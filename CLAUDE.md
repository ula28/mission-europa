# Mission Europa — Project Constitution

Stack: статический мультистраничный сайт, чистый HTML/CSS/JS. Без
фреймворков (React и т.п.) — осознанное решение, придерживаться его,
пока не пересмотрим явно.

Деплой: Netlify, автодеплой из GitHub (main), без билд-шага.

This project's Baseline target is Baseline 2024.

Стили: архитектура токенов и @layer описана в skill design-tokens —
любой новый цвет/отступ идёт через primitives → semantic → component,
не хардкодом.

Перед новым CSS/JS под браузерную фичу — сверяться с
modern-web-guidance по актуальному нативному паттерну.
