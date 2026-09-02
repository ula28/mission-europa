---
description: Правила дизайн-токенов и каскадных слоёв проекта Mission Europa. Используй при написании или правке любого CSS.
---

## Токены (:root в @layer tokens)

Три уровня, в этом порядке:

1. Primitives — сырая палитра: --white, --off-white, --gray-100…700,
   --ink-950, --navy-900, --navy-800, --orange-500/600, --sky-600/700,
   --violet-700/800/100/500. Никогда не использовать напрямую в
   компонентах.
2. Semantic — по назначению: --black, --accent, --accent-dk, --blue,
   --blue-dk, --color-brand-accent(-dk), --color-surface-dark,
   --color-surface-darkest, --color-text-muted, --parasol-*.
   Ссылаются только на primitives.
3. Component — для одного конкретного компонента: --btn-dark-bg,
   --btn-dark-bg-hover. Ссылаются только на semantic.

Перед тем как написать новый hex-цвет — сначала проверь, нет ли уже
подходящего primitive/semantic токена (частая причина рассинхрона:
кто-то на глаз подбирает близкий, но не тот же самый цвет).

## Cascade layers

Порядок: @layer reset, tokens, base, components, pages, utilities;
объявлен в начале style.css.

- reset — сброс стилей браузера
- tokens — :root с токенами
- base — типографика, .wrap, .section
- components — переиспользуемые части (nav, btn, footer, chip и т.д.)
- pages — стили конкретных секций главной страницы
- utilities — точечные переопределения (например .nav__lang-sep)

Переопределение через !important запрещено — вместо этого разместить
правило в более позднем слое, который выигрывает по порядку слоёв
независимо от специфичности селектора.

## Известный долг

Секция PARASOLKA PROJECT PAGE (pp-* классы) и .scroll-top пока НЕ
обёрнуты в @layer — это осознанно вне скоупа последнего рефакторинга.
Часть pp-* стилей всё ещё использует var(--gray-500) напрямую вместо
var(--color-text-muted). Не трогать это самостоятельно без отдельной
задачи — не пытаться "исправить заодно".
