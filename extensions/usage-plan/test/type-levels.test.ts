// Every text in the Usage popover and the usage dashboard sits on a shared type level (docs/2026-11-14-whole-app-type-design.md,
// "usage popover"): its size and weight come from one token in ../../shared/tokens.css, never from a px size or a
// loose weight. Icons are the one exception.
import assert from "node:assert/strict";
import fs from "node:fs";
import { DASHBOARD_CSS } from "../src/dashboard-styles.ts";
import { CSS } from "../src/styles.ts";

/** The rules of a style sheet as [selector, body]; @media and @keyframes wrappers are dropped. */
const rules = (css: string): [string, string][] =>
  [
    ...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ].map((m) => [
    m[1]
      .replace(/^\s*@media[^{]*/, "")
      .replace(/\s+/g, " ")
      .trim(),
    m[2],
  ]);

/** The `font` token a selector's own rule sets, or "" when it sets none. */
const fontOf = (css: string, selector: string) => {
  const rule = rules(css).find(([s]) => s === selector);
  assert.ok(rule, `no rule for ${selector}`);
  return /(?:^|;)\s*font:\s*var\(--x-([a-z-]+)\)/.exec(rule[1])?.[1] ?? "";
};

const ICONS = [".up-sym", ".up-iconbtn .up-sym"];
const POPOVER = [
  "title",
  "hero-figure",
  "figure",
  "heading",
  "meta",
  "label",
  "count",
];
const DASHBOARD = [
  "title",
  "hero-figure",
  "figure",
  "heading",
  "meta",
  "label",
  "code",
];

/** Text → token, as the design maps it. */
const popoverMap: [string, string][] = [
  [".up-title", "title"], // "Usage Plan"
  [".up-fig", "hero-figure"], // the one big figure
  [".up-limit.small .up-fig", "figure"], // the 5-hour figure
  [".up-stat-fig", "figure"], // budget and pace figures
  [".up-label", "heading"], // "This week"
  [".up-verdict", "heading"], // "Runs out Sat 16:55"
  [".up-cap", "meta"], // resets, captions
  [".up-unit", "meta"], // "used", "%/h"
  [".up-busy", "meta"],
  [".up-empty", "meta"],
  [".up-error", "meta"],
  [".up-extra", "label"], // a model's own limit, "Fable"
  [".up-btn", "label"], // "Full dashboard"
  [".up-error button", "label"], // "Retry"
  [".up-now", "count"], // the "Now" tick on the bar
  [".up", "meta"], // anything not named above
];
const dashboardMap: [string, string][] = [
  [".ud h1", "title"],
  [".ud-limit .pct", "hero-figure"],
  [".ud-who b", "figure"],
  [".ud h2", "heading"],
  [".ud-limit .name", "heading"],
  [".ud thead th", "heading"],
  [".ud .detail h3", "heading"],
  [".ud-tip .h", "heading"],
  [".ud-limit .foot .bad, .ud-limit .foot .warn", "heading"],
  [".ud table", "meta"],
  [".ud tbody th", "meta"],
  [".ud-limit .sub", "meta"],
  [".ud-legend", "meta"],
  [".ud-rank", "meta"],
  [".ud-tip", "meta"],
  [".ud-btn", "label"],
  [".ud-seg button", "label"],
  [".ud-chip", "label"],
  [".ud-more", "label"],
  [".ud .strong", "label"],
  [".ud-rank .val", "label"],
  [".ud-state.bad", "label"],
  [".ud-tip b", "label"],
  [".ud code", "code"],
  [".ud", "meta"], // anything not named above
];

const cases: [string, () => void][] = [
  [
    "popover: each text uses its level's token",
    () => {
      for (const [sel, token] of popoverMap)
        assert.equal(fontOf(CSS, sel), token, sel);
    },
  ],
  [
    "dashboard: each text uses its level's token",
    () => {
      for (const [sel, token] of dashboardMap)
        assert.equal(fontOf(DASHBOARD_CSS, sel), token, sel);
    },
  ],
  ...(
    [
      ["popover", CSS, POPOVER],
      ["dashboard", DASHBOARD_CSS, DASHBOARD],
    ] as const
  ).map(([name, css, allowed]): [string, () => void] => [
    `${name}: fonts only from its tokens, no px sizes or loose weights (icons excepted)`,
    () => {
      for (const [sel, body] of rules(css)) {
        for (const m of body.matchAll(/(?:^|;)\s*(font[a-z-]*):\s*([^;]+)/g)) {
          const [, prop, value] = m;
          if (prop === "font") {
            const token = /^var\(--x-([a-z-]+)\)$/.exec(value.trim())?.[1];
            assert.ok(
              value.trim() === "inherit" ||
                (token && (allowed as readonly string[]).includes(token)),
              `${sel}: font: ${value.trim()}`,
            );
          } else if (prop === "font-size")
            assert.ok(ICONS.includes(sel), `${sel}: font-size outside an icon`);
          else
            assert.ok(
              ["font-variant-numeric", "font-variation-settings"].includes(
                prop,
              ),
              `${sel}: ${prop}: ${value.trim()}`,
            );
        }
      }
    },
  ]),
  [
    "the base button rule does not outrank the class rules that set a font",
    () =>
      assert.ok(
        !/(^|[\s,])\.ud button[\s,{]/.test(DASHBOARD_CSS) &&
          DASHBOARD_CSS.includes(":where(.ud) button"),
      ),
  ],
  [
    "views: no inline font sizes or weights",
    () => {
      for (const file of ["popover.tsx", "dashboard-view.tsx", "index.tsx"]) {
        const src = fs.readFileSync(
          new URL(`../src/${file}`, import.meta.url),
          "utf8",
        );
        assert.ok(
          !/fontSize|fontWeight|font:|font-size|font-weight/.test(src),
          file,
        );
      }
    },
  ],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}
process.exitCode = failed ? 1 : 0;
