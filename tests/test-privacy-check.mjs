// Tests for scripts/privacy-check.mjs, then the check itself on this repository.
// Run: node tests/test-privacy-check.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHECK = fileURLToPath(new URL("../scripts/privacy-check.mjs", import.meta.url));
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const check = (...args) => {
  const r = spawnSync(process.execPath, [CHECK, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout };
};
const folder = (files) => {
  const dir = fs.mkdtempSync(path.join(tmp, "f-"));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-test-"));
fs.writeFileSync(path.join(tmp, "words.txt"), "# a comment line\nexample farm\n");

// The planted leaks are built from pieces so this file doesn't trip the check itself.
const leaks = {
  "home folder path": "log at C:\\" + "Users\\jsmith\\notes.txt",
  "home folder path (forward slashes)": "cd /" + "Users/jsmith/code",
  "email address": "mail me: j.smith" + "@gmail.com",
  "Telegram bot token": "token " + "123456789:AA" + "x".repeat(33),
  "API key or token": "key=sk-" + "ant-" + "a".repeat(30),
  "AI credit line": "Co-" + "Authored-By: someone",
  "real session id": '"session_id": "' + "1234abcd-12ab-34cd-",
  "private word": "notes about Example Farm Co",
};
for (const [what, text] of Object.entries(leaks)) {
  const r = check(folder({ "a.md": `first line\n${text}\n` }), "--words", path.join(tmp, "words.txt"));
  ok(`finds it: ${what}`, [r.code, r.out.includes("a.md:2:")], [1, true]);
}
ok("a word from the word list is found without regard to case",
  check(folder({ "a.md": leaks["private word"] }), "--words", path.join(tmp, "words.txt")).out.includes('private word "example farm"'));
fs.writeFileSync(path.join(tmp, "allow.txt"), "example farm\nallow LICENSE:1\n");
const allow = check(folder({ LICENSE: "Copyright Example Farm Co\nExample Farm again\n", "a.md": "j.smith" + "@gmail.com\n" }), "--words", path.join(tmp, "allow.txt")).out;
ok("an allowed line may hold a private word; other lines and other findings still count",
  [allow.includes("LICENSE:1:"), allow.includes("LICENSE:2:"), allow.includes("a.md:1: email"), allow.includes("1 private words")], [false, true, true, true]);
ok("finds backup and .env files by name", check(folder({ "x.mjs.bak": "", ".env": "", ".env.example": "" })).out.match(/: (backup|environment) file/g), [": environment file", ": backup file"]);
ok("lists a file over 1 MB", check(folder({ "big.txt": "a".repeat(1100000) })).out.includes("big.txt (1.0 MB)"));
const clean = check(folder({
  "a.md": "Copy to C:\\Users\\<you>\\.claude or ~/.claude. Commits as 1+" + "user@users.noreply.github.com.",
  ".env.example": "API_KEY=",
}));
ok("placeholders, noreply addresses and .env.example pass", [clean.code, clean.out.includes("nothing found")], [0, true]);
fs.rmSync(tmp, { recursive: true, force: true });

// ---- this repository
const repo = check();
console.log(repo.out.trim().split("\n").map((l) => `     ${l}`).join("\n"));
ok("this repository passes the privacy check", repo.code, 0);

console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
