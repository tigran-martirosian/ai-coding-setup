// Checks the themes: every colour slot filled, text readable on its background, manifest.json in step
// with themes.mjs, and the built style sheet scoped to this extension's themes only.
// Run: node test.mjs   (after node build.mjs)
import fs from 'node:fs';
import { EXTENSION_ID, THEMES, colors, contrast } from './themes.mjs';

let failed = 0, passed = 0;
const check = (ok, what) => { ok ? passed++ : (failed++, console.log('FAIL', what)); };
const at = (t, a, b, min) => {
  const c = contrast(t[a], t[b]);
  check(c >= min, `${t.id}: ${a} on ${b} is ${c.toFixed(2)}, needs ${min}`);
};

check(new Set(THEMES.map((t) => t.id)).size === THEMES.length, 'theme ids are unique');
const slots = Object.keys(colors(THEMES[0])).length;
for (const t of THEMES) {
  const c = colors(t);
  check(/^ink-[a-z]+$/.test(t.id), `${t.id}: id is ink-<word>`);
  check(Object.keys(c).length === slots && Object.values(c).every((v) => /^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, 0\.\d+\))$/.test(v)), `${t.id}: every slot is a colour`);
  // Body text, on the page, the side bar and raised boxes
  for (const bg of ['bg', 'side', 'raised']) { at(t, 'text', bg, 10); at(t, 'muted', bg, 6); at(t, 'faint', bg, 4.5); }
  at(t, 'onPrimary', 'primary', 4);
  at(t, 'onPrimary', 'primaryHover', 3.3);
  for (const k of ['link', 'success', 'warning', 'error', 'info', 'purple']) at(t, k, 'bg', 4.5);
  at(t, 'focus', 'bg', 3);
  at(t, 'primary', 'bg', t.isDark ? 3 : 4.5);
  // The side bar must be told apart from the page, and disabled text must stay quieter than faint text
  check(contrast(t.bg, t.side) >= 1.03, `${t.id}: side bar differs from the page (${contrast(t.bg, t.side).toFixed(2)})`);
  check(contrast(t.disabled, t.bg) < contrast(t.faint, t.bg), `${t.id}: disabled is quieter than faint`);
  check(contrast(t.bg, '#000000') > 1 === true && (t.isDark ? contrast(t.text, '#000000') > contrast(t.bg, '#000000') : contrast(t.bg, '#000000') > contrast(t.text, '#000000')), `${t.id}: isDark matches its colours`);
}

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
check(manifest.id === EXTENSION_ID, 'manifest id matches themes.mjs');
check(JSON.stringify(manifest.contributions.themes) === JSON.stringify(THEMES.map((t) => ({ id: t.id, name: t.name, isDark: t.isDark, colors: colors(t) }))),
  'manifest.json matches themes.mjs (run node build.mjs)');

const cssFile = new URL('./dist/theme.css', import.meta.url);
if (!fs.existsSync(cssFile)) check(false, 'dist/theme.css is missing: run node build.mjs first');
else {
  const css = fs.readFileSync(cssFile, 'utf8').replace(/@font-face[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check(css.includes(`html[data-theme^="${EXTENSION_ID}:"] {`), 'shared rules are scoped to this extension');
  check(!css.includes('__S__'), 'no scope word left in the style sheet');
  for (const t of THEMES) check(css.includes(`html[data-theme="${EXTENSION_ID}:${t.id}"] { --nim-on-primary: ${t.onPrimary}`), `${t.id}: has its own rule`);
  // Outside the two scopes there must be nothing, or the fonts and shapes would leak into other themes
  let depth = 0, outside = '';
  for (const ch of css) { if (ch === '{') depth++; else if (ch === '}') depth--; else if (depth === 0) outside += ch; }
  const selectors = outside.split('\n').map((s) => s.trim()).filter(Boolean);
  check(selectors.every((s) => s.startsWith('html[data-theme')), `nothing styled outside the themes: ${selectors.filter((s) => !s.startsWith('html[data-theme')).join(' | ').slice(0, 200)}`);
}
check(fs.readFileSync(new URL('./shell.js', import.meta.url), 'utf8').includes('--ink-sans'), 'shell.js tells from the style sheet whether a theme is on');

console.log(failed ? `${passed} passed, ${failed} failed` : `all ${passed} passed`);
process.exit(failed ? 1 : 0);
