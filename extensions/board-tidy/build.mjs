// Builds Board Tidy: copies src/index.js to dist/ with the visible words (the STRINGS object) in the
// answer language (SETUP_LANGUAGE=russian); with --install copies manifest.json, dist/ and pick.mjs
// into Nimbalyst's extensions folder. Restart Nimbalyst to load it.
//   node build.mjs            build dist/
//   node build.mjs --install  build, then install
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extensionTarget,
  lenientLanguage,
  swapStrings,
} from "../shared/build-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");

const RUSSIAN_STRINGS = `const STRINGS = {
  archived: 'Board Tidy убрал в архив старых сессий: {n}. Вернуть: вид «Архив» → «Разархивировать».',
  failed: 'Board Tidy не смог убрать сессии в архив: {error}',
};`;
const lang = lenientLanguage();

fs.mkdirSync(dist, { recursive: true });
let js = fs.readFileSync(path.join(here, "src", "index.js"), "utf8");
if (lang === "russian") js = swapStrings(js, RUSSIAN_STRINGS);
fs.writeFileSync(path.join(dist, "index.js"), js);
console.log(`built dist/ (${lang === "russian" ? "russian" : "english"})`);

if (process.argv.includes("--install")) {
  const target = extensionTarget("boardtidy");
  fs.mkdirSync(path.join(target, "dist"), { recursive: true });
  fs.copyFileSync(
    path.join(here, "manifest.json"),
    path.join(target, "manifest.json"),
  );
  fs.copyFileSync(path.join(here, "pick.mjs"), path.join(target, "pick.mjs"));
  fs.copyFileSync(
    path.join(dist, "index.js"),
    path.join(target, "dist", "index.js"),
  );
  console.log(`installed to ${target}; restart Nimbalyst to load it`);
}
