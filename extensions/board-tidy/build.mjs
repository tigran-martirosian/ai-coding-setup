// Builds Board Tidy: copies src/index.js to dist/ with the visible words (the STRINGS object) in the
// answer language (SETUP_LANGUAGE=russian); with --install copies manifest.json, dist/ and pick.mjs
// into Nimbalyst's extensions folder. Restart Nimbalyst to load it.
//   node build.mjs            build dist/
//   node build.mjs --install  build, then install
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');

const RUSSIAN_STRINGS = `const STRINGS = {
  archived: 'Board Tidy убрал в архив старых сессий: {n}. Вернуть: вид «Архив» → «Разархивировать».',
  failed: 'Board Tidy не смог убрать сессии в архив: {error}',
};`;
const STRINGS_START = 'const STRINGS = {';
const STRINGS_END = '\n};';
const lang = (process.env.SETUP_LANGUAGE || 'english').toLowerCase().replace(/^ru$/, 'russian');

fs.mkdirSync(dist, { recursive: true });
let js = fs.readFileSync(path.join(here, 'src', 'index.js'), 'utf8');
if (lang === 'russian') {
  const from = js.indexOf(STRINGS_START);
  const to = js.indexOf(STRINGS_END, from);
  if (from < 0 || to < 0) throw new Error('STRINGS object not found in src/index.js');
  js = js.slice(0, from) + RUSSIAN_STRINGS + js.slice(to + STRINGS_END.length);
}
fs.writeFileSync(path.join(dist, 'index.js'), js);
console.log(`built dist/ (${lang === 'russian' ? 'russian' : 'english'})`);

if (process.argv.includes('--install')) {
  const appData = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.APPDATA;
  if (!appData) throw new Error('APPDATA is not set, so Nimbalyst\'s folder is unknown');
  const home = path.join(appData, '@nimbalyst', 'electron');
  if (!fs.existsSync(home)) throw new Error(`Nimbalyst's folder is not there: ${home}`);
  const target = path.join(home, 'extensions', 'boardtidy');
  fs.mkdirSync(path.join(target, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(here, 'manifest.json'), path.join(target, 'manifest.json'));
  fs.copyFileSync(path.join(here, 'pick.mjs'), path.join(target, 'pick.mjs'));
  fs.copyFileSync(path.join(dist, 'index.js'), path.join(target, 'dist', 'index.js'));
  console.log(`installed to ${target}; restart Nimbalyst to load it`);
}
