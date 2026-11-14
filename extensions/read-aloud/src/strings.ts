// Every text a person reads in this extension, in two full sets.
//
// The language is fixed when the extension is built: the installer sets SETUP_LANGUAGE to `english` or
// `russian` (see vite.config.ts). The set that is not chosen is dropped from the built file.
// `russian` has the type of `english`, so a missing key is a compile error.
// Not translated on purpose: the test sentence that is spoken (the voices are American English) and
// the text of the backend (backend.ts), which has its own build.

declare const __SETUP_LANGUAGE__: "english" | "russian" | undefined;

const english = {
  // transcript buttons: the word on the button, then its tooltip where it says more
  readSummary: "Read the short spoken summary",
  readAloud: "Read aloud",
  readFullWord: "Read full",
  readFull: "Read the full reply",
  preparing: "Preparing speech",
  pause: "Pause",
  resume: "Resume",
  next: "Next",
  skipAhead: "Skip to the next part",
  close: "Close",
  closeTip: "Stop and close (Esc)",
  speedLabel: "Speech speed",
  autoWord: "Hands-free",
  autoOnWord: "Hands-free on",
  autoOnTip: "Hands-free reading is on, click to turn it off",
  autoOffTip: "Turn on hands-free reading",
  dismiss: "Dismiss",
  // the player box, line 1: the state word, then where it is ("Playing part 2 of 5")
  statePreparing: "Preparing",
  statePlaying: "Playing",
  statePaused: "Paused",
  partOf: (n: number, total: number) => `part ${n} of ${total}`,
  pausedAt: (n: number, total: number) => `at part ${n} of ${total}`,
  // the docked player above the chat box, while the reply being read is scrolled away
  dockLabel: "Read Aloud player",
  showReply: "Show reply",
  showReplyTip: "Scroll to the reply being read",
  // player and bridge messages
  nothingToRead: "Nothing to read in this message",
  hostUnreachable:
    "Read Aloud could not reach the Nimbalyst host. Reload the extension.",
  backendDown:
    "The Read Aloud backend is not running. Allow it in Settings > Extensions > Read Aloud, then try again.",
  // settings panel
  intro:
    "Reads agent replies aloud with Kokoro running on this computer. Nothing is sent over the network and there are no per-use costs.",
  enable: "Enable Read Aloud",
  handsFree: "Hands-free (auto-read)",
  handsFreeHint:
    "Reads each finished reply and each question aloud, or use /voice in chat",
  voice: "Voice",
  defaultWord: "default",
  voiceHint: "American English",
  voiceNames: {
    af_sky: "Sky",
    af_heart: "Heart",
    af_bella: "Bella",
    af_nicole: "Nicole",
    af_sarah: "Sarah",
    af_river: "River",
    af_nova: "Nova",
    af_jessica: "Jessica",
    af_aoede: "Aoede",
  } as Record<string, string>,
  speed: "Speed",
  reset: "Reset",
  skipCode: "Skip code blocks",
  skipTerminal: "Skip terminal output and diffs",
  ttsFolder: "Local TTS folder",
  save: "Save",
  folderHint:
    "The folder that holds your local voice model and its Python environment",
  testVoice: "Test voice",
  stopTest: "Stop test",
  startEngine: "Start voice engine",
  stopEngine: "Stop voice engine",
  engine: "Voice engine",
  stateStopped: "Stopped",
  stateStarting: "Starting",
  stateReady: "Ready",
  stateError: "Needs attention",
  showDetails: "Show details",
  hideDetails: "Hide details",
  engineDetails: (uptimeSec: number, requests: number) =>
    `Running for ${uptimeSec} s, ${requests} requests served`,
  modelLoaded: (ms: number) => `Model loaded in ${ms} ms`,
  missingFiles: "Some voice model files are missing from this folder",
};

type Strings = typeof english;

const russian: Strings = {
  readSummary: "Прочитать краткую озвучку",
  readAloud: "Прочитать вслух",
  readFullWord: "Целиком",
  readFull: "Прочитать ответ целиком",
  preparing: "Готовлю озвучку",
  pause: "Пауза",
  resume: "Продолжить",
  next: "Дальше",
  skipAhead: "Перейти к следующей части",
  close: "Закрыть",
  closeTip: "Остановить и закрыть (Esc)",
  speedLabel: "Скорость речи",
  autoWord: "Без рук",
  autoOnWord: "Без рук: вкл.",
  autoOnTip: "Режим без рук включён, нажмите, чтобы выключить",
  autoOffTip: "Включить режим без рук",
  dismiss: "Скрыть",
  statePreparing: "Готовлю",
  statePlaying: "Читаю",
  statePaused: "Пауза",
  partOf: (n, total) => `часть ${n} из ${total}`,
  pausedAt: (n, total) => `на части ${n} из ${total}`,
  dockLabel: "Плеер Read Aloud",
  showReply: "К ответу",
  showReplyTip: "Прокрутить к ответу, который читается",
  nothingToRead: "В этом сообщении нечего читать",
  hostUnreachable:
    "Read Aloud не удалось связаться с Nimbalyst. Перезагрузите расширение.",
  backendDown:
    "Бэкенд Read Aloud не запущен. Разрешите его в Settings > Extensions > Read Aloud и повторите.",
  intro:
    "Читает ответы агента вслух с помощью Kokoro, который работает на этом компьютере. Ничего не уходит по сети, платы за использование нет.",
  enable: "Включить Read Aloud",
  handsFree: "Без рук (авточтение)",
  handsFreeHint:
    "Читает вслух каждый готовый ответ и каждый вопрос, или используйте /voice в чате",
  voice: "Голос",
  defaultWord: "по умолчанию",
  voiceHint: "американский английский",
  voiceNames: {
    af_sky: "Скай",
    af_heart: "Харт",
    af_bella: "Белла",
    af_nicole: "Николь",
    af_sarah: "Сара",
    af_river: "Ривер",
    af_nova: "Нова",
    af_jessica: "Джессика",
    af_aoede: "Аоэде",
  },
  speed: "Скорость",
  reset: "Сбросить",
  skipCode: "Пропускать блоки кода",
  skipTerminal: "Пропускать вывод терминала и диффы",
  ttsFolder: "Папка с локальным TTS",
  save: "Сохранить",
  folderHint: "Папка с локальной моделью голоса и её окружением Python",
  testVoice: "Проверить голос",
  stopTest: "Остановить проверку",
  startEngine: "Запустить голосовой движок",
  stopEngine: "Остановить голосовой движок",
  engine: "Голосовой движок",
  stateStopped: "Остановлен",
  stateStarting: "Запускается",
  stateReady: "Готов",
  stateError: "Нужно внимание",
  showDetails: "Показать подробности",
  hideDetails: "Скрыть подробности",
  engineDetails: (uptimeSec, requests) =>
    `Работает ${uptimeSec} с, обработано запросов: ${requests}`,
  modelLoaded: (ms) => `Модель загружена за ${ms} мс`,
  missingFiles: "В этой папке не хватает файлов модели голоса",
};

// Unset means english.
export const t: Strings =
  typeof __SETUP_LANGUAGE__ !== "undefined" && __SETUP_LANGUAGE__ === "russian"
    ? russian
    : english;

/** Speech speed as shown everywhere: at most two decimals, no trailing zeros, then "×" (1.2×, 1×, 0.75×). */
export function formatSpeed(speed: number): string {
  return `${Math.round(speed * 100) / 100}×`;
}
