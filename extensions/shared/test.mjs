// Checks the shared design tokens: the type scale, radii, orb values and state tones exist, and every state
// word is readable (4.5:1 or more) on surfaces 0-2 in all eleven Ink themes, measured the way the browser
// mixes the tokens. Run: node test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { colors, contrast, THEMES } from "../ink-themes/themes.mjs";
import { createChecks } from "./check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { check, finish } = createChecks();
const css = fs.readFileSync(path.join(here, "tokens.css"), "utf8");
const design = fs.readFileSync(path.join(here, "DESIGN.md"), "utf8");

/** The custom properties declared directly in the first block that starts with `selector {`. */
function block(selector) {
  const from = css.indexOf(`${selector} {`);
  if (from < 0) throw new Error(`tokens.css has no "${selector} {" block`);
  const body = css.slice(from, css.indexOf("\n}", from));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].trim(),
    ]),
  );
}
const root = block(":root");
const light = block("html:not(.dark-theme)");

// ---- the tokens exist ----
const want = {
  "--x-title": "600 16px/22px",
  "--x-body": "400 14px/20px",
  "--x-row-title": "500 14px/20px",
  "--x-meta": "400 13px/18px",
  "--x-heading": "600 13px/18px",
  "--x-count": "600 12px/16px",
  // The whole-window text design (26.2): reading text, small control labels, code, the Usage hero number
  "--x-reading": "400 15px/24px",
  "--x-label": "500 13px/18px",
  "--x-code": "400 13px/20px var(--x-font-mono)",
  "--x-hero-figure": "600 32px/36px",
  "--x-font-mono": "var(--ink-mono, ",
  "--x-radius-control": "6px",
  "--x-radius-window": "8px",
  "--x-control-height": "32px",
  "--x-orb-size": "24px",
  "--x-orb-dot-size": "1.5",
  "--x-orb-ink": "var(--x-accent-text)",
  "--x-accent-text": "var(--nim-link)",
};
for (const [name, value] of Object.entries(want))
  check(
    `token ${name} starts with ${value}`,
    (root[name] || "").startsWith(value),
  );
for (const name of ["--x-caption", "--x-micro"])
  check(`old token ${name} removed`, !(name in root));
const STATES = ["running", "needs", "failed", "done", "stopped", "unread"];
for (const s of STATES) check(`token --x-state-${s}`, `--x-state-${s}` in root);
for (const s of ["needs"])
  check(
    `token --x-state-${s}-tint is the tone at 12%`,
    /^color-mix\(in oklab, var\(--[\w-]+\) 12%, transparent\)$/.test(
      root[`--x-state-${s}-tint`] || "",
    ),
  );
check(
  "listening orb takes the needs-you tone",
  /canvas\[data-orb="listening"\]\s*\{\s*color:\s*var\(--x-state-needs\)/.test(
    css,
  ),
);
check(
  "orb dark flag is 0 on light themes",
  light["--orb-dark"] === "0" && root["--orb-dark"] === "1",
);
// Every `font` token (a weight, then size/line-height), whatever its name, is 12px or more
const fontTokens = Object.entries(root).filter(([, value]) =>
  /^\d{3} \d+px\/\d+px /.test(value),
);
check("eleven font tokens", fontTokens.length === 11);
for (const [name, value] of fontTokens)
  check(`${name} is 12px or more`, +value.match(/ (\d+)px\//)[1] >= 12);

// ---- DESIGN.md carries the look rule ----
for (const row of [
  "| Running |",
  "| Needs you |",
  "| Failed |",
  "| Done |",
  "| Stopped, to do |",
  "| Unread |",
  "| Selected |",
])
  check(`DESIGN.md state table has ${row}`, design.includes(row));
check(
  "DESIGN.md has no one-accent-per-view rule",
  !/one accent per view/i.test(design),
);
check(
  "DESIGN.md has no neutral filled button",
  !/surface-3 fill/i.test(design),
);
check(
  "DESIGN.md has the level table",
  /^## Text levels by area$/m.test(design) &&
    /^\| Area \| View title \| Level 1 \| Level 2 \| Level 3 \| Sizes \|$/m.test(
      design,
    ),
);
for (const area of [
  "Rail",
  "Gutter",
  "Session list",
  "Chat",
  "Thinking line",
  "Needs-you bar",
  "Chat box",
  "Copy row",
  "Tool cards",
  "Right panel",
  "Tracker list",
  "Tracker table",
  "Tracker item view",
  "Commands",
  "Usage popover",
  "Systems map",
  "Menus",
])
  check(
    `DESIGN.md level table has the ${area} row`,
    new RegExp(`^\\| ${area}[ |,]`, "m").test(design),
  );
for (const name of ["--x-reading", "--x-label", "--x-code", "--x-hero-figure"])
  check(`DESIGN.md names ${name}`, design.includes("`" + name + "`"));
check(
  "DESIGN.md: Commands groups without headings",
  /Commands[^\n]*no headings/.test(design),
);
check(
  "DESIGN.md: rail and gutter icons 28 px",
  /28 px in the rail and gutter/.test(design) &&
    !/18px in the gutter/.test(design),
);

// ---- colour, as the browser computes it ----
const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGam = (v) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
const hexRgb = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const rgbHex = (c) =>
  "#" +
  c
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
function oklab([r, g, b]) {
  [r, g, b] = [r, g, b].map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(toGam);
}

/** A token's colour in one theme: { hex, alpha }. Knows var(), color-mix(in oklab, ...) and transparent. */
function resolve(value, t) {
  value = value.trim();
  const v = value.match(/^var\((--[\w-]+)\)$/);
  if (v) {
    const name = v[1];
    if (name.startsWith("--nim-")) {
      const hex = colors(t)[name.slice(6)];
      if (!/^#[0-9a-f]{6}$/i.test(hex || ""))
        throw new Error(`no hex for ${name} in ${t.id}`);
      return { hex, alpha: 1 };
    }
    const decl = (!t.isDark && light[name]) || root[name];
    if (!decl) throw new Error(`token ${name} is not declared`);
    return resolve(decl, t);
  }
  const mix = value.match(
    /^color-mix\(in oklab,\s*(.+?)(?:\s+(\d+)%)?,\s*(.+?)(?:\s+(\d+)%)?\)$/,
  );
  if (mix) {
    const [, a, pa, b, pb] = mix;
    const wa = pa != null ? +pa / 100 : pb != null ? 1 - +pb / 100 : 0.5;
    if (b === "transparent") return { ...resolve(a, t), alpha: wa };
    const [x, y] = [resolve(a, t), resolve(b, t)].map((c) =>
      oklab(hexRgb(c.hex)),
    );
    return {
      hex: rgbHex(fromOklab(x.map((xi, i) => xi * wa + y[i] * (1 - wa)))),
      alpha: 1,
    };
  }
  throw new Error(`cannot resolve "${value}" in ${t.id}`);
}
/** A colour with alpha laid over an opaque background, as the browser blends it. */
const over = (c, bg) =>
  rgbHex(
    hexRgb(c.hex).map((v, i) => v * c.alpha + hexRgb(bg)[i] * (1 - c.alpha)),
  );
const tok = (name, t) => resolve(`var(${name})`, t);

check("eleven themes", THEMES.length === 11);
const report = [];
for (const t of THEMES) {
  const surfaces = [0, 1, 2].map((n) => tok(`--x-surface-${n}`, t).hex);
  for (const s of STATES) {
    const tone = tok(`--x-state-${s}`, t).hex;
    const worst = Math.min(...surfaces.map((bg) => contrast(tone, bg)));
    check(
      `${t.id}: ${s} ${tone} ${worst.toFixed(2)}:1 on surfaces 0-2`,
      worst >= 4.5,
    );
    report.push(`${t.id} ${s} ${tone} ${worst.toFixed(2)}`);
  }
  // A tinted row: the state word on its own tone at 12%, over each surface
  for (const s of ["needs"]) {
    const tone = tok(`--x-state-${s}`, t).hex;
    const worst = Math.min(
      ...surfaces.map((bg) =>
        contrast(tone, over(tok(`--x-state-${s}-tint`, t), bg)),
      ),
    );
    check(
      `${t.id}: ${s} word on its 12% tint ${worst.toFixed(2)}:1`,
      worst >= 4.5,
    );
    report.push(`${t.id} ${s}-on-tint ${worst.toFixed(2)}`);
  }
  const onAccent = contrast(
    tok("--x-on-accent", t).hex,
    tok("--x-accent", t).hex,
  );
  check(
    `${t.id}: text on the filled accent button ${onAccent.toFixed(2)}:1`,
    onAccent >= 4.5,
  );
}
// ---- no edge stripes (user 2026-11-13: a coloured bar on the edge of a row reads as AI-made) ----
check(
  "no stripe tokens",
  !("--x-bar-width" in root) && !("--x-state-selected-bar" in root),
);
const extRoot = path.join(here, "..");
const styleFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      e.name === "node_modules" ||
      e.name === "dist" ||
      e.name.startsWith(".")
    )
      continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (
      /\.(css|ts|tsx|js|mjs|html)$/.test(e.name) &&
      !/\.min\.|orbs\.js$|test\.mjs$/.test(e.name)
    )
      styleFiles.push(p);
  }
})(extRoot);
const stripe = [
  /box-shadow:\s*inset\s+-?[1-9][\d.]*(px)?\s+0(px)?\s+0/, // inset Npx 0 0: a bar on the left or right edge
  /border-(left|right)(-width)?:\s*([2-9]|\d{2,})px/, // a side border of 2px or more
  /border-(left|right):[^;]*var\(--(x-accent|x-state|nim-(primary|link|warning|error|success))/, // a side border in an accent or state colour
];
const hits = [];
for (const f of styleFiles)
  fs.readFileSync(f, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (stripe.some((re) => re.test(line)))
        hits.push(path.relative(extRoot, f) + ":" + (i + 1));
    });
check(
  "no edge stripe in any extension" +
    (hits.length ? " (" + hits.join(", ") + ")" : ""),
  hits.length === 0,
);
if (process.argv.includes("--report")) console.log(report.join("\n"));
finish();
