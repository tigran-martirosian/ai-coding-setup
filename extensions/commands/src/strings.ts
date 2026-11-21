// Every text a person reads in this extension, in two full sets.
//
// The language is fixed when the extension is built: the installer sets SETUP_LANGUAGE to `english` or
// `russian` (see vite.config.ts). The set that is not chosen is dropped from the built file.
// `russian` has the type of `english`, so a missing key is a compile error.

declare const __SETUP_LANGUAGE__: "english" | "russian" | undefined;

const english = {
  title: "Commands",
  subtitle: "Each one starts a new session in this project",
  starting: "Starting…",
  started: (time: string) => `Started ${time}`,
  askAgain: (time: string) => `Started ${time}. Start another?`,
  again: "Start again",
  cancel: "Cancel",
  startedHint: "The session is in the sessions list",
  /** The closed pick row's tooltip: which of its options started. */
  startedOption: (name: string, time: string) => `${name} started ${time}`,
  note: {
    button: "Note",
    hint: "Send the text to this session as a note it reads before its next step, without interrupting it",
    dismiss: "Close message",
    typeFirst: "Type a note first",
    sending: "Sending…",
    queued: "Queued, it starts now",
    queuedAfterReply: "Queued, it starts when its reply ends",
    notSent: (why: string) => `Not sent: ${why}`,
    notSentWhy: (why: string) => `Not sent: ${why}`,
    oddId: "Not sent: this session cannot take a note",
    noBox: "Not sent: could not find the chat box",
    noSession: "Not sent: could not tell which session this is",
    fileBusy: "a file is still being added, try again in a moment",
    fileNoPath: "could not read the path of an attached file",
    fileLeft: "Note sent, but its file is still in the chat box",
    waiting: "Note on its way",
    waitingTip: (n: number) =>
      n === 1
        ? "A note is on the way to this session"
        : `${n} notes are on the way to this session`,
    delivered: "Note delivered",
    notConfirmed: (text: string) =>
      `Not confirmed, send it again if needed: "${text}"`,
    untracked:
      "Note sent, but it cannot be followed to the end. Update the setup to see when it arrives",
  },
  tryIt: {
    button: "Try it",
    hint: "Ask this session to run the project's verify skill on its last change; a local page it starts opens beside the chat",
    watchingTip:
      "Try it was pressed: the page opens beside the chat when the session gives one",
    sent: "Try it sent, the session reads it before its next step",
    opened: (url: string) => `Opened ${url} beside the chat`,
    notLocal: (url: string) =>
      `Try it: not opened, the page is not on this PC: ${url}`,
    openFailed: (why: string) => `Try it: the page did not open: ${why}`,
  },
  copy: {
    button: "Copy",
    done: "Copied",
    hint: "Copy the whole reply as Markdown",
    blocked: "Couldn't copy: clipboard blocked",
    noText: "Couldn't copy: the reply's text is no longer loaded",
    dismiss: "Dismiss",
  },
  commands: {
    boardCleanup: {
      label: "Board cleanup",
      note: "Move finished sessions to Complete",
    },
    nextMove: {
      label: "Next move",
      note: "The most useful thing to do next here",
    },
    projectScan: {
      label: "Project scan",
      note: "Check this project's Claude setup",
    },
    setupAudit: {
      label: "Setup audit",
      note: "Pick a check of the setup",
    },
    setupHealth: {
      label: "Setup health",
      note: "The whole setup checked, and compared with the last check",
    },
    usageReport: {
      label: "Usage report",
      note: "Where the tokens went, and the forecast",
    },
    promptAudit: {
      label: "Prompt audit",
      note: "Rules, skills and agent texts: what to cut or reword",
    },
    grillMe: {
      label: "Grill me",
      note: "Questions on your plan, one at a time, until we agree",
    },
    pcTidy: {
      label: "PC tidy",
      note: "What holds memory, and what sessions left behind",
    },
    diskTidy: {
      label: "Disk tidy",
      note: "What fills the disk, cleared item by item with your yes",
    },
    chatReview: {
      label: "Chat review",
      note: "What your chats show is missing",
    },
    fullReview: {
      label: "Full review",
      note: "How the work went, and what to change",
    },
    untangle: {
      label: "Untangle code",
      note: "Every tangle in this project, fixed in one pass",
    },
    systemsMap: {
      label: "Systems map",
      note: "Build or refresh the map of this project's parts",
    },
    newProject: { label: "New project", note: "Set this folder up for Claude" },
    lead: {
      label: "Lead",
      note: "Big work: planned in steps, built by helpers, reviewed",
    },
    whereAreWe: {
      label: "Where are we",
      note: "How much of the release is left, from the tracker",
    },
    updateProject: {
      label: "Update project",
      note: "Bring this project up to the current setup",
    },
    backup: {
      label: "Backup",
      note: "Back up the setup and projects, or show the backup's state",
    },
    phone: {
      label: "Phone inbox",
      note: "What you sent from your phone",
    },
    updateSetup: {
      label: "Update setup",
      note: "Install the newest version of the setup",
    },
  },
  /** Comments on the lines of the Review panel diff, sent to the session as one message. */
  diff: {
    add: "Comment on this line. Shift+click another line to cover a range",
    placeholder: "A comment for the agent",
    save: "Save",
    saveHint: "Save (Ctrl+Enter)",
    cancel: "Cancel",
    edit: "Edit",
    remove: "Remove",
    rangeHint: "Shift+click another line to cover a range",
    count: (n: number) => (n === 1 ? "1 comment" : `${n} comments`),
    sendAll: "Send all",
    sendHint: "Send all comments to this session as one message",
    clear: "Clear",
    clearHint: "Remove all comments of this session",
    none: "No comments to send",
    /** The first line of the message the agent gets. */
    header: (n: number) =>
      `Review comments on your changes (${n}), each on a line of the diff:`,
    line: (n: number) => `line ${n}`,
    lines: (a: number, b: number) => `lines ${a}-${b}`,
    oldLine: (n: number) => `old line ${n}`,
    oldLines: (a: number, b: number) => `old lines ${a}-${b}`,
    blank: "(blank line)",
    /** What a note that was not confirmed is called in its message. */
    pending: (n: number) => `review comments (${n})`,
    /** After the line or range of a comment whose line no longer reads as when it was written. */
    movedLabel: "(line has changed since)",
    countMoved: (n: number, m: number) =>
      `${n === 1 ? "1 comment" : `${n} comments`}, ${m} moved`,
    removeMoved: "Remove moved",
    removeMovedHint: "Remove the comments whose lines have changed since",
    gone: "This comment was sent or removed meanwhile; Save keeps the text as a new comment",
    rangeGone:
      "The first line of the range is no longer shown; click + on it again",
    /** Asked on the bar before Clear removes them. */
    clearAsk: (n: number) =>
      n === 1 ? "Clear 1 comment?" : `Clear ${n} comments?`,
    keep: "Keep",
    /** After a send: how many went, before what became of them. */
    sent: (n: number) => (n === 1 ? "1 comment sent" : `${n} comments sent`),
    // The batch's own outcome lines, in place of the Note button's (note.ts)
    waiting: "Comments on their way…",
    untracked:
      "They cannot be followed to the end. Update the setup to see when they arrive",
    oddId: "Not sent: this session cannot take comments",
    delivered: "Comments delivered: the agent reads them at its next step",
    notConfirmed: "Not confirmed: your comments are back in the list",
    notBack: (why: string) =>
      `Not confirmed, and the comments could not be put back (${why}): write them again if needed`,
    /** Send all while a comment box holds text not saved yet. */
    saveFirst: "Save or cancel the open comment first",
  },
};

type Strings = typeof english;

const russian: Strings = {
  title: "Команды",
  subtitle: "Каждая запускает новую сессию в этом проекте",
  starting: "Запуск…",
  started: (time: string) => `Запущено ${time}`,
  askAgain: (time: string) => `Запущено ${time}. Запустить ещё одну?`,
  again: "Запустить снова",
  cancel: "Отмена",
  startedHint: "Сессия в списке сессий",
  startedOption: (name: string, time: string) => `${name}: запущено ${time}`,
  note: {
    button: "Заметка",
    hint: "Отправить текст в эту сессию как заметку, которую она прочтёт перед следующим шагом, не прерывая её",
    dismiss: "Закрыть сообщение",
    typeFirst: "Сначала введите заметку",
    sending: "Отправляю…",
    queued: "В очереди, запускается сейчас",
    queuedAfterReply: "В очереди, запустится, когда закончится ответ",
    notSent: (why: string) => `Не отправлено: ${why}`,
    notSentWhy: (why: string) => `Не отправлено: ${why}`,
    oddId: "Не отправлено: эта сессия не принимает заметки",
    noBox: "Не отправлено: не найдено поле чата",
    noSession: "Не отправлено: не удалось определить сессию",
    fileBusy: "файл ещё добавляется, попробуйте через секунду",
    fileNoPath: "не удалось прочитать путь прикреплённого файла",
    fileLeft: "Заметка отправлена, но её файл остался в поле чата",
    waiting: "Заметка в пути",
    waitingTip: (n: number) => `Заметок в пути к этой сессии: ${n}`,
    delivered: "Заметка доставлена",
    notConfirmed: (text: string) =>
      `Нет подтверждения, при необходимости отправьте ещё раз: «${text}»`,
    untracked:
      "Заметка отправлена, но проследить её до конца нельзя. Обновите настройку, чтобы видеть, когда она дойдёт",
  },
  tryIt: {
    button: "Проверить",
    hint: "Попросить эту сессию запустить навык verify проекта на её последнем изменении; локальная страница, которую она запустит, откроется рядом с чатом",
    watchingTip:
      "Проверка запрошена: страница откроется рядом с чатом, когда сессия её даст",
    sent: "Проверка отправлена, сессия прочтёт её перед следующим шагом",
    opened: (url: string) => `${url} открыта рядом с чатом`,
    notLocal: (url: string) =>
      `Проверка: не открыто, страница не на этом компьютере: ${url}`,
    openFailed: (why: string) => `Проверка: страница не открылась: ${why}`,
  },
  copy: {
    button: "Копировать",
    done: "Скопировано",
    hint: "Скопировать весь ответ как Markdown",
    blocked: "Не скопировано: буфер обмена заблокирован",
    noText: "Не скопировано: текст ответа больше не загружен",
    dismiss: "Закрыть",
  },
  commands: {
    boardCleanup: {
      label: "Уборка доски",
      note: "Перенести завершённые сессии в Complete",
    },
    nextMove: {
      label: "Следующий шаг",
      note: "Самое полезное, что можно сделать дальше",
    },
    projectScan: {
      label: "Проверка проекта",
      note: "Проверить настройку Claude в этом проекте",
    },
    setupAudit: {
      label: "Аудит настройки",
      note: "Выбрать проверку настройки",
    },
    setupHealth: {
      label: "Состояние настройки",
      note: "Проверка всей настройки и сравнение с прошлой",
    },
    usageReport: {
      label: "Отчёт об использовании",
      note: "Куда ушли токены, и прогноз",
    },
    promptAudit: {
      label: "Аудит промптов",
      note: "Правила, навыки и тексты агентов: что убрать или переписать",
    },
    grillMe: {
      label: "Допрос по плану",
      note: "Вопросы о вашем плане по одному, пока мы не поймём друг друга",
    },
    pcTidy: {
      label: "Уборка ПК",
      note: "Что занимает память и что оставили сессии",
    },
    diskTidy: {
      label: "Уборка диска",
      note: "Что занимает диск; чистка по одному пункту с вашего согласия",
    },
    chatReview: {
      label: "Разбор чатов",
      note: "Чего не хватает, судя по чатам",
    },
    fullReview: {
      label: "Полный разбор",
      note: "Как прошла работа и что стоит изменить",
    },
    untangle: {
      label: "Распутать код",
      note: "Все узлы в коде проекта, исправленные за один проход",
    },
    systemsMap: {
      label: "Карта систем",
      note: "Собрать или обновить карту частей проекта",
    },
    newProject: {
      label: "Новый проект",
      note: "Настроить эту папку для Claude",
    },
    updateSetup: {
      label: "Обновить настройку",
      note: "Установить новейшую версию настройки",
    },
    lead: {
      label: "Вести задачу",
      note: "Большая работа: план по шагам, делают помощники, потом проверка",
    },
    whereAreWe: {
      label: "Где мы сейчас",
      note: "Сколько осталось до релиза, по трекеру",
    },
    updateProject: {
      label: "Обновить проект",
      note: "Привести этот проект к текущей настройке",
    },
    backup: {
      label: "Резервная копия",
      note: "Сделать резервную копию настройки и проектов или показать её состояние",
    },
    phone: {
      label: "Входящие с телефона",
      note: "Что вы отправили с телефона",
    },
  },
  diff: {
    add: "Комментарий к этой строке. Shift+клик по другой строке охватит диапазон",
    placeholder: "Комментарий для агента",
    save: "Сохранить",
    saveHint: "Сохранить (Ctrl+Enter)",
    cancel: "Отмена",
    edit: "Изменить",
    remove: "Удалить",
    rangeHint: "Shift+клик по другой строке охватит диапазон",
    count: (n: number) => `Комментариев: ${n}`,
    sendAll: "Отправить все",
    sendHint: "Отправить все комментарии в эту сессию одним сообщением",
    clear: "Очистить",
    clearHint: "Удалить все комментарии этой сессии",
    none: "Нет комментариев для отправки",
    header: (n: number) =>
      `Комментарии к вашим изменениям (${n}), каждый к строке диффа:`,
    line: (n: number) => `строка ${n}`,
    lines: (a: number, b: number) => `строки ${a}-${b}`,
    oldLine: (n: number) => `старая строка ${n}`,
    oldLines: (a: number, b: number) => `старые строки ${a}-${b}`,
    blank: "(пустая строка)",
    pending: (n: number) => `комментарии к изменениям (${n})`,
    movedLabel: "(строка с тех пор изменилась)",
    countMoved: (n: number, m: number) => `Комментариев: ${n}, сдвинуто: ${m}`,
    removeMoved: "Удалить сдвинутые",
    removeMovedHint: "Удалить комментарии, строки которых с тех пор изменились",
    gone: "Этот комментарий тем временем отправлен или удалён; Сохранить сделает текст новым комментарием",
    rangeGone:
      "Первая строка диапазона больше не видна; нажмите + на ней ещё раз",
    clearAsk: (n: number) => `Удалить все комментарии (${n})?`,
    keep: "Оставить",
    sent: (n: number) => `Отправлено комментариев: ${n}`,
    waiting: "Комментарии в пути…",
    untracked:
      "Проследить их до конца нельзя. Обновите настройку, чтобы видеть, когда они дойдут",
    oddId: "Не отправлено: эта сессия не принимает комментарии",
    delivered: "Комментарии доставлены: агент прочтёт их на следующем шаге",
    notConfirmed: "Нет подтверждения: ваши комментарии снова в списке",
    notBack: (why: string) =>
      `Нет подтверждения, и вернуть комментарии не удалось (${why}): при необходимости напишите их снова`,
    saveFirst: "Сначала сохраните или отмените открытый комментарий",
  },
};

// Unset (as in the plain-node tests) means english.
export const t: Strings =
  typeof __SETUP_LANGUAGE__ !== "undefined" && __SETUP_LANGUAGE__ === "russian"
    ? russian
    : english;
