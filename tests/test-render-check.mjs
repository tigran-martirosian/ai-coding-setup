// Tests for scripts/render-check.mjs, the check that draws a page as GitHub does and fails when a reader would
// miss text. Needs `npm ci` and `npx playwright install chromium` in the repo, and the tag v26.5.2.
// Run: node tests/test-render-check.mjs
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CHECK = join(REPO, "scripts", "render-check.mjs");
const PAGES = join(REPO, "tests", "fixtures", "pages");
const tmp = mkdtempSync(join(tmpdir(), "render-check-"));
let fails = 0;
const ok = (name, pass, why = "") => {
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: ${why}`}`);
};
const run = (...args) => {
  const r = spawnSync(process.execPath, [CHECK, ...args], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 300000,
  });
  return { ...r, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const report = (dir) =>
  JSON.parse(readFileSync(join(dir, "render-check.json"), "utf8"));
const shots = (dir) =>
  ["light-1280", "light-390", "dark-1280", "dark-390"].filter(
    (s) => !existsSync(join(dir, `${s}.png`)),
  );
const kinds = (rep) =>
  rep.failures.map(
    (f) => `${f.kind} ${f.scheme ?? ""} ${f.width ?? ""} "${f.text}"`,
  );

try {
  // The 26.5 tour as released: at 390 px GitHub's pan/zoom panel covers the last box, "You try it".
  const tour = join(tmp, "v26.5.2");
  mkdirSync(join(tour, "docs"), { recursive: true });
  for (const f of ["docs/whats-new.md", "CHANGELOG.md"]) {
    const g = spawnSync("git", ["show", `v26.5.2:${f}`], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 1 << 26,
    });
    if (g.status !== 0)
      throw new Error(
        `git show v26.5.2:${f} failed (is the tag fetched?): ${g.stderr}`,
      );
    writeFileSync(join(tour, f), g.stdout);
  }
  const tourOut = join(tmp, "out-tour");
  const t = run(join(tour, "docs", "whats-new.md"), "--out", tourOut);
  ok(
    "the 26.5.2 tour fails the render check (exit 1)",
    t.status === 1,
    `exit ${t.status}\n${t.out}`,
  );
  const tr = existsSync(join(tourOut, "render-check.json"))
    ? report(tourOut)
    : null;
  ok("the tour's render-check.json is written", tr !== null, t.out);
  if (tr) {
    for (const scheme of ["light", "dark"])
      ok(
        `the tour fails because the pan/zoom panel covers "You try it" at 390 px, ${scheme}`,
        tr.failures.some(
          (f) =>
            f.kind === "label-under-panel" &&
            f.text === "You try it" &&
            f.width === 390 &&
            f.scheme === scheme,
        ),
        kinds(tr).join("\n"),
      );
    ok(
      "the panel does not cover a tour label at 1280 px",
      !tr.failures.some(
        (f) => f.kind === "label-under-panel" && f.width === 1280,
      ),
      kinds(tr).join("\n"),
    );
    ok(
      "the tour's links all lead to a file",
      !tr.failures.some((f) => f.kind === "dead-link"),
      kinds(tr).join("\n"),
    );
  }
  ok(
    "the tour's four screenshots are written",
    shots(tourOut).length === 0,
    `missing: ${shots(tourOut)}`,
  );

  // A label whose words grow after Mermaid measured them: its words are bigger than its box.
  const cutOut = join(tmp, "out-cut");
  const c = run(join(PAGES, "cut-label.md"), "--out", cutOut);
  ok(
    "a page with a cut label fails (exit 1)",
    c.status === 1,
    `exit ${c.status}\n${c.out}`,
  );
  const cr = existsSync(join(cutOut, "render-check.json"))
    ? report(cutOut)
    : null;
  for (const width of [1280, 390])
    ok(
      `the cut label "Grows" is named in dark at ${width} px`,
      cr?.failures.some(
        (f) =>
          f.kind === "label-cut" &&
          f.text === "Grows" &&
          f.scheme === "dark" &&
          f.width === width,
      ),
      cr ? kinds(cr).join("\n") : c.out,
    );
  ok("the cut is named on the output", /label-cut "Grows"/.test(c.out), c.out);

  // A dead link, a missing image and text a box hides, each its own failure.
  const made = join(tmp, "made");
  mkdirSync(made);
  writeFileSync(
    join(made, "page.md"),
    [
      "# Made page",
      "",
      "See [the guide](no-such-guide.md) and [the top](#made-page).",
      "",
      "![a picture](no-such-picture.png)",
      "",
      '<div style="overflow:hidden;white-space:nowrap;width:60px">A sentence far too long for its narrow box</div>',
      "",
    ].join("\n"),
  );
  const madeOut = join(tmp, "out-made");
  const m = run(join(made, "page.md"), "--out", madeOut);
  ok(
    "a page with a dead link, a missing image and hidden text fails (exit 1)",
    m.status === 1,
    `exit ${m.status}\n${m.out}`,
  );
  const mr = existsSync(join(madeOut, "render-check.json"))
    ? report(madeOut)
    : null;
  for (const [kind, text] of [
    ["dead-link", "no-such-guide.md"],
    ["image-missing", "no-such-picture.png"],
    ["text-cut", "A sentence far too long for its narrow box"],
  ])
    ok(
      `the ${kind} "${text}" is named`,
      mr?.failures.some((f) => f.kind === kind && f.text === text),
      mr ? kinds(mr).join("\n") : m.out,
    );
  ok(
    "a link to a heading on the page is not dead",
    !mr?.failures.some((f) => f.text === "#made-page"),
    mr ? kinds(mr).join("\n") : "",
  );

  // A clean page passes; with no --out its proof goes to .proof/<page name>/ in the repo.
  const cleanOut = join(REPO, ".proof", "tests__fixtures__pages__clean");
  rmSync(cleanOut, { recursive: true, force: true });
  const k = run(join(PAGES, "clean.md"));
  ok(
    "a clean page passes (exit 0)",
    k.status === 0,
    `exit ${k.status}\n${k.out}`,
  );
  ok(
    "its proof goes to .proof/tests__fixtures__pages__clean/",
    existsSync(join(cleanOut, "render-check.json")),
    k.out,
  );
  ok(
    "its four screenshots are written",
    existsSync(cleanOut) && shots(cleanOut).length === 0,
    `missing: ${shots(cleanOut)}`,
  );
  ok(
    "its render-check.json says pass",
    existsSync(join(cleanOut, "render-check.json")) &&
      report(cleanOut).pass === true,
    k.out,
  );
  rmSync(cleanOut, { recursive: true, force: true });

  ok(
    "a page outside the repo with no --out is refused (exit 2)",
    run(join(made, "page.md")).status === 2,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
