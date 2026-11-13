#!/usr/bin/env node
// rules/history.json: the keys of every block the setup ever shipped in rules/CLAUDE.md and the
// projects/<home>/CLAUDE.md files, so the carve (scripts/blocks.mjs) knows old setup text from a person's own.
//   --write        rebuild "shipped" from every commit plus the working tree (needs git); "added" is kept
//   --add <file>   add the keys of one more rules text (a friend patch's) to "added"
//   --check        exit 1 naming each block of the current texts missing from the history (no git)
// Each text is keyed in its Windows and its non-Windows form, with <projects> left in. Keys only: no text,
// commit ids or dates, so nothing private ships.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fitter } from "./repo.mjs";
import { splitBlocks, key, lead, unfit } from "./blocks.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = (repo) => path.join(repo, "rules", "history.json");

// The keys a person's file can hold for this text: as installed on Windows and elsewhere, after unfit().
export function formKeys(text) {
  const keys = new Set();
  for (const win of [true, false]) {
    const fitted = fitter(REPO, "<projects>", win)
      .fit("CLAUDE.md", Buffer.from(text))
      .toString("utf8");
    for (const b of splitBlocks(unfit(fitted, "<projects>", win)))
      keys.add(key(b.text));
  }
  return keys;
}

// The repo's current rules texts, relative paths.
export function currentTexts(repo) {
  const rels = [path.join("rules", "CLAUDE.md")];
  for (const e of fs.readdirSync(path.join(repo, "projects"), {
    withFileTypes: true,
  })) {
    const rel = path.join("projects", e.name, "CLAUDE.md");
    if (e.isDirectory() && fs.existsSync(path.join(repo, rel))) rels.push(rel);
  }
  return rels;
}

function readHistory(repo) {
  const file = FILE(repo);
  if (!fs.existsSync(file)) return null;
  const h = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(h.shipped) || !Array.isArray(h.added))
    throw new Error(`${file} has no "shipped" and "added" lists`);
  return h;
}

function writeHistory(repo, shipped, added) {
  const sorted = (s) => [...new Set(s)].sort();
  fs.writeFileSync(
    FILE(repo),
    JSON.stringify(
      { shipped: sorted(shipped), added: sorted(added) },
      null,
      2,
    ) + "\n",
  );
}

// [{rel, lead}] for each block of the current texts the history lacks.
export function missing(repo) {
  const h = readHistory(repo);
  if (!h)
    throw new Error(
      `no ${FILE(repo)}; run node scripts/rules-history.mjs --write`,
    );
  const have = new Set([...h.shipped, ...h.added]);
  const out = [];
  for (const rel of currentTexts(repo)) {
    const text = fs.readFileSync(path.join(repo, rel), "utf8");
    for (const win of [true, false]) {
      const fitted = fitter(repo, "<projects>", win)
        .fit(rel, Buffer.from(text))
        .toString("utf8");
      for (const b of splitBlocks(unfit(fitted, "<projects>", win))) {
        if (
          !have.has(key(b.text)) &&
          !out.some((m) => m.rel === rel && m.lead === lead(b.text))
        )
          out.push({ rel, lead: lead(b.text) });
      }
    }
  }
  return out;
}

function git(args) {
  return execFileSync("git", ["-C", REPO, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function shippedKeys() {
  const keys = new Set();
  const log = git([
    "log",
    "--no-renames",
    "--format=@%H",
    "--name-status",
    "--",
    "rules/CLAUDE.md",
    "projects/*/CLAUDE.md",
  ]);
  let commit = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("@")) {
      commit = line.slice(1);
      continue;
    }
    const m = line.match(/^([A-Z])\t(.+)$/);
    if (!m || m[1] === "D") continue;
    for (const k of formKeys(git(["show", `${commit}:${m[2]}`]))) keys.add(k);
  }
  for (const rel of currentTexts(REPO))
    for (const k of formKeys(fs.readFileSync(path.join(REPO, rel), "utf8")))
      keys.add(k);
  return keys;
}

function main(argv) {
  const [cmd, arg] = argv;
  if (cmd === "--write") {
    const h = readHistory(REPO);
    const shipped = shippedKeys();
    writeHistory(REPO, shipped, h ? h.added : []);
    console.log(
      `rules history: ${shipped.size} shipped keys, ${h ? h.added.length : 0} added keys`,
    );
  } else if (cmd === "--add") {
    if (!arg) throw new Error("--add needs a file");
    const h = readHistory(REPO);
    if (!h) throw new Error(`no ${FILE(REPO)}; run --write first`);
    const add = formKeys(fs.readFileSync(arg, "utf8"));
    const before = new Set(h.added);
    writeHistory(REPO, h.shipped, [...h.added, ...add]);
    console.log(
      `rules history: ${[...add].filter((k) => !before.has(k)).length} keys added from ${arg}`,
    );
  } else if (cmd === "--check") {
    const gone = missing(REPO);
    for (const m of gone)
      console.log(`missing from rules/history.json: ${m.rel}: ${m.lead}`);
    if (gone.length) {
      console.log("run node scripts/rules-history.mjs --write");
      process.exit(1);
    }
    console.log("rules history: every current block is in rules/history.json");
  } else {
    throw new Error(
      "usage: node scripts/rules-history.mjs --write | --add <file> | --check",
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2));
