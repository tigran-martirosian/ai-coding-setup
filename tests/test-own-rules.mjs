// Tests for skills/update-setup/own-rules.mjs: the undo of the installer's carve and of a tidy, the tidy marks
// (--status, --skip, --offered and the pending key), --report [--homes], the ledger (--check, --apply), the vault
// (--vault, --restore). Everything happens in a temporary home folder, with the small invented files in
// tests/fixtures/own-rules. Run: node tests/test-own-rules.mjs
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { key, splitBlocks } from "../scripts/blocks.mjs";

process.env.SETUP_CC_CHECK = "off";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const FIX = path.join(REPO, "tests", "fixtures", "own-rules");
const fwd = (p) => p.replace(/\\/g, "/");
const OWN = path.join(REPO, "skills", "update-setup", "own-rules.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "own-rules-test-"));
let pass = 0,
  fail = 0;
const check = (name, ok) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};
const read = (file) => fs.readFileSync(file, "utf8");
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

const home = path.join(tmp, "home");
const claude = path.join(home, ".claude");
const rulesFile = path.join(claude, "CLAUDE.md");
const myRules = path.join(claude, "rules", "my-rules.md");
const stateFile = path.join(claude, "setup-state.json");
const lock = path.join(claude, "update-auto.lock");
const state = () => JSON.parse(read(stateFile));
const install = () =>
  spawnSync(
    process.execPath,
    [path.join(REPO, "install.mjs"), "--home", home, "--codex", "no"],
    { encoding: "utf8" },
  );
const own = (...flags) => {
  const r = spawnSync(process.execPath, [OWN, "--home", home, ...flags], {
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
// a tidy ledger: the given files (each {file, sha, blocks}) and one tidied text, written to temp files
const ledgerFile = path.join(tmp, "ledger.json");
const outFile = path.join(tmp, "tidied-out.md");
const writeLedger = (files, out) => {
  fs.writeFileSync(outFile, out);
  fs.writeFileSync(
    ledgerFile,
    JSON.stringify(
      {
        ledger: 1,
        files: files.map((f) => ({ ...f, out: fwd(outFile), leaveOut: [] })),
      },
      null,
      2,
    ),
  );
  return ledgerFile;
};
const allKeep = (file) => ({
  file: fwd(file),
  sha: sha(read(file)),
  blocks: splitBlocks(read(file)).map((b, i) => ({
    id: `B${i + 1}`,
    key: key(b.text),
    kind: /^#/.test(b.text) ? "heading" : "own",
    verdict: "keep",
  })),
});

// ---- an installed setup whose rules the person edited: a second install carves them
check("the setup installs", install().status === 0);
fs.writeFileSync(
  rulesFile,
  read(rulesFile).replace("# How to work", "# How to work\n\n- My own rule."),
);
const edited = read(rulesFile);
const carved = install();
check(
  "the carve moves the own rule to my-rules.md",
  carved.status === 0 &&
    read(myRules).includes("- My own rule.") &&
    !read(rulesFile).includes("- My own rule."),
);
check(
  "the carve leaves an undo record",
  state().rulesUndo?.by === "carve" &&
    state().rulesUndo.files.some((f) => f.copy === null),
);

// ---- --apply and --undo wait while the background self-install runs
fs.writeFileSync(lock, "");
const lockedUndo = own("--undo");
const tidyFile = path.join(tmp, "tidied.md");
fs.writeFileSync(tidyFile, "## How to work\n\n- Mine, shorter.\n");
const lockedApply = own("--apply", tidyFile);
check(
  "--undo and --apply stop with a clear line while update-auto.lock exists, and change nothing",
  lockedUndo.code === 1 &&
    lockedApply.code === 1 &&
    /^own-rules stopped: an update is installing itself/m.test(
      lockedUndo.out,
    ) &&
    /^own-rules stopped: an update is installing itself/m.test(
      lockedApply.out,
    ) &&
    fs.existsSync(myRules) &&
    read(rulesFile) !== edited,
);
fs.rmSync(lock);

// ---- check 10: one command undoes the carve
const undoCarve = own("--undo");
check(
  "--undo after a carve puts CLAUDE.md back and deletes the my-rules.md it created",
  undoCarve.code === 0 && read(rulesFile) === edited && !fs.existsSync(myRules),
);
check(
  "--undo after a carve says the next update carves again, and clears the record",
  /next update brings the rules up to this version again/.test(undoCarve.out) &&
    !("rulesUndo" in state()),
);
check("--undo with nothing on record stops", own("--undo").code === 1);

// ---- check 11: the tidy marks
check(
  "--status with no my-rules.md says so",
  own("--status").out.trim() === "my-rules: none",
);
install();
const first = read(myRules);
const s1 = own("--status");
check(
  "--status names lines and size, and that the file changed since its last tidy",
  s1.code === 0 &&
    /^my-rules: \d+ lines, \d+\.\d KB, changed since last tidy$/m.test(s1.out),
);
const skipped = own("--skip");
check(
  "--skip silences it until the next change",
  skipped.code === 0 &&
    !own("--status").out.includes("changed since last tidy") &&
    state().ownTidied?.[fwd(myRules)] === sha(first),
);
fs.appendFileSync(myRules, "\n- Another rule of mine.\n");
const before = read(myRules);
check(
  "--status says changed again after the file changed",
  own("--status").out.includes("changed since last tidy"),
);
// an all-keep ledger whose tidied text is the same blocks, one blank line apart
const tidiedText =
  splitBlocks(before)
    .map((b) => b.text)
    .join("\n\n") + "\n";
const applied = own("--apply", writeLedger([allKeep(myRules)], tidiedText));
// the local day, as own-rules.mjs names its folders in setup-logs
const now = new Date();
const day = new Date(now.getTime() - now.getTimezoneOffset() * 6e4)
  .toISOString()
  .slice(0, 10);
const logs = path.join(claude, "setup-logs");
const copy = path.join(logs, `${day}-tidy`, ".claude", "rules", "my-rules.md");
const besideRules = () =>
  fs
    .readdirSync(path.join(claude, "rules"))
    .concat(fs.readdirSync(claude))
    .filter((n) => n.includes(".before-"));
check(
  "--apply writes the tidied text and keeps the old one in setup-logs/<date>-tidy, nothing beside the file",
  applied.code === 0 &&
    read(myRules) === tidiedText &&
    fs.existsSync(copy) &&
    read(copy) === before &&
    besideRules().length === 0 &&
    applied.out.includes(
      `old copy: ~/.claude/setup-logs/${day}-tidy/.claude/rules/my-rules.md`,
    ),
);
check(
  "--apply sets ownTidied, so --status no longer offers it",
  state().ownTidied?.[fwd(myRules)] === sha(tidiedText) &&
    !own("--status").out.includes("changed since last tidy"),
);
check(
  "--apply records the tidy as the undo and prints the undo command",
  state().rulesUndo?.by === "tidy" &&
    /lines before, \d+ after .*--undo\)/.test(applied.out),
);
const rulesNow = read(rulesFile);
const undoTidy = own("--undo");
check(
  "--undo after a tidy puts back the earlier my-rules.md and leaves CLAUDE.md",
  undoTidy.code === 0 &&
    read(myRules) === before &&
    read(rulesFile) === rulesNow,
);
check(
  "--apply without a file stops",
  own("--apply").code === 1 &&
    own("--apply", path.join(tmp, "missing.md")).code === 1,
);

// ---- --skip waits while the background self-install runs
fs.writeFileSync(lock, "");
const lockedSkip = own("--skip");
check(
  "--skip stops with a clear line while update-auto.lock exists",
  lockedSkip.code === 1 &&
    /^own-rules stopped: an update is installing itself/m.test(lockedSkip.out),
);
fs.rmSync(lock);

// ---- a rule added by hand to the my-rules.md a carve created is kept when that carve is undone
fs.rmSync(myRules);
fs.writeFileSync(
  rulesFile,
  read(rulesFile).replace(
    "# How to work",
    "# How to work\n\n- Another own rule.",
  ),
);
check(
  "a carve creates my-rules.md again",
  install().status === 0 &&
    state().rulesUndo?.files.some(
      (f) => f.copy === null && f.file === myRules.replace(/\\/g, "/"),
    ),
);
const HAND = "- Rule I added by hand later.";
fs.appendFileSync(myRules, `\n${HAND}\n`);
const handMine = read(myRules);
const undoLater = own("--undo");
// earlier undos in this file kept copies of their own that day, so the folder (-2, -3 ...) is taken from the output
const named = undoLater.out.match(
  new RegExp(
    `kept as ~/(\\.claude/setup-logs/${day}-undo(-\\d+)?/\\.claude/rules/my-rules\\.md)`,
  ),
)?.[1];
const keptAs = named && path.join(home, named);
check(
  "--undo keeps the my-rules.md it takes away in setup-logs/<date>-undo, named, with the hand-added rule, nothing beside it",
  undoLater.code === 0 &&
    !fs.existsSync(myRules) &&
    !!keptAs &&
    fs.existsSync(keptAs) &&
    read(keptAs) === handMine &&
    read(keptAs).includes(HAND) &&
    besideRules().length === 0,
);

// ---- the copies an older version of own-rules.mjs left beside the files move into setup-logs on the next run of the
// installer (here the background --files-only), and the undo records, a restore's stacked one too, follow them
const oldTidy = path.join(claude, "rules", "my-rules.md.before-tidy-20261002");
const oldRestore = path.join(claude, "CLAUDE.md.before-restore-20261003");
const oldUndo = path.join(claude, "rules", "my-rules.md.before-undo-20261003");
fs.writeFileSync(myRules, "- Now.\n");
fs.writeFileSync(oldTidy, "- Before the old tidy.\n");
fs.writeFileSync(oldRestore, "# old rules\n");
fs.writeFileSync(oldUndo, "- Before the old undo.\n");
// as an older version left the record: no oldCopiesMoved mark, so the next run searches for the copies
fs.writeFileSync(
  stateFile,
  JSON.stringify({
    ...state(),
    oldCopiesMoved: undefined,
    rulesUndo: {
      at: "2026-10-02T00:00:00.000Z",
      by: "tidy",
      files: [{ file: fwd(myRules), copy: fwd(oldTidy) }],
    },
    rulesUndoBefore: {
      at: "2026-10-03T00:00:00.000Z",
      by: "restore",
      files: [{ file: fwd(rulesFile), copy: fwd(oldRestore) }],
      before: {
        at: "2026-10-01T00:00:00.000Z",
        by: "tidy",
        files: [{ file: fwd(myRules), copy: fwd(oldUndo) }],
      },
    },
  }),
);
const filesOnly = spawnSync(
  process.execPath,
  [path.join(REPO, "install.mjs"), "--home", home, "--files-only"],
  { encoding: "utf8" },
);
const movedTo = (d, ...rel) => path.join(logs, d, ".claude", ...rel);
const st = state();
check(
  "the installer moves old .before-tidy, -restore and -undo copies into setup-logs/<date>-tidy, -restore, -undo, none stay beside",
  filesOnly.status === 0 &&
    read(movedTo("2026-10-02-tidy", "rules", "my-rules.md")) ===
      "- Before the old tidy.\n" &&
    read(movedTo("2026-10-03-restore", "CLAUDE.md")) === "# old rules\n" &&
    read(movedTo("2026-10-03-undo", "rules", "my-rules.md")) ===
      "- Before the old undo.\n" &&
    besideRules().length === 0,
);
check(
  "the undo records follow the moved copies, the stacked one too",
  st.rulesUndo.files[0].copy ===
    fwd(movedTo("2026-10-02-tidy", "rules", "my-rules.md")) &&
    st.rulesUndoBefore.files[0].copy ===
      fwd(movedTo("2026-10-03-restore", "CLAUDE.md")) &&
    st.rulesUndoBefore.before.files[0].copy ===
      fwd(movedTo("2026-10-03-undo", "rules", "my-rules.md")),
);
fs.writeFileSync(
  stateFile,
  JSON.stringify({ ...st, rulesUndoBefore: undefined }),
);
const undoMoved = own("--undo");
check(
  "--undo puts back the file from the moved copy",
  undoMoved.code === 0 && read(myRules) === "- Before the old tidy.\n",
);

// ---- tidy v2: a messy global file and one project home's own rules
const mixed = read(path.join(FIX, "mixed.md"));
fs.writeFileSync(myRules, mixed);
const projects = path.join(tmp, "projects");
const thesis = path.join(projects, "thesis");
const homeMine = path.join(thesis, ".claude", "rules", "my-rules.md");
fs.mkdirSync(path.dirname(homeMine), { recursive: true });
fs.writeFileSync(
  path.join(thesis, "CLAUDE.md"),
  "# Thesis home\n\n- Keep sources in sources.bib.\n",
);
fs.writeFileSync(homeMine, read(path.join(FIX, "home.md")));
fs.mkdirSync(path.join(projects, "bakery-site"));
const was = state();
fs.writeFileSync(
  stateFile,
  JSON.stringify(
    {
      ...was,
      projects: fwd(projects),
      written: { ...was.written, [fwd(path.join(thesis, "CLAUDE.md"))]: "0" },
    },
    null,
    2,
  ),
);
const rows = (out) => out.split("\n").filter((l) => /^B\d+ /.test(l));
const row = (out, id) => rows(out).find((l) => l.startsWith(`${id} `)) ?? "";
const sameBlocks = (out, text) =>
  rows(out).length === splitBlocks(text).length &&
  rows(out).every(
    (l, i) => l.split(/\s+/)[1] === key(splitBlocks(text)[i].text),
  );

const rep = own("--report");
check(
  "--report gives the blocks and keys of scripts/blocks.mjs splitBlocks, headings included",
  rep.code === 0 && sameBlocks(rep.out, mixed),
);
check(
  "--report flags heading, dup, caps, a missing absolute path (not a relative one), dated and long",
  /heading/.test(row(rep.out, "B1")) &&
    /dup B3/.test(row(rep.out, "B5")) &&
    /caps/.test(row(rep.out, "B4")) &&
    /missing:Z:\/old-drive\/notes\//.test(row(rep.out, "B8")) &&
    !/missing/.test(row(rep.out, "B7")) &&
    /dated/.test(row(rep.out, "B9")) &&
    /long/.test(row(rep.out, "B11")),
);
check(
  "--home <folder> still works: --report names that folder's file with size and sha, the wired hooks and the deny list",
  rep.out.includes(`file ${fwd(myRules)} · `) &&
    rep.out.includes(`sha ${sha(mixed)}`) &&
    /^- [\w.-]+: \S.*$/m.test(rep.out) &&
    /^denied: /m.test(rep.out),
);
const repH = own("--report", "--homes");
const homePart = repH.out.split(`file ${fwd(homeMine)} · `)[1] ?? "";
check(
  "--report leaves home files out; --report --homes adds each home's own rules, its CLAUDE.md lines flagged shipped",
  !rep.out.includes(fwd(homeMine)) &&
    sameBlocks(homePart.split("\n\n")[0], read(homeMine)) &&
    /shipped/.test(row(homePart, "B3")) &&
    !/shipped/.test(row(homePart, "B2")),
);
const valued = own("--report", "--homes", "x");
check(
  "--homes given a value stops",
  valued.code === 1 && /--homes takes no value/.test(valued.out),
);

// the pending key: first 16 hex of sha256 over the sorted "<file> <sha>" lines of the untidied files
const pend = (files) =>
  sha(
    files
      .map((f) => `${fwd(f)} ${sha(read(f))}`)
      .sort()
      .join("\n"),
  ).slice(0, 16);
const stH = own("--status", "--homes");
check(
  "--status --homes lists both files as changed and prints the pending key over both",
  /^my-rules: \d+ lines, .*changed since last tidy$/m.test(stH.out) &&
    stH.out.includes(
      `my-rules ${fwd(homeMine)}: 4 lines, 0.1 KB, changed since last tidy`,
    ) &&
    stH.out.includes(`pending: ${pend([myRules, homeMine])}`),
);
check(
  "--offered marks the current pending key",
  own("--offered").code === 0 &&
    state().ownOffered === pend([myRules, homeMine]),
);
own("--skip");
const afterSkip = own("--status").out;
check(
  "--skip leaves home files pending; --skip --homes marks them too",
  afterSkip.includes(`pending: ${pend([homeMine])}`) &&
    own("--skip", "--homes").code === 0 &&
    !own("--status", "--homes").out.includes("pending:") &&
    state().ownTidied[fwd(homeMine)] === sha(read(homeMine)),
);

// ---- --check: one verdict per block, matched by id and key; the tidied text counted
const bakery = path.join(
  projects,
  "bakery-site",
  ".claude",
  "rules",
  "my-rules.md",
);
const skill = path.join(claude, "skills", "release-app", "SKILL.md");
const sqlRule = path.join(claude, "rules", "sql-style.md");
const TIDIED =
  '# My rules\n\n## Writing\n\n- Answer in plain English, short sentences.\n- No "utilize" in replies.\n';
const tidyEntries = () => {
  const b = splitBlocks(read(myRules));
  const e = (i, kind, verdict, more = {}) => ({
    id: `B${i}`,
    key: key(b[i - 1].text),
    kind,
    verdict,
    ...more,
  });
  return [
    e(1, "heading", "keep"),
    e(2, "heading", "keep"),
    e(3, "own", "keep"),
    e(4, "wordy", "reword", { text: '- No "utilize" in replies.' }),
    e(5, "duplicate", "vault", { by: "B3" }),
    e(6, "heading", "drop"),
    e(7, "project-only", "move", { to: fwd(bakery) }),
    e(8, "dead", "vault"),
    e(9, "stale", "vault"),
    e(10, "heading", "drop"),
    e(11, "procedure", "move", {
      to: fwd(skill),
      description: "Use when releasing the app.",
    }),
    e(12, "heading", "drop"),
    e(13, "file-type-only", "move", { to: fwd(sqlRule), paths: ["**/*.sql"] }),
  ];
};
const ledger = (blocks, out = TIDIED) =>
  writeLedger([{ file: fwd(myRules), sha: sha(read(myRules)), blocks }], out);
const good = own("--check", ledger(tidyEntries()));
check(
  "--check passes a full ledger that vaults one of two identical blocks, and prints the counts and bytes",
  good.code === 0 &&
    /^check: ok, ~\/\.claude\/rules\/my-rules\.md: 13 blocks, kept 3, reworded 1, vaulted 3, moved 3, asked 0; \d+ B before, \d+ B after \(about \d+ tokens less each chat\)$/m.test(
      good.out,
    ),
);
const missing = own(
  "--check",
  ledger(tidyEntries().filter((e) => e.id !== "B9")),
);
check(
  "--check fails a ledger that misses a block, naming it",
  missing.code === 1 && /^check: .*B9 has no entry/m.test(missing.out),
);
const dropItem = own(
  "--check",
  ledger(
    tidyEntries().map((e) => (e.id === "B9" ? { ...e, verdict: "drop" } : e)),
  ),
);
check(
  "--check allows drop only for a heading",
  dropItem.code === 1 && /B9: drop is only for a heading/.test(dropItem.out),
);
const bothKept = own(
  "--check",
  ledger(
    tidyEntries().map((e) =>
      e.id === "B5" ? { ...e, kind: "own", verdict: "keep" } : e,
    ),
  ),
);
check(
  "--check counts identical blocks: keeping both copies needs both in the tidied text",
  bothKept.code === 1 &&
    /lacks a kept block \(2 copies wanted\)/.test(bothKept.out),
);
const extra = own(
  "--check",
  ledger(tidyEntries(), `${TIDIED}\n- A line nobody kept.\n`),
);
const wrongKey = own(
  "--check",
  ledger(
    tidyEntries().map((e) =>
      e.id === "B3" ? { ...e, key: "0000000000000000" } : e,
    ),
  ),
);
check(
  "--check fails a tidied text with a block the ledger doesn't keep, and an entry whose key isn't its block's",
  extra.code === 1 &&
    /doesn't keep: "- A line nobody kept\."/.test(extra.out) &&
    wrongKey.code === 1 &&
    /B3: key 0{16} is not the key/.test(wrongKey.out),
);

// ---- --apply <ledger>, the vault, --restore and its undo
const ap = own("--apply", ledger(tidyEntries()));
const vaultFile = path.join(claude, "my-rules-vault.md");
const vaultText = fs.existsSync(vaultFile) ? read(vaultFile) : "";
check(
  "--apply <ledger> writes the tidied text and the moves (project rules, a path-scoped rule, a skill), and prints before/after",
  ap.code === 0 &&
    read(myRules) === TIDIED &&
    read(bakery).includes("images go in `public/img`") &&
    read(sqlRule).startsWith('---\npaths: ["**/*.sql"]\n---') &&
    /^name: release-app$/m.test(read(skill)) &&
    /lines before, \d+ after \(vaulted 4, moved 3, .*--undo\)/.test(ap.out),
);
check(
  "--apply vaults every removed block and the original of the reworded one as V1-V4, with reason and heading",
  /^## V1 · \d{4}-\d\d-\d\d · reworded \(wordy\)$/m.test(vaultText) &&
    vaultText.includes("- IMPORTANT: NEVER use") &&
    /^## V2 · .* · same as B3$/m.test(vaultText) &&
    vaultText.includes(
      'From: ~/.claude/rules/my-rules.md, under "Bakery site"',
    ) &&
    state().ownVaultNext === 5,
);
check(
  "--apply marks the file tidied, keeps the ledger in setup-logs and puts every changed or created file on one undo record",
  state().ownTidied[fwd(myRules)] === sha(TIDIED) &&
    fs.existsSync(path.join(claude, "setup-logs", `tidy-${day}.json`)) &&
    state().rulesUndo?.by === "tidy" &&
    [myRules, vaultFile, bakery, skill, sqlRule].every((f) =>
      state().rulesUndo.files.some((u) => u.file === fwd(f)),
    ),
);
const vl = own("--vault");
check(
  "--vault lists the entries with id, date, kind and first words",
  vl.code === 0 &&
    /^V2 {2}\d{4}-\d\d-\d\d {2}duplicate {2}Answer in plain English/m.test(
      vl.out,
    ) &&
    /^V1 .* reworded /m.test(vl.out),
);
const r2 = own("--restore", "V2");
check(
  "--restore puts a vaulted block back under its heading, takes it out of the vault and marks the file tidied",
  r2.code === 0 &&
    read(myRules) ===
      `${TIDIED}\n- Answer in plain English, short sentences.\n` &&
    !/^## V2 /m.test(read(vaultFile)) &&
    state().ownTidied[fwd(myRules)] === sha(read(myRules)),
);
check(
  "--restore keeps the tidy's undo as rulesUndoBefore",
  state().rulesUndo?.by === "restore" && state().rulesUndoBefore?.by === "tidy",
);
const ur = own("--undo");
check(
  "--undo after a restore puts both files back and the tidy's undo record with them",
  ur.code === 0 &&
    read(myRules) === TIDIED &&
    /^## V2 /m.test(read(vaultFile)) &&
    state().rulesUndo?.by === "tidy" &&
    !("rulesUndoBefore" in state()),
);
const r1 = own("--restore", "V1");
check(
  "--restore of a reworded entry puts the original in place of its rewording",
  r1.code === 0 &&
    read(myRules).includes("- IMPORTANT: NEVER use") &&
    !read(myRules).includes('No "utilize"'),
);
const r3 = own("--restore", "V2");
check(
  "a second --restore stacks on the first: two undos take both back, the tidy's undo stays on record",
  r3.code === 0 &&
    own("--undo").code === 0 &&
    own("--undo").code === 0 &&
    read(myRules) === TIDIED &&
    state().rulesUndo?.by === "tidy",
);
const ut = own("--undo");
check(
  "--undo after the tidy puts back the file and takes away the vault and the moved-to files it created",
  ut.code === 0 &&
    read(myRules) === mixed &&
    !fs.existsSync(vaultFile) &&
    !fs.existsSync(skill) &&
    !fs.existsSync(sqlRule) &&
    !fs.existsSync(bakery),
);

// ---- a global line moved into a home file that the same ledger tidies lands in its tidied text
const GLOBAL2 = "- Keep this one.\n\n- In the thesis project, cite with APA.\n";
fs.writeFileSync(myRules, GLOBAL2);
fs.writeFileSync(homeMine, "- Home rule.\n");
const out1 = path.join(tmp, "out1.md"),
  out2 = path.join(tmp, "out2.md");
fs.writeFileSync(out1, "- Keep this one.\n");
fs.writeFileSync(out2, "- Home rule.\n");
const g = splitBlocks(GLOBAL2);
fs.writeFileSync(
  ledgerFile,
  JSON.stringify({
    ledger: 1,
    files: [
      {
        file: fwd(myRules),
        sha: sha(GLOBAL2),
        out: fwd(out1),
        leaveOut: [],
        blocks: [
          { id: "B1", key: key(g[0].text), kind: "own", verdict: "keep" },
          {
            id: "B2",
            key: key(g[1].text),
            kind: "project-only",
            verdict: "move",
            to: fwd(homeMine),
          },
        ],
      },
      {
        file: fwd(homeMine),
        sha: sha("- Home rule.\n"),
        out: fwd(out2),
        leaveOut: [],
        blocks: [
          { id: "B1", key: key("- Home rule."), kind: "own", verdict: "keep" },
        ],
      },
    ],
  }),
);
const mv = own("--apply", ledgerFile);
check(
  "--apply: a global block moved into a home file of the same ledger is in that file afterwards, which is marked tidied with it",
  mv.code === 0 &&
    read(homeMine).includes("cite with APA") &&
    read(homeMine).includes("- Home rule.") &&
    state().ownTidied[fwd(homeMine)] === sha(read(homeMine)) &&
    !own("--status", "--homes").out.includes("pending:"),
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
