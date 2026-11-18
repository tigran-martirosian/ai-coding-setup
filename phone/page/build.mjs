// The page build (PC program design, section 2; pipe design, section 6). Copies the page's files as they are with
// LF line ends, writes page/screens.generated.js (the first-wave screen files' imports, the later files' loadRest(),
// the page's version) and version.json, and puts one modulepreload line per first-wave module into index.html.
// Byte-for-byte repeatable: no time stamp, sorted lists, the version read from version.json.
//   node phone/page/build.mjs [--out <dir>] [--checks] [--test-copy]
// The served folder mirrors phone/: index.html at the top, page/** and shared/ beside it, so the page's
// relative import of ../../shared/seal.mjs works in the repo (for Node tests) and on the relay alike.
// --out: where the served page goes; phone/page/dist when not given (git ignores dist/).
// --checks: the test build for the phone check. It adds the Checks screen.
// --test-copy: the page of the test copy beside the real relay. Its STORE_SUFFIX "-test" ends every storage key
// name (frame/keystore.js), so a test copy opened from the same bot never reads or overwrites the real pairing.
// A plain build's suffix is empty: its key names stay the real app's.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PAGE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(PAGE, "..", "..");

// Served path -> source file. Folders are listed whole; anything else in phone/page (this script, the README,
// the picture script, dist/) is not served. The job tracker's model.js is copied unchanged to the path that the
// screens' import "../../../extensions/job-tracker/src/model.js" reaches in the repo and, from /page/screens/,
// on the served page too (a URL's "../" stops at the site's root).
const FIXED = [
  [
    "/extensions/job-tracker/src/model.js",
    path.join(ROOT, "extensions", "job-tracker", "src", "model.js"),
  ],
  ["/", path.join(PAGE, "index.html")],
  ["/page/files.css", path.join(PAGE, "files.css")],
  ["/page/page.css", path.join(PAGE, "page.css")],
  ["/page/shell.css", path.join(PAGE, "shell.css")],
  ["/page/telegram-web-app.js", path.join(PAGE, "telegram-web-app.js")],
  ["/page/wide.css", path.join(PAGE, "wide.css")],
  ["/shared/seal.mjs", path.join(ROOT, "phone", "shared", "seal.mjs")],
  ["/shared/tokens.css", path.join(ROOT, "extensions", "shared", "tokens.css")],
];
const FOLDERS = ["frame", "screens"];
const SCREEN_FILE = /^[a-z][a-z0-9-]*\.js$/;

const lf = (text) => Buffer.from(text.replace(/\r\n/g, "\n"), "utf8");

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`page build: cannot read ${file}: ${e.message}`);
  }
}

function setupVersion() {
  const file = path.join(ROOT, "version.json");
  const v = JSON.parse(readText(file)).version;
  if (typeof v !== "string") throw new Error(`${file} has no "version"`);
  return v;
}

function jsFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .sort();
}

// The screens a file registers, as [{ id, tab }]. Every registerScreen call starts with its id and tab, so the build
// can read them without running the file.
function screensIn(name, text) {
  const calls = text.split("registerScreen({").length - 1;
  const found = [
    ...text.matchAll(
      /registerScreen\(\{\s*id:\s*"([a-z][a-z0-9-]*)",\s*tab:\s*(null|"[a-z]+")/g,
    ),
  ].map((m) => ({ id: m[1], tab: m[2] === "null" ? null : m[2] }));
  if (found.length !== calls)
    throw new Error(
      `page build: ${name} has a registerScreen call that does not start with id: "…", tab: …`,
    );
  return found;
}

// The first wave (comfort design, section 4): the files that register a tab screen or a Home part load before the
// first draw; every other screen file loads after it.
const firstWave = (text, found) =>
  found.some((s) => s.tab !== null) || text.includes("registerHomePart({");

// The static imports of a module's text: `import … from "x"`, `import "x"` and `export … from "x"`; not import().
const importsOf = (text) =>
  [
    ...text.matchAll(
      /(?:^|\n)\s*(?:import|export)\s+(?:[^"';]*?\sfrom\s*)?"([^"]+)"/g,
    ),
  ].map((m) => m[1]);

// Every served path reached by static imports from `entries` (the entries themselves left out), sorted.
function reached(files, entries) {
  const seen = new Set();
  const walk = (at) => {
    const bytes = files.get(at);
    if (!bytes) throw new Error(`page build: ${at} is imported but not served`);
    for (const spec of importsOf(bytes.toString("utf8"))) {
      const next = new URL(spec, `https://page${at}`).pathname;
      if (seen.has(next) || entries.includes(next)) continue;
      seen.add(next);
      walk(next);
    }
  };
  for (const at of entries) walk(at);
  return [...seen].sort();
}

// The one file the frame imports to load the screens: an import per first-wave file, sorted; LATER, the ids of the
// screens in the later files; loadRest(), which imports the later files; the version and the storage key suffix.
function generated(first, later, laterIds, version, storeSuffix) {
  const lines = [
    "// Written by phone/page/build.mjs: do not edit. The first-wave screen files load with the page; the rest load",
    "// with loadRest() after the first draw.",
    ...first.map((s) => `import "./${s}";`),
    "",
    `export const LATER = ${JSON.stringify(laterIds)};`,
    "export const loadRest = () =>",
    "  Promise.all([",
    ...later.map((s) => `    import("./${s}"),`),
    "  ]);",
    "",
    `export const PAGE_VERSION = ${JSON.stringify(version)};`,
    `export const STORE_SUFFIX = ${JSON.stringify(storeSuffix)};`,
    "",
  ];
  return lines.join("\n");
}

const PRELOAD_MARK = "    <!-- modulepreload -->\n";

// index.html with one modulepreload line per module the two entry scripts reach, so they load in one wave.
function withPreloads(files) {
  const html = files.get("/").toString("utf8");
  if (!html.includes(PRELOAD_MARK))
    throw new Error(
      "page build: index.html has no <!-- modulepreload --> line of its own",
    );
  const links = reached(files, ["/page/frame/boot.js", "/page/frame/app.js"])
    .map((at) => `    <link rel="modulepreload" href="${at.slice(1)}" />\n`)
    .join("");
  return lf(html.replace(PRELOAD_MARK, links));
}

// Returns { version, files: [[servedPath, bytes]] sorted by path }.
export function buildPage({ checks = false, testCopy = false } = {}) {
  const version = setupVersion();
  const files = new Map();
  for (const [at, src] of FIXED) files.set(at, lf(readText(src)));
  for (const folder of FOLDERS)
    for (const f of jsFiles(path.join(PAGE, folder)))
      files.set(
        `/page/${folder}/${f}`,
        lf(readText(path.join(PAGE, folder, f))),
      );
  const screens = jsFiles(path.join(PAGE, "screens"));
  for (const s of screens)
    if (!SCREEN_FILE.test(s))
      throw new Error(
        `page build: screens/${s} is not a screen file name (lower case, digits and dashes, .js)`,
      );
  const all = screens.map((s) => `screens/${s}`);
  if (checks) {
    files.set(
      "/page/checks/checks.js",
      lf(readText(path.join(PAGE, "checks", "checks.js"))),
    );
    all.push("checks/checks.js");
  }
  const first = [];
  const later = [];
  const laterIds = [];
  for (const s of all) {
    const text = files.get(`/page/${s}`).toString("utf8");
    const found = screensIn(s, text);
    if (firstWave(text, found)) first.push(s);
    else {
      later.push(s);
      laterIds.push(...found.map((f) => f.id));
    }
  }
  files.set(
    "/page/screens.generated.js",
    lf(
      generated(
        first,
        later,
        laterIds.sort(),
        version,
        testCopy ? "-test" : "",
      ),
    ),
  );
  files.set("/", withPreloads(files));
  files.set("/version.json", lf(`${JSON.stringify({ version })}\n`));
  const sorted = [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { version, files: sorted };
}

// A served path to its place in the output folder: "/" is index.html.
const outPath = (out, at) =>
  path.join(out, at === "/" ? "index.html" : at.slice(1));

// Writes the page to `out`, which must be empty, missing, or an earlier build (it holds version.json and
// index.html); an earlier build is removed first so no stale file is served.
export function writePage(out, build) {
  if (fs.existsSync(out)) {
    const names = fs.readdirSync(out);
    const earlier =
      names.includes("version.json") && names.includes("index.html");
    if (names.length && !earlier)
      throw new Error(
        `page build: ${out} is not empty and is not an earlier page build`,
      );
    fs.rmSync(out, { recursive: true, force: true });
  }
  for (const [at, bytes] of build.files) {
    const file = outPath(out, at);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  const checks = args.includes("--checks");
  const testCopy = args.includes("--test-copy");
  const at = args.indexOf("--out");
  if (at >= 0 && !args[at + 1]) {
    console.error(
      "Usage: node phone/page/build.mjs [--out <dir>] [--checks] [--test-copy]",
    );
    process.exit(2);
  }
  const out = path.resolve(at >= 0 ? args[at + 1] : path.join(PAGE, "dist"));
  const build = buildPage({ checks, testCopy });
  writePage(out, build);
  console.log(
    `page ${build.version}${checks ? " (test build with Checks)" : ""}${testCopy ? " (test copy)" : ""}: ${build.files.length} files in ${out}`,
  );
}
