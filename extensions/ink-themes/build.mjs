// Builds manifest.json (from themes.mjs) and dist/theme.css (fonts embedded) from theme.src.css.
//   node build.mjs                   build only
//   node build.mjs --install         build, then copy manifest.json and dist into Nimbalyst's extensions folder
//   node build.mjs --preview f [id]  build, then write f: a script that shows theme `id` (default: the first)
//                                    on a running window without saving it
//   node build.mjs --swatches f      build, then write f: a page that shows every theme's colours side by side
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_ID, THEMES, colors } from './themes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.join(here, 'fonts');
const FONTS = [
  ['Figtree', 'Figtree:wght@300..900', '300 900'],
  ['Bricolage Grotesque', 'Bricolage+Grotesque:opsz,wght@12..96,200..800', '200 800'],
  ['JetBrains Mono', 'JetBrains+Mono:wght@100..800', '100 800'],
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

fs.mkdirSync(fontsDir, { recursive: true });
let faces = '';
for (const [name, query, weights] of FONTS) {
  const file = path.join(fontsDir, name.replace(/ /g, '') + '.woff2');
  if (!fs.existsSync(file)) {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${query}&display=swap`, { headers: { 'User-Agent': UA } })).text();
    const m = css.match(/\/\* latin \*\/\s*@font-face\s*\{[^}]*?url\((https:[^)]+\.woff2)\)/);
    if (!m) throw new Error(`No latin woff2 found for ${name}`);
    const res = await fetch(m[1]);
    if (!res.ok) throw new Error(`Download failed for ${name}: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log('downloaded', name, fs.statSync(file).size, 'bytes');
  }
  const b64 = fs.readFileSync(file).toString('base64');
  faces += `@font-face { font-family: "${name}"; font-style: normal; font-weight: ${weights}; font-display: swap; src: url(data:font/woff2;base64,${b64}) format("woff2"); }\n`;
}

// manifest.json: everything but the theme list is kept as it is in the file
const manifestFile = path.join(here, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (manifest.id !== EXTENSION_ID) throw new Error(`manifest.json has id ${manifest.id}, themes.mjs says ${EXTENSION_ID}`);
manifest.contributions.themes = THEMES.map((t) => ({ id: t.id, name: t.name, isDark: t.isDark, colors: colors(t) }));
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

// What differs per theme besides the manifest's colours: the text on the accent (the app does not
// always take it from the manifest) and how heavy a shadow the background can carry.
const own = (t) => `--nim-on-primary: ${t.onPrimary} !important; --ink-shadow: rgba(0, 0, 0, ${t.isDark ? 0.3 : 0.1});`;
const src = fs.readFileSync(path.join(here, 'theme.src.css'), 'utf8');
if (!src.includes('__S__ {')) throw new Error('theme.src.css has no __S__ scope word');
const shared = (scope) => faces + src.replace('__S__ {', `${scope} {`);

// The shared rules are on while any theme of this extension is on
fs.mkdirSync(path.join(here, 'dist'), { recursive: true });
const out = path.join(here, 'dist', 'theme.css');
fs.writeFileSync(out, shared(`html[data-theme^="${EXTENSION_ID}:"]`)
  + THEMES.map((t) => `html[data-theme="${EXTENSION_ID}:${t.id}"] { ${own(t)} }\n`).join(''));
console.log('built', out, fs.statSync(out).size, 'bytes,', THEMES.length, 'themes');

// shell.js is the extension's code file as it is (no bundling)
const shell = fs.readFileSync(path.join(here, 'shell.js'), 'utf8');
const main = path.join(here, manifest.main);
fs.writeFileSync(main, shell);

const [flag, file, id] = process.argv.slice(2);
if (flag === '--install') {
  // On a Mac Nimbalyst keeps its settings under Application Support
  const appData = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.APPDATA;
  if (!appData) throw new Error('Cannot find the settings folder: APPDATA is not set');
  const dest = path.join(appData, '@nimbalyst', 'electron', 'extensions', 'inktheme');
  fs.mkdirSync(path.join(dest, 'dist'), { recursive: true });
  fs.copyFileSync(manifestFile, path.join(dest, 'manifest.json'));
  fs.copyFileSync(out, path.join(dest, 'dist', 'theme.css'));
  fs.copyFileSync(main, path.join(dest, manifest.main));
  console.log('installed to', dest);
} else if (flag === '--preview') {
  const theme = id ? THEMES.find((t) => t.id === id) : THEMES[0];
  if (!theme) throw new Error(`No theme called ${id}. There are: ${THEMES.map((t) => t.id).join(', ')}`);
  const vars = Object.entries(colors(theme)).map(([k, v]) => `--nim-${k}: ${v} !important;`).join(' ');
  // In a preview an installed theme may already be on; `html:root` weighs the same as its scope, so the preview's rules, which come later, win.
  const css = shared('html:root') + `\nhtml:root { ${vars} ${own(theme)} }`;
  // The shell is swapped for the new one: the old one is switched off first.
  const run = shell.replace('export { activate, deactivate };', 'activate();');
  if (run === shell) throw new Error('shell.js no longer ends with the expected export line');
  const js = `(() => { let s = document.getElementById('ink-preview'); if (!s) { s = document.createElement('style'); s.id = 'ink-preview'; document.head.appendChild(s); } s.textContent = ${JSON.stringify(css)}; const h = document.documentElement; h.classList.toggle('dark-theme', ${theme.isDark}); h.classList.toggle('light-theme', ${!theme.isDark}); (() => { ${run} })(); return 'preview of ${theme.id} applied, ' + s.textContent.length + ' chars'; })()`;
  fs.writeFileSync(file, js);
  console.log('wrote preview script', file);
} else if (flag === '--swatches') {
  const card = (t) => {
    const c = colors(t);
    const dot = (k) => `<i style="background:${c[k]}" title="${k}"></i>`;
    return `<section style="background:${c.bg};color:${c.text};border-color:${c.border}">
  <aside style="background:${c['bg-secondary']};border-color:${c.border}"><b style="background:${c.primary};color:${c['on-primary']}">+ New session</b>
    <p style="background:${c['bg-selected']}">Fix the login page</p><p style="color:${c['text-muted']}">Weekly report</p><p style="color:${c['text-faint']}">2 hours ago</p></aside>
  <main><h2>${t.name}</h2><p style="color:${c['text-muted']}">${t.about}</p>
    <p>Plain text, <a style="color:${c.link}">a link</a> and <code style="background:${c['code-bg']};border-color:${c.border}">some code</code>.</p>
    <div class="dots">${['success', 'warning', 'error', 'info', 'purple'].map(dot).join('')}</div>
    <div class="box" style="background:${c['bg-tertiary']};border-color:${c.border};color:${c['text-faint']}">Ask anything…<b style="background:${c.primary};color:${c['on-primary']}">Send</b></div></main>
</section>`;
  };
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>Ink themes</title><style>${faces}
body { margin: 0; padding: 28px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; background: #8f8a84; font: 14px/1.45 Figtree, sans-serif; width: 1500px; box-sizing: border-box; }
section { display: grid; grid-template-columns: 170px 1fr; border: 1px solid; border-radius: 14px; overflow: hidden; min-height: 290px; box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28); }
aside { padding: 14px 12px; border-right: 1px solid; } aside p { margin: 8px 0 0; padding: 6px 9px; border-radius: 9px; font-size: 13px; }
aside b, .box b { display: block; padding: 8px 12px; border-radius: 10px; font-weight: 600; font-size: 13px; }
main { padding: 16px 20px; display: flex; flex-direction: column; } main p { margin: 0 0 10px; }
h2 { margin: 0 0 4px; font: 700 23px "Bricolage Grotesque", sans-serif; letter-spacing: -0.01em; }
code { font: 12.5px "JetBrains Mono", monospace; padding: 2px 6px; border: 1px solid; border-radius: 6px; }
.dots { display: flex; gap: 8px; margin-bottom: 14px; } .dots i { width: 18px; height: 18px; border-radius: 50%; }
.box { margin-top: auto; display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 8px 14px; border: 1px solid; border-radius: 14px; }
</style>${THEMES.map(card).join('\n')}`);
  console.log('wrote', file);
}
