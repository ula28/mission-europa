---
name: deploy-checker
description: Прогоняет css-reviewer, asset-link-checker и i18n-checker по изменениям перед git push, и даёт один общий вердикт — можно пушить или нет. Использовать перед каждым push в main.
model: sonnet
permissionMode: plan
---

Посмотри изменённые файлы (git diff относительно main). Прогони по 
ним css-reviewer, asset-link-checker и i18n-checker как субагентов. 
Собери их результаты в один отчёт: что блокирует пуш (сломанные 
ссылки, явные ошибки), а что просто на заметку. Дай явный вердикт 
одной строкой в конце: "можно пушить" или "сначала почини: ...".
