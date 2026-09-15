/**
 * Mission Europa Resource e. V. — donation backend.
 *
 * Deploy as a Web App (see README.md in this folder). Receives POST
 * requests from donate.html / thank-you.html, talks to Stripe and
 * PayPal to create/confirm payments, appends a row to the Google
 * Sheet tab matching the current year, and sends a thank-you email.
 *
 * All secrets (Stripe secret key, PayPal client id/secret, the
 * Spreadsheet ID) live in Script Properties — never in this file.
 * Project Settings (gear icon) → Script Properties → Add property.
 */

// Flip to 'live' once real Stripe/PayPal credentials are in Script
// Properties (STRIPE_SECRET_KEY_LIVE, PAYPAL_CLIENT_ID_LIVE, PAYPAL_SECRET_LIVE).
const MODE = 'test';

function getConfig_() {
  const p = PropertiesService.getScriptProperties();
  const live = MODE === 'live';
  return {
    mode: MODE,
    sheetId: p.getProperty('SHEET_ID'),
    stripeSecretKey: p.getProperty(live ? 'STRIPE_SECRET_KEY_LIVE' : 'STRIPE_SECRET_KEY_TEST'),
    paypalClientId: p.getProperty(live ? 'PAYPAL_CLIENT_ID_LIVE' : 'PAYPAL_CLIENT_ID_TEST'),
    paypalSecret: p.getProperty(live ? 'PAYPAL_SECRET_LIVE' : 'PAYPAL_SECRET_TEST'),
    paypalApiBase: live ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
    orgEmail: p.getProperty('ORG_EMAIL') || 'mer@mer-verein.de',
    orgName: 'Mission Europa Resource e. V.',
    // Used only in the "donation under 300 €" thank-you email paragraph,
    // which doubles as the simplified proof of donation (§ 50 Abs. 4
    // EStDV) donors can hand to their Finanzamt together with their
    // payment receipt. Fill these in via Script Properties once the
    // Freistellungsbescheid is on hand — until then the email still
    // sends, just with visible [BRACKET] placeholders.
    finanzamt: p.getProperty('FINANZAMT') || '[FINANZAMT]',
    freistellungDatum: p.getProperty('FREISTELLUNG_DATUM') || '[DATUM]',
    steuernummer: p.getProperty('STEUERNUMMER') || '[STEUERNUMMER]',
  };
}

const SHEET_HEADERS = [
  'Datum', 'Name, Vorname', 'Straße, Nr.', 'PLZ, Ort', 'E-Mail',
  'Betrag (€)', 'Zahlungsart', 'Zuwendungsbestätigung', 'Transaktions-ID', 'Projekt', 'Telefon', 'Nachricht',
  'DSGVO-Einwilligung',
];

// ── HTTP entry points ──────────────────────────────────────────────

function doGet() {
  return ContentService
    .createTextOutput('Mission Europa donation backend is running. Use POST.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  let result;
  try {
    const body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'createStripeSession':
        result = createStripeSession_(body);
        break;
      case 'confirmStripeSession':
        result = confirmStripeSession_(body);
        break;
      case 'logPayPalDonation':
        result = logPayPalDonation_(body);
        break;
      default:
        result = { ok: false, error: 'Unknown action: ' + body.action };
    }
  } catch (err) {
    result = { ok: false, error: String(err) };
  }
  return jsonOutput_(result);
}

function jsonOutput_(obj) {
  // Plain JSON response. The frontend posts with Content-Type:
  // text/plain specifically so the browser treats it as a "simple
  // request" and skips the CORS preflight — Apps Script Web Apps
  // don't implement doOptions(), so a real preflight would 404.
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── Stripe (test/live via MODE) ────────────────────────────────────

function createStripeSession_(body) {
  const cfg = getConfig_();
  if (!cfg.stripeSecretKey) return { ok: false, error: 'Stripe-Key fehlt in den Script Properties.' };

  const donor = body.donor || {};
  const amountCents = Math.round(Number(body.amount) * 100);
  if (!amountCents || amountCents < 100) return { ok: false, error: 'Ungültiger Betrag.' };

  if (!body.successUrl) return { ok: false, error: 'successUrl fehlt.' };
  const paymentMethodType = body.method === 'sepa_debit' ? 'sepa_debit' : 'card';
  const successUrl = body.successUrl + (body.successUrl.indexOf('?') === -1 ? '?' : '&') + 'session_id={CHECKOUT_SESSION_ID}';

  const params = {
    'mode': 'payment',
    'payment_method_types[0]': paymentMethodType,
    'line_items[0][price_data][currency]': String(body.currency || 'eur').toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(amountCents),
    'line_items[0][price_data][product_data][name]': 'Spende – ' + cfg.orgName,
    'line_items[0][quantity]': '1',
    'success_url': successUrl,
    'cancel_url': body.cancelUrl || successUrl,
    'customer_email': donor.email || '',
    'metadata[firstName]': donor.firstName || '',
    'metadata[lastName]': donor.lastName || '',
    'metadata[phone]': donor.phone || '',
    'metadata[street]': donor.street || '',
    'metadata[zip]': donor.zip || '',
    'metadata[city]': donor.city || '',
    'metadata[email]': donor.email || '',
    'metadata[project]': donor.project || '',
    'metadata[language]': donor.language || 'de',
    'metadata[receipt]': donor.receipt || 'Nein',
    'metadata[gdprConsentAt]': donor.gdprConsentAt || '',
    // Stripe metadata values are capped at 500 characters — truncate
    // rather than let a long message break session creation entirely.
    'metadata[message]': String(donor.message || '').slice(0, 500),
  };

  const resp = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + cfg.stripeSecretKey },
    payload: params,
    muteHttpExceptions: true,
  });
  const data = JSON.parse(resp.getContentText());
  if (data.error) return { ok: false, error: data.error.message };
  return { ok: true, url: data.url, id: data.id };
}

function confirmStripeSession_(body) {
  const cfg = getConfig_();
  const sessionId = body.sessionId;
  if (!sessionId) return { ok: false, error: 'sessionId fehlt.' };
  if (!cfg.stripeSecretKey) return { ok: false, error: 'Stripe-Key fehlt in den Script Properties.' };

  if (isAlreadyProcessed_(sessionId)) return { ok: true, alreadyProcessed: true };

  // customer_details (email/name/phone/address) is already included by
  // default on a Checkout Session — no expand needed.
  const resp = UrlFetchApp.fetch(
    'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId),
    { headers: { Authorization: 'Bearer ' + cfg.stripeSecretKey }, muteHttpExceptions: true }
  );
  const session = JSON.parse(resp.getContentText());
  if (session.error) return { ok: false, error: session.error.message };
  if (session.payment_status !== 'paid') return { ok: false, error: 'Zahlung noch nicht abgeschlossen (Status: ' + session.payment_status + ').' };

  const md = session.metadata || {};
  const donor = {
    firstName: md.firstName || '',
    lastName: md.lastName || '',
    phone: md.phone || '',
    street: md.street || '',
    zip: md.zip || '',
    city: md.city || '',
    email: (session.customer_details && session.customer_details.email) || md.email || '',
    amount: (session.amount_total || 0) / 100,
    receipt: md.receipt || 'Nein',
    language: md.language || 'de',
    project: md.project || '',
    message: md.message || '',
    gdprConsentAt: md.gdprConsentAt || '',
    method: (session.payment_method_types || ['card'])[0],
  };

  appendDonationRow_(donor, 'Stripe (' + (session.payment_method_types || ['card']).join('/') + ')', sessionId);
  sendThankYouEmail_(donor);
  return { ok: true, donor };
}

// ── PayPal (sandbox/live via MODE) ─────────────────────────────────

function getPayPalAccessToken_(cfg) {
  const resp = UrlFetchApp.fetch(cfg.paypalApiBase + '/v1/oauth2/token', {
    method: 'post',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(cfg.paypalClientId + ':' + cfg.paypalSecret) },
    payload: { grant_type: 'client_credentials' },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(resp.getContentText());
  if (!data.access_token) throw new Error('PayPal-Token-Fehler: ' + resp.getContentText());
  return data.access_token;
}

// The client only gets the buyer's approval (order status APPROVED) —
// the charge itself has to be captured server-side to reach COMPLETED.
// If it was already captured (e.g. a retried/duplicate request), PayPal
// answers 422 ORDER_ALREADY_CAPTURED; fall back to fetching the order
// instead of treating that as an error.
function capturePayPalOrder_(cfg, token, orderId) {
  const resp = UrlFetchApp.fetch(cfg.paypalApiBase + '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: '{}',
    muteHttpExceptions: true,
  });
  let order = JSON.parse(resp.getContentText());
  const alreadyCaptured = resp.getResponseCode() === 422 &&
    ((order.details || [])[0] || {}).issue === 'ORDER_ALREADY_CAPTURED';
  if (alreadyCaptured) {
    const getResp = UrlFetchApp.fetch(cfg.paypalApiBase + '/v2/checkout/orders/' + encodeURIComponent(orderId), {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    order = JSON.parse(getResp.getContentText());
  }
  if (order.status !== 'COMPLETED') {
    return { error: order.message || ('PayPal-Zahlung nicht abgeschlossen (Status: ' + order.status + ').') };
  }
  return order;
}

function logPayPalDonation_(body) {
  const cfg = getConfig_();
  const orderId = body.orderId;
  const donor = body.donor || {};
  if (!orderId) return { ok: false, error: 'orderId fehlt.' };
  if (!cfg.paypalClientId || !cfg.paypalSecret) return { ok: false, error: 'PayPal-Zugangsdaten fehlen in den Script Properties.' };

  if (isAlreadyProcessed_(orderId)) return { ok: true, alreadyProcessed: true };

  const token = getPayPalAccessToken_(cfg);
  const order = capturePayPalOrder_(cfg, token, orderId);
  if (order.error) return { ok: false, error: order.error };

  const purchaseUnit = (order.purchase_units || [])[0] || {};
  const capture = ((purchaseUnit.payments || {}).captures || [])[0] || {};
  const amount = parseFloat((capture.amount || {}).value || donor.amount || 0);

  // Identity fields must come from PayPal's own verified order, not from
  // the client-submitted donor object — otherwise a tampered request could
  // send the receipt/thank-you email to someone other than the actual
  // payer (same reasoning as confirmStripeSession_ trusting
  // session.customer_details.email over client-supplied metadata).
  // PayPal doesn't return a billing street/zip/city for a plain capture
  // without shipping, so those still come from what the donor typed in.
  const payer = order.payer || {};
  const payerName = payer.name || {};
  donor.email = payer.email_address || donor.email || '';
  donor.firstName = payerName.given_name || donor.firstName || '';
  donor.lastName = payerName.surname || donor.lastName || '';
  donor.amount = amount;
  donor.method = 'paypal';

  appendDonationRow_(donor, 'PayPal', orderId);
  sendThankYouEmail_(donor);
  return { ok: true, donor };
}

// ── Sheet ───────────────────────────────────────────────────────────

function getYearSheet_() {
  const cfg = getConfig_();
  if (!cfg.sheetId) throw new Error('SHEET_ID fehlt in den Script Properties.');
  const ss = SpreadsheetApp.openById(cfg.sheetId);
  const year = String(new Date().getFullYear());
  let sheet = ss.getSheetByName(year);
  if (!sheet) {
    sheet = ss.insertSheet(year);
    sheet.appendRow(SHEET_HEADERS);
    sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function isAlreadyProcessed_(txnId) {
  const sheet = getYearSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const txnCol = SHEET_HEADERS.indexOf('Transaktions-ID') + 1;
  const ids = sheet.getRange(2, txnCol, lastRow - 1, 1).getValues();
  return ids.some(row => row[0] === txnId);
}

// Google Sheets treats a cell as a formula whenever its text starts with
// =, +, - or @ — a donor typing e.g. "=HYPERLINK(...)" as their name would
// otherwise get evaluated as a formula. Prefixing with a literal apostrophe
// forces Sheets to treat the cell as plain text.
function sanitizeCell_(value) {
  const str = String(value == null ? '' : value);
  return /^[=+\-@]/.test(str) ? "'" + str : str;
}

// Renders the GDPR consent audit trail as one text cell, e.g.
// "Ja (12.09.2026 17:04 Europe/Berlin)". Combining "Ja" with the
// timestamp (rather than a bare date) also keeps Sheets from trying to
// auto-parse the cell as a date/number.
function formatConsent_(isoTimestamp) {
  if (!isoTimestamp) return '';
  const date = new Date(isoTimestamp);
  if (isNaN(date.getTime())) return '';
  const formatted = Utilities.formatDate(date, 'Europe/Berlin', 'dd.MM.yyyy HH:mm');
  return 'Ja (' + formatted + ' Europe/Berlin)';
}

function appendDonationRow_(donor, zahlungsart, txnId) {
  const sheet = getYearSheet_();
  const fullName = sanitizeCell_([donor.lastName, donor.firstName].filter(Boolean).join(', '));
  const plzOrt = sanitizeCell_([donor.zip, donor.city].filter(Boolean).join(', '));
  sheet.appendRow([
    new Date(),
    fullName,
    sanitizeCell_(donor.street || ''),
    plzOrt,
    sanitizeCell_(donor.email || ''),
    donor.amount || '',
    zahlungsart,
    donor.receipt === 'Ja' ? 'Ja' : 'Nein',
    txnId,
    sanitizeCell_(donor.project || ''),
    sanitizeCell_(donor.phone || ''),
    sanitizeCell_(donor.message || ''),
    formatConsent_(donor.gdprConsentAt),
  ]);
}

// ── Email ───────────────────────────────────────────────────────────

const METHOD_LABELS = {
  de: { card: 'Kreditkarte', sepa_debit: 'SEPA-Lastschrift', paypal: 'PayPal' },
  en: { card: 'card', sepa_debit: 'SEPA Direct Debit', paypal: 'PayPal' },
  ru: { card: 'карта', sepa_debit: 'SEPA-дебет', paypal: 'PayPal' },
  uk: { card: 'картка', sepa_debit: 'SEPA-дебет', paypal: 'PayPal' },
};

// Two donation-certificate paragraphs per language, inserted before the
// sign-off — which one applies depends on whether the donation reaches
// the 300 € threshold in § 50 Abs. 4 EStDV:
//  - under 300 €: no official Zuwendungsbestätigung is required: this
//    email, naming our Freistellungsbescheid, together with the donor's
//    own payment receipt is already sufficient simplified proof.
//  - 300 € or more: a real Zuwendungsbestätigung is legally required for
//    the tax deduction, so we tell the donor one is coming.
const CERT_TEXTS = {
  de: {
    under300: (org, finanzamt, datum, steuernummer) =>
      org + ' ist als gemeinnützig anerkannt (Freistellungsbescheid des Finanzamts ' + finanzamt +
      ' vom ' + datum + ', Steuernummer ' + steuernummer + '). Ihre Zuwendung erfolgte freiwillig und ohne ' +
      'Gegenleistung. Für Spenden bis 300 € genügt dem Finanzamt dieser Nachweis zusammen mit Ihrem ' +
      'Zahlungsbeleg (§ 50 Abs. 4 EStDV) — eine gesonderte Zuwendungsbestätigung ist in der Regel nicht nötig.',
    over300: () =>
      'Da Ihre Spende 300 € übersteigt, benötigen Sie für den steuerlichen Abzug eine offizielle ' +
      'Zuwendungsbestätigung. Wir stellen sie Ihnen in den kommenden Tagen kostenlos per E-Mail bzw. Post aus.',
  },
  en: {
    under300: (org, finanzamt, datum, steuernummer) =>
      org + ' is officially recognised as a charitable organisation (Freistellungsbescheid issued by Finanzamt ' +
      finanzamt + ' on ' + datum + ', tax number ' + steuernummer + '). Your donation was made voluntarily and ' +
      'without any consideration in return. For donations up to €300, this letter together with your payment ' +
      'receipt is sufficient proof for German tax authorities (§ 50 para. 4 EStDV) — a separate certificate is ' +
      'usually not required.',
    over300: () =>
      'As your donation exceeds €300, you will need an official donation certificate (Zuwendungsbestätigung) ' +
      'for the tax deduction. We will issue and send it to you free of charge within the next few days, by ' +
      'email or post.',
  },
  ru: {
    under300: (org, finanzamt, datum, steuernummer) =>
      org + ' официально признана общественно полезной организацией (Freistellungsbescheid, налоговая ' +
      'инспекция ' + finanzamt + ', от ' + datum + ', Steuernummer ' + steuernummer + '). Ваше пожертвование ' +
      'было добровольным и без встречного предоставления. Для пожертвований до 300 € налоговой достаточно ' +
      'этого письма вместе с банковской выпиской (§ 50 Abs. 4 EStDV) — отдельная справка обычно не требуется.',
    over300: () =>
      'Поскольку сумма вашего пожертвования превышает 300 €, для налогового вычета вам потребуется ' +
      'официальная Zuwendungsbestätigung. Мы оформим и вышлем её вам в течение нескольких дней по e-mail ' +
      'или почте — бесплатно.',
  },
  uk: {
    under300: (org, finanzamt, datum, steuernummer) =>
      org + ' офіційно визнана суспільно корисною організацією (Freistellungsbescheid, податкова інспекція ' +
      finanzamt + ', від ' + datum + ', Steuernummer ' + steuernummer + '). Ваше пожертвування було ' +
      'добровільним і без зустрічного надання. Для пожертв до 300 € податковій достатньо цього листа разом ' +
      'із банківською випискою (§ 50 Abs. 4 EStDV) — окрема довідка зазвичай не потрібна.',
    over300: () =>
      'Оскільки сума вашого пожертвування перевищує 300 €, для податкового вирахування вам знадобиться ' +
      'офіційна довідка (Zuwendungsbestätigung). Ми оформимо та надішлемо її вам протягом кількох днів ' +
      'електронною поштою або поштою — безкоштовно.',
  },
};

const EMAIL_TEXTS = {
  de: {
    subject: 'Vielen Dank für Ihre Spende!',
    body: (name, amount, org, datetime, method, certParagraph) =>
      'Liebe(r) ' + (name || 'Spender(in)') + ',\n\n' +
      'vielen herzlichen Dank für Ihre Spende in Höhe von ' + amount + ' am ' + datetime +
      ' (Zahlungsart: ' + method + ') an ' + org + '\n\n' +
      'Ihre Unterstützung hilft uns, unsere Projekte für Geflüchtete und ihre Kinder in Deutschland fortzuführen.\n\n' +
      certParagraph + '\n\n' +
      'Mit herzlichen Grüßen\nIhr Team von ' + org,
  },
  en: {
    subject: 'Thank you for your donation!',
    body: (name, amount, org, datetime, method, certParagraph) =>
      'Dear ' + (name || 'Supporter') + ',\n\n' +
      'Thank you very much for your donation of ' + amount + ' on ' + datetime +
      ' (payment method: ' + method + ') to ' + org + '\n\n' +
      'Your support helps us continue our projects for refugees and their children in Germany.\n\n' +
      certParagraph + '\n\n' +
      'Warm regards,\nThe ' + org + ' team',
  },
  ru: {
    subject: 'Спасибо за ваше пожертвование!',
    body: (name, amount, org, datetime, method, certParagraph) =>
      'Уважаем(ый/ая) ' + (name || 'жертвователь') + ',\n\n' +
      'Большое спасибо за ваше пожертвование в размере ' + amount + ' от ' + datetime +
      ' (способ оплаты: ' + method + ') в пользу ' + org + '\n\n' +
      'Ваша поддержка помогает нам продолжать проекты для беженцев и их детей в Германии.\n\n' +
      certParagraph + '\n\n' +
      'С уважением,\nКоманда ' + org,
  },
  uk: {
    subject: 'Дякуємо за ваш благодійний внесок!',
    body: (name, amount, org, datetime, method, certParagraph) =>
      'Шановний(а) ' + (name || 'жертводавцю') + ',\n\n' +
      'Щиро дякуємо за ваш внесок у розмірі ' + amount + ' від ' + datetime +
      ' (спосіб оплати: ' + method + ') на користь ' + org + '\n\n' +
      'Ваша підтримка допомагає нам продовжувати проєкти для біженців та їхніх дітей у Німеччині.\n\n' +
      certParagraph + '\n\n' +
      'З повагою,\nКоманда ' + org,
  },
};

function sendThankYouEmail_(donor) {
  if (!donor.email) return;
  const cfg = getConfig_();
  const lang = EMAIL_TEXTS[donor.language] ? donor.language : 'de';
  const texts = EMAIL_TEXTS[lang];
  const certTexts = CERT_TEXTS[lang];
  const amountValue = Number(donor.amount) || 0;
  const amountStr = amountValue.toFixed(2).replace('.', ',') + ' €';
  const datetime = Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy, HH:mm') + ' Uhr (Europe/Berlin)';
  const methodLabel = (METHOD_LABELS[lang] && METHOD_LABELS[lang][donor.method]) || donor.method || '–';
  // § 50 Abs. 4 EStDV: below 300 € the simplified proof (this email +
  // payment receipt) is enough; at/above 300 € an official
  // Zuwendungsbestätigung is legally required.
  const certParagraph = amountValue >= 300
    ? certTexts.over300()
    : certTexts.under300(cfg.orgName, cfg.finanzamt, cfg.freistellungDatum, cfg.steuernummer);
  MailApp.sendEmail({
    to: donor.email,
    subject: texts.subject,
    body: texts.body(donor.firstName, amountStr, cfg.orgName, datetime, methodLabel, certParagraph),
    name: cfg.orgName,
  });
}
