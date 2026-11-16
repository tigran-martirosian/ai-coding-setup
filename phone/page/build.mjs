// The page build (PC program design, section 2; pipe design, section 6). Copies the page's files as they are with
// LF line ends, writes page/screens.generated.js (one import per file in screens/, sorted, plus the page's
// version) and version.json, and the PC's list of every served file's SHA-256 (skills/phone-bot/pc/page-hashes.json).
// Byte-for-byte repeatable: no time stamp, sorted lists, the version read from version.json.
//   node phone/page/build.mjs [--out <dir>] [--checks]
// The served folder mirrors phone/: index.html at the top, page/** and shared/ beside it, so the page's
// relative import of ../../shared/seal.mjs works in the repo (for Node tests) and on the relay alike.
// --out: where the served page goes; phone/page/dist when not given (git ignores dist/).
// --checks: the test build for the phone check. It adds the Checks screen and writes no page-hashes.json, so a
// PC never trusts a test build.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PAGE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(PAGE, "..", "..");
export const HASHES_FILE = path.join(
  ROOT,
  "skills",
  "phone-bot",
  "pc",
  "page-hashes.json",
);

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
  ["/page/page.css", path.join(PAGE, "page.css")],
  ["/page/telegram-web-app.js", path.join(PAGE, "telegram-web-app.js")],
  ["/shared/seal.mjs", path.join(ROOT, "phone", "shared", "seal.mjs")],
  ["/shared/tokens.css", path.join(ROOT, "extensions", "shared", "tokens.css")],
];
const FOLDERS = ["frame", "screens"];
const SCREEN_FILE = /^[a-z][a-z0-9-]*\.js$/;

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
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

// The one file the frame imports to load every screen: an import per screen file, sorted, and the version.
function generated(screens, version) {
  const lines = [
    "// Written by phone/page/build.mjs: do not edit. One import per file in screens/, sorted.",
    ...screens.map((s) => `import "./${s}";`),
    "",
    `export const PAGE_VERSION = ${JSON.stringify(version)};`,
    "",
  ];
  return lines.join("\n");
}

// Returns { version, files: [[servedPath, bytes]] sorted by path, hashes: { version, files } }.
export function buildPage({ checks = false } = {}) {
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
  const imports = screens.map((s) => `screens/${s}`);
  if (checks) {
    files.set(
      "/page/checks/checks.js",
      lf(readText(path.join(PAGE, "checks", "checks.js"))),
    );
    imports.push("checks/checks.js");
  }
  files.set("/page/screens.generated.js", lf(generated(imports, version)));
  files.set("/version.json", lf(`${JSON.stringify({ version })}\n`));
  const sorted = [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    version,
    files: sorted,
    hashes: {
      version,
      files: Object.fromEntries(sorted.map(([p, b]) => [p, sha(b)])),
    },
  };
}

export const hashesText = (hashes) => `${JSON.stringify(hashes, null, 2)}\n`;

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
  const at = args.indexOf("--out");
  if (at >= 0 && !args[at + 1]) {
    console.error("Usage: node phone/page/build.mjs [--out <dir>] [--checks]");
    process.exit(2);
  }
  const out = path.resolve(at >= 0 ? args[at + 1] : path.join(PAGE, "dist"));
  const build = buildPage({ checks });
  writePage(out, build);
  console.log(
    `page ${build.version}${checks ? " (test build with Checks)" : ""}: ${build.files.length} files in ${out}`,
  );
  if (!checks) {
    fs.writeFileSync(HASHES_FILE, hashesText(build.hashes));
    console.log(`page hashes: ${HASHES_FILE}`);
  }
}
