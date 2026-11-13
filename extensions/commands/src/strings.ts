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
  note: {
    button: "Note",
    hint: "Send the text to this session as a note it reads before its next step, without interrupting it",
    dismiss: "Close message",
    typeFirst: "Type a note first",
    sending: "Sending…",
    queued: "Queued, it starts now",
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
      note: "Full check of the global setup",
    },
    usageReport: {
      label: "Usage report",
      note: "Where the tokens went, and the forecast",
    },
    pcTidy: {
      label: "PC tidy",
      note: "What holds memory, and what sessions left behind",
    },
    diskTidy: {
      label: "Disk tidy",
      note: "What fills the disk, cleared item by item with your yes",
    },
    fileUpkeep: {
      label: "File upkeep",
      note: "Names and places of project files, by the standard",
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
    updateSetup: {
      label: "Update setup",
      note: "Install the newest version of the setup",
    },
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
  note: {
    button: "Заметка",
    hint: "Отправить текст в эту сессию как заметку, которую она прочтёт перед следующим шагом, не прерывая её",
    dismiss: "Закрыть сообщение",
    typeFirst: "Сначала введите заметку",
    sending: "Отправляю…",
    queued: "В очереди, запускается сейчас",
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
      note: "Полная проверка глобальной настройки",
    },
    usageReport: {
      label: "Отчёт об использовании",
      note: "Куда ушли токены, и прогноз",
    },
    pcTidy: {
      label: "Уборка ПК",
      note: "Что занимает память и что оставили сессии",
    },
    diskTidy: {
      label: "Уборка диска",
      note: "Что занимает диск; чистка по одному пункту с вашего согласия",
    },
    fileUpkeep: {
      label: "Порядок в файлах",
      note: "Имена и места файлов проекта по стандарту",
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
  },
};

// Unset (as in the plain-node tests) means english.
export const t: Strings =
  typeof __SETUP_LANGUAGE__ !== "undefined" && __SETUP_LANGUAGE__ === "russian"
    ? russian
    : english;
