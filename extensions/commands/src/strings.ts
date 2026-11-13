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
  note: {
    button: 'Note',
    hint: 'Send the text to this session as a note it reads before its next step, without interrupting it',
    typeFirst: 'Type a note first',
    sending: 'Sending…',
    queued: 'Queued, it starts now',
    notSent: (why: string) => `Not sent: ${why}`,
    notSentCode: (code: unknown, why: string) => `Not sent (code ${code}): ${why}`,
    oddId: (id: string) => `Not sent: odd session id "${id}"`,
    noBox: 'Not sent: could not find the chat box',
    noSession: 'Not sent: could not tell which session this is',
    fileBusy: 'a file is still being added, try again in a moment',
    fileNoPath: 'could not read the path of an attached file',
    fileLeft: 'Note sent, but its file is still in the chat box',
    waiting: 'Note on its way',
    waitingTip: (n: number) => (n === 1 ? 'A note is on the way to this session' : `${n} notes are on the way to this session`),
    delivered: 'Note delivered',
    notConfirmed: (text: string) => `Not confirmed, send it again if needed: "${text}"`,
    untracked: 'Note sent, but this button cannot follow it: steer.mjs is out of date',
  },
  commands: {
    boardCleanup: { label: 'Board cleanup', note: 'Move finished sessions to Complete' },
    nextMove: { label: 'Next move', note: 'The most useful thing to do next here' },
    projectScan: { label: 'Project scan', note: "Check this project's Claude setup" },
    setupAudit: { label: 'Setup audit', note: 'Full check of the global setup' },
    usageReport: { label: 'Usage report', note: 'Where the tokens went, and the forecast' },
    pcTidy: { label: 'PC tidy', note: 'What holds memory, and what sessions left behind' },
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
  note: {
    button: 'Заметка',
    hint: 'Отправить текст в эту сессию как заметку, которую она прочтёт перед следующим шагом, не прерывая её',
    typeFirst: 'Сначала введите заметку',
    sending: 'Отправляю…',
    queued: 'В очереди, запускается сейчас',
    notSent: (why: string) => `Не отправлено: ${why}`,
    notSentCode: (code: unknown, why: string) => `Не отправлено (код ${code}): ${why}`,
    oddId: (id: string) => `Не отправлено: странный id сессии "${id}"`,
    noBox: 'Не отправлено: не найдено поле чата',
    noSession: 'Не отправлено: не удалось определить сессию',
    fileBusy: 'файл ещё добавляется, попробуйте через секунду',
    fileNoPath: 'не удалось прочитать путь прикреплённого файла',
    fileLeft: 'Заметка отправлена, но её файл остался в поле чата',
    waiting: 'Заметка в пути',
    waitingTip: (n: number) => `Заметок в пути к этой сессии: ${n}`,
    delivered: 'Заметка доставлена',
    notConfirmed: (text: string) => `Нет подтверждения, при необходимости отправьте ещё раз: «${text}»`,
    untracked: 'Заметка отправлена, но кнопка не может её отследить: steer.mjs устарел',
  },
  commands: {
    boardCleanup: { label: 'Уборка доски', note: 'Перенести завершённые сессии в Complete' },
    nextMove: { label: 'Следующий шаг', note: 'Самое полезное, что можно сделать дальше' },
    projectScan: { label: 'Проверка проекта', note: 'Проверить настройку Claude в этом проекте' },
    setupAudit: { label: 'Аудит настройки', note: 'Полная проверка глобальной настройки' },
    usageReport: { label: 'Отчёт об использовании', note: 'Куда ушли токены, и прогноз' },
    pcTidy: { label: 'Уборка ПК', note: 'Что занимает память и что оставили сессии' },
    chatReview: { label: 'Разбор чатов', note: 'Чего не хватает, судя по чатам' },
    fullReview: { label: 'Полный разбор', note: 'Как прошла работа и что стоит изменить' },
    newProject: { label: 'Новый проект', note: 'Настроить эту папку для Claude' },
    updateSetup: { label: 'Обновить настройку', note: 'Установить новейшую версию настройки' },
  },
};

// Unset (as in the plain-node tests) means english.
export const t: Strings = typeof __SETUP_LANGUAGE__ !== 'undefined' && __SETUP_LANGUAGE__ === 'russian' ? russian : english;
