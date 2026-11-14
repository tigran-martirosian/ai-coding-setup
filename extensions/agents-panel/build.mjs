// Builds the Agents Panel extension: copies src/ to dist/ (no bundler needed), with the two
// visible words (the STRINGS object) in the answer language (SETUP_LANGUAGE=russian), and with --install copies
// manifest.json and dist/ into Nimbalyst's extensions folder. Restart Nimbalyst to load it.
//   node build.mjs            build dist/
//   node build.mjs --install  build, then install
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extensionTarget,
  lenientLanguage,
  readTokens,
  swapStrings,
} from "../shared/build-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "src");
const dist = path.join(here, "dist");

// The whole STRINGS object of src/index.js, in Russian (same keys). Tool names inside the
// "now" phrases stay as the app gives them.
const RUSSIAN_STRINGS = `const STRINGS = {
  running: 'Работает: {n}',
  failed: 'Сбой: {n}',
  done: 'Готово: {n}',
  stopped: 'Остановлено: {n}',
  idle: 'Ничего не запущено',
  doneIn: 'готово за {n}',
  failedAfter: 'сбой через {n}',
  stoppedAfter: 'остановлено через {n}',
  doneWord: 'готово',
  failedWord: 'сбой',
  stoppedWord: 'остановлено',
  kinds: { 'Sub-agent': 'Помощник', Command: 'Команда', Workflow: 'Процесс', 'MCP task': 'Задача MCP', Task: 'Задача' },
  tools: { one: 'инструментов: {n}', many: 'инструментов: {n}' },
  units: { h: 'ч', m: 'м', s: 'с' },
  waiting: '{step} уже {n}',
  thinking: 'думает',
  planning: 'планирует',
  background: 'работает в фоне',
  models: { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku', fable: 'Fable' },
  efforts: { low: 'низкий', medium: 'средний', high: 'высокий', xhigh: 'очень высокий', max: 'максимальный' },
  now: {
    WebFetch: 'читает страницу',
    WebSearch: 'ищет в сети',
    Read: 'читает файл',
    Grep: 'ищет по файлам',
    Glob: 'ищет по файлам',
    Edit: 'правит файл',
    Write: 'правит файл',
    MultiEdit: 'правит файл',
    Bash: 'выполняет команду',
    PowerShell: 'выполняет команду',
    Agent: 'ждёт помощника',
  },
  filesLine: '{files}, {folders}',
  files: { one: 'Файлов: {n}', many: 'Файлов: {n}' },
  folders: { one: 'папок: {n}', many: 'папок: {n}' },
  moreFolders: { one: 'ещё папок: {n}', many: 'ещё папок: {n}' },
  filesOpen: 'Открыть весь список',
  filesFold: 'Свернуть список',
  commit: 'Коммит',
  waitLine: {
    thinking: 'Думает',
    background: 'Ждёт фоновую задачу',
    backgroundWhat: 'Ждёт фоновую задачу: {what}',
    backgrounds: 'Ждёт фоновые задачи: {n}',
    helper: 'Ждёт помощника',
    helpers: 'Ждёт помощников: {n}',
  },
  needs: {
    word: 'Ждёт вас',
    one: '1 вопрос: {what}',
    many: 'Вопросов: {n}. {what} и ещё {more}',
    oneBare: '1 вопрос',
    manyBare: 'Вопросов: {n}',
    running: 'работает',
  },
  helperCard: {
    roles: { helper: 'Помощник', reviewer: 'Проверяющий', planner: 'Планировщик' },
    finished: '{role}: готово',
    doingLine: '{role} {doing}',
    still: '{role} всё ещё {doing}',
    doing: {
      WebFetch: 'читает страницу',
      WebSearch: 'ищет в сети',
      Read: 'читает файлы',
      Grep: 'ищет по файлам',
      Glob: 'ищет по файлам',
      Edit: 'правит файлы',
      Write: 'правит файлы',
      MultiEdit: 'правит файлы',
      Bash: 'выполняет команду',
      PowerShell: 'выполняет команду',
      Agent: 'ждёт помощника',
      Task: 'ждёт помощника',
    },
    running: 'работает',
    background: 'Работает в фоне',
    inBackground: 'В фоне',
    stopped: 'Остановлен раньше срока',
    failed: 'Сбой',
    turnLimit: 'исчерпал лимит ходов',
    steps: { one: 'шагов: {n}', many: 'шагов: {n}' },
    tokens: 'токенов: {n}',
    noTokens: 'токены не сообщены',
    lastStep: 'последний шаг {n} назад',
    started: 'начат в {n}',
    timeLocale: 'ru-RU',
    thousand: ' тыс.',
    million: ' млн',
  },
};`;
const lang = lenientLanguage();

fs.mkdirSync(dist, { recursive: true });
let js = fs.readFileSync(path.join(src, "index.js"), "utf8");
// The extension loads one file, so src/runs.js (no imports of its own) goes in place of its import line
// Found by shape, so a formatter's quotes and line wraps don't break the match
const importOf = (file) =>
  new RegExp(
    `^import \\{[^}]*\\} from ["']\\./${file.replace(/\./g, "\\.")}["'];?[ \\t]*\\r?$`,
    "m",
  );
const RUNS_IMPORT = importOf("runs.js");
if (!RUNS_IMPORT.test(js))
  throw new Error("runs.js import not found in src/index.js");
const inline = (file) =>
  fs
    .readFileSync(path.join(src, file), "utf8")
    .replace(/\nexport \{[^}]*\};\s*$/, "\n")
    .trimEnd();
js = js.replace(RUNS_IMPORT, () => inline("runs.js"));
// src/scroll-hold.js the same way
const HOLD_IMPORT = importOf("scroll-hold.js");
if (!HOLD_IMPORT.test(js))
  throw new Error("scroll-hold.js import not found in src/index.js");
js = js.replace(HOLD_IMPORT, () => inline("scroll-hold.js"));
// src/stage.js the same way
const STAGE_IMPORT = importOf("stage.js");
if (!STAGE_IMPORT.test(js))
  throw new Error("stage.js import not found in src/index.js");
js = js.replace(STAGE_IMPORT, () => inline("stage.js"));
// src/files-fold.js the same way
const FOLD_IMPORT = importOf("files-fold.js");
if (!FOLD_IMPORT.test(js))
  throw new Error("files-fold.js import not found in src/index.js");
js = js.replace(FOLD_IMPORT, () => inline("files-fold.js"));
// src/chat-state.js the same way
const CHAT_IMPORT = importOf("chat-state.js");
if (!CHAT_IMPORT.test(js))
  throw new Error("chat-state.js import not found in src/index.js");
js = js.replace(CHAT_IMPORT, () => inline("chat-state.js"));
// src/helper-card.js the same way
const HELPER_IMPORT = importOf("helper-card.js");
if (!HELPER_IMPORT.test(js))
  throw new Error("helper-card.js import not found in src/index.js");
js = js.replace(HELPER_IMPORT, () => inline("helper-card.js"));
// The shared thinking-orbs mount goes in place of the marker line inside loadOrbs(), so it runs at activate,
// not when the file is imported (test.mjs imports it in Node, where there is no window)
const ORBS_MARKER = /^[ \t]*\/\/ ORBS-MOUNT \(build\.mjs\)[ \t]*\r?$/m;
if (!ORBS_MARKER.test(js))
  throw new Error("ORBS-MOUNT marker not found in src/index.js");
const orbs = fs.readFileSync(
  path.join(here, "..", "shared", "orbs", "orbs.js"),
  "utf8",
);
js = js.replace(ORBS_MARKER, () => orbs.trimEnd());
if (lang === "russian") js = swapStrings(js, RUSSIAN_STRINGS);
fs.writeFileSync(path.join(dist, "index.js"), js);
fs.writeFileSync(
  path.join(dist, "style.css"),
  readTokens() + "\n" + fs.readFileSync(path.join(src, "style.css"), "utf8"),
);
console.log(`built dist/ (${lang === "russian" ? "russian" : "english"})`);

if (process.argv.includes("--install")) {
  const target = extensionTarget("agentspanel");
  fs.mkdirSync(path.join(target, "dist"), { recursive: true });
  fs.copyFileSync(
    path.join(here, "manifest.json"),
    path.join(target, "manifest.json"),
  );
  for (const f of ["index.js", "style.css"])
    fs.copyFileSync(path.join(dist, f), path.join(target, "dist", f));
  console.log(`installed to ${target}; restart Nimbalyst to load it`);
}
