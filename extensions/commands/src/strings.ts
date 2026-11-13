// Every text a person reads in this extension, in two full sets.
//
// The language is fixed when the extension is built: the installer sets SETUP_LANGUAGE to `english` or
// `russian` (see vite.config.ts). The set that is not chosen is dropped from the built file.
// `russian` has the type of `english`, so a missing key is a compile error.

declare const __SETUP_LANGUAGE__: 'english' | 'russian' | undefined;

const english = {
  title: 'Commands',
  subtitle: 'Each one starts a new session in this project',
  starting: 'Starting…',
  started: 'Started: see the sessions list',
  commands: {
    boardCleanup: { label: 'Board cleanup', note: 'Move finished sessions to Complete' },
    nextMove: { label: 'Next move', note: 'The most useful thing to do next here' },
    projectScan: { label: 'Project scan', note: "Check this project's Claude setup" },
    setupAudit: { label: 'Setup audit', note: 'Full check of the global setup' },
    usageReport: { label: 'Usage report', note: 'Where the tokens went, and the forecast' },
    chatReview: { label: 'Chat review', note: 'What your chats show is missing' },
    fullReview: { label: 'Full review', note: 'How the work went, and what to change' },
    newProject: { label: 'New project', note: 'Set this folder up for Claude' },
    updateSetup: { label: 'Update setup', note: 'Install the newest version of the setup' },
  },
};

type Strings = typeof english;

const russian: Strings = {
  title: 'Команды',
  subtitle: 'Каждая запускает новую сессию в этом проекте',
  starting: 'Запуск…',
  started: 'Запущено: смотрите список сессий',
  commands: {
    boardCleanup: { label: 'Уборка доски', note: 'Перенести завершённые сессии в Complete' },
    nextMove: { label: 'Следующий шаг', note: 'Самое полезное, что можно сделать дальше' },
    projectScan: { label: 'Проверка проекта', note: 'Проверить настройку Claude в этом проекте' },
    setupAudit: { label: 'Аудит настройки', note: 'Полная проверка глобальной настройки' },
    usageReport: { label: 'Отчёт об использовании', note: 'Куда ушли токены, и прогноз' },
    chatReview: { label: 'Разбор чатов', note: 'Чего не хватает, судя по чатам' },
    fullReview: { label: 'Полный разбор', note: 'Как прошла работа и что стоит изменить' },
    newProject: { label: 'Новый проект', note: 'Настроить эту папку для Claude' },
    updateSetup: { label: 'Обновить настройку', note: 'Установить новейшую версию настройки' },
  },
};

// Unset (as in the plain-node tests) means english.
export const t: Strings = typeof __SETUP_LANGUAGE__ !== 'undefined' && __SETUP_LANGUAGE__ === 'russian' ? russian : english;
