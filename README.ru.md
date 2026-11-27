<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/banner-dark.svg"><img src="docs/img/banner.svg" alt="Stratus"></picture>
</p>

<p align="center"><a href="README.md">English</a> | <b>Русский</b></p>

<p align="center">Claude планирует каждую задачу вместе с вами, агенты-помощники собирают и проверяют её, а проверки ловят ложные заявления; в комплекте расширения для редактора <a href="https://nimbalyst.com">Nimbalyst</a> и приложение в Telegram для ваших сессий.</p>

<p align="center">Работает на Claude Code, в Nimbalyst или в терминале. Полнее всего на Windows; большая часть работает и на macOS.</p>

<p align="center">
  <a href="https://github.com/tigran-martirosian/ai-coding-setup/releases/latest"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftigran-martirosian%2Fai-coding-setup%2Fmain%2Fversion.json&query=%24.version&label=release&prefix=v&color=blue" alt="Последний релиз"></a>
  <a href="https://github.com/tigran-martirosian/ai-coding-setup/actions/workflows/tests.yml"><img src="https://github.com/tigran-martirosian/ai-coding-setup/actions/workflows/tests.yml/badge.svg?branch=main" alt="Тесты"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-source--available%2C%20not%20open%20source-blue" alt="Лицензия: код открыт для чтения, но это не open source"></a>
  <img src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS-lightgrey" alt="Платформы: Windows и macOS">
</p>

<p align="center">
  <a href="#установка">Установка</a> · <a href="docs/getting-started.md">Первые шаги</a> · <a href="docs/how-it-works/overview.md">Как это устроено</a> · <a href="docs/README.md">Документация</a>
</p>

https://github.com/user-attachments/assets/6384f243-b336-4dae-b890-b14bfb9e6847

- **Большие задачи с планом и ревью.** Вопросы, спек, помощники, которые параллельно собирают части, ревью по спеку.
- **Заявления сверяются с журналом.** Хуки сравнивают заявления Claude с журналом Claude Code и возвращают ложное заявление на исправление.
- **Стражи на опасных командах.** Разрушительный SQL и push, в котором есть секретный ключ, сначала спрашивают вас.
- **Расширения для редактора Nimbalyst.** Страница для каждой задачи, работающие помощники, кнопка команд, расход лимитов, карта частей проекта, темы.
- **Расход подписки на виду.** Напишите `usage`, чтобы увидеть расход токенов и подписки и прогноз лимита.
- **Приложение для телефона.** Мини-приложение Telegram, чтобы следить за сессиями и отвечать в них.

## Требования и платформы

Нужны Claude Code (2.1.321 или новее), в котором вы вошли в аккаунт, и Node.js 18 или новее (22.5 для части функций Nimbalyst: [Зависимости](docs/reference/dependencies.md)). Лучше всего подходит тариф Max: ревью идут на Fable, самой большой модели Anthropic. На тарифе Pro за $20 ревью идут на Opus. API-ключам, Bedrock и Vertex нужен доступ к Fable. Nimbalyst, настольный редактор для чатов Claude Code, не обязателен ([что без него не работает](docs/reference/platforms.md#terminal-claude-code-and-nimbalyst)). На Linux не проверялось.

| | Windows | macOS |
|---|---|---|
| Правила, хуки, скиллы, помощники, расширения Nimbalyst | Да | Да |
| Nimbalyst обновляется и патчится через Stratus | Да | Нет |
| Прогноз расхода подписки | Да | Нет |
| Дополнения: приложение для телефона, Read Aloud (ответы вслух) | Да | Нет |

Полный список: [Windows и macOS](docs/reference/platforms.md).

## Установка

> [!IMPORTANT]
> Код Stratus открыт для чтения, но это не open source. Свою копию можно использовать и менять, но нельзя публиковать, передавать или продавать ([LICENSE](LICENSE)).

Распакуйте ZIP репозитория или клонируйте его в папку, которую вы сохраните до первого обновления ([почему](docs/how-it-works/install.md#keep-the-folder-you-installed-from)), и запустите в ней один из вариантов.

**Вариант 1: полная установка под руководством Claude.** Claude спросит, какие у вас подписки, установит и настроит Nimbalyst, Node.js и другие программы, а потом Stratus, по [этим шагам](docs/full-install.md).

```
claude "Read docs/full-install.md and carry out every step in it."
```

**Вариант 2: только файлы Stratus.** Для терминала или уже установленного Nimbalyst. Установщик добавляет:

- файлы Stratus и его настройки Claude Code;
- четыре плагина Claude Code и один скилл, все от других авторов ([какие](docs/using/install-and-update.md#what-the-install-sets-up));
- расширения Nimbalyst, если Nimbalyst установлен;
- две папки в `~/Projects`: `quick-tasks` для разовых просьб, `claude-settings` для изменений в самом Stratus.

```
node install.mjs --dry-run
node install.mjs
```

`--dry-run` показывает, что изменится. `--plugins no`, `--extensions no` и `--no-theme` пропускают по одной части; `--with phone-bot,read-aloud` добавляет дополнения для Windows. На Mac добавьте `--node "$(command -v node)"` в обе строки.

Ваши собственные хуки и скиллы остаются; заменяемый файл сначала копируется в резервную копию. На Windows следующие обновления также обновляют и патчат Nimbalyst (`NIMBALYST_FOLLOW=off` это отключает; [Патчи Nimbalyst](docs/how-it-works/nimbalyst-patches.md)). Все изменения: [Что меняет установка](docs/reference/install-changes.md).

Потом пройдите пятиминутные [Первые шаги](docs/getting-started.md). В командном репозитории [уберите Stratus с дороги](docs/using/projects.md#work-in-an-existing-or-team-repository).

## Удаление

В папке, из которой ставили, а после обновления — в самой новой папке `v<версия>` в `~/.claude/setup-source`:

```
node install.mjs --uninstall
```

Эту папку удалите вручную. Команда убирает то, что записал Stratus, если вы это не меняли, и возвращает файлы, которые он заменил. Плагины, расширения, папки проектов и большая часть настроек остаются; команда говорит, как убрать каждое из них ([Что оставляет `--uninstall`](docs/how-it-works/install.md#what---uninstall-leaves)).

## Как проходит задача

Сначала Claude одной строкой говорит, маленькая просьба, средняя или большая. Чтобы поменять размер, назовите другой.

- **Маленькая:** делается сразу и показывается в работе.
- **Средняя:** от одного до трёх вопросов с рекомендованными ответами, строки «готово, когда» на ваше одобрение, потом работа.
- **Большая:** спек с проверкой для каждой строки, план, который вы одобряете, помощники, которые параллельно собирают части, одно ревью по спеку.

Что говорить: [Как пользоваться Stratus](docs/HOW-TO.md). Каждый шаг: [Большие задачи](docs/using/big-jobs.md). Весь процесс по шагам и то, как Stratus улучшается: [Процесс разработки](docs/how-it-works/development-process.md).

## Что вы получаете

### Проверки, которые ловят ложные заявления

Ход, в котором менялся код, но не было ни сборки, ни тестов, не заканчивается. Хук `verify-gate` говорит Claude:

> verify-gate: code was edited this turn (cart.ts) and no build or test ran after the last edit. Run the project's build or test now, then finish; if it has none, say so in the reply.

Другие проверки ловят ссылку, которую Claude не открывал, и ответ, который ничего не отвечает. Все 31 хук, стражи и выключатели: [Хуки](docs/reference/hooks.md).

### Исследования с метками

У каждого вывода в отчёте об исследовании одна метка: **Solid** (три и больше источников), **Thin** (один или два независимых источника), **Ours** (собственное рассуждение Claude) или **Old** (только данные до 2025 года).

### Безопасность в три уровня

Плагин security-guidance проверяет рискованный код, пока Claude его правит. `/security` проверяет изменение и ищет в нём секреты. `/security deep` проверяет весь проект.

### Расходы под контролем

Помощники работают на той модели, которая нужна их задаче: Sonnet читает, Opus пишет код, Fable делает ревью. Что стоит денег или расходует подписку: [Расходы](docs/reference/costs.md).

## Что уходит с вашего компьютера

Claude Code отправляет вашу работу в Anthropic. Stratus добавляет:

| Что | Куда | Когда | Выключатель |
|---|---|---|---|
| Ваш вход в Claude, чтобы прочитать расход подписки | api.anthropic.com | Не чаще раза в 5 минут | `PLAN_USAGE_LOGGER=off` |
| Проверка обновлений и обновления, которые ставятся без вопросов | GitHub | Раз в 12 часов | `UPDATE_CHECK=off`, `AUTO_UPDATE=off` |
| Файлы проекта, чтобы нарисовать карту проекта | Anthropic | Новые проекты; большие существующие — после вашего «да»; потом раз в неделю | `MAP_NUDGE=off` |
| Адреса страниц, которые не может открыть локальный читатель страниц Firecrawl | Облако Firecrawl | Если вы установили Firecrawl | `FIRECRAWL_CLOUD=off` |
| Названия проектов и пакетов, когда Claude проверяет версию | endoflife.date, GitHub, реестры пакетов | Во время работы | Нет |
| Сессии со сквозным шифрованием; уведомления и отправленные файлы открытым текстом | Telegram; релей приложения для телефона | С приложением для телефона | `node ~/.claude/skills/phone-bot/pc/setup.mjs remove` |
| Зашифрованные резервные копии | Ваше хранилище Backblaze B2 | Только с `/backup` | `/backup off` |

Общего релея нет: запустите своего бота и релей ([Приложение для телефона](phone/README.md)) или подключитесь к чужому по приглашению. Релей же отдаёт страницу приложения, поэтому вы доверяете его владельцу. Резервное копирование проверено на локальной папке, на Backblaze ещё нет.

## Ограничения

- Проверка знает, что страницу открыли, но не знает, что на ней было.
- Хук, который падает с ошибкой, пропускает вызов; страж вместо этого его отклоняет. Следующая сессия называет хук, который упал.
- Не за каждым правилом стоит проверка.
- Проверка может вернуть Claude по ошибке; если так случилось, откройте issue.

## Результаты тестов

- Агент-ревьюер нашёл те же известные баги, что и обычный запрос на проверку (5 из 8), и потратил на 40% меньше токенов.
- Хуки отработали больше 12 000 раз на повторённых и придуманных сессиях без единого падения.
- Тесты привели к исправлениям, после которых ложных срабатываний стало 1 на 13 настоящих сессий вместо 4 на 12.

Измерено до версии 26.1, на старых хуках и старом агенте-ревьюере ([подробности](docs/test-results.md)).

## Помощь

- **Баг или вопрос:** откройте issue. О проблеме с безопасностью сообщайте закрыто ([SECURITY.md](SECURITY.md)).
- **Изменения по версиям:** [CHANGELOG.md](CHANGELOG.md).
- **Тесты:** `node tests/run-all.mjs` на Node.js 22.6+ ([как они запускаются](docs/how-it-works/overview.md#tests)).
- **Pull request'ы** не принимаются: лицензия не разрешает распространять изменённый код ([CONTRIBUTING.md](CONTRIBUTING.md)).
