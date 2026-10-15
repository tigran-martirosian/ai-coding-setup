// Builds the Agents Panel extension: copies src/ to dist/ (no bundler needed), with the two
// visible labels in the answer language (SETUP_LANGUAGE=russian), and with --install copies
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

const LABELS = {
  russian: [
    ['`${done} finished`', '`Готово: ${done}`'],
    ["'Nothing running'", "'Ничего не запущено'"],
  ],
};
const lang = (process.env.SETUP_LANGUAGE || 'english').toLowerCase().replace(/^ru$/, 'russian');

fs.mkdirSync(dist, { recursive: true });
let js = fs.readFileSync(path.join(src, 'index.js'), 'utf8');
for (const [from, to] of LABELS[lang] || []) {
  if (!js.includes(from)) throw new Error(`label ${from} not found in src/index.js`);
  js = js.replace(from, to);
}
fs.writeFileSync(path.join(dist, 'index.js'), js);
fs.copyFileSync(path.join(src, 'style.css'), path.join(dist, 'style.css'));
console.log(`built dist/ (${LABELS[lang] ? lang : 'english'})`);

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
