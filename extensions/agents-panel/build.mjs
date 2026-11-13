// Builds the Agents Panel extension: copies src/ to dist/ (no bundler needed), with the two
// visible words (the STRINGS object) in the answer language (SETUP_LANGUAGE=russian), and with --install copies
// manifest.json and dist/ into Nimbalyst's extensions folder. Restart Nimbalyst to load it.
//   node build.mjs            build dist/
//   node build.mjs --install  build, then install
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionTarget, lenientLanguage, readTokens, swapStrings } from '../shared/build-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'src');
const dist = path.join(here, 'dist');

// The whole STRINGS object of src/index.js, in Russian (same keys). Tool names inside the
// "now" phrases stay as the app gives them.
const RUSSIAN_STRINGS = `const STRINGS = {
  running: 'Работает: {n}',
  failed: 'Сбой: {n}',
  done: 'Готово: {n}',
  stopped: 'Остановлено: {n}',
  idle: 'Ничего не запущено',
  doneWord: 'готово',
  failedWord: 'сбой',
  stoppedWord: 'остановлено',
  kinds: { 'Sub-agent': 'Субагент', Command: 'Команда', Workflow: 'Процесс', 'MCP task': 'Задача MCP', Task: 'Задача' },
  tools: { one: 'инструментов: {n}', many: 'инструментов: {n}' },
  units: { h: 'ч', m: 'м', s: 'с' },
  quiet: 'тихо уже {n}',
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
    Agent: 'ждёт субагента',
  },
};`;
const lang = lenientLanguage();

fs.mkdirSync(dist, { recursive: true });
let js = fs.readFileSync(path.join(src, 'index.js'), 'utf8');
// The extension loads one file, so src/runs.js (no imports of its own) goes in place of its import line
const RUNS_IMPORT = "import { parseRuns, matchRun, readRuns } from './runs.js';";
if (!js.includes(RUNS_IMPORT)) throw new Error('runs.js import not found in src/index.js');
const runsSource = fs.readFileSync(path.join(src, 'runs.js'), 'utf8').replace(/\nexport \{[^}]*\};\s*$/, '\n').trimEnd();
js = js.replace(RUNS_IMPORT, () => runsSource);
if (lang === 'russian') js = swapStrings(js, RUSSIAN_STRINGS);
fs.writeFileSync(path.join(dist, 'index.js'), js);
fs.writeFileSync(path.join(dist, 'style.css'), readTokens() + '\n' + fs.readFileSync(path.join(src, 'style.css'), 'utf8'));
console.log(`built dist/ (${lang === 'russian' ? 'russian' : 'english'})`);

if (process.argv.includes('--install')) {
  const target = extensionTarget('agentspanel');
  fs.mkdirSync(path.join(target, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(here, 'manifest.json'), path.join(target, 'manifest.json'));
  for (const f of ['index.js', 'style.css']) fs.copyFileSync(path.join(dist, f), path.join(target, 'dist', f));
  console.log(`installed to ${target}; restart Nimbalyst to load it`);
}
