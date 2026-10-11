// Tests for install.mjs --language, in a temporary home folder. Run: node tests/test-language.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "language-test-"));
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const install = (home, ...flags) => spawnSync(process.execPath, [path.join(REPO, "install.mjs"), "--home", home, "--codex", "no", "--agy", "no", ...flags], { encoding: "utf8" });

const home = path.join(tmp, "home");
const state = () => json(path.join(home, ".claude", "setup-state.json"));
const settings = () => json(path.join(home, ".claude", "settings.json"));

let r = install(home);
check("a fresh run without the flag prints 'Language: not chosen'", r.status === 0 && r.stdout.includes("Language: not chosen"));
check("nothing is stored or written for it", state().language === undefined && settings().language === undefined);

r = install(home, "--language", "RU");
check("--language RU (any case, short form) prints 'Language: russian'", r.status === 0 && r.stdout.includes("Language: russian"));
check("it stores language russian in the state", state().language === "russian");
check("it writes \"language\": \"russian\" to settings.json", settings().language === "russian");

r = install(home);
check("a run without the flag keeps both", r.status === 0 && r.stdout.includes("Language: russian") && state().language === "russian" && settings().language === "russian");

r = install(home, "--language", "english");
check("--language english stores english", r.status === 0 && r.stdout.includes("Language: english") && state().language === "english");
check("it removes the settings key", settings().language === undefined);

// a language the person set themselves stays
const other = path.join(tmp, "other");
install(other, "--language", "russian");
const otherFile = path.join(other, ".claude", "settings.json");
fs.writeFileSync(otherFile, JSON.stringify({ ...json(otherFile), language: "japanese" }, null, 2));
r = install(other, "--language", "english");
check("--language english leaves a 'japanese' setting alone", r.status === 0 && json(otherFile).language === "japanese");

r = install(path.join(tmp, "bad"), "--language", "klingon");
check("--language klingon exits non-zero and names both languages", r.status !== 0 && /english/.test(r.stdout) && /russian/.test(r.stdout));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
