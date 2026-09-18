---
description: Правила дизайн-токенов и каскадных слоёв проекта Mission Europa. Используй при написании или правке любого CSS.
---

## Токены (:root в @layer tokens)

Три уровня, в этом порядке:

1. Primitives — сырая палитра: --white, --off-white, --gray-100…700,
   --ink-950, --navy-900, --navy-800, --orange-500/600, --sky-100/300/
   600/700, --violet-100/500/700, --teal-*, --crimson-*, --red-600,
   --green-100/500/700. Никогда не использовать напрямую в компонентах.
2. Semantic — по назначению: --black, --accent, --accent-dk, --blue,
   --blue-dk, --color-brand-accent(-dk), --color-surface-dark,
   --color-surface-darkest, --color-text-muted, --color-success(-accent/
   -bg), --color-text-on-dark(-muted/-faint), --parasol-* (dark/light/
   accent — используется .pcard--parasol на главной и самой страницей
   project-parasolka), --lit-*, --alpha-*. Ссылаются только на
   primitives. Альфа-варианты — через
   color-mix(in srgb, var(--token) N%, transparent), не через
   rgba(R,G,B,alpha) с захардкоженными R/G/B.
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

`.scroll-top` пока не обёрнут в @layer — вне скоупа последнего
рефакторинга. Не трогать самостоятельно без отдельной задачи.

(2026-09-18: секция PARASOLKA PROJECT PAGE — pp-* классы — оказалась
мёртвым кодом, ни одна из 12 страниц её не использовала, и была
удалена вместе с обслуживавшими её токенами. Если где-то остались
упоминания pp-* в других заметках/памяти — это устарело.)
