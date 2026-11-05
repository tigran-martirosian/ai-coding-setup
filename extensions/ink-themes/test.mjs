// Checks the themes: every colour slot filled, text readable on its background, manifest.json in step
// with themes.mjs, and the built style sheet scoped to this extension's themes only.
// Run: node test.mjs   (after node build.mjs)
import fs from 'node:fs';
import { EXTENSION_ID, THEMES, colors, contrast } from './themes.mjs';
import { labelFor } from './shell.js';

let failed = 0, passed = 0;
const check = (ok, what) => { ok ? passed++ : (failed++, console.log('FAIL', what)); };
const at = (t, a, b, min) => {
  const c = contrast(t[a], t[b]);
  check(c >= min, `${t.id}: ${a} on ${b} is ${c.toFixed(2)}, needs ${min}`);
};

const hsl = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : 60 * (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return { h, s, l };
};
check(THEMES.every((t) => !/\.$/.test(t.about)), 'theme descriptions have no trailing period');
check(new Set(THEMES.map((t) => t.id)).size === THEMES.length, 'theme ids are unique');
const slots = Object.keys(colors(THEMES[0])).length;
for (const t of THEMES) {
  const c = colors(t);
  check(/^ink-[a-z]+$/.test(t.id), `${t.id}: id is ink-<word>`);
  check(Object.keys(c).length === slots && Object.values(c).every((v) => /^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, 0\.\d+\))$/.test(v)), `${t.id}: every slot is a colour`);
  // Body text, on the page, the side bar and raised boxes
  for (const bg of ['bg', 'side', 'raised']) { at(t, 'text', bg, 10); at(t, 'muted', bg, 6); at(t, 'faint', bg, 4.5); }
  at(t, 'onPrimary', 'primary', 4.5);
  at(t, 'onPrimary', 'primaryHover', 3.3);
  // Calm backgrounds: HSL saturation of the page, side bar and raised boxes stays at 12% or less
  for (const k of ['bg', 'side', 'raised']) check(hsl(t[k]).s <= 0.12, `${t.id}: ${k} saturation is ${(hsl(t[k]).s * 100).toFixed(1)}%, needs 12% or less`);
  // One accent: the link colour is a shade of it (a grey accent has no hue to match)
  if (hsl(t.primary).s > 0.1) {
    const d = Math.abs(hsl(t.link).h - hsl(t.primary).h);
    check(Math.min(d, 360 - d) <= 15, `${t.id}: link hue ${hsl(t.link).h.toFixed(0)} is not a shade of the accent hue ${hsl(t.primary).h.toFixed(0)}`);
  }
  // A stop or delete button: white text on the error colour of a light theme
  if (!t.isDark) at({ ...t, white: '#ffffff' }, 'white', 'error', 4.5);
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
// shell.js, the pure part: the button label
check(labelFor('new session') === 'New session' && labelFor('New file') === 'New file' && labelFor(' Open folder ') === 'Open folder', 'shell: button label from the list, else the app label');
// The usage block and its tests were removed (user, 2026-11-05): weekly usage shows in one place only, the app's own Claude ring in the side bar.
// Tokens: the light-theme block must sit on the theme's own element (&:not), not as a nested "html:not(" that never matches
if (fs.existsSync(cssFile)) {
  const built = fs.readFileSync(cssFile, 'utf8');
  const lightBlock = built.match(/&:not\(\.dark-theme\) \{([^}]*)\}/);
  check(!built.includes('html:not(') && !!lightBlock && lightBlock[1].includes('--x-overlay-hover: color-mix(in oklab, var(--nim-text) 4%') && lightBlock[1].includes('--x-overlay-selected: color-mix(in oklab, var(--nim-text) 7%'),
    'built css: light themes get the 4% / 7% overlays through &:not(.dark-theme), no nested html:not(');
}
// Every app class, test id and label the shell touches is in selectors.json (the probe's list)
{
  const listed = fs.readFileSync(new URL('./selectors.json', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('./theme.src.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const js = fs.readFileSync(new URL('./shell.js', import.meta.url), 'utf8');
  const own = /^(ink-|dark-theme|light-theme|material-symbols|rounded|active$)/;
  const used = new Set();
  for (const m of css.matchAll(/([^{};]+)\{/g)) {
    const pre = m[1].trim();
    if (pre.startsWith('@') || pre.startsWith('--')) continue;
    const plain = pre.replace(/\[class[^\]]*\]/g, '').replace(/\[data-panel-id[^\]]*\]/g, '');
    for (const c of plain.matchAll(/\.([a-z][\w-]*)/g)) if (!own.test(c[1])) used.add('.' + c[1]);
    for (const v of plain.matchAll(/\[(?:data-testid|aria-label)[\^$*]?="([^"]+)"\]/g)) used.add(v[1]);
  }
  for (const m of js.matchAll(/(?:querySelector(?:All)?\(\s*['`]|byTest\(['"]|closest\(['"])([^'"`)]*)/g)) {
    for (const c of m[1].matchAll(/\.([a-z][\w-]*)/g)) if (!own.test(c[1])) used.add('.' + c[1]);
  }
  for (const m of js.matchAll(/'([a-z]+-(?:mode-button|usage-indicator))'/g)) used.add(m[1]);
  const missing = [...used].filter((u) => !listed.includes(u));
  check(missing.length === 0, 'selectors.json lacks: ' + missing.join(', '));
}
check(fs.readFileSync(new URL('./shell.js', import.meta.url), 'utf8').includes('--ink-sans'), 'shell.js tells from the style sheet whether a theme is on');

console.log(failed ? `${passed} passed, ${failed} failed` : `all ${passed} passed`);
process.exit(failed ? 1 : 0);
