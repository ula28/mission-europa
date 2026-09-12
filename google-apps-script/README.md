# Spenden-Backend (Google Apps Script)

Dieses Script empfängt die Formulardaten von `donate.html` /
`thank-you.html`, erstellt Stripe-Checkout-Sessions, prüft PayPal-
Zahlungen, schreibt jede erfolgreiche Spende in die passende
Jahres-Tabelle der Google-Tabelle und verschickt eine automatische
Dankes-E-Mail.

Google Tabelle: https://docs.google.com/spreadsheets/d/15LR78T3u6JWAaTSDWi5c1D4U-BbdGHMixQaM4_su5gw/edit

## 1. Einrichtung

1. Öffne die Google Tabelle oben und notiere dir ihre **Spreadsheet-ID**
   (der Teil der URL zwischen `/d/` und `/edit`, hier:
   `15LR78T3u6JWAaTSDWi5c1D4U-BbdGHMixQaM4_su5gw`).
2. In der Tabelle: **Erweiterungen → Apps Script**.
3. Den Inhalt von `Code.gs` aus diesem Ordner reinkopieren (die
   Standarddatei `Code.gs`/`myFunction()` ersetzen).
4. **Projekteinstellungen** (Zahnrad-Symbol links) → **Script-Properties**
   → **Property hinzufügen**. Folgende Properties anlegen:

   | Property | Wert |
   |---|---|
   | `SHEET_ID` | die Spreadsheet-ID aus Schritt 1 |
   | `STRIPE_SECRET_KEY_TEST` | dein Stripe **Test**-Secret-Key (`sk_test_...`) |
   | `PAYPAL_CLIENT_ID_TEST` | dein PayPal **Sandbox**-Client-ID |
   | `PAYPAL_SECRET_TEST` | dein PayPal **Sandbox**-Secret |
   | `ORG_EMAIL` | `mer@mer-verein.de` (Absender-Referenz, optional) |

   Stripe-Test-Keys: https://dashboard.stripe.com/test/apikeys
   PayPal-Sandbox-Apps: https://developer.paypal.com/dashboard/applications/sandbox

   Für den Produktivbetrieb später zusätzlich `STRIPE_SECRET_KEY_LIVE`,
   `PAYPAL_CLIENT_ID_LIVE`, `PAYPAL_SECRET_LIVE` eintragen und in
   `Code.gs` die Konstante `MODE` von `'test'` auf `'live'` umstellen —
   das ist die einzige Stelle im Code, die für den Umstieg auf echte
   Zahlungen geändert werden muss.

## 2. Als Web App veröffentlichen

1. Oben rechts **Bereitstellen → Neue Bereitstellung**.
2. Typ: **Web App**.
3. **Ausführen als:** Ich (dein Google-Konto).
4. **Wer hat Zugriff:** Jeder (`Anyone`) — nötig, damit die Website
   (Netlify) das Script ohne Google-Login aufrufen kann.
5. **Bereitstellen** klicken, Berechtigungen bestätigen (Google warnt
   wegen des unverifizierten Scripts — das ist normal für ein eigenes
   Script, "Erweitert" → "Zu [Projekt] wechseln (unsicher)" wählen).
6. Die angezeigte **Web-App-URL** (endet auf `/exec`) kopieren.

## 3. Frontend verbinden

In **beiden** Dateien `donate.html` und `thank-you.html` den Platzhalter
`PAYMENT_CONFIG.BACKEND_URL` durch die eben kopierte `/exec`-URL ersetzen:

```js
const PAYMENT_CONFIG = {
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycb.../exec', // ← hier
  ...
};
```

In `donate.html` zusätzlich `PAYMENT_CONFIG.PAYPAL_CLIENT_ID` durch
deine PayPal-**Sandbox**-Client-ID ersetzen (dieselbe wie
`PAYPAL_CLIENT_ID_TEST` oben — Client-IDs sind clientseitig sichtbar,
das ist bei PayPal so vorgesehen; **Secrets bleiben immer nur in den
Script Properties**, nie im HTML/JS).

> Jede erneute Codeänderung in `Code.gs` erfordert eine **neue
> Bereitstellung** (Bereitstellen → Bereitstellungen verwalten →
> Bearbeiten-Stift → neue Version) — sonst läuft weiter die alte
> Codeversion.

## 4. Testmodus prüfen

Mit den `_TEST`-Properties aus Schritt 1 ist alles automatisch im
Testmodus — es fließt kein echtes Geld.

**Stripe (Karte/SEPA):**
1. `donate.html` öffnen, Formular ausfüllen, Zahlungsart "Kreditkarte"
   oder "SEPA-Lastschrift" wählen, absenden.
2. Auf der Stripe-Checkout-Seite Testkarte `4242 4242 4242 4242`
   verwenden, beliebiges zukünftiges Ablaufdatum, beliebige CSC/PLZ.
   Für SEPA-Test-IBAN: `DE89370400440532013000` (siehe
   https://docs.stripe.com/testing).
3. Nach Bezahlung landet man auf `thank-you.html?session_id=...` —
   das Script bestätigt die Session, schreibt die Zeile in die
   Tabelle (Tab mit dem aktuellen Jahr) und verschickt die
   Dankes-Mail an die eingegebene Adresse.

**PayPal (Sandbox):**
1. Unter https://developer.paypal.com/dashboard/accounts einen
   Sandbox-Testkäufer-Account anlegen (oder den automatisch
   erstellten "personal"-Account nutzen).
2. `donate.html` öffnen, Zahlungsart "PayPal" wählen → PayPal-Button
   erscheint. Mit dem Sandbox-Testkäufer einloggen und bezahlen.
3. Direkt danach erscheint `thank-you.html?provider=paypal` und die
   Zeile in der Tabelle.

**Kontrolle:**
- In der Google Tabelle sollte ein Tab mit dem aktuellen Jahr (z. B.
  `2026`) automatisch entstanden sein, mit den Spalten `Datum`,
  `Name, Vorname`, `Straße, Nr.`, `PLZ, Ort`, `E-Mail`, `Betrag (€)`,
  `Zahlungsart`, `Spendenbescheinigung`, `Transaktions-ID`, `Projekt`,
  `Telefon`, `Nachricht`, `DSGVO-Einwilligung` (die Spalte
  `Transaktions-ID` dient nur der internen Zuordnung/Vermeidung
  doppelter Zeilen bei einem Seiten-Reload und kann ausgeblendet
  werden).
- Falls ihr einen Jahres-Tab schon manuell angelegt habt (z. B. für
  Tests), bevor das Script ihn automatisch erstellen konnte: das
  Script schreibt Kopfzeilen nur beim automatischen Erstellen eines
  neuen Tabs. In einem bereits vorhandenen Tab bitte die Spalten
  `Projekt`, `Telefon`, `Nachricht` und `DSGVO-Einwilligung` einmalig
  selbst als letzte Spaltenüberschriften ergänzen — sonst landen die
  Werte zwar korrekt in der jeweils letzten Spalte, aber ohne
  passende Überschrift.

## 6. DSGVO-Einwilligung (Nachweis)

Jede Zeile trägt in der Spalte `DSGVO-Einwilligung` einen Nachweis wie
`Ja (12.09.2026 17:04 Europe/Berlin)` — Zeitpunkt, zu dem die
Einwilligungs-Checkbox beim Absenden des Formulars nachweislich
angehakt war (nicht der spätere Zeitpunkt der Zahlungsbestätigung).
Da das Formular ohne angehakte Checkbox gar nicht abgeschickt werden
kann, gibt es hier nie ein "Nein" — jede Zeile in der Tabelle ist
automatisch ein Beleg für eine erteilte Einwilligung zum
Zeitpunkt der Spende.
- Apps Script → **Ausführungen** (linkes Menü) zeigt jeden Aufruf und
  eventuelle Fehler — der erste Blick bei Problemen.

## 5. Wichtige Hinweise

- **Nie** einen Stripe-Secret-Key oder ein PayPal-Secret ins HTML/JS
  der Website schreiben — nur in die Apps-Script-Properties. Nur der
  Stripe **Publishable**-Key bzw. der PayPal **Client-ID** dürfen
  öffentlich sein, und die werden hier ohnehin nicht clientseitig für
  Stripe benötigt (die Weiterleitung läuft über die von Apps Script
  erzeugte Checkout-URL).
- Der Frontend-Request an Apps Script wird bewusst mit
  `Content-Type: text/plain` gesendet, nicht `application/json` — das
  vermeidet einen CORS-Preflight (`OPTIONS`), den Apps-Script-Web-Apps
  nicht beantworten. `Code.gs` parst den Text-Body selbst als JSON.
- Die Zahlungsbestätigung (Betrag + Zahlungsstatus) wird serverseitig
  bei Stripe bzw. PayPal **erneut abgefragt**, bevor etwas in die
  Tabelle geschrieben wird — dem Browser wird nur die Kontakt-/
  Adressangabe geglaubt, nie Betrag oder Zahlungsstatus.
