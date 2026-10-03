#!/usr/bin/env node
// privacy-check: scans every file that would be published for things that must not go out: home
// folder paths, email addresses, API keys and tokens, AI credit lines, backup and .env files, and any
// word on a private list. Files over 1 MB are listed too.
//   node scripts/privacy-check.mjs [folder] [--words <file>]
// The folder is this repository by default. Real names belong in the word list, not in this script:
// one word or phrase per line in .privacy-words at the top of the folder (git ignores that file, so it
// never ships). Each is matched without regard to case. Exit code 1 when anything is found.
// A line "allow <file>:<line>" in the word list lets private words stand on that one line, for a
// name that is meant to be public there, such as the copyright line of a licence.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const wordsAt = args.indexOf("--words");
const wordsArg = wordsAt >= 0 ? args.splice(wordsAt, 2)[1] : null;
const ROOT = path.resolve(args[0] || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const WORDS_FILE = path.resolve(wordsArg || path.join(ROOT, ".privacy-words"));
const SKIP_DIRS = new Set([".git", "node_modules"]);
const BIG = 1024 * 1024;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const listed = fs.existsSync(WORDS_FILE)
  ? fs.readFileSync(WORDS_FILE, "utf8").split(/\r?\n/).map((w) => w.trim()).filter((w) => w && !w.startsWith("#"))
  : [];
const ALLOW = /^allow\s+(\S+:\d+)$/i;
const allowed = new Set(listed.filter((w) => ALLOW.test(w)).map((w) => w.match(ALLOW)[1]));
const words = listed.filter((w) => !ALLOW.test(w));
// The home folder of whoever runs the check, in both slash styles
const home = os.homedir();
const PATTERNS = [
  // placeholders such as <you>, %USERNAME%, $USER or "someone" are fine
  ["home folder path", /(?:[A-Za-z]:[\\/]{1,4}Users[\\/]{1,4}|\/(?:Users|home)\/)(?![<%$]|(?:USERNAME|you|name|user|someone|other|example)\b)[a-z][\w.-]*/i],
  ["this computer's home folder", new RegExp(`${escape(home)}|${escape(home.replace(/\\/g, "/"))}|${escape(home.replace(/\\/g, "\\\\"))}`, "i")],
  ["email address", /(?<![\w.%+-])[\w.%+-]+@(?!(?:[\w-]+\.)*(?:example\.(?:com|org|net)|users\.noreply\.github\.com|github\.com)\b)[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/i],
  ["Telegram bot token", /\b\d{8,10}:AA[\w-]{30,}/],
  ["real session id", /session_?id"?\s*[:=]\s*"?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i],
  ["API key or token", /\b(?:sk-(?:ant-)?[\w-]{20,}|ghp_\w{30,}|github_pat_\w{30,}|AIza[\w-]{30,}|xox[abp]-[\w-]{10,})/],
  ["AI credit line", new RegExp("co-author" + "ed-by|generated (?:with|by) (?:claude|chatgpt|codex|gemini|an? ai)", "i")],
  ...words.map((w) => [`private word "${w}"`, new RegExp(escape(w), "i")]),
];
const BAD_NAME = [["backup file", /\.bak(\.|$)|~$/i], ["environment file", /^\.env(\.(?!example$).*)?$/i]];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(full);
    return full === WORDS_FILE ? [] : [full];
  });
}

const files = walk(ROOT);
const hits = [], big = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const size = fs.statSync(file).size;
  if (size > BIG) big.push(`${rel} (${(size / BIG).toFixed(1)} MB)`);
  for (const [what, re] of BAD_NAME) if (re.test(path.basename(file))) hits.push(`${rel}: ${what}`);
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("\u0000")) continue; // binary
  text.split("\n").forEach((line, i) => {
    for (const [what, re] of PATTERNS) {
      const m = line.match(re);
      if (m && what.startsWith("private word") && allowed.has(`${rel}:${i + 1}`)) continue;
      if (m) hits.push(`${rel}:${i + 1}: ${what}: ${m[0].slice(0, 60)}`);
    }
  });
}

console.log(`privacy check: ${files.length} files in ${path.basename(ROOT)}, ${words.length} private words from ${fs.existsSync(WORDS_FILE) ? path.basename(WORDS_FILE) : "no word list"}`);
for (const h of hits.slice(0, 40)) console.log(`  ${h}`);
if (hits.length > 40) console.log(`  and ${hits.length - 40} more`);
console.log(big.length ? `files over 1 MB: ${big.join(", ")}` : "files over 1 MB: none");
console.log(hits.length ? `${hits.length} finding(s)` : "nothing found");
process.exit(hits.length ? 1 : 0);
