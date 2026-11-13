// Builds the Agents Panel extension: copies src/ to dist/ (no bundler needed), with the two
// visible words (the STRINGS object) in the answer language (SETUP_LANGUAGE=russian), and with --install copies
// manifest.json and dist/ into Nimbalyst's extensions folder. Restart Nimbalyst to load it.
//   node build.mjs            build dist/
//   node build.mjs --install  build, then install
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const STRINGS_START = 'const STRINGS = {';
const STRINGS_END = '\n};';
const lang = (process.env.SETUP_LANGUAGE || 'english').toLowerCase().replace(/^ru$/, 'russian');

fs.mkdirSync(dist, { recursive: true });
let js = fs.readFileSync(path.join(src, 'index.js'), 'utf8');
// The extension loads one file, so src/runs.js (no imports of its own) goes in place of its import line
const RUNS_IMPORT = "import { parseRuns, matchRun, readRuns } from './runs.js';";
if (!js.includes(RUNS_IMPORT)) throw new Error('runs.js import not found in src/index.js');
const runsSource = fs.readFileSync(path.join(src, 'runs.js'), 'utf8').replace(/\nexport \{[^}]*\};\s*$/, '\n').trimEnd();
js = js.replace(RUNS_IMPORT, () => runsSource);
if (lang === 'russian') {
  const from = js.indexOf(STRINGS_START);
  const to = js.indexOf(STRINGS_END, from);
  if (from < 0 || to < 0) throw new Error('STRINGS object not found in src/index.js');
  js = js.slice(0, from) + RUSSIAN_STRINGS + js.slice(to + STRINGS_END.length);
}
fs.writeFileSync(path.join(dist, 'index.js'), js);
const tokensPath = path.join(here, '..', 'shared', 'tokens.css');
if (!fs.existsSync(tokensPath)) throw new Error(`shared tokens not found: ${tokensPath}`);
fs.writeFileSync(path.join(dist, 'style.css'), fs.readFileSync(tokensPath, 'utf8') + '\n' + fs.readFileSync(path.join(src, 'style.css'), 'utf8'));
console.log(`built dist/ (${lang === 'russian' ? 'russian' : 'english'})`);

if (process.argv.includes('--install')) {
  const appData = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.APPDATA;
  if (!appData) throw new Error('APPDATA is not set, so Nimbalyst\'s folder is unknown');
  const home = path.join(appData, '@nimbalyst', 'electron');
  if (!fs.existsSync(home)) throw new Error(`Nimbalyst's folder is not there: ${home}`);
  const target = path.join(home, 'extensions', 'agentspanel');
  fs.mkdirSync(path.join(target, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(here, 'manifest.json'), path.join(target, 'manifest.json'));
  for (const f of ['index.js', 'style.css']) fs.copyFileSync(path.join(dist, f), path.join(target, 'dist', f));
  console.log(`installed to ${target}; restart Nimbalyst to load it`);
}
