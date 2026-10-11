// Every text a person reads in this extension, in two full sets.
//
// The language is fixed when the extension is built: the installer sets SETUP_LANGUAGE to `english` or
// `russian` (see vite.config.ts). The set that is not chosen is dropped from the built file.
// `russian` has the type of `english`, so a missing key is a compile error.
// Not translated on purpose: the test sentence that is spoken (the voices are American English) and
// the text of the backend (backend.ts), which has its own build.

declare const __SETUP_LANGUAGE__: 'english' | 'russian' | undefined;

const english = {
  // transcript buttons
  readSummary: 'Read the short spoken summary',
  readAloud: 'Read aloud',
  readFull: 'Read the full reply',
  preparing: 'Preparing speech',
  pause: 'Pause',
  resume: 'Resume',
  skipAhead: 'Skip ahead',
  stop: 'Stop',
  speedTip: 'Speech speed (click to change; applies from the next sentence)',
  autoOnTip: 'Hands-free reading is on: finished replies and questions are read aloud. Click to turn off.',
  autoOffTip: 'Turn on hands-free reading (reads finished replies and questions aloud)',
  // player and bridge messages
  nothingToRead: 'Nothing to read in this message.',
  hostUnreachable: 'Read Aloud could not reach the Nimbalyst host. Reload the extension.',
  backendDown: 'The Read Aloud backend is not running. Allow it in Settings > Extensions > Read Aloud, then try again.',
  // settings panel
  intro: 'Reads agent replies aloud with Kokoro running on this computer. Nothing is sent over the network and there are no per-use costs.',
  enable: 'Enable Read Aloud',
  handsFree: 'Hands-free (auto-read)',
  handsFreeHint: 'Reads each finished reply and each question aloud. Also: /voice in chat.',
  voice: 'Voice',
  defaultWord: 'default',
  voiceHint: 'American English',
  speed: 'Speed',
  reset: 'Reset',
  skipCode: 'Skip code blocks',
  skipTerminal: 'Skip terminal output and diffs',
  ttsFolder: 'Local TTS folder',
  save: 'Save',
  folderHint: 'Expects venv\\Scripts\\python.exe, kokoro-v1.0.onnx and voices-v1.0.bin inside this folder.',
  testVoice: 'Test voice',
  stopTest: 'Stop test',
  startWorker: 'Start worker',
  stopWorker: 'Stop worker',
  worker: 'Worker',
  workerInfo: (pid: number, uptimeSec: number, requests: number) => ` (pid ${pid}, up ${uptimeSec}s, ${requests} requests)`,
  modelLoaded: (ms: number) => `, model loaded in ${ms} ms`,
  missing: (what: string) => `Missing ${what}`,
};

type Strings = typeof english;

const russian: Strings = {
  readSummary: 'Прочитать краткую озвучку',
  readAloud: 'Прочитать вслух',
  readFull: 'Прочитать ответ целиком',
  preparing: 'Готовлю озвучку',
  pause: 'Пауза',
  resume: 'Продолжить',
  skipAhead: 'Пропустить вперёд',
  stop: 'Остановить',
  speedTip: 'Скорость речи (нажмите, чтобы изменить; подействует со следующего предложения)',
  autoOnTip: 'Режим без рук включён: готовые ответы и вопросы читаются вслух. Нажмите, чтобы выключить.',
  autoOffTip: 'Включить режим без рук (готовые ответы и вопросы читаются вслух)',
  nothingToRead: 'В этом сообщении нечего читать.',
  hostUnreachable: 'Read Aloud не удалось связаться с Nimbalyst. Перезагрузите расширение.',
  backendDown: 'Бэкенд Read Aloud не запущен. Разрешите его в Settings > Extensions > Read Aloud и повторите.',
  intro: 'Читает ответы агента вслух с помощью Kokoro, который работает на этом компьютере. Ничего не уходит по сети, платы за использование нет.',
  enable: 'Включить Read Aloud',
  handsFree: 'Без рук (авточтение)',
  handsFreeHint: 'Читает вслух каждый готовый ответ и каждый вопрос. Также: /voice в чате.',
  voice: 'Голос',
  defaultWord: 'по умолчанию',
  voiceHint: 'американский английский',
  speed: 'Скорость',
  reset: 'Сбросить',
  skipCode: 'Пропускать блоки кода',
  skipTerminal: 'Пропускать вывод терминала и диффы',
  ttsFolder: 'Папка с локальным TTS',
  save: 'Сохранить',
  folderHint: 'В этой папке должны лежать venv\\Scripts\\python.exe, kokoro-v1.0.onnx и voices-v1.0.bin.',
  testVoice: 'Проверить голос',
  stopTest: 'Остановить проверку',
  startWorker: 'Запустить воркер',
  stopWorker: 'Остановить воркер',
  worker: 'Воркер',
  workerInfo: (pid, uptimeSec, requests) => ` (pid ${pid}, работает ${uptimeSec} с, запросов: ${requests})`,
  modelLoaded: (ms) => `, модель загружена за ${ms} мс`,
  missing: (what) => `Не найдено: ${what}`,
};

// Unset means english.
export const t: Strings = typeof __SETUP_LANGUAGE__ !== 'undefined' && __SETUP_LANGUAGE__ === 'russian' ? russian : english;
