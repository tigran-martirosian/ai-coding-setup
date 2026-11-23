// Draws each given Markdown page as GitHub shows it (light and dark, 1280 and 390 px wide, Mermaid diagrams in
// their frames with GitHub's pan/zoom panel) and checks what a reader would see.
// Run: node scripts/render-check.mjs <page.md...> [--out <folder>]
// Writes <light|dark>-<1280|390>.png and render-check.json to the page's proof folder, .proof/<page name>/ in
// this repo (page name: the path from the repo with / turned into __ and .md dropped, docs__whats-new), or to
// --out (one page only; a page outside this repo needs it).
// Exits 1 when a reader would miss text: a diagram label wider or taller than its box, sticking out of its box's
// shape, or under the pan/zoom panel; other text cut (hidden overflow or an ellipsis with more text than fits);
// a relative link to a file that is not there; an image that does not load. A box that scrolls is listed in
// render-check.json, not failed. Exits 2 on a wrong call.
// How GitHub draws a page was matched against github.com in 8 of 8 screenshots (release 26.6 plan, S1): marked
// (GFM) into github-markdown-css's article, each Mermaid block in its own frame set up as GitHub sets it up.
// Everything is served from node_modules on a local port; nothing is fetched from a CDN. Needs `npm ci` and
// `npx playwright install chromium` in this repo first.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const SCHEMES = ["light", "dark"];
const WIDTHS = [1280, 390];
const SETTLE_MS = 2500;
const TOLERANCE = 1.5;

function usage(msg) {
  console.error(
    `${msg}\nRun: node scripts/render-check.mjs <page.md...> [--out <folder>]`,
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
let outArg = null;
if (outAt >= 0) {
  outArg = args[outAt + 1];
  if (!outArg || outArg.startsWith("--")) usage("--out needs a folder");
  args.splice(outAt, 2);
}
if (args.some((a) => a.startsWith("--")))
  usage(`unknown option ${args.find((a) => a.startsWith("--"))}`);
if (args.length === 0) usage("no page given");
if (outArg && args.length > 1)
  usage(
    "--out takes one page; without it each page goes to .proof/<page name>/",
  );

const pageName = (file) =>
  relative(REPO, file).split(sep).join("__").replace(/\.md$/i, "");
const inRepo = (file) => {
  const r = relative(REPO, file);
  return r !== "" && !r.startsWith("..") && !isAbsolute(r);
};

const pages = args.map((a) => {
  const file = resolve(a);
  if (!existsSync(file)) usage(`no such page: ${a}`);
  if (!outArg && !inRepo(file))
    usage(`${a} is outside this repo: give --out <folder>`);
  return {
    file,
    name: inRepo(file) ? pageName(file) : null,
    out: outArg ? resolve(outArg) : join(REPO, ".proof", pageName(file)),
  };
});

// ---- the page as GitHub draws it ----

const { Marked } = await import("marked");
const { chromium } = await import("playwright");
const ASSETS = {
  "mermaid.min.js": require.resolve("mermaid/dist/mermaid.min.js"),
  "light.css": require.resolve("github-markdown-css/github-markdown-light.css"),
  "dark.css": require.resolve("github-markdown-css/github-markdown-dark.css"),
};
const BG = { light: "#ffffff", dark: "#0d1117" };

// The page's HTML and its Mermaid blocks; each block becomes a frame that reports its height.
function pageHtml(md, scheme, blocks) {
  const html = new Marked({ gfm: true })
    .use({
      renderer: {
        code({ text, lang }) {
          if ((lang ?? "").trim() !== "mermaid") return false;
          blocks.push(text);
          const n = blocks.length - 1;
          return `<section class="js-render-enrichment-target"><iframe data-n="${n}" src="/__render-check__/frame?scheme=${scheme}&n=${n}" style="width:100%;border:0;display:block" height="150"></iframe></section>\n`;
        },
      },
    })
    .parse(md);
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/__render-check__/assets/${scheme}.css">
<style>body{margin:0;background:${BG[scheme]}}
article.markdown-body{box-sizing:content-box;max-width:861px;margin:0 auto;padding:32px 25px}</style>
</head><body><article class="markdown-body">
${html}
</article>
<script>
const frames = document.querySelectorAll("iframe[data-n]");
let left = frames.length;
window.__framesDone = left === 0;
window.__frameErrors = [];
addEventListener("message", (e) => {
  const f = document.querySelector('iframe[data-n="' + e.data.n + '"]');
  if (!f) return;
  f.style.height = e.data.height + "px";
  if (e.data.error) window.__frameErrors.push({ n: e.data.n, error: e.data.error });
  if (!f.dataset.seen) { f.dataset.seen = "1"; left--; }
  if (left === 0) window.__framesDone = true;
});
</script></body></html>`;
}

// One Mermaid frame, set up as GitHub's viewer sets it up, with its 101 px pan/zoom panel at the bottom right.
function frameHtml(code, scheme, n) {
  const dark = scheme === "dark";
  const config = {
    startOnLoad: false,
    securityLevel: "antiscript",
    flowchart: { diagramPadding: 48 },
    gantt: { useWidth: 1200 },
    pie: { useWidth: 1200 },
    sequence: { diagramMarginY: 40 },
    theme: dark ? "dark" : "default",
  };
  const json = (v) => JSON.stringify(v).replace(/</g, "\u003c");
  return `<!doctype html><html data-color-mode="${scheme}"><head><meta charset="utf-8"><style>
html[data-color-mode=dark]{background:#0d1117;color-scheme:dark}
html[data-color-mode=light]{background:#ffffff}
body{margin:0;font:12px Helvetica,arial,freesans,clean,sans-serif}
.mermaid{display:flex;justify-content:center;align-content:flex-start;height:fit-content}
.mermaid>svg{margin:0 auto;display:inline-block}
.mermaid-viewer-control-panel{position:absolute;bottom:1em;right:1em;width:101px;height:101px;box-sizing:border-box;
border-radius:6px;background:${dark ? "#161b22" : "#f6f8fa"};border:1px solid ${dark ? "#30363d" : "#d0d7de"}}
</style><script src="/__render-check__/assets/mermaid.min.js"></script></head><body>
<div class="mermaid" id="m"></div><div class="mermaid-viewer-control-panel"></div>
<script>
(async () => {
  let error = null;
  try {
    mermaid.initialize(${json(config)});
    const { svg } = await mermaid.render("diagram", ${json(code)});
    document.getElementById("m").innerHTML = svg;
  } catch (e) {
    error = String((e && e.message) || e);
  }
  parent.postMessage({ n: ${n}, height: document.documentElement.scrollHeight, error }, "*");
})();
</script></body></html>`;
}

// Serves the page's folder tree (its git top folder, or its own folder) and the drawing files from node_modules.
function serve(root, page) {
  const md = readFileSync(page.file, "utf8");
  const blocks = [];
  const htmlFor = {
    light: pageHtml(md, "light", blocks),
    dark: pageHtml(md, "dark", []),
  };
  const rel = relative(root, page.file).split(sep).join("/");
  const pageUrl = `/${rel.replace(/[^/]+$/, "")}__render-check__.html`;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (code, type, body) => {
      res.writeHead(code, { "content-type": type });
      res.end(body);
    };
    if (url.pathname === pageUrl) {
      const html = htmlFor[url.searchParams.get("scheme")];
      if (!html) return send(404, "text/plain", "no such colour scheme");
      return send(200, "text/html; charset=utf-8", html);
    }
    if (url.pathname === "/__render-check__/frame") {
      const n = Number(url.searchParams.get("n"));
      const code = blocks[n];
      if (code === undefined) return send(404, "text/plain", "no such diagram");
      return send(
        200,
        "text/html; charset=utf-8",
        frameHtml(code, url.searchParams.get("scheme"), n),
      );
    }
    if (url.pathname.startsWith("/__render-check__/assets/")) {
      const file =
        ASSETS[url.pathname.slice("/__render-check__/assets/".length)];
      if (!file) return send(404, "text/plain", "no such file");
      const type = file.endsWith(".css") ? "text/css" : "text/javascript";
      return send(200, `${type}; charset=utf-8`, readFileSync(file));
    }
    const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    const r = relative(root, file);
    if (
      r.startsWith("..") ||
      isAbsolute(r) ||
      !existsSync(file) ||
      !statSync(file).isFile()
    )
      return send(404, "text/plain", "not found");
    send(
      200,
      TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      readFileSync(file),
    );
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () =>
      ok({
        server,
        base: `http://127.0.0.1:${server.address().port}${pageUrl}`,
        blocks,
      }),
    ),
  );
}
const TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".md": "text/plain; charset=utf-8",
};

// ---- what a reader would miss ----

// In a Mermaid frame: each label's text against its own box, its box's shape and the pan/zoom panel.
function measureFrame(tol) {
  const found = [];
  const box = (r) =>
    `${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.x)},${Math.round(r.y)}`;
  const panel = document
    .querySelector(".mermaid-viewer-control-panel")
    .getBoundingClientRect();
  const overlap = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > tol &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tol;
  const outside = (a, b) =>
    a.left < b.left - tol ||
    a.right > b.right + tol ||
    a.top < b.top - tol ||
    a.bottom > b.bottom + tol;
  for (const fo of document.querySelectorAll("svg foreignObject")) {
    // The text itself, line by line: a Range around each text node, all joined in one box.
    const range = document.createRange();
    const walk = document.createTreeWalker(fo, NodeFilter.SHOW_TEXT);
    let t = null;
    const lines = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      lines.push(n.textContent);
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width === 0 && r.height === 0) continue;
        t = t
          ? DOMRect.fromRect({
              x: Math.min(t.left, r.left),
              y: Math.min(t.top, r.top),
              width: Math.max(t.right, r.right) - Math.min(t.left, r.left),
              height: Math.max(t.bottom, r.bottom) - Math.min(t.top, r.top),
            })
          : r;
      }
    }
    const text = lines.join(" ").replace(/\s+/g, " ").trim();
    if (!t || !text) continue;
    const b = fo.getBoundingClientRect();
    if (t.width > b.width + tol || t.height > b.height + tol)
      found.push({
        kind: "label-cut",
        text,
        detail: `text ${box(t)} is bigger than its box ${box(b)}`,
      });
    const node = fo.closest("g.node");
    const shape =
      node &&
      (node.querySelector(":scope > .label-container") ??
        [...node.children].find((e) => !e.classList.contains("label")));
    const s = shape?.getBoundingClientRect();
    if (s && outside(t, s))
      found.push({
        kind: "label-outside-shape",
        text,
        detail: `text ${box(t)} sticks out of its shape ${box(s)}`,
      });
    // A box the panel covers in part looks cut to a reader even when its words are clear of the panel.
    const covered = s ?? t;
    if (overlap(covered, panel))
      found.push({
        kind: "label-under-panel",
        text,
        detail: `${s ? "its box" : "text"} ${box(covered)} is under the pan/zoom panel ${box(panel)}`,
      });
  }
  return found;
}

// In the page: text cut by a box that hides what does not fit; boxes that scroll are listed only.
function measurePage() {
  const cut = [];
  const scrolls = [];
  const hides = (v) => v === "hidden" || v === "clip";
  const scrollsAt = (v) => v === "auto" || v === "scroll";
  for (const el of document.querySelectorAll("article *")) {
    const text = el.textContent.replace(/\s+/g, " ").trim();
    if (!text || el.tagName === "IFRAME") continue;
    const cs = getComputedStyle(el);
    const overX = el.scrollWidth > el.clientWidth + 1;
    const overY = el.scrollHeight > el.clientHeight + 1;
    const short = text.length > 60 ? `${text.slice(0, 57)}...` : text;
    const what = `<${el.tagName.toLowerCase()}> ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`;
    if (
      (hides(cs.overflowX) && overX) ||
      (hides(cs.overflowY) && overY) ||
      (cs.textOverflow === "ellipsis" && overX)
    )
      cut.push({ kind: "text-cut", text: short, detail: what });
    else if (
      (scrollsAt(cs.overflowX) && overX) ||
      (scrollsAt(cs.overflowY) && overY)
    )
      scrolls.push({ kind: "scrolls", text: short, detail: what });
  }
  const images = [...document.querySelectorAll("article img")]
    .filter((i) => !i.complete || i.naturalWidth === 0)
    .map((i) => ({
      kind: "image-missing",
      text: i.getAttribute("src") ?? "",
      detail: "the image does not load",
    }));
  const sideways = document.documentElement.scrollWidth > innerWidth + 1;
  if (sideways)
    scrolls.push({
      kind: "page-scrolls-sideways",
      text: "",
      detail: `${document.documentElement.scrollWidth} px wide in ${innerWidth}`,
    });
  return { cut, scrolls, images };
}

// Relative links and images that name a file not on disk ("/x" starts at the served top folder).
function deadLinks(page, root, refs) {
  const dead = [];
  for (const { tag, ref } of refs) {
    if (
      !ref ||
      ref.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(ref) ||
      ref.startsWith("//")
    )
      continue;
    const path = decodeURIComponent(ref.replace(/[?#].*$/, ""));
    const target = path.startsWith("/")
      ? join(root, path)
      : resolve(dirname(page.file), path);
    if (!existsSync(target))
      dead.push({
        kind: tag === "img" ? "image-missing" : "dead-link",
        text: ref,
        detail: `${relative(dirname(page.file), target)} is not there`,
      });
  }
  return dead;
}

// The Chromium that this Playwright wants; when it is not installed, the newest one Playwright installed earlier.
function chromiumPath() {
  const want = chromium.executablePath();
  if (existsSync(want)) return want;
  const parts = want.split(sep);
  const at = parts.findIndex((p) => /^chromium-\d+$/.test(p));
  if (at > 0) {
    const cache = parts.slice(0, at).join(sep);
    const tail = parts.slice(at + 1);
    const found = readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      .map((d) => join(cache, d, ...tail))
      .find((p) => existsSync(p));
    if (found) return found;
  }
  throw new Error(
    `no Chromium for Playwright at ${want}: run npx playwright install chromium`,
  );
}

function gitTop(dir) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: dir,
    encoding: "utf8",
  });
  return r.status === 0 ? resolve(r.stdout.trim()) : null;
}

// ---- each page: four screenshots, the findings, the verdict ----

const browser = await chromium.launch({ executablePath: chromiumPath() });
let failed = 0;
try {
  for (const page of pages) {
    const root = gitTop(dirname(page.file)) ?? dirname(page.file);
    const { server, base, blocks } = await serve(root, page);
    mkdirSync(page.out, { recursive: true });
    const report = {
      page: page.file,
      pageName: page.name,
      shots: [],
      failures: [],
      listed: [],
    };
    try {
      for (const scheme of SCHEMES)
        for (const width of WIDTHS) {
          const where = { scheme, width };
          const ctx = await browser.newContext({
            colorScheme: scheme,
            viewport: { width, height: 900 },
            deviceScaleFactor: 1,
          });
          try {
            const tab = await ctx.newPage();
            await tab.goto(`${base}?scheme=${scheme}`, { waitUntil: "load" });
            await tab.waitForFunction(
              () => window.__framesDone === true,
              null,
              { timeout: 60000 },
            );
            for (const e of await tab.evaluate(() => window.__frameErrors))
              report.failures.push({
                ...where,
                kind: "diagram-error",
                text: `diagram ${e.n + 1}`,
                detail: e.error,
              });
            await tab.setViewportSize({
              width,
              height: await tab.evaluate(
                () => document.documentElement.scrollHeight,
              ),
            });
            await tab.waitForTimeout(SETTLE_MS);
            const height = await tab.evaluate(
              () => document.documentElement.scrollHeight,
            );
            if (height !== tab.viewportSize().height)
              await tab.setViewportSize({ width, height });
            const file = `${scheme}-${width}.png`;
            await tab.screenshot({ path: join(page.out, file) });
            report.shots.push({ ...where, file, height });
            for (const frame of tab.frames()) {
              if (!frame.url().includes("/__render-check__/frame")) continue;
              const n = Number(new URL(frame.url()).searchParams.get("n"));
              for (const f of await frame.evaluate(measureFrame, TOLERANCE))
                report.failures.push({ ...where, diagram: n + 1, ...f });
            }
            const seen = await tab.evaluate(measurePage);
            for (const f of [...seen.cut, ...seen.images])
              report.failures.push({ ...where, ...f });
            for (const f of seen.scrolls)
              report.listed.push({ ...where, ...f });
            if (scheme === SCHEMES[0] && width === WIDTHS[0]) {
              const refs = await tab.evaluate(() => [
                ...[...document.querySelectorAll("article a[href]")].map(
                  (a) => ({ tag: "a", ref: a.getAttribute("href") }),
                ),
                ...[...document.querySelectorAll("article img[src]")].map(
                  (i) => ({ tag: "img", ref: i.getAttribute("src") }),
                ),
              ]);
              for (const f of deadLinks(page, root, refs))
                report.failures.push(f);
            }
          } finally {
            await ctx.close();
          }
        }
    } finally {
      server.close();
    }
    report.diagrams = blocks.length;
    report.pass = report.failures.length === 0;
    writeFileSync(
      join(page.out, "render-check.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const shown = inRepo(page.file) ? relative(REPO, page.file) : page.file;
    for (const f of report.failures)
      console.log(
        `FAIL ${shown}${f.scheme ? ` ${f.scheme} ${f.width}px` : ""}${f.diagram ? ` diagram ${f.diagram}` : ""}: ${f.kind} "${f.text}": ${f.detail}`,
      );
    console.log(
      `${report.pass ? "ok" : "FAIL"} ${shown}: ${report.failures.length} problem(s), ${report.listed.length} box(es) that scroll, ${report.shots.length} screenshots in ${page.out}`,
    );
    if (!report.pass) failed++;
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
