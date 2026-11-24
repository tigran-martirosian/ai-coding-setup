// Tests for scripts/render-check.mjs, the check that draws a page as GitHub does and fails when a reader would
// miss text. Needs `npm ci` and `npx playwright install chromium` in the repo, and the tag v26.5.2.
// Run: node tests/test-render-check.mjs
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

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
// The same run without blocking this process, so a web server in this test can answer the check.
const runAsync = (...args) =>
  new Promise((done) => {
    const p = spawn(process.execPath, [CHECK, ...args], { cwd: REPO });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
    });
    p.stderr.on("data", (d) => {
      out += d;
    });
    p.on("close", (status) => done({ status, out }));
  });
// A screenshot's pixels: { w, h, bpp, px } (8-bit RGB or RGBA, as Chromium writes them)
function readPng(file) {
  const b = readFileSync(file);
  const idat = [];
  let w;
  let h;
  let depth;
  let type;
  for (let p = 8; p < b.length; ) {
    const len = b.readUInt32BE(p);
    const kind = b.toString("ascii", p + 4, p + 8);
    const d = b.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      depth = d[8];
      type = d[9];
    } else if (kind === "IDAT") idat.push(d);
    else if (kind === "IEND") break;
    p += 12 + len;
  }
  const bpp = { 2: 3, 6: 4 }[type];
  if (depth !== 8 || !bpp)
    throw new Error(
      `${file}: a PNG of depth ${depth}, type ${type} is not read here`,
    );
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const at = y * (stride + 1);
    const filter = raw[at];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = raw[at + 1 + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(up - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + up - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
const hasMagenta = ({ w, h, bpp, px }) => {
  for (let i = 0; i < w * h * bpp; i += bpp)
    if (px[i] > 235 && px[i + 1] < 20 && px[i + 2] > 235) return true;
  return false;
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

  // A page taller than Chromium draws in one picture (16,384 px): past that height one screenshot repeats the
  // top, so the page's end (a magenta block) must be in one of the numbered pictures.
  const tall = join(tmp, "tall");
  mkdirSync(tall);
  writeFileSync(
    join(tall, "page.md"),
    [
      "# A tall page",
      "",
      '<div style="height:17000px;background:#00ffff"></div>',
      "",
      '<div style="height:120px;background:#ff00ff"></div>',
      "",
      "The end of the page.",
      "",
    ].join("\n"),
  );
  const tallOut = join(tmp, "out-tall");
  const tl = run(join(tall, "page.md"), "--out", tallOut);
  ok(
    "a tall clean page passes (exit 0)",
    tl.status === 0,
    `exit ${tl.status}\n${tl.out}`,
  );
  const tlr = existsSync(join(tallOut, "render-check.json"))
    ? report(tallOut)
    : null;
  for (const scheme of ["light", "dark"])
    for (const width of [1280, 390]) {
      const shot = tlr?.shots.find(
        (s) => s.scheme === scheme && s.width === width,
      );
      const files = existsSync(tallOut)
        ? readdirSync(tallOut).filter((n) =>
            new RegExp(`^${scheme}-${width}(-\\d+)?\\.png$`).test(n),
          )
        : [];
      const pics = files.map((n) => readPng(join(tallOut, n)));
      ok(
        `each picture of the tall page is at most 16,384 px tall, ${scheme} ${width}`,
        pics.length > 0 && pics.every((p) => p.h <= 16384),
        `${files.join(", ")}: ${pics.map((p) => p.h).join(", ")}`,
      );
      ok(
        `the tall page's pictures together cover its whole height, ${scheme} ${width}`,
        Boolean(shot) &&
          shot.height > 16384 &&
          pics.reduce((n, p) => n + p.h, 0) >= shot.height,
        `page ${shot?.height} px; ${files.join(", ")}: ${pics.map((p) => p.h).join(", ")}`,
      );
      ok(
        `the tall page's end is in a saved picture, ${scheme} ${width}`,
        pics.some(hasMagenta),
        files.join(", "),
      );
    }

  // Links to headings, on the page and on another page, by GitHub's heading ids; web links only with --web.
  const links = join(tmp, "links");
  mkdirSync(links);
  writeFileSync(
    join(links, "other.md"),
    "# Other page\n\n## Its part\n\nText.\n",
  );
  const web = createServer((req, res) => {
    if (req.url === "/head-refused" && req.method === "HEAD")
      res.writeHead(405);
    else res.writeHead(req.url === "/gone" ? 404 : 200);
    res.end();
  });
  await new Promise((r) => web.listen(0, "127.0.0.1", r));
  const site = `http://127.0.0.1:${web.address().port}`;
  const FILM =
    "https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000";
  writeFileSync(
    join(links, "page.md"),
    [
      "# Links page",
      "",
      "## Step 2: run it (fast)!",
      "",
      "## Again",
      "",
      "## Again",
      "",
      '<a name="raw-spot"></a>',
      "",
      "[ok 1](#links-page) [ok 2](#step-2-run-it-fast) [ok 3](#again-1) [ok 4](#raw-spot)",
      "[ok 5](other.md#its-part) [ok 6](other.md)",
      "[bad 1](#no-such-heading) [bad 2](other.md#no-part) [bad 3](#again-2)",
      `[web ok](${site}/ok) [web head refused](${site}/head-refused) [web gone](${site}/gone)`,
      `[a film](${FILM})`,
      "",
    ].join("\n"),
  );
  try {
    const linksOut = join(tmp, "out-links");
    const l = await runAsync(join(links, "page.md"), "--out", linksOut);
    ok(
      "a page with dead heading links fails (exit 1)",
      l.status === 1,
      `exit ${l.status}\n${l.out}`,
    );
    const lr = existsSync(join(linksOut, "render-check.json"))
      ? report(linksOut)
      : null;
    for (const bad of ["#no-such-heading", "other.md#no-part", "#again-2"])
      ok(
        `a link to a heading that is not there, "${bad}", is a dead-anchor`,
        Boolean(
          lr?.failures.some((f) => f.kind === "dead-anchor" && f.text === bad),
        ),
        lr ? kinds(lr).join("\n") : l.out,
      );
    for (const good of [
      "#links-page",
      "#step-2-run-it-fast",
      "#again-1",
      "#raw-spot",
      "other.md#its-part",
      "other.md",
    ])
      ok(
        `a link to a heading that is there, "${good}", passes (GitHub's ids)`,
        Boolean(lr) && !lr.failures.some((f) => f.text === good),
        lr ? kinds(lr).join("\n") : l.out,
      );
    ok(
      "web links are not checked without --web",
      Boolean(lr) && !lr.failures.some((f) => f.kind === "web-link"),
      lr ? kinds(lr).join("\n") : l.out,
    );
    const webOut = join(tmp, "out-links-web");
    const lw = await runAsync(join(links, "page.md"), "--out", webOut, "--web");
    const wr = existsSync(join(webOut, "render-check.json"))
      ? report(webOut)
      : null;
    ok(
      "with --web a web link that answers 404 is a web-link problem with its status",
      Boolean(
        wr?.failures.some(
          (f) =>
            f.kind === "web-link" &&
            f.text === `${site}/gone` &&
            /404/.test(f.detail),
        ),
      ),
      wr ? kinds(wr).join("\n") : lw.out,
    );
    for (const good of [`${site}/ok`, `${site}/head-refused`])
      ok(
        `with --web a web link that loads (HEAD, else GET) passes: ${good.slice(site.length)}`,
        Boolean(wr) && !wr.failures.some((f) => f.text === good),
        wr ? kinds(wr).join("\n") : lw.out,
      );
    // GitHub answers 404 to any signed-out request for an uploaded file, a live film too: such a link is listed
    // as not checkable, not failed.
    ok(
      "with --web a GitHub user-attachments link is listed as not checkable, not failed",
      Boolean(wr) &&
        !wr.failures.some((f) => f.text === FILM) &&
        wr.listed.some(
          (f) => f.kind === "web-link-unchecked" && f.text === FILM,
        ),
      wr ? `${kinds(wr).join("\n")}\n${JSON.stringify(wr.listed)}` : lw.out,
    );
  } finally {
    web.close();
  }

  // GitHub draws "> [!IMPORTANT]" as an alert box with a purple bar (#8250df in light), not as a grey quote
  // that shows the marker as text; the check must draw it the same way.
  const alert = join(tmp, "alert");
  mkdirSync(alert);
  writeFileSync(
    join(alert, "page.md"),
    "# Alert\n\n> [!IMPORTANT]\n> Read this before you install.\n",
  );
  const alertOut = join(tmp, "out-alert");
  const al = run(join(alert, "page.md"), "--out", alertOut);
  const purple = (file) => {
    if (!existsSync(file)) return false;
    const { w, h, bpp, px } = readPng(file);
    for (let i = 0; i < w * h * bpp; i += bpp)
      if (
        Math.abs(px[i] - 0x82) < 12 &&
        Math.abs(px[i + 1] - 0x50) < 12 &&
        Math.abs(px[i + 2] - 0xdf) < 12
      )
        return true;
    return false;
  };
  ok(
    "an IMPORTANT alert is drawn as GitHub's alert box (its purple bar shows), light 1280",
    al.status === 0 && purple(join(alertOut, "light-1280.png")),
    al.out,
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
