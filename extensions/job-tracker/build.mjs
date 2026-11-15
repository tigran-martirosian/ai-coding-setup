// Builds the Job Tracker extension: copies src/ to dist/ (no bundler needed) as one script, with the shared
// design tokens in front of the stylesheet, and with --install copies manifest.json and dist/ into Nimbalyst's
// extensions folder. Restart Nimbalyst to load it.
//   node build.mjs            build dist/
//   node build.mjs --install  build, then install
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extensionTarget,
  lenientLanguage,
  readTokens,
} from "../shared/build-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "src");
const dist = path.join(here, "dist");

const lang = lenientLanguage();
if (lang !== "english")
  throw new Error(
    `job-tracker has English words only so far; SETUP_LANGUAGE is "${lang}"`,
  );

// The extension loads one file, so each src module goes in place of its import line in src/index.js, without its
// own import and export lines. Found by shape, so a formatter's quotes and line wraps don't break the match.
const importOf = (file) =>
  new RegExp(
    `^import \\{[^}]*\\} from ["']\\./${file.replace(/\./g, "\\.")}["'];?[ \\t]*\\r?$`,
    "m",
  );
const inline = (file) =>
  fs
    .readFileSync(path.join(src, file), "utf8")
    .replace(/^import \{[^}]*\} from ["']\.\/[\w-]+\.js["'];?[ \t]*\r?\n/gm, "")
    .replace(/\nexport \{[^}]*\};\s*$/, "\n")
    .trimEnd();

let js = fs.readFileSync(path.join(src, "index.js"), "utf8");
// model.js first: reading.js, groups.js and row.js use it
for (const file of [
  "model.js",
  "reading.js",
  "groups.js",
  "item-view.js",
  "row.js",
  "selectors.js",
  "chat.js",
]) {
  const re = importOf(file);
  if (!re.test(js)) throw new Error(`${file} import not found in src/index.js`);
  js = js.replace(re, () => inline(file));
}
// row.js takes the orb's shape from the agents panel's own map (agents-panel/src/stage.js, which imports nothing):
// it goes in place of row.js's import line, so the two extensions never disagree on a tool's orb
const STAGE_IMPORT =
  /^import \{ stageOf \} from ["']\.\.\/\.\.\/agents-panel\/src\/stage\.js["'];?[ \t]*\r?$/m;
if (!STAGE_IMPORT.test(js))
  throw new Error("agents-panel stage.js import not found in src/row.js");
js = js.replace(STAGE_IMPORT, () =>
  fs
    .readFileSync(
      path.join(here, "..", "agents-panel", "src", "stage.js"),
      "utf8",
    )
    .replace(/\nexport \{[^}]*\};\s*$/, "\n")
    .trimEnd(),
);
// The shared thinking-orbs mount goes in place of the marker line inside loadOrbs(), so it runs at activate, not
// when the file is imported (test.mjs imports it in Node, where there is no window)
const ORBS_MARKER = /^[ \t]*\/\/ ORBS-MOUNT \(build\.mjs\)[ \t]*\r?$/m;
if (!ORBS_MARKER.test(js))
  throw new Error("ORBS-MOUNT marker not found in src/index.js");
js = js.replace(ORBS_MARKER, () =>
  fs
    .readFileSync(path.join(here, "..", "shared", "orbs", "orbs.js"), "utf8")
    .trimEnd(),
);

fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "index.js"), js);
fs.writeFileSync(
  path.join(dist, "style.css"),
  readTokens() + "\n" + fs.readFileSync(path.join(src, "style.css"), "utf8"),
);
console.log("built dist/ (english)");

if (process.argv.includes("--install")) {
  const target = extensionTarget("jobtracker");
  fs.mkdirSync(path.join(target, "dist"), { recursive: true });
  fs.copyFileSync(
    path.join(here, "manifest.json"),
    path.join(target, "manifest.json"),
  );
  for (const f of ["index.js", "style.css"])
    fs.copyFileSync(path.join(dist, f), path.join(target, "dist", f));
  console.log(`installed to ${target}; restart Nimbalyst to load it`);
}
