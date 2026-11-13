#!/usr/bin/env node
// The person's own rules: ~/.claude/rules/my-rules.md and each project home folder's .claude/rules/my-rules.md.
// The tidy's facts, its ledger check and apply, the vault of removed blocks, the tidy marks and the undo.
//   node own-rules.mjs --status [--homes]   per file: lines, size, "changed since last tidy" (state.ownTidied); then
//                                           "pending: <key>" when an own-rules file (home ones always counted) is untidied
//   node own-rules.mjs --report [--homes]   every block of the file(s): id, key, lines, heading, flags, lead; then the
//                                           hooks wired in settings.json (one line each) and the deny list
//   node own-rules.mjs --check <ledger>     the tidy's ledger against the files: one verdict per block, the tidied text
//                                           holds exactly the kept and reworded blocks; prints before/after per file
//   node own-rules.mjs --apply <ledger>     runs the check, then per file: a dated copy, the tidied text, the removed
//                                           blocks to the vault, the moves; one undo record for every file it changed
//   node own-rules.mjs --skip [--homes]     "not now": every untidied file is marked tidied as it is now
//   node own-rules.mjs --offered            the tidy was offered for the current pending key (state.ownOffered)
//   node own-rules.mjs --vault [--homes]    lists the vault entries (id, date, kind, first words)
//   node own-rules.mjs --restore <V-id>     puts one vault entry back in the file it came from
//   node own-rules.mjs --undo               puts back every file of state.rulesUndo (the last carve, tidy or restore)
//                                           and takes away a file that run created; a file it changes or takes away
//                                           is first kept in ~/.claude/setup-logs/<date>-undo/ (the tidy's and the
//                                           restore's copies go to <date>-tidy/ and <date>-restore/ the same way)
//   --homes                                 also the project home folders' own-rules files
//   --home <folder>                         work on <folder>/.claude instead of the home folder's (tests)
// The vault, <.claude>/my-rules-vault.md, sits outside every rules folder, so Claude Code never loads it.
// Self-contained: it reads and writes ~/.claude/setup-state.json itself (read again, written to .part, renamed).
// Every switch that writes refuses while the background self-install holds ~/.claude/update-auto.lock.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const stop = (why) => {
  console.log(`own-rules stopped: ${why}`);
  process.exit(1);
};
const valueOf = (flag) => {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const v = args[at + 1];
  return v && !v.startsWith("--") ? v : null;
};
const homeArg = valueOf("--home");
if (homeArg === null) stop("--home needs a folder.");
const home = homeArg === undefined ? os.homedir() : path.resolve(homeArg);
const HOMES = args.includes("--homes");
if (HOMES && valueOf("--homes"))
  stop("--homes takes no value (--home <folder> is the test switch).");
const CLAUDE = path.join(home, ".claude");
const fwd = (p) => p.replace(/\\/g, "/");
const tilde = (f) =>
  fwd(f).startsWith(fwd(home) + "/")
    ? "~/" + fwd(path.relative(home, f))
    : fwd(f);
const untilde = (f) =>
  path.resolve(/^~[\\/]/.test(f) ? path.join(home, f.slice(2)) : f);
const MY_RULES = path.join(CLAUDE, "rules", "my-rules.md");
const STATE = path.join(CLAUDE, "setup-state.json");
const LOCK = path.join(CLAUDE, "update-auto.lock");
const OWN = tilde(path.join(CLAUDE, "skills", "update-setup", "own-rules.mjs"));
const UNDO = `node ${OWN} --undo`;
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const lines = (text) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
// the local day, as the person's clock and git show it
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4)
    .toISOString()
    .slice(0, 10);
};
const read = (f) => fs.readFileSync(f, "utf8");

const readState = () => {
  if (!fs.existsSync(STATE))
    stop(
      `${fwd(STATE)} is missing, so this setup was not put in place by install.mjs.`,
    );
  return JSON.parse(read(STATE));
};
// read again just before the write, so a field another run changed in the meantime is kept
const saveState = (change) => {
  const next = { ...readState(), ...change };
  for (const k of Object.keys(change))
    if (change[k] === undefined) delete next[k];
  fs.writeFileSync(`${STATE}.part`, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(`${STATE}.part`, STATE);
};
const notLocked = () => {
  if (fs.existsSync(LOCK))
    stop(
      `an update is installing itself right now (${fwd(LOCK)} is there); try again in a few minutes.`,
    );
};
// Where the copy of a file kept before a change goes: ~/.claude/setup-logs/<YYYY-MM-DD>-<what>/ (what: tidy, undo,
// restore) under its path from the home folder (one outside it under outside-home/<drive>/...), or in
// <YYYY-MM-DD>-<what>-2, -3 ... when that day's folder already has one. Nothing is kept beside the file itself.
// The same layout as scripts/files.mjs backupPath, which also moves the <file>.before-<what>-<yyyymmdd> copies
// older versions of this script left beside the files.
function copyName(file, what = "tidy") {
  let rel = path.relative(home, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    const abs = path.resolve(file);
    const root = path.parse(abs).root;
    rel = path.join(
      "outside-home",
      root.replace(/[:\\/]/g, "") || "root",
      abs.slice(root.length),
    );
  }
  for (let n = 1; ; n++) {
    const name = path.join(
      CLAUDE,
      "setup-logs",
      `${today()}-${what}${n > 1 ? `-${n}` : ""}`,
      rel,
    );
    if (!fs.existsSync(name)) {
      fs.mkdirSync(path.dirname(name), { recursive: true });
      return name;
    }
  }
}

// ---- blocks: a copy of scripts/blocks.mjs splitBlocks, normal, key, lead, appendOwn (the installed skill folder
// has no scripts/; tests/test-own-rules.mjs checks both give the same blocks). Each block also has its line range.
const HEADING = /^#{1,6}\s/;
const ITEM = /^([-*]|\d+\.)\s/;
const FENCE = /^\s*(```|~~~)/;
const headingName = (line) => line.replace(/^#+\s*/, "").trim();
function splitBlocks(text) {
  const blocks = [];
  let heading = null;
  let cur = null; // {from, lines}
  let fence = false;
  const close = () => {
    if (cur)
      blocks.push({
        heading,
        text: cur.lines.join("\n"),
        from: cur.from,
        to: cur.from + cur.lines.length - 1,
      });
    cur = null;
  };
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line, i) => {
      if (fence) {
        cur.lines.push(line);
        if (FENCE.test(line)) fence = false;
        return;
      }
      if (line.trim() === "") {
        close();
        return;
      }
      if (HEADING.test(line)) {
        close();
        heading = headingName(line);
        blocks.push({ heading, text: line, from: i, to: i });
        return;
      }
      if (ITEM.test(line)) {
        close();
        cur = { from: i, lines: [line] };
      } else if (cur) cur.lines.push(line);
      else cur = { from: i, lines: [line] };
      if (FENCE.test(line)) fence = true;
    });
  close();
  return blocks;
}
const normal = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
const key = (text) =>
  crypto.createHash("sha256").update(normal(text)).digest("hex").slice(0, 16);
const lead = (text) => {
  const t = normal(text).replace(/^(#+|[-*]|\d+\.)\s+/, "");
  const bold = t.match(/^\*\*(.+?)\*\*/);
  return bold ? bold[1].trim() : t.split(" ").slice(0, 6).join(" ");
};
// own blocks appended under "## <heading>"; a block already there word for word is skipped; the existing text is
// kept byte for byte and the new lines take its line endings
function appendOwn(had, own) {
  const eol = had.includes("\r\n") ? "\r\n" : "\n";
  const lf = had.replace(/\r\n/g, "\n");
  const have = new Set(splitBlocks(lf).map((b) => key(b.text)));
  const heads = splitBlocks(lf).filter((b) => HEADING.test(b.text));
  let section = heads.length ? heads[heads.length - 1].heading : undefined;
  let out = lf;
  let lastItem = false;
  for (const b of own) {
    const k = key(b.text);
    if (have.has(k)) continue;
    have.add(k);
    const name = b.heading ?? "My rules";
    const item = ITEM.test(b.text);
    if (out !== "" && !out.endsWith("\n")) out += "\n";
    if (out !== "" && !(lastItem && item && name === section)) out += "\n";
    if (name !== section) {
      out += `## ${name}\n\n`;
      section = name;
    }
    out += b.text.replace(/\r\n/g, "\n") + "\n";
    lastItem = item;
  }
  return had + out.slice(lf.length).replace(/\n/g, eol);
}

// ---- the own-rules files
// A home is the folder of a state.written key that ends in /CLAUDE.md under state.projects
const homes = (state) => {
  if (!state.projects) return [];
  const root = fwd(state.projects).replace(/\/$/, "") + "/";
  return Object.keys(state.written || {})
    .filter((k) => k.endsWith("/CLAUDE.md") && fwd(k).startsWith(root))
    .map((k) => path.dirname(k));
};
const homeRules = (dir) => path.join(dir, ".claude", "rules", "my-rules.md");
// the files that exist: the global one, and with withHomes each home's
const ownFiles = (state, withHomes) =>
  [MY_RULES, ...(withHomes ? homes(state).map(homeRules) : [])]
    .map((f) => path.resolve(f))
    .filter((f) => fs.existsSync(f));
const isGlobal = (file) => path.resolve(file) === path.resolve(MY_RULES);
// the setup text a file's blocks are compared with: ~/.claude/CLAUDE.md, and for a home file also the home's CLAUDE.md
const setupTexts = (file) => {
  const list = [path.join(CLAUDE, "CLAUDE.md")];
  if (!isGlobal(file))
    list.push(path.resolve(path.dirname(file), "..", "..", "CLAUDE.md"));
  return list.filter((f) => fs.existsSync(f)).map(read);
};
const vaultOf = (file) =>
  path.resolve(path.dirname(file), "..", "my-rules-vault.md");
const tidiedMap = (state) =>
  state.ownTidied && typeof state.ownTidied === "object" ? state.ownTidied : {};
const untidied = (state, files) =>
  files.filter((f) => sha(read(f)) !== tidiedMap(state)[fwd(f)]);
// first 16 hex of sha256 over the sorted lines "<file> <sha>" (file: absolute, forward slashes) of the untidied
// files, global and homes; hooks/update-check.mjs computes it the same way
const pendingKey = (state) => {
  const open = untidied(state, ownFiles(state, true));
  if (!open.length) return null;
  return sha(
    open
      .map((f) => `${fwd(f)} ${sha(read(f))}`)
      .sort()
      .join("\n"),
  ).slice(0, 16);
};
const size = (text) => `${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`;
const tokens = (bytes) => Math.round(bytes / 4);

function status() {
  const state = readState();
  const files = ownFiles(state, HOMES);
  if (!files.length) console.log("my-rules: none");
  const open = new Set(untidied(state, files));
  for (const f of files) {
    const text = read(f);
    console.log(
      `${isGlobal(f) ? "my-rules" : `my-rules ${fwd(f)}`}: ${lines(text)} lines, ${size(text)}${open.has(f) ? ", changed since last tidy" : ""}`,
    );
  }
  const pending = pendingKey(state);
  if (pending) console.log(`pending: ${pending}`);
}

function skip() {
  notLocked();
  const state = readState();
  const open = untidied(state, ownFiles(state, HOMES));
  const marks = { ...tidiedMap(state) };
  for (const f of open) marks[fwd(f)] = sha(read(f));
  saveState({ ownTidied: marks });
  console.log(
    `my-rules: not offered again until the file changes (${open.length ? open.map(tilde).join(", ") : "nothing was untidied"})`,
  );
}

function offered() {
  notLocked();
  const pending = pendingKey(readState());
  if (!pending)
    stop("no own-rules file is untidied, so there is no offer to mark.");
  saveState({ ownOffered: pending });
  console.log(`my-rules: offer marked (${pending})`);
}

// ---- --report
const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
const MONTH = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
const DATED = new RegExp(
  `^(([-*]|\\d+\\.)\\s+)?(\\*\\*)?(\\d{4}-\\d{2}-\\d{2}|${MONTH} \\d{1,2}\\b)`,
);
// mechanical flags only, no judgement
function flags(b, i, keys, shipped) {
  const f = [];
  if (HEADING.test(b.text)) f.push("heading");
  if (shipped.has(keys[i])) f.push("shipped");
  const first = keys.indexOf(keys[i]);
  if (first < i) f.push(`dup B${first + 1}`);
  // a backticked absolute path (drive letter, leading / or ~) that doesn't exist; relative paths are never flagged
  for (const [, p] of b.text.matchAll(/`([^`\s]+)[^`]*`/g)) {
    if (/^([A-Za-z]:[\\/]|\/|~[\\/])/.test(p) && !fs.existsSync(untilde(p)))
      f.push(`missing:${p}`);
  }
  if ((b.text.match(/\b[A-Z]{4,}\b/g) || []).length >= 2) f.push("caps");
  if (DATED.test(normal(b.text))) f.push("dated");
  if (b.to - b.from + 1 > 8) f.push("long");
  return f;
}
function reportFile(file) {
  const text = read(file);
  const blocks = splitBlocks(text);
  const keys = blocks.map((b) => key(b.text));
  const shipped = new Set(
    setupTexts(file).flatMap((t) => splitBlocks(t).map((b) => key(b.text))),
  );
  const bytes = Buffer.byteLength(text);
  console.log(
    `file ${fwd(file)} · ${lines(text)} lines · ${bytes.toLocaleString("en-US")} B · about ${tokens(bytes)} tokens each chat · sha ${sha(text)}`,
  );
  const rows = [
    ["id", "key", "lines", "heading", "flags", "lead"],
    ...blocks.map((b, i) => [
      `B${i + 1}`,
      keys[i],
      String(b.to - b.from + 1),
      cut(b.heading ?? "", 24),
      flags(b, i, keys, shipped).join(", "),
      cut(normal(b.text).replace(/^(#+|[-*]|\d+\.)\s+/, ""), 48),
    ]),
  ];
  const width = rows[0].map((_, c) =>
    Math.max(...rows.map((r) => r[c].length)),
  );
  for (const r of rows)
    console.log(
      r
        .map((v, c) => v.padEnd(width[c]))
        .join("  ")
        .trimEnd(),
    );
  console.log("");
}
// the first sentence of a hook's header comment, without its "<name>: " lead, at most 200 characters
function headerSentence(file, name) {
  if (!fs.existsSync(file)) return "(the hook file is missing)";
  const said = [];
  for (const line of read(file).split(/\r?\n/).slice(0, 6)) {
    if (line.startsWith("#!")) continue;
    const m = line.match(/^\s*(\/\/|#)\s?(.*)$/);
    if (!m) break;
    said.push(m[2].trim());
  }
  let t = said.join(" ");
  if (t.startsWith(`${name}:`)) t = t.slice(name.length + 1).trim();
  // "<event> hook." alone says nothing of what it does: the sentence after it does
  t = t.replace(/^\w+ hook\.\s+/, "");
  const end = t.search(/\.(\s|$)/);
  return cut(end === -1 ? t : t.slice(0, end + 1), 200);
}
// what the setup covers that is not already in the chat: the wired hooks and the deny list
function covers() {
  const file = path.join(CLAUDE, "settings.json");
  if (!fs.existsSync(file))
    stop(
      `${fwd(file)} is missing, so the hooks the setup wires can't be listed.`,
    );
  const s = JSON.parse(read(file));
  const seen = new Map();
  for (const groups of Object.values(s.hooks || {}))
    for (const g of groups)
      for (const h of g.hooks || []) {
        const m = (h.command || "").match(
          /([^"\s]*[\\/]hooks[\\/]([\w.-]+)\.(?:mjs|cjs|js|sh|py|ps1))/,
        );
        if (m && !seen.has(m[2])) seen.set(m[2], m[1]);
      }
  console.log(
    `setup hooks (wired in ${tilde(file)}; the setup's rules, skills and agents are already in the chat):`,
  );
  for (const [name, f] of seen)
    console.log(`- ${name}: ${headerSentence(f, name)}`);
  const deny = s.permissions?.deny || [];
  console.log(`denied: ${deny.length ? deny.join(", ") : "none"}`);
}
function report() {
  const files = ownFiles(readState(), HOMES);
  if (!files.length) console.log("my-rules: none\n");
  for (const f of files) reportFile(f);
  covers();
}

// ---- the ledger: --check and --apply
const KINDS = [
  "own",
  "covered",
  "partly-covered",
  "dead",
  "stale",
  "no-op",
  "cost",
  "worse",
  "clash-small",
  "clash-important",
  "wordy",
  "project-only",
  "file-type-only",
  "procedure",
  "duplicate",
  "heading",
];
const VERDICTS = ["keep", "reword", "vault", "move", "ask", "drop"];
const NEEDS_BY = [
  "covered",
  "partly-covered",
  "worse",
  "clash-small",
  "clash-important",
  "duplicate",
];
const gone = (e) =>
  e.verdict === "vault" || (e.verdict === "ask" && e.answer === "setup");
const reworded = (e) =>
  e.verdict === "reword" || (e.verdict === "ask" && e.answer !== "setup");
// the paths: list of a rules file's frontmatter, as JSON text, or null
const pathsOf = (text) => {
  const m = text
    .replace(/\r\n/g, "\n")
    .match(/^---\n([\s\S]*?)\n---/)?.[1]
    .match(/^paths:\s*(.+)$/m);
  try {
    return m ? JSON.stringify(JSON.parse(m[1])) : null;
  } catch {
    return null;
  }
};

function loadLedger(flag) {
  const file = valueOf(flag);
  if (!file || !fs.existsSync(file))
    stop(
      `${flag} needs the ledger file${file ? ` (${fwd(file)} is not there)` : ""}.`,
    );
  let ledger;
  try {
    ledger = JSON.parse(read(file));
  } catch (e) {
    stop(`${fwd(file)} is not a ledger: ${e.message}`);
  }
  if (
    ledger.ledger !== 1 ||
    !Array.isArray(ledger.files) ||
    !ledger.files.length
  )
    stop(`${fwd(file)} is not a ledger ("ledger": 1 and a "files" list).`);
  return { file, ledger };
}

function moveFaults(e) {
  if (!e.to) return [`${e.id}: move needs "to"`];
  const to = untilde(e.to);
  if (e.kind === "procedure") {
    if (
      path.basename(to) !== "SKILL.md" ||
      path.basename(path.dirname(path.dirname(to))) !== "skills"
    )
      return [`${e.id}: a procedure moves to <.claude>/skills/<name>/SKILL.md`];
    if (fs.existsSync(path.dirname(to)))
      return [
        `${e.id}: the skill folder ${fwd(path.dirname(to))} already exists; pick a new name`,
      ];
    if (!e.description?.trim())
      return [
        `${e.id}: a procedure move needs "description" (when to use the skill)`,
      ];
  } else if (e.kind === "file-type-only") {
    if (path.basename(path.dirname(to)) !== "rules" || !to.endsWith(".md"))
      return [
        `${e.id}: a file-type-only move goes to <.claude>/rules/<topic>.md`,
      ];
    if (!Array.isArray(e.paths) || !e.paths.length)
      return [`${e.id}: a file-type-only move needs "paths" (globs)`];
    if (fs.existsSync(to) && pathsOf(read(to)) !== JSON.stringify(e.paths))
      return [
        `${e.id}: ${fwd(to)} exists without the same paths:; pick a new file name`,
      ];
  } else if (e.kind === "project-only") {
    if (!fwd(to).endsWith("/.claude/rules/my-rules.md"))
      return [
        `${e.id}: a project-only move goes to <project>/.claude/rules/my-rules.md`,
      ];
    const project = path.resolve(path.dirname(to), "..", "..");
    if (!fs.existsSync(project))
      return [`${e.id}: the project folder ${fwd(project)} doesn't exist`];
  } else
    return [
      `${e.id}: only project-only, file-type-only and procedure blocks move`,
    ];
  return [];
}

// every fault of the ledger, and per file what --apply needs
function checkLedger(ledger) {
  const faults = [];
  const plans = [];
  const seen = new Set();
  for (const lf of ledger.files) {
    const file = lf.file ? untilde(lf.file) : null;
    const bad = (why) =>
      faults.push(`${file ? tilde(file) : "(an entry without file)"}: ${why}`);
    if (!file || !fs.existsSync(file)) {
      bad("the file is not there");
      continue;
    }
    if (seen.has(file)) {
      bad("the file is in the ledger twice");
      continue;
    }
    seen.add(file);
    const text = read(file);
    if (lf.sha !== sha(text))
      bad(
        "the file changed since the report (sha differs); run --report again",
      );
    const blocks = splitBlocks(text);
    if (!Array.isArray(lf.blocks)) {
      bad(`no "blocks" list`);
      continue;
    }
    const byId = new Map();
    for (const e of lf.blocks) {
      const n = /^B(\d+)$/.exec(e.id ?? "")?.[1];
      const b = n && blocks[n - 1];
      if (!b) {
        bad(`${e.id ?? "an entry without id"} is not a block of the file`);
        continue;
      }
      if (key(b.text) !== e.key) {
        bad(
          `${e.id}: key ${e.key} is not the key of the block at that place (${key(b.text)})`,
        );
        continue;
      }
      if (byId.has(e.id)) {
        bad(`${e.id} has two entries`);
        continue;
      }
      byId.set(e.id, e);
      const heading = HEADING.test(b.text);
      if (!KINDS.includes(e.kind)) bad(`${e.id}: unknown kind "${e.kind}"`);
      if (!VERDICTS.includes(e.verdict))
        bad(`${e.id}: unknown verdict "${e.verdict}"`);
      else if (e.verdict === "drop" && !heading)
        bad(`${e.id}: drop is only for a heading`);
      else if (heading && !["keep", "drop"].includes(e.verdict))
        bad(`${e.id}: a heading is kept or dropped`);
      if (NEEDS_BY.includes(e.kind) && !e.by)
        bad(`${e.id}: kind ${e.kind} needs "by"`);
      if (e.verdict === "reword" && !e.text?.trim())
        bad(`${e.id}: reword needs "text"`);
      if (e.verdict === "ask") {
        if (!("answer" in e) || !["mine", "setup", null].includes(e.answer))
          bad(`${e.id}: ask needs "answer" (mine, setup or null)`);
        else if (e.answer !== "setup" && !e.text?.trim())
          bad(
            `${e.id}: ask answered ${e.answer} needs "text" (the exception wording)`,
          );
      }
      if (e.verdict === "move") moveFaults(e).forEach(bad);
    }
    blocks.forEach((b, i) => {
      if (!byId.has(`B${i + 1}`))
        bad(`B${i + 1} has no entry ("${cut(normal(b.text), 50)}")`);
    });
    // the tidied text, counted as a multiset of normal forms: each kept block as often as it is kept, nothing more
    const outFile = lf.out ? untilde(lf.out) : null;
    if (!outFile || !fs.existsSync(outFile)) {
      bad(
        `the tidied text ("out") ${outFile ? `${fwd(outFile)} is not there` : "is not named"}`,
      );
      continue;
    }
    const out = read(outFile);
    const want = new Map();
    const have = new Map();
    const count = (m, t) => m.set(normal(t), (m.get(normal(t)) ?? 0) + 1);
    for (const [id, e] of byId) {
      if (e.verdict === "keep") count(want, blocks[id.slice(1) - 1].text);
      else if (reworded(e) && e.text?.trim())
        splitBlocks(e.text).forEach((x) => count(want, x.text));
    }
    splitBlocks(out).forEach((x) => count(have, x.text));
    for (const [t, n] of want)
      if ((have.get(t) ?? 0) < n)
        bad(
          `the tidied text lacks a kept block${n > 1 ? ` (${n} copies wanted)` : ""}: "${cut(t, 60)}"`,
        );
    for (const [t, n] of have)
      if (n > (want.get(t) ?? 0))
        bad(
          `the tidied text has a block the ledger doesn't keep: "${cut(t, 60)}"`,
        );
    plans.push({ lf, file, text, blocks, byId, out });
  }
  return { faults, plans };
}
const tally = (p) => {
  const n = (f) => [...p.byId.values()].filter(f).length;
  const before = Buffer.byteLength(p.text);
  const after = Buffer.byteLength(p.out);
  return (
    `${p.blocks.length} blocks, kept ${n((e) => e.verdict === "keep")}, reworded ${n((e) => e.verdict === "reword")}, ` +
    `vaulted ${n(gone)}, moved ${n((e) => e.verdict === "move")}, asked ${n((e) => e.verdict === "ask")}; ` +
    `${before} B before, ${after} B after (about ${tokens(before - after)} tokens less each chat)`
  );
};
function check() {
  const { ledger } = loadLedger("--check");
  const { faults, plans } = checkLedger(ledger);
  if (faults.length) {
    for (const f of faults) console.log(`check: ${f}`);
    process.exit(1);
  }
  for (const p of plans)
    console.log(`check: ok, ${tilde(p.file)}: ${tally(p)}`);
}

// ---- the vault: entries appended to <.claude>/my-rules-vault.md, newest at the end
//   ## V7 · 2026-11-09 · works against "Never edit or skip a test to get green"
//   From: ~/.claude/rules/my-rules.md, under "Testing"
//   Kind: worse
//   Now: <the reworded text, one line>       (only for kind reworded)
//   <blank line, then the block as it was>
const bare = (by) => String(by).replace(/^(rule|hook|skill|agent):\s*/, "");
function vaultEntry(n, e, b, file) {
  const why = reworded(e)
    ? `reworded (${e.kind})`
    : e.kind === "worse"
      ? `works against "${bare(e.by)}"`
      : e.verdict === "ask"
        ? `the setup's "${bare(e.by)}" kept`
        : e.kind === "covered"
          ? `covered by ${e.by}`
          : e.kind === "duplicate"
            ? `same as ${e.by}`
            : e.kind;
  return [
    `## V${n} · ${today()} · ${why}`,
    `From: ${tilde(file)}${b.heading !== null ? `, under "${b.heading}"` : ""}`,
    `Kind: ${reworded(e) ? "reworded" : e.kind}`,
    ...(reworded(e) ? [`Now: ${normal(e.text)}`] : []),
    "",
    b.text,
    "",
  ].join("\n");
}
const ENTRY = /^## (V\d+) · (\d{4}-\d{2}-\d{2}) · (.*)$/;
function vaultEntries(vault) {
  const ls = read(vault).replace(/\r\n/g, "\n").split("\n");
  const entries = [];
  ls.forEach((l, i) => {
    const m = ENTRY.exec(l);
    if (m) entries.push({ id: m[1], date: m[2], why: m[3], from: i });
  });
  entries.forEach((en, j) => {
    en.to = j + 1 < entries.length ? entries[j + 1].from : ls.length;
    const part = ls.slice(en.from + 1, en.to);
    const from = /^From: (.+?)(?:, under "(.*)")?$/.exec(part[0] ?? "");
    const kind = /^Kind: (.+)$/.exec(part[1] ?? "");
    if (!from || !kind)
      stop(
        `${tilde(vault)}: entry ${en.id} has no From: and Kind: lines; fix it by hand.`,
      );
    en.file = untilde(from[1]);
    en.heading = from[2] ?? null;
    en.kind = kind[1];
    const now = /^Now: (.*)$/.exec(part[2] ?? "");
    en.now = now ? now[1] : null;
    const body = part.slice(now ? 3 : 2);
    while (body.length && body[0].trim() === "") body.shift();
    while (body.length && body[body.length - 1].trim() === "") body.pop();
    en.body = body.join("\n");
  });
  return { ls, entries };
}

function apply() {
  notLocked();
  const { ledger } = loadLedger("--apply");
  const { faults, plans } = checkLedger(ledger);
  if (faults.length) {
    for (const f of faults) console.log(`check: ${f}`);
    stop("the ledger has faults; nothing was changed.");
  }
  const state = readState();
  let next = state.ownVaultNext ?? 1;
  const first = next;
  const undo = [];
  const marks = { ...tidiedMap(state) };
  const created = new Set();
  // each changed or created file goes on the undo record once, before its first change in this run
  const before = (file) => {
    if (undo.some((u) => path.resolve(u.file) === path.resolve(file))) return;
    if (fs.existsSync(file)) {
      const copy = copyName(file);
      fs.copyFileSync(file, copy);
      undo.push({ file: fwd(file), copy: fwd(copy) });
    } else {
      created.add(path.resolve(file));
      undo.push({ file: fwd(file), copy: null });
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
  };
  const said = [];
  // every tidied file is written first and the moves after, so a block moved into another file of the same
  // ledger (a global line about a home project) lands in that file's tidied text instead of being overwritten
  const moves = [];
  for (const p of plans) {
    before(p.file);
    fs.writeFileSync(p.file, p.out);
    p.blocks.forEach((b, i) => {
      const e = p.byId.get(`B${i + 1}`);
      if (e.verdict === "move") moves.push({ e, b });
    });
  }
  for (const { e, b } of moves) {
    const to = untilde(e.to);
    before(to);
    const had = fs.existsSync(to) ? read(to) : "";
    const sep = had === "" || had.endsWith("\n") ? "" : "\n";
    if (e.kind === "project-only")
      fs.writeFileSync(
        to,
        appendOwn(had, [{ heading: b.heading, text: b.text }]),
      );
    else if (had !== "") fs.writeFileSync(to, `${had}${sep}\n${b.text}\n`);
    else if (e.kind === "file-type-only")
      fs.writeFileSync(
        to,
        `---\npaths: ${JSON.stringify(e.paths)}\n---\n\n${b.text}\n`,
      );
    else
      fs.writeFileSync(
        to,
        `---\nname: ${path.basename(path.dirname(to))}\ndescription: ${e.description.trim()}\n---\n\n${b.text}\n`,
      );
  }
  for (const p of plans) {
    const copy = undo.find((u) => path.resolve(u.file) === p.file).copy;
    const entries = [];
    let moved = 0;
    p.blocks.forEach((b, i) => {
      const e = p.byId.get(`B${i + 1}`);
      if (gone(e) || reworded(e))
        entries.push(vaultEntry(next++, e, b, p.file));
      if (e.verdict === "move") moved++;
    });
    if (entries.length) {
      const vault = vaultOf(p.file);
      before(vault);
      const had = fs.existsSync(vault) ? read(vault) : "";
      fs.writeFileSync(
        vault,
        had +
          (had && !had.endsWith("\n") ? "\n" : "") +
          (had.trim() ? "\n" : "") +
          entries.join("\n"),
      );
    }
    marks[fwd(p.file)] = sha(read(p.file)); // after the moves: a block moved in was judged in this run too
    said.push(
      `my-rules: tidied ${tilde(p.file)}, ${lines(p.text)} lines before, ${lines(p.out)} after (vaulted ${entries.length}, moved ${moved}, ` +
        `about ${tokens(Buffer.byteLength(p.text) - Buffer.byteLength(p.out))} tokens less each chat; old copy: ${tilde(copy)}; undo: ${UNDO})`,
    );
  }
  const logs = path.join(CLAUDE, "setup-logs");
  fs.mkdirSync(logs, { recursive: true });
  let log = path.join(logs, `tidy-${today()}.json`);
  for (let n = 2; fs.existsSync(log); n++)
    log = path.join(logs, `tidy-${today()}-${n}.json`);
  fs.writeFileSync(log, JSON.stringify(ledger, null, 2) + "\n");
  saveState({
    ownTidied: marks,
    ownVaultNext: next,
    rulesUndo: { at: new Date().toISOString(), by: "tidy", files: undo },
    rulesUndoBefore: undefined,
  });
  for (const s of said) console.log(s);
  if (next > first)
    console.log(
      `vault: V${first}-V${next - 1} added (list: node ${OWN} --vault; put one back: node ${OWN} --restore V${first})`,
    );
  console.log(`ledger kept as ${tilde(log)}`);
  const leave = ledger.files.flatMap((f) => f.leaveOut || []);
  for (const l of leave)
    console.log(
      `leave out: node ${tilde(path.join(CLAUDE, "skills", "update-setup", "update.mjs"))} --leave-out "${l}"`,
    );
}

const vaultFiles = (state, withHomes) =>
  [MY_RULES, ...(withHomes ? homes(state).map(homeRules) : [])]
    .map(vaultOf)
    .filter((f) => fs.existsSync(f));
function vault() {
  const files = vaultFiles(readState(), HOMES);
  let any = false;
  for (const v of files) {
    const { entries } = vaultEntries(v);
    if (!entries.length) continue;
    any = true;
    console.log(`vault ${tilde(v)}`);
    for (const en of entries)
      console.log(
        `${en.id}  ${en.date}  ${en.kind}  ${cut(normal(en.body).replace(/^(#+|[-*]|\d+\.)\s+/, ""), 60)}`,
      );
  }
  if (!any) console.log("vault: empty");
}

// text with body put back under its heading (after that section's last block), or at the end under a new heading
function putUnder(text, heading, body) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const ls = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const blocks = splitBlocks(ls.join("\n"));
  const h =
    heading === null
      ? -1
      : blocks.findIndex((b) => HEADING.test(b.text) && b.heading === heading);
  if (h === -1) {
    const add =
      heading === null || (ls.length === 1 && ls[0] === "")
        ? []
        : [`## ${heading}`, ""];
    const lead = ls.length === 1 && ls[0] === "" ? [] : [...ls, ""];
    return [...lead, ...add, ...body.split("\n")].join(eol) + eol;
  }
  let last = h;
  while (last + 1 < blocks.length && !HEADING.test(blocks[last + 1].text))
    last++;
  ls.splice(blocks[last].to + 1, 0, "", ...body.split("\n"));
  return ls.join(eol) + eol;
}
// text with the run of blocks whose joined normal form is now replaced by body, or null when it isn't there
function replaceRun(text, now, body) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const ls = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const blocks = splitBlocks(ls.join("\n"));
  for (let i = 0; i < blocks.length; i++) {
    let joined = "";
    for (let j = i; j < blocks.length && joined.length < now.length; j++) {
      joined = joined
        ? `${joined} ${normal(blocks[j].text)}`
        : normal(blocks[j].text);
      if (joined === now) {
        ls.splice(
          blocks[i].from,
          blocks[j].to - blocks[i].from + 1,
          ...body.split("\n"),
        );
        return ls.join(eol) + eol;
      }
    }
  }
  return null;
}

function restore() {
  notLocked();
  const id = valueOf("--restore");
  if (!id || !/^V\d+$/.test(id))
    stop("--restore needs a vault id like V7 (see --vault).");
  const state = readState();
  let found = null;
  for (const v of vaultFiles(state, true)) {
    const { ls, entries } = vaultEntries(v);
    const en = entries.find((x) => x.id === id);
    if (en) found = { v, ls, en };
  }
  if (!found) stop(`${id} is not in the vault (see --vault).`);
  const { v, ls, en } = found;
  if (!fs.existsSync(en.file))
    stop(`${tilde(en.file)}, the file ${id} came from, is not there.`);
  const text = read(en.file);
  const next =
    en.kind === "reworded"
      ? replaceRun(text, en.now, en.body)
      : putUnder(text, en.heading, en.body);
  if (next === null)
    stop(
      `the reworded text of ${id} is no longer in ${tilde(en.file)}; copy it back by hand from ${tilde(v)}.`,
    );
  const files = [];
  for (const f of [en.file, v]) {
    const copy = copyName(f, "restore");
    fs.copyFileSync(f, copy);
    files.push({ file: fwd(f), copy: fwd(copy) });
  }
  fs.writeFileSync(en.file, next);
  const rest = [...ls.slice(0, en.from), ...ls.slice(en.to)];
  while (rest.length && rest[rest.length - 1].trim() === "") rest.pop();
  fs.writeFileSync(v, rest.length ? rest.join("\n") + "\n" : "");
  const marks = tidiedMap(state);
  // the replaced record becomes rulesUndoBefore; the one that was there rides on this record, so restores stack
  saveState({
    rulesUndo: {
      at: new Date().toISOString(),
      by: "restore",
      files,
      marks,
      before: state.rulesUndoBefore,
    },
    rulesUndoBefore: state.rulesUndo,
    ownTidied: { ...marks, [fwd(en.file)]: sha(next) },
  });
  console.log(
    `restore: ${id} is back in ${tilde(en.file)}${en.kind === "reworded" ? " in place of its rewording" : en.heading ? ` under "${en.heading}"` : ""} (undo: ${UNDO})`,
  );
}

function undo() {
  notLocked();
  const state = readState();
  const undo = state.rulesUndo;
  if (!undo?.files?.length)
    stop("there is nothing to undo (no carve, tidy or restore on record).");
  // every copy is checked before anything is put back, so a missing one changes nothing
  const lost = undo.files
    .filter((f) => f.copy !== null && !fs.existsSync(f.copy))
    .map((f) => fwd(f.copy));
  if (lost.length)
    stop(
      `the copy ${lost.join(", ")} is gone, so the ${undo.by} can't be undone; nothing was changed.`,
    );
  // the file as it is now is kept first, so a line added since that run is never lost: one the run created
  // is moved to setup-logs/<date>-undo/, one put back is copied there first (unless it already matches)
  for (const { file, copy } of undo.files) {
    const there = fs.existsSync(file);
    if (copy === null) {
      if (!there) continue;
      const kept = copyName(file, "undo");
      // copied, then removed: the project folders can be on another drive than ~/.claude
      fs.copyFileSync(file, kept, fs.constants.COPYFILE_EXCL);
      fs.rmSync(file);
      console.log(
        `undo: took away ${tilde(file)} (that run created it); what it had is kept as ${tilde(kept)}`,
      );
    } else {
      let kept = null;
      if (there && !fs.readFileSync(file).equals(fs.readFileSync(copy))) {
        kept = copyName(file, "undo");
        fs.copyFileSync(file, kept);
      }
      fs.copyFileSync(copy, file);
      console.log(
        `undo: put back ${tilde(file)} from ${tilde(copy)}${kept ? ` (what it had is kept as ${tilde(kept)})` : ""}`,
      );
    }
  }
  // a restore's undo puts back the record it replaced (the tidy's, say) and the tidy marks it changed
  if (undo.by === "restore")
    saveState({
      rulesUndo: state.rulesUndoBefore,
      rulesUndoBefore: undo.before,
      ownTidied: undo.marks,
    });
  else saveState({ rulesUndo: undefined, rulesUndoBefore: undefined });
  if (undo.by === "carve")
    console.log(
      "undo: done. The next update brings the rules up to this version again, the same way.",
    );
  else console.log("undo: done.");
}

const MODES = {
  "--status": status,
  "--report": report,
  "--check": check,
  "--apply": apply,
  "--skip": skip,
  "--offered": offered,
  "--vault": vault,
  "--restore": restore,
  "--undo": undo,
};
const mode = Object.keys(MODES).filter((m) => args.includes(m));
if (mode.length !== 1) stop(`give one of ${Object.keys(MODES).join(", ")}.`);
MODES[mode[0]]();
