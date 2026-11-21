// Tests for skills/file-upkeep/file-check.mjs: each rule with a hit and a guard, the report, the ledger check and
// its faults, the apply (git mv, deletes, a merge, a keep, the reference fix with a systems map, absolute Windows
// paths and a dated record that keeps its old path), the undo from the saved ledger, git-ignored data that the
// report, apply and undo never touch, a non-git folder, macOS and Windows path forms, and the update's offer line.
// Everything happens in made-up folders under the system temp folder. Run: node tests/test-file-check.mjs
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const FC = path.join(REPO, "skills", "file-upkeep", "file-check.mjs");
const { breaks, dateIn, fixName, refSpans } = await import(
  new URL("../skills/file-upkeep/file-check.mjs", import.meta.url)
);
const tmp = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "file-check-test-")),
);
const home = path.join(tmp, "home");
const claude = path.join(home, ".claude");
fs.mkdirSync(claude, { recursive: true });
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${detail}`}`,
  );
};
const fwd = (p) => p.replace(/\\/g, "/");
const read = (f) => fs.readFileSync(f, "utf8");
const fc = (...flags) => {
  const r = spawnSync(process.execPath, [FC, "--home", home, ...flags], {
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const json = (dir) => JSON.parse(fc("--report", dir, "--json").out);
const make = (root, files) => {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
};
const git = (root, ...a) => {
  const r = spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const gitRepo = (root, files) => {
  make(root, files);
  git(root, "init", "-q");
  git(root, "config", "user.email", "someone@example.com");
  git(root, "config", "user.name", "someone");
  git(root, "config", "core.autocrlf", "false");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "start");
};
// every file under root but .git, with its sha: the byte-identical test
const snapshot = (root) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else
        out[fwd(path.relative(root, full))] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(full))
          .digest("hex");
    }
  };
  walk(root);
  return out;
};
const sameSnap = (a, b) =>
  JSON.stringify(Object.entries(a).sort()) ===
  JSON.stringify(Object.entries(b).sort());
const byPath = (r, p) => r.findings.find((f) => f.path === p);
// a ledger from the report: every fix as proposed, asks as given in answers {path: entry fields}
const ledgerFrom = (r, answers = {}) => ({
  project: r.project,
  entries: r.findings
    .filter((f) => f.kind !== "note")
    .map((f) => ({
      id: f.id,
      path: f.path,
      sha: f.sha,
      ...(answers[f.path] ||
        (f.target ? { action: f.action, to: f.target } : { action: f.action })),
    })),
});
const writeLedger = (l, name = "ledger.json") => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, JSON.stringify(l, null, 2));
  return f;
};

// ---- 1. the rules, each with a hit and a guard
const rules = path.join(tmp, "rules-project");
gitRepo(rules, {
  "README.md": "# x\n",
  "DECISIONS.md": "- see docs/2025-01-02-linked-plan.md\n",
  "CLAUDE.md": "x\n".repeat(201),
  "package.json": JSON.stringify({ name: "x", main: "server-start.mjs" }),
  "server-start.mjs": "",
  "index.js": "",
  "install.mjs": "",
  "drift.mjs": "",
  "test-kit.mjs": "",
  "tests/test-a.mjs": "",
  "snippets.md": "",
  "docs/Setup_Notes.md": "",
  "docs/temperature.md": "",
  "docs/untitled.md": "",
  "docs/turn-cap-candidates-2026-10-11.md": "",
  "docs/research/folders.md": "",
  "docs/research/2026-01-01-handoff-study.md": "",
  "docs/history-handoff-2026-11-06.md": "",
  "docs/decisions-archive-2026-11-02.md": "- old\n",
  "docs/prices.md": "",
  "docs/prices.md.bak": "",
  "docs/api-v2.md": "",
  "docs/notes.md": "",
  "docs/notes-old.md": "",
  "docs/2025-01-01-old-plan.md": "",
  "docs/2025-01-02-linked-plan.md": "",
  "tools/tts-worker.py": "",
  "tools/__init__.py": "",
  "lib/read-file.mjs": "",
  "lib/read-data.mjs": "",
  "lib/writeFile.mjs": "",
  "ui/Voice.tsx": "",
  "ui/useVoice.ts": "",
  "kit/Install on Windows.cmd": "",
  "scripts/check-20261002.sh": "",
  "scripts/release-1.0.4.sh": "",
  "scripts/a3f20261002b.txt": "",
  "scripts/release-2026-11-10.sh": "",
  "scripts/test-lib-copy.mjs": "",
  "audits/repo-push.sh": "",
  ".claude/notes.md": "",
  ".claude/settings.json": "{}",
  "patches/superseded/a.md": "",
  "hooks/handoff-sync.mjs": "",
  "docs/decisions/2026-11-14-x.md": "# 2026-11-14: x\n",
  "docs/decisions/hooks.md": "# Hooks\n",
  "docs/decisions/2026-11-13-handoff-fix.md": "# 2026-11-13: handoff fix\n",
  "docs/decisions/2026-11-02-history-decisions.md":
    "# 2026-11-02: history decisions\n",
});
const r1 = json(rules);
const hit = (p, rule, target) => {
  const f = byPath(r1, p);
  check(
    `${rule}: ${p}${target ? ` → ${target}` : ""}`,
    f && f.rules.includes(rule) && (!target || f.target === target),
    JSON.stringify(f),
  );
};
const noRule = (p, rule) =>
  check(
    `guard: ${p} is not ${rule}`,
    !byPath(r1, p)?.rules.includes(rule),
    JSON.stringify(byPath(r1, p)),
  );
const clean = (p) =>
  check(`guard: ${p} passes`, !byPath(r1, p), JSON.stringify(byPath(r1, p)));
hit("docs/Setup_Notes.md", "N1", "docs/setup-notes.md");
hit("tools/tts-worker.py", "N2", "tools/tts_worker.py");
clean("tools/__init__.py");
hit("lib/writeFile.mjs", "N3", "lib/write-file.mjs");
clean("lib/read-file.mjs");
clean("ui/Voice.tsx");
clean("ui/useVoice.ts");
hit("kit/Install on Windows.cmd", "N4", "kit/install-on-windows.cmd");
hit("scripts/check-20261002.sh", "N6a", "scripts/2026-10-02-check.sh");
clean("scripts/release-1.0.4.sh");
clean("scripts/a3f20261002b.txt");
clean("scripts/release-2026-11-10.sh");
hit(
  "docs/turn-cap-candidates-2026-10-11.md",
  "N6b",
  "docs/2026-10-11-turn-cap-candidates.md",
);
const now = new Date();
const today = new Date(now.getTime() - now.getTimezoneOffset() * 6e4)
  .toISOString()
  .slice(0, 10); // local day, as the checker and git use
hit("docs/research/folders.md", "N6c", `docs/research/${today}-folders.md`);
hit("docs/untitled.md", "N7");
check("N7 is an ask", byPath(r1, "docs/untitled.md")?.kind === "ask");
clean("docs/temperature.md");
hit("drift.mjs", "P1", "scripts/drift.mjs");
clean("index.js");
clean("install.mjs");
clean("server-start.mjs");
hit("test-kit.mjs", "P2a", "tests/test-kit.mjs");
clean("tests/test-a.mjs");
hit("snippets.md", "P3", "docs/snippets.md");
clean("README.md");
clean("DECISIONS.md");
hit("audits/repo-push.sh", "P4");
check("P4 is an ask", byPath(r1, "audits/repo-push.sh")?.kind === "ask");
hit(".claude/notes.md", "P5");
clean(".claude/settings.json");
hit("CLAUDE.md", "P6");
hit("docs/history-handoff-2026-11-06.md", "R1");
check(
  "R1 tracked is a delete fix",
  byPath(r1, "docs/history-handoff-2026-11-06.md")?.action === "delete" &&
    byPath(r1, "docs/history-handoff-2026-11-06.md")?.kind === "fix",
);
noRule("docs/research/2026-01-01-handoff-study.md", "R1");
clean("hooks/handoff-sync.mjs");
// the decision files of a split record: dated or not, "handoff" or "decisions" in the name, none is a copy (R1)
for (const p of [
  "docs/decisions/2026-11-14-x.md",
  "docs/decisions/hooks.md",
  "docs/decisions/2026-11-13-handoff-fix.md",
  "docs/decisions/2026-11-02-history-decisions.md",
])
  clean(p);
hit("docs/decisions-archive-2026-11-02.md", "R2", "docs/decisions-archive.md");
hit("docs/2025-01-01-old-plan.md", "R3");
clean("docs/2025-01-02-linked-plan.md");
hit("patches/superseded", "A1");
check("A1 takes the folder whole", !byPath(r1, "patches/superseded/a.md"));
hit("docs/prices.md.bak", "A2");
hit("docs/notes-old.md", "A2");
clean("docs/api-v2.md");
noRule("scripts/test-lib-copy.mjs", "A2");
check(
  "the text report has the header and the estimate",
  /· \d+ to fix · \d+ to ask · \d+ notes/.test(fc("--report", rules).out) &&
    /Reorganize: about \d+ minutes/.test(fc("--report", rules).out),
);
check(
  "unit: N6a on a compact date, none on a hash",
  dateIn("check-20261002")?.iso === "2026-10-02" &&
    dateIn("a3f20261002b") === null &&
    dateIn("release-1.0.4") === null,
);
check(
  "unit: a reversed date",
  fixName("report-02-10-2026.md", "docs")[0] === "2026-10-02-report.md",
);

// ---- 2. the reorganize of a git project, with git-ignored data beside it
const bake = path.join(tmp, "projects", "bakery");
const winRoot = bake.replace(/\//g, "\\"),
  slashRoot = fwd(bake);
const lowDrive = (p) => p.replace(/^([A-Z]):/, (_, d) => `${d.toLowerCase()}:`);
const IGNORED = {
  "logs/Run_Log.txt": "run 1\n",
  "logs/old/backup.bak": "x\n",
  "data/Cache_Old.db": "db\n",
  "data/notes.db": "db2\n",
  "Run_Data/run.log": "r\n",
};
gitRepo(bake, {
  ".gitignore": "logs/\ndata/*.db\n*.log\n",
  "CLAUDE.md":
    "# Bakery\nRun `node resize.mjs` after a photo. Menu notes: docs/Menu_Ideas.md\n",
  "HANDOFF.md": `- ${slashRoot}/docs/Menu_Ideas.md\n- ${winRoot}\\docs\\Menu_Ideas.md\n- ${lowDrive(slashRoot)}/docs/Menu_Ideas.md\n- see ./docs/Menu_Ideas.md\n`,
  "resize.mjs": "export {};\n",
  "scripts/build.mjs":
    "const menu = '../docs/Menu_Ideas.md';\nconst built = path.join('docs', 'Menu_Ideas.md');\n",
  "docs/Menu_Ideas.md": "# Menu\n",
  "docs/2026-10-01-record.md": "Then the menu lived in docs/Menu_Ideas.md.\n",
  "docs/decisions/menu.md":
    "# Menu\n\n- The menu lives in docs/Menu_Ideas.md.\n",
  "docs/prices.md": "1\n",
  "docs/prices.md.bak": "0\n",
  "docs/decisions-archive-2026-11-02.md": "- an old decision\n",
  "data/schema.md": "tables\n",
  "Run_Data/summary.md": "s\n",
  ".claude/systems-map.json":
    JSON.stringify(
      {
        things: [
          {
            id: "menu",
            start: ["docs/Menu_Ideas.md", "resize.mjs"],
            read: ["docs\\Menu_Ideas.md"],
          },
        ],
      },
      null,
      2,
    ) + "\n",
});
make(bake, {
  ...IGNORED,
  "docs/notes.md": "n\n",
  "docs/notes-old.md": "untracked copy\n",
});
const ignoredBefore = Object.fromEntries(
  Object.keys(IGNORED).map((f) => [f, read(path.join(bake, f))]),
);
const r2 = json(bake);
const named = r2.findings.map((f) => f.path).join(" ");
check(
  "ignored data is never in the report (logs/, data/*.db, *.log)",
  !/logs\/|\.db|run\.log/.test(named),
  named,
);
check(
  "a folder that holds ignored data is not renamed",
  !r2.findings.some((f) => f.path.startsWith("Run_Data/")),
  named,
);
check(
  "data/schema.md (tracked, beside ignored databases) passes",
  !byPath(r2, "data/schema.md"),
);
check(
  "the untracked copy is an ask",
  byPath(r2, "docs/notes-old.md")?.kind === "ask",
);
check(
  "the report names the files a move changes",
  (byPath(r2, "docs/Menu_Ideas.md")?.refs || []).includes("CLAUDE.md") &&
    byPath(r2, "docs/Menu_Ideas.md").refs.includes(".claude/systems-map.json"),
  JSON.stringify(byPath(r2, "docs/Menu_Ideas.md")),
);
const answers = {
  "docs/notes-old.md": { action: "keep", reason: "the person keeps it" },
};
const good = ledgerFrom(r2, answers);
check(
  "check: ok on a full ledger",
  fc("--check", writeLedger(good)).out.includes("check: ok"),
  fc("--check", writeLedger(good)).out,
);
// one ledger per fault kind
const menuId = byPath(r2, "docs/Menu_Ideas.md").id,
  bakId = byPath(r2, "docs/prices.md.bak").id,
  copyId = byPath(r2, "docs/notes-old.md").id;
const mutate = (fn) => {
  const l = JSON.parse(JSON.stringify(good));
  fn(l);
  return fc("--check", writeLedger(l, "bad.json")).out;
};
const ent = (l, id) => l.entries.find((e) => e.id === id);
check(
  "fault: a finding with no entry",
  mutate((l) => {
    l.entries = l.entries.filter((e) => e.id !== bakId);
  }).includes(`${bakId}: no entry`),
);
check(
  "fault: a finding with two entries",
  mutate((l) => {
    l.entries.push({ ...ent(l, bakId) });
  }).includes(`${bakId}: 2 entries`),
);
check(
  "fault: a file changed since the report",
  mutate((l) => {
    ent(l, menuId).sha = "0".repeat(64);
  }).includes("changed since the report"),
);
check(
  "fault: two moves to one target",
  mutate((l) => {
    ent(l, bakId).action = "move";
    ent(l, bakId).to = "docs/menu-ideas.md";
  }).includes("is also the target of"),
);
check(
  "fault: a target that exists",
  mutate((l) => {
    ent(l, menuId).to = "docs/prices.md";
  }).includes("docs/prices.md exists"),
);
check(
  "fault: a target that breaks a rule",
  mutate((l) => {
    ent(l, menuId).to = "docs/Menu Ideas.md";
  }).includes("breaks N4"),
);
check(
  "fault: an untracked delete without the person's answer",
  mutate((l) => {
    ent(l, copyId).action = "delete";
    delete ent(l, copyId).reason;
  }).includes("needs the person's answer"),
);
check(
  "fault: a path outside the project",
  mutate((l) => {
    ent(l, menuId).to = "../elsewhere.md";
  }).includes("outside the project"),
);
const before = snapshot(bake);
const applied = fc("--apply", writeLedger(good));
check(
  "apply runs",
  applied.code === 0 && applied.out.includes("applied:"),
  applied.out,
);
const st = git(bake, "status", "--porcelain");
check(
  "apply moves tracked files with git mv",
  /^R {2}docs\/Menu_Ideas\.md -> docs\/menu-ideas\.md$/m.test(st) &&
    /^R {2}resize\.mjs -> scripts\/resize\.mjs$/m.test(st),
  st,
);
check(
  "apply deletes the tracked copy with git rm",
  /^D {2}docs\/prices\.md\.bak$/m.test(st),
  st,
);
const at = (f) => read(path.join(bake, f));
check(
  "CLAUDE.md: the root file's path and the moved doc are fixed",
  at("CLAUDE.md").includes("node scripts/resize.mjs") &&
    at("CLAUDE.md").includes("docs/menu-ideas.md"),
  at("CLAUDE.md"),
);
const map = JSON.parse(at(".claude/systems-map.json")).things[0];
check(
  "the systems map's paths are rewritten (both slash forms)",
  map.start.join() === "docs/menu-ideas.md,scripts/resize.mjs" &&
    map.read[0] === "docs\\menu-ideas.md",
  JSON.stringify(map),
);
const ho = at("HANDOFF.md");
check(
  "absolute Windows paths are fixed: forward, back slashes, lower-case drive",
  ho.includes(`${slashRoot}/docs/menu-ideas.md`) &&
    ho.includes(`${winRoot}\\docs\\menu-ideas.md`) &&
    ho.includes(`${lowDrive(slashRoot)}/docs/menu-ideas.md`) &&
    !ho.includes("Menu_Ideas"),
  ho,
);
check("a ./ path is fixed", ho.includes("./docs/menu-ideas.md"));
check(
  "a path relative to the citing file is fixed",
  at("scripts/build.mjs").includes("'../docs/menu-ideas.md'"),
  at("scripts/build.mjs"),
);
check(
  "a path built in code is listed, not changed",
  at("scripts/build.mjs").includes("'Menu_Ideas.md'") &&
    applied.out.includes("by hand: scripts/build.mjs:2"),
  applied.out,
);
check(
  "a dated record keeps its old path",
  at("docs/2026-10-01-record.md").includes("docs/Menu_Ideas.md"),
);
check(
  "a decision file in docs/decisions/ is a record: its old path is kept and not listed",
  at("docs/decisions/menu.md").includes("docs/Menu_Ideas.md") &&
    !applied.out.includes("docs/decisions/menu.md"),
  applied.out,
);
check(
  "the dated decisions archive is merged",
  at("docs/decisions-archive.md").includes("- an old decision") &&
    !fs.existsSync(path.join(bake, "docs/decisions-archive-2026-11-02.md")),
);
check(
  "a keep goes to .claude/file-standard.json with its reason",
  JSON.parse(at(".claude/file-standard.json")).reason["docs/notes-old.md"] ===
    "the person keeps it",
);
check(
  "after the apply the folder reports clean",
  (() => {
    const r = json(bake);
    return r.fix + r.ask === 0;
  })(),
  fc("--report", bake).out,
);
const logs = path.join(claude, "setup-logs");
const savedName = fs.readdirSync(logs).find((n) => n.startsWith("file-moves-"));
const saved = savedName && JSON.parse(read(path.join(logs, savedName)));
check(
  "the saved ledger holds every move, delete, merge and edit with old and new",
  saved &&
    saved.ops.some((o) => o.op === "move" && o.from === "resize.mjs") &&
    saved.ops.some((o) => o.op === "delete") &&
    saved.ops.some((o) => o.op === "merge") &&
    saved.edits.some(
      (e) =>
        e.file === "CLAUDE.md" &&
        e.edits.some(
          (x) => x.old === "resize.mjs" && x.new === "scripts/resize.mjs",
        ),
    ),
);
const ignoredSame = () =>
  Object.entries(ignoredBefore).every(
    ([f, t]) =>
      fs.existsSync(path.join(bake, f)) && read(path.join(bake, f)) === t,
  );
check("apply leaves the ignored data as it was", ignoredSame());
const undone = fc("--undo");
check(
  "undo runs from the saved ledger",
  undone.code === 0 && undone.out.includes("undone:"),
  undone.out,
);
const afterUndo = snapshot(bake);
check(
  "undo leaves the folder byte-identical",
  sameSnap(before, afterUndo),
  JSON.stringify(
    Object.keys(before)
      .filter((k) => before[k] !== afterUndo[k])
      .concat(Object.keys(afterUndo).filter((k) => !(k in before))),
  ),
);
check("undo leaves the ignored data as it was", ignoredSame());
check(
  "a second undo finds nothing left",
  fc("--undo").out.includes("no ledger to undo"),
);

// ---- 3. a folder that is not a git project
const plain = path.join(tmp, "plain-folder");
make(plain, {
  "README.md": "see Notes_Draft.md\n",
  "Notes_Draft.md": "d\n",
  "a.md": "a\n",
  "a.md.bak": "old a\n",
  "node_modules/Bad_Name/x.md": "",
  "nested/.git/HEAD": "",
  "nested/Bad_Name.md": "",
});
const r3 = json(plain);
check(
  "not git: the walk skips node_modules and nested repos",
  !r3.findings.some((f) => /node_modules|nested/.test(f.path)),
  r3.findings.map((f) => f.path).join(" "),
);
check(
  "not git: a copy is an ask (no history holds it)",
  byPath(r3, "a.md.bak")?.kind === "ask",
);
const plainBefore = snapshot(plain);
const l3 = ledgerFrom(r3, { "a.md.bak": { action: "delete", answer: "yes" } });
const a3 = fc("--apply", writeLedger(l3, "plain.json"));
check(
  "not git: apply renames and sends the delete to the trash folder",
  a3.code === 0 &&
    !fs.existsSync(path.join(plain, "a.md.bak")) &&
    fs.existsSync(path.join(claude, "setup-logs", "file-moves-trash")) &&
    fs.existsSync(path.join(plain, "docs", "notes-draft.md")),
  a3.out,
);
check(
  "not git: the root file's bare name is fixed",
  read(path.join(plain, "README.md")).includes("docs/notes-draft.md"),
);
const u3 = fc("--undo");
check(
  "not git: undo is byte-identical",
  u3.code === 0 && sameSnap(plainBefore, snapshot(plain)),
  u3.out,
);

// ---- 4. path forms: macOS and Windows roots, a relative path, a bare name
const spans = (text, root, citing, rel) =>
  refSpans(text, root, citing, rel).map((s) => s.text);
check(
  "macOS: an absolute path under /Users/someone is found",
  spans(
    "open /Users/someone/shop/docs/a.md now",
    "/Users/someone/shop",
    "CLAUDE.md",
    "docs/a.md",
  ).join() === "docs/a.md",
);
check(
  "macOS: a path under another folder is not",
  spans(
    "open /Users/someone/other/docs/a.md",
    "/Users/someone/shop",
    "CLAUDE.md",
    "docs/a.md",
  ).length === 0,
);
check(
  "Windows: back slashes and a JSON-escaped path",
  spans(
    'C:\\Users\\someone\\shop\\docs\\a.md and "docs\\\\a.md"',
    "C:/Users/someone/shop",
    "x.json",
    "docs/a.md",
  ).join("|") === "docs\\a.md|docs\\\\a.md",
);
check(
  "Windows: the drive letter in any case",
  spans(
    "c:/Users/someone/shop/docs/a.md",
    "C:/Users/someone/shop",
    "CLAUDE.md",
    "docs/a.md",
  ).length === 1,
);
check(
  "a longer name is not a hit",
  spans(
    "docs/a.md.bak docs/a.mdx xdocs/a.md",
    "/Users/someone/shop",
    "CLAUDE.md",
    "docs/a.md",
  ).length === 0,
);
check(
  "a path relative to the citing file",
  spans(
    "[a](../docs/a.md)",
    "/Users/someone/shop",
    "notes/b.md",
    "docs/a.md",
  ).join() === "../docs/a.md",
);

// ---- 5. the update's offer: --status --homes, then --skip --homes
const shop = path.join(tmp, "projects", "shop");
gitRepo(shop, { "CLAUDE.md": "# shop\n", "Price_List.md": "p\n" });
const projects = path.join(tmp, "projects");
const stateFile = path.join(claude, "setup-state.json");
fs.writeFileSync(
  stateFile,
  JSON.stringify({
    projects: fwd(projects),
    written: {
      [`${fwd(shop)}/CLAUDE.md`]: "x",
      [`${fwd(bake)}/CLAUDE.md`]: "x",
    },
  }),
);
const s1 = fc("--status", "--homes");
check(
  "status: one line per home and a pending key",
  s1.out.includes(`${fwd(shop)}: 1 fix`) &&
    /^pending: [0-9a-f]{16}$/m.test(s1.out),
  s1.out,
);
check(
  "status: the bakery home with uncommitted changes is skipped until committed",
  s1.out.includes(`${fwd(bake)}: skipped until its changes are committed`),
  s1.out,
);
check(
  "status: one offer line with the folders, files and minutes",
  /^offer: 1 folder, 1 files to reorganize, about \d+ minutes; skipped until committed: .*bakery/m.test(
    s1.out,
  ),
  s1.out,
);
const sk = fc("--skip", "--homes");
check(
  "skip marks the pending key offered",
  sk.out.startsWith("skipped: pending") &&
    JSON.parse(read(stateFile)).fileOffered ===
      /^pending: (\w+)$/m.exec(s1.out)[1],
  sk.out,
);
check(
  "after skip the offer is none",
  fc("--status", "--homes").out.includes("offer: none (offered before"),
);
make(shop, { "Second_File.md": "s\n" });
git(shop, "add", "-A");
git(shop, "commit", "-q", "-m", "more");
check(
  "a new finding brings the offer back",
  /^offer: 1 folder, 2 files/m.test(fc("--status", "--homes").out),
);

// ---- 6. relative references: a moved file's own imports, and a sibling ./name in a subfolder
const tool = path.join(tmp, "elsewhere", "tool-project");
gitRepo(tool, {
  "tool-one.mjs":
    'import { a } from "./lib/a.mjs";\nimport { two } from "./helper-two.mjs";\nimport { b } from "./src/b.mjs";\nconsole.log(a + two + b);\n',
  "helper-two.mjs":
    'import { a } from "./lib/a.mjs";\nexport const two = "2" + a;\n',
  "lib/a.mjs": 'export const a = "a";\n',
  "src/b.mjs":
    'import { two } from "./helper-two.mjs";\nexport const b = two;\n',
  "src/helper-two.mjs": 'export const two = "s";\n',
});
const r6 = json(tool);
check(
  "P1: a root script is an ask, not a fix",
  byPath(r6, "tool-one.mjs")?.kind === "ask" &&
    byPath(r6, "helper-two.mjs")?.target === "scripts/helper-two.mjs",
  JSON.stringify(r6.findings),
);
const toolBefore = snapshot(tool),
  srcB = read(path.join(tool, "src/b.mjs"));
const a6 = fc("--apply", writeLedger(ledgerFrom(r6), "tool.json"));
const ran = spawnSync(
  process.execPath,
  [path.join(tool, "scripts", "tool-one.mjs")],
  { encoding: "utf8", cwd: tmp },
);
check(
  "a moved file's imports still reach the files that stayed and the one that moved: node runs it",
  a6.code === 0 && ran.status === 0 && ran.stdout.trim() === "a2as",
  `${a6.out}\n${ran.stderr}\n${read(path.join(tool, "scripts", "tool-one.mjs"))}`,
);
check(
  "a sibling ./helper-two.mjs in src/ is not taken for the root file",
  read(path.join(tool, "src/b.mjs")) === srcB,
  read(path.join(tool, "src/b.mjs")),
);
const u6 = fc("--undo");
check(
  "undo of the relative fixes is byte-identical",
  u6.code === 0 && sameSnap(toolBefore, snapshot(tool)),
  u6.out,
);

// ---- 7. files a tool needs at the root are never proposed
const ROOT_TOOLS = [
  "gradlew",
  "gradlew.bat",
  "next-env.d.ts",
  "middleware.ts",
  "instrumentation.ts",
  "wsgi.py",
  "asgi.py",
  "manage.py",
];
const web = path.join(tmp, "elsewhere", "web-project");
gitRepo(
  web,
  Object.fromEntries([...ROOT_TOOLS, "other-tool.mjs"].map((f) => [f, "x\n"])),
);
const r7 = json(web);
for (const f of ROOT_TOOLS)
  check(
    `a tool's root file stays: ${f}`,
    !byPath(r7, f),
    JSON.stringify(byPath(r7, f)),
  );
check(
  "another root script is an ask",
  byPath(r7, "other-tool.mjs")?.kind === "ask",
  JSON.stringify(byPath(r7, "other-tool.mjs")),
);

// ---- 8. a run that stops on the 3rd of 5 moves: the journal holds the 2 done, undo restores them
const half = path.join(tmp, "elsewhere", "half-project");
make(half, {
  "Alpha_Notes.md": "a\n",
  "Beta_Notes.md": "b\n",
  "Gamma_Notes.md": "c\n",
  "Delta_Notes.md": "d\n",
  "Omega_Notes.md": "e\n",
  blocker: "a file, so no folder can be made here\n",
});
const r8 = json(half),
  l8 = ledgerFrom(r8);
check(
  "five moves planned",
  l8.entries.filter((e) => e.action === "move").length === 5,
  JSON.stringify(l8.entries),
);
l8.entries[2].to = "blocker/third.md"; // its folder cannot be made: the 3rd action fails
const halfBefore = snapshot(half);
const a8 = fc("--apply", writeLedger(l8, "half.json"));
check(
  "the stopped run says so and names its journal",
  a8.code === 1 && a8.out.includes("stopped midway"),
  a8.out,
);
const u8 = fc("--undo");
check(
  "undo after a stop midway is byte-identical",
  u8.code === 0 &&
    u8.out.includes("undone: 2 steps") &&
    sameSnap(halfBefore, snapshot(half)),
  `${u8.out}\n${JSON.stringify(snapshot(half))}`,
);

// ---- 9. names that say what a file does (N8), Python copies, folders as one finding, documents, folder roles (P8)
// Spec 2026-11-20-file-names D1-D4. A guard of a new rule counts only once the rule's hit is there: before, it
// proves nothing.
const named9 = path.join(tmp, "elsewhere", "names-project");
gitRepo(named9, {
  "README.md": "# names\n\n![logo](docs/img/logo.png)\n",
  "July_Rewrite.py": "",
  "_work/july_rewrite.py": "",
  "_work/july_rewrite.before.py": "",
  "_work/draft-03/Out_Put.txt": "",
  "_work/draft-03/page.html": "",
  "scripts/sync-december.mjs": "",
  "scripts/importer-v2.mjs": "",
  "scripts/decorate.mjs": "",
  "scripts/fix-links.mjs": "",
  "scripts/rewrite-history.mjs": "",
  "scripts/build_resume.py": "",
  "scripts/export_pdf.ps1": "",
  "scripts/x.py": "",
  "scripts/x.before.py": "",
  "scripts/a_b-2026-10-05.py": "",
  "extensions/x/test.mjs": "",
  "previous/Resume_Old.py": "",
  "previous/notes.md": "",
  "letters/Jane_Doe_Resume.pdf": "",
  "letters/Cover_Letter.docx": "",
  "letters/Cover Letter Two.docx": "",
  "docs/preview.png": "",
  "docs/img/logo.png": "",
  "docs/arch.svg": "",
  "docs/flow.mmd": "",
  "docs/make_chart.py": "",
});
const r9 = json(named9);
const f9 = (p) => byPath(r9, p);
const is9 = (p, rule) => Boolean(f9(p)?.rules.includes(rule));
const n8Live = is9("_work/july_rewrite.py", "N8");
const p8Live = is9("docs/preview.png", "P8");
// D1: N8, an ask with no target
for (const p of [
  "_work/july_rewrite.py",
  "scripts/sync-december.mjs",
  "scripts/importer-v2.mjs",
])
  check(
    `N8: ${p} is an ask with no target (its name does not say what it does)`,
    is9(p, "N8") && f9(p).kind === "ask" && !f9(p).target,
    JSON.stringify(f9(p)),
  );
for (const p of [
  "scripts/build_resume.py",
  "scripts/export_pdf.ps1",
  "scripts/fix-links.mjs",
  "scripts/rewrite-history.mjs",
  "scripts/decorate.mjs",
  "extensions/x/test.mjs",
])
  check(
    `guard: ${p} is not N8 (a round word followed by its job, a month only as a whole word), with N8 live`,
    n8Live && !is9(p, "N8"),
    JSON.stringify(f9(p)),
  );
// D2: Python copies and dated Python names never get a hyphenated target
for (const p of ["scripts/x.before.py", "_work/july_rewrite.before.py"])
  check(
    `A2: ${p} is a copy (delete), not an N1 rename`,
    is9(p, "A2") && f9(p).action === "delete" && !is9(p, "N1"),
    JSON.stringify(f9(p)),
  );
check(
  "N2: a dated Python name (scripts/a_b-2026-10-05.py) is an ask with no target: it cannot import and keep its date",
  is9("scripts/a_b-2026-10-05.py", "N2") &&
    f9("scripts/a_b-2026-10-05.py").kind === "ask" &&
    !f9("scripts/a_b-2026-10-05.py").target,
  JSON.stringify(f9("scripts/a_b-2026-10-05.py")),
);
check(
  "N2: every N2 target's stem has only [a-z0-9_], so it imports",
  r9.findings
    .filter((f) => f.rules.includes("N2") && f.target)
    .every((f) => /^[a-z0-9_]+\.py$/.test(path.posix.basename(f.target))),
  JSON.stringify(r9.findings.filter((f) => f.rules.includes("N2"))),
);
// D3: an old-versions folder and a run-output folder are one finding each; documents keep their case
check(
  "A1: previous/ is one finding, its files none",
  is9("previous", "A1") &&
    !r9.findings.some((f) => f.path.startsWith("previous/")),
  JSON.stringify(r9.findings.filter((f) => f.path.startsWith("previous"))),
);
check(
  "P9: a draft-* folder of run output is one ask with no target, its files none",
  is9("_work/draft-03", "P9") &&
    f9("_work/draft-03").kind === "ask" &&
    !f9("_work/draft-03").target &&
    !r9.findings.some((f) => f.path.startsWith("_work/draft-03/")),
  JSON.stringify(r9.findings.filter((f) => f.path.startsWith("_work/draft"))),
);
for (const p of ["letters/Jane_Doe_Resume.pdf", "letters/Cover_Letter.docx"])
  check(
    `a document a person sends out keeps its case: ${p} passes`,
    !f9(p),
    JSON.stringify(f9(p)),
  );
check(
  "guard: N4 still applies to a document (a space in letters/Cover Letter Two.docx)",
  is9("letters/Cover Letter Two.docx", "N4"),
  JSON.stringify(f9("letters/Cover Letter Two.docx")),
);
const line9 = fc("--report", named9)
  .out.split(/\r?\n/)
  .find((l) => / July_Rewrite\.py( |$)/.test(l));
const ids9 = /^F\d+ +(\S+) +(fix|ask) /.exec(line9 || "");
check(
  "the printed report keeps a space between three rule ids and the kind (July_Rewrite.py: N2, P1, N8)",
  Boolean(ids9) && ids9[1].split("+").length >= 3,
  line9,
);
// D4: P8, folder roles
check(
  "P8: an unlinked picture in docs/ is a fix to shown/",
  is9("docs/preview.png", "P8") &&
    f9("docs/preview.png").kind === "fix" &&
    f9("docs/preview.png").target === "shown/preview.png",
  JSON.stringify(f9("docs/preview.png")),
);
check(
  "P8: a code file in docs/ is an ask with no target",
  is9("docs/make_chart.py", "P8") &&
    f9("docs/make_chart.py").kind === "ask" &&
    !f9("docs/make_chart.py").target,
  JSON.stringify(f9("docs/make_chart.py")),
);
for (const p of ["docs/img/logo.png", "docs/arch.svg", "docs/flow.mmd"])
  check(
    `guard: ${p} stays in docs/ (a picture a tracked README links, or a diagram), with P8 live`,
    p8Live && !f9(p),
    JSON.stringify(f9(p)),
  );

// ---- 9b. what the new rules leave alone (S2a review): a word that is a folder's name, not an archive or a run
const alone = path.join(tmp, "elsewhere", "alone-project");
gitRepo(alone, {
  "app/previous/page.tsx": "",
  "skills/backup/SKILL.md": "",
  "backup/restore.mjs": "",
  "tests/fixtures/rename.before.json": "",
  "tests/fixtures/rename.after.json": "",
  ".claude/output-styles/terse.md": "",
  "src/output/write.ts": "",
  "audits/2026-10-01-perf.md": "",
  "audits/2026-10-01-perf/output/run.txt": "",
  "gunicorn.conf.py": "",
  "deploy/gunicorn.conf.py": "",
  "src/may-retry.ts": "",
  "src/dec-to-hex.js": "",
  "src/sep.py": "",
  "src/oct-parse.go": "",
  "src/report_20261005.py": "",
  "Old Stuff/july_sync.mjs": "",
});
const rA = json(alone);
const fA = (p) => byPath(rA, p);
const under = (dir) =>
  rA.findings.filter((f) => f.path === dir || f.path.startsWith(dir + "/"));
for (const [dir, what] of [
  ["app/previous", "a route named previous below the top is no archive (A1)"],
  ["skills/backup", "a skill named backup is no archive (A1)"],
  [
    "tests/fixtures/rename.before.json",
    "a .before name with no plain file beside it is no copy (A2)",
  ],
  [
    ".claude/output-styles",
    "Claude Code's output-styles is no run output (P9)",
  ],
  ["src/output", "an output folder of code is a module, no run output (P9)"],
  [
    "audits/2026-10-01-perf/output",
    "an audit run folder's output stays where P4 puts it (no P9)",
  ],
  ["gunicorn.conf.py", "Gunicorn's config at the root is a tool's name"],
  ["deploy/gunicorn.conf.py", "Gunicorn's config is never renamed to _conf"],
])
  check(
    `guard: ${what}: ${dir}`,
    !under(dir).length,
    JSON.stringify(under(dir)),
  );
check(
  "A1: an archive-named folder that holds code (backup/) is an ask, never a delete fix",
  fA("backup")?.rules.includes("A1") && fA("backup").kind === "ask",
  JSON.stringify(fA("backup")),
);
check(
  "a document's accented name keeps its letters and case: lib/Résumé.PDF → lib/Resume.PDF",
  fixName("Résumé.PDF", "lib")[0] === "Resume.PDF",
  fixName("Résumé.PDF", "lib")[0],
);
for (const p of [
  "src/may-retry.ts",
  "src/dec-to-hex.js",
  "src/sep.py",
  "src/oct-parse.go",
])
  check(
    `guard: a short month form that is a common word is not N8: ${p}, with N8 live`,
    n8Live && !fA(p)?.rules.includes("N8"),
    JSON.stringify(fA(p)),
  );
check(
  "N2: a Python name with a compact date (src/report_20261005.py) is an ask with no target",
  fA("src/report_20261005.py")?.rules.includes("N2") &&
    fA("src/report_20261005.py").kind === "ask" &&
    !fA("src/report_20261005.py").target,
  JSON.stringify(fA("src/report_20261005.py")),
);
check(
  "N8: the ask still names the other rules' fix (Old Stuff/ → old-stuff/)",
  fA("Old Stuff/july_sync.mjs")?.rules.includes("N8") &&
    fA("Old Stuff/july_sync.mjs").why.includes("old-stuff/july_sync.mjs"),
  JSON.stringify(fA("Old Stuff/july_sync.mjs")),
);

// ---- 10. the projects root (P10, --root): one folder per project family plus archive/, report only (spec D5)
const rootDir = path.join(tmp, "made-up-projects");
gitRepo(path.join(rootDir, "orchard-port"), { "CLAUDE.md": "# port\n" });
make(rootDir, {
  "orchard-invite/CLAUDE.md": "# invite\n",
  "Orchard.pdf": "pdf\n",
  "shop/CLAUDE.md": "# shop\n",
  "shop_worktrees/feature/CLAUDE.md": "# shop feature\n",
  "blog/CLAUDE.md": "# blog\n",
  "blog-old/CLAUDE.md": "# blog, old copy\n",
  "garden/CLAUDE.md": "# garden\n",
  "notes.txt": "loose\n",
  "decompiled/a.class": "x\n",
  "archive/old-thing/CLAUDE.md": "# old\n",
});
const rootBefore = snapshot(rootDir);
const tryJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const rootRun = fc("--root", rootDir, "--json");
const r10 = tryJson(rootRun.out);
const p10 = (r10?.findings || []).filter((f) => f.rules?.includes("P10"));
const p10At = (p) => p10.find((f) => f.path === p);
check(
  "--root <folder> --json runs and gives findings",
  rootRun.code === 0 && Array.isArray(r10?.findings),
  rootRun.out,
);
// the family: each entry is named, and as one family (one finding, or targets all in one folder)
const FAMILY = ["Orchard.pdf", "orchard-port", "orchard-invite"];
const famFindings = p10.filter((f) =>
  FAMILY.some((n) => f.path === n || JSON.stringify(f).includes(n)),
);
const famFolders = new Set(
  famFindings.map((f) => (f.target || "").split("/")[0].toLowerCase()),
);
check(
  "P10: a family in mixed case, a loose file included, is one family",
  FAMILY.every((n) => famFindings.some((f) => JSON.stringify(f).includes(n))) &&
    (famFindings.length === 1 ||
      (famFolders.size === 1 && !famFolders.has(""))),
  JSON.stringify(famFindings),
);
check(
  "P10: a <name>_worktrees folder beside its project",
  Boolean(p10At("shop_worktrees")),
  JSON.stringify(p10),
);
check(
  "P10: a <name>-old folder goes under archive/",
  p10At("blog-old")?.target === "archive/blog-old",
  JSON.stringify(p10At("blog-old")),
);
check(
  "P10: a loose file in the root",
  Boolean(p10At("notes.txt")),
  JSON.stringify(p10),
);
check(
  "P10: a folder that is no project (no git, no CLAUDE.md, no family) is an ask",
  p10At("decompiled")?.kind === "ask",
  JSON.stringify(p10At("decompiled")),
);
check(
  "guard: archive/ and a project with no family (garden) are not P10, with P10 live",
  p10.length > 0 &&
    !(r10?.findings || []).some((f) => /^(archive|garden)(\/|$)/.test(f.path)),
  JSON.stringify(r10?.findings),
);
check(
  "--root is report only: the root is as it was",
  sameSnap(rootBefore, snapshot(rootDir)),
);
// the default root: setup-state.json's projects field
const rootHome = path.join(tmp, "root-home");
fs.mkdirSync(path.join(rootHome, ".claude"), { recursive: true });
fs.writeFileSync(
  path.join(rootHome, ".claude", "setup-state.json"),
  JSON.stringify({ projects: fwd(rootDir) }),
);
const FCM = await import(
  new URL("../skills/file-upkeep/file-check.mjs", import.meta.url)
);
check(
  "projectsRoot(home) reads setup-state.json's projects field",
  typeof FCM.projectsRoot === "function" &&
    fwd(FCM.projectsRoot(rootHome) || "") === fwd(rootDir),
);
const defRun = spawnSync(
  process.execPath,
  [FC, "--home", rootHome, "--root", "--json"],
  { encoding: "utf8" },
);
check(
  "--root with no folder reports the setup's projects folder",
  defRun.status === 0 &&
    (tryJson(defRun.stdout)?.findings || []).some(
      (f) => f.path === "shop_worktrees",
    ),
  `${defRun.stdout}${defRun.stderr}`,
);

// ---- 11. S2b review: P8's apply leaves git, what counts as a link, docs sites, the note's git check, P10 families
// a tracked picture P8 moves to shown/ leaves git (shown/ is git-ignored); --undo tracks it again at its old path
const shownApp = path.join(tmp, "elsewhere", "shown-project");
gitRepo(shownApp, { "README.md": "# shown\n", "docs/img/shot.png": "png\n" });
const rS = json(shownApp);
const shot = byPath(rS, "docs/img/shot.png");
check(
  "P8: a tracked picture's fix says it leaves git, its history stays",
  shot?.kind === "fix" &&
    shot.target === "shown/img/shot.png" &&
    /leaves git/.test(shot.why),
  JSON.stringify(shot),
);
const p8Ledger = (r, f, name) =>
  writeLedger(
    {
      project: r.project,
      entries: [
        { id: f.id, path: f.path, sha: f.sha, action: "move", to: f.target },
      ],
    },
    name,
  );
const aS = fc("--apply", p8Ledger(rS, shot, "shown.json"));
const ignoreS = path.join(shownApp, "shown", ".gitignore");
check(
  "P8 apply: the picture is on disk in shown/, out of git's index, and shown/.gitignore (*) is made",
  aS.code === 0 &&
    fs.existsSync(path.join(shownApp, "shown", "img", "shot.png")) &&
    !git(shownApp, "ls-files").includes("shot.png") &&
    fs.existsSync(ignoreS) &&
    read(ignoreS) === "*\n" &&
    git(shownApp, "status", "--short") === "D  docs/img/shot.png\n",
  `${aS.out}\n${git(shownApp, "status", "--short")}`,
);
const uS = fc("--undo");
check(
  "P8 undo: the picture is tracked again at its old path, shown/ (made by the apply) is gone, git status is clean",
  uS.code === 0 &&
    git(shownApp, "ls-files").includes("docs/img/shot.png") &&
    git(shownApp, "status", "--short") === "" &&
    !fs.existsSync(path.join(shownApp, "shown")),
  `${uS.out}\n${git(shownApp, "status", "--short")}`,
);
// a shown/.gitignore that is there already stays as it is, through the apply and the undo
fs.mkdirSync(path.join(shownApp, "shown"));
fs.writeFileSync(ignoreS, "# mine\n*\n");
const rS2 = json(shownApp);
fc("--apply", p8Ledger(rS2, byPath(rS2, "docs/img/shot.png"), "shown2.json"));
const keptIgnore = read(ignoreS);
fc("--undo");
check(
  "P8 apply and undo leave a shown/.gitignore that was there already as it was",
  keptIgnore === "# mine\n*\n" && read(ignoreS) === "# mine\n*\n",
  `${keptIgnore} / ${fs.existsSync(ignoreS) && read(ignoreS)}`,
);
// links: a file over 1 MB, UTF-16 with and without a byte-order mark, another case, a URL-encoded name
const linksApp = path.join(tmp, "elsewhere", "links-project");
gitRepo(linksApp, {
  "README.md": "# links\n",
  "site/page.html": `<html>${"x".repeat(1100 * 1024)}<img src="img/big-only.png"></html>`,
  "notes/wide.txt": Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("see docs/img/wide-only.png\r\n", "utf16le"),
  ]),
  "notes/wide-bare.txt": Buffer.from("see wide-bare.png\r\n", "utf16le"),
  "notes/case.md": "![x](docs/Case-Only.PNG)\n",
  "notes/coded.md": "![x](docs/My%20Shot.png)\n",
  "docs/img/big-only.png": "p",
  "docs/img/wide-only.png": "p",
  "docs/img/wide-bare.png": "p",
  "docs/case-only.png": "p",
  "docs/My Shot.png": "p",
  "docs/lonely.png": "p",
});
const rL = json(linksApp);
for (const [p, how] of [
  ["docs/img/big-only.png", "a page over 1 MB"],
  ["docs/img/wide-only.png", "a UTF-16 file with a byte-order mark"],
  ["docs/img/wide-bare.png", "a UTF-16 file without one"],
  ["docs/case-only.png", "a link in another case"],
  ["docs/My Shot.png", "a URL-encoded link"],
])
  check(
    `P8 guard: a picture named only in ${how} stays (${p}), with P8 live`,
    byPath(rL, "docs/lonely.png")?.rules.includes("P8") &&
      !byPath(rL, p)?.rules.includes("P8"),
    JSON.stringify(byPath(rL, p)),
  );
// a docs site, and code that reads from docs/: a picture's move is an ask; a site's own code is not asked about
const siteApp = path.join(tmp, "elsewhere", "site-project");
gitRepo(siteApp, {
  "README.md": "# site\n",
  "mkdocs.yml": "site_name: site\n",
  "docs/index.md": "# home\n",
  "docs/favicon.png": "p",
  "docs/javascripts/extra.js": "",
});
const rSite = json(siteApp);
const favicon = byPath(rSite, "docs/favicon.png");
check(
  "P8: in a docs site (mkdocs.yml) an unnamed picture's move is an ask, not a fix",
  favicon?.rules.includes("P8") &&
    favicon.kind === "ask" &&
    /site/.test(favicon.why),
  JSON.stringify(favicon),
);
check(
  "P8 guard: a docs site's own code (docs/javascripts/extra.js) is not asked about",
  !byPath(rSite, "docs/javascripts/extra.js"),
  JSON.stringify(byPath(rSite, "docs/javascripts/extra.js")),
);
const readerApp = path.join(tmp, "elsewhere", "reader-project");
gitRepo(readerApp, {
  "README.md": "# reader\n",
  "src/load.py": 'open(os.path.join("docs", "img", name + ".png"))\n',
  "docs/img/chart.png": "p",
});
const chartPic = byPath(json(readerApp), "docs/img/chart.png");
check(
  "P8: with code that reads from docs/ (src/load.py), an unnamed picture's move is an ask naming that file",
  chartPic?.kind === "ask" && chartPic.why.includes("src/load.py"),
  JSON.stringify(chartPic),
);
const confApp = path.join(tmp, "elsewhere", "conf-project");
gitRepo(confApp, {
  "README.md": "# conf\n",
  "docs/.vitepress/config.ts": "",
  "docs/sidebars.js": "",
});
const rConf = json(confApp);
for (const p of ["docs/.vitepress/config.ts", "docs/sidebars.js"])
  check(
    `P8 guard: site config in docs/ is not asked about: ${p}`,
    !byPath(rConf, p)?.rules.includes("P8"),
    JSON.stringify(byPath(rConf, p)),
  );
const chartApp = path.join(tmp, "elsewhere", "chart-project");
gitRepo(chartApp, { "README.md": "# chart\n", "docs/Tools/Make_Chart.py": "" });
const chart = byPath(json(chartApp), "docs/Tools/Make_Chart.py");
check(
  "P8: a code file's ask in docs/ still names the other rules' rename (docs/tools/make_chart.py)",
  chart?.rules.includes("P8") &&
    chart.kind === "ask" &&
    !chart.target &&
    chart.why.includes("the other rules give docs/tools/make_chart.py"),
  JSON.stringify(chart),
);
// the note: git runs where the path is, a submodule's path gives [], the listing leaves git-ignored entries out
const outer = path.join(tmp, "elsewhere", "outer-project");
const subSrc = path.join(tmp, "elsewhere", "sub-source");
gitRepo(subSrc, { "README.md": "# sub\n" });
gitRepo(outer, { "README.md": "# outer\n" });
git(
  outer,
  "-c",
  "protocol.file.allow=always",
  "submodule",
  "add",
  "-q",
  fwd(subSrc),
  "lib/sub",
);
const noteOf = (root, rel) => {
  try {
    return FCM.newPathNotes(root, rel);
  } catch (e) {
    return `threw: ${e.message}`;
  }
};
check(
  "newPathNotes: a path in a submodule gives [] and does not throw",
  JSON.stringify(noteOf(outer, "lib/sub/New Notes.md")) === "[]",
  JSON.stringify(noteOf(outer, "lib/sub/New Notes.md")),
);
const plainRoot = path.join(tmp, "elsewhere", "plain-root");
gitRepo(path.join(plainRoot, "inner"), {
  ".gitignore": "cache/\n",
  "README.md": "# inner\n",
});
check(
  "newPathNotes: an inner repository's .gitignore counts under a folder that is no git project",
  JSON.stringify(noteOf(plainRoot, "inner/cache/Some Thing.md")) === "[]",
  JSON.stringify(noteOf(plainRoot, "inner/cache/Some Thing.md")),
);
const igApp = path.join(tmp, "elsewhere", "ignored-listing");
gitRepo(igApp, {
  ".gitignore": "src/oneTwo.mjs\nsrc/threeFour.mjs\ndocs/plan.txt\n",
  "src/a-b.mjs": "",
});
make(igApp, {
  "src/oneTwo.mjs": "",
  "src/threeFour.mjs": "",
  "docs/plan.txt": "",
});
const n3 = noteOf(igApp, "src/fiveSix.mjs");
check(
  "newPathNotes: N3 is judged from the files git shows (two ignored camelCase files do not count)",
  Array.isArray(n3) && n3[0]?.target === "src/five-six.mjs",
  JSON.stringify(n3),
);
check(
  "newPathNotes: a git-ignored plain file does not make a new name a copy (no A2)",
  JSON.stringify(noteOf(igApp, "docs/plan-copy.txt")) === "[]",
  JSON.stringify(noteOf(igApp, "docs/plan-copy.txt")),
);
// P10: one part beside a plain folder is an ask; a folder of projects is a family's folder
const famRoot = path.join(tmp, "family-root");
make(famRoot, {
  "tools/readme.txt": "x\n",
  "tools-cli/CLAUDE.md": "# cli\n",
  "game/game-port/CLAUDE.md": "# port\n",
  "game-invite/CLAUDE.md": "# invite\n",
});
const rFam = tryJson(fc("--root", famRoot, "--json").out);
const famAt = (p) => (rFam?.findings || []).find((f) => f.path === p);
check(
  "P10: one part beside a folder that is no project (tools-cli beside tools/) is an ask with no target",
  famAt("tools-cli")?.kind === "ask" && !famAt("tools-cli").target,
  JSON.stringify(rFam?.findings),
);
check(
  "P10: a part beside a folder that holds the family's projects (game/) goes into it",
  famAt("game-invite")?.kind === "fix" &&
    famAt("game-invite").target === "game/game-invite",
  JSON.stringify(rFam?.findings),
);
// names a tool or platform requires, Next.js route folders, scale suffixes and style modules keep their form in the
// report too (file-name-note is silent on them, so the two agree)
const toolApp = path.join(tmp, "elsewhere", "tool-names");
gitRepo(toolApp, {
  "CLAUDE.md": "# tool names\n",
  "Cargo.toml": "",
  "CMakeLists.txt": "",
  "GEMINI.md": "",
  "README.de.md": "",
  "android/app/src/main/AndroidManifest.xml": "",
  "ios/Info.plist": "",
  "ios/Podfile.lock": "",
  "src/Shop.App.csproj": "",
  "app/[slug]/page.tsx": "",
  "app/(store)/layout.tsx": "",
  "public/Logo@2x.png": "",
  "app/components/UserCard.tsx": "",
  "app/components/UserCard.module.css": "",
  "docs/Menu_Ideas.md": "",
});
const rTool = tryJson(fc("--report", toolApp, "--json").out);
const toolHits = (rTool?.findings || []).map((f) => f.path);
check(
  "--report leaves tool-required names, route folders, @2x pictures and style modules alone (only docs/Menu_Ideas.md is found)",
  JSON.stringify(toolHits) === JSON.stringify(["docs/Menu_Ideas.md"]),
  JSON.stringify(rTool?.findings ?? rTool),
);
const noHomeRun = spawnSync(
  process.execPath,
  [FC, "--report", toolApp, "--home"],
  {
    encoding: "utf8",
  },
);
const noHome = {
  code: noHomeRun.status,
  out: `${noHomeRun.stdout}${noHomeRun.stderr}`,
};
check(
  "--home with no folder still stops the command line",
  noHome.code === 1 && /--home needs a folder/.test(noHome.out),
  `exit ${noHome.code}: ${noHome.out}`,
);

// ---- 12. S6 end-review fixes: families by a shared prefix or a set name (D5), previews in docs/ (D4), draft-* only
// where run output goes, an archive imported only by an import line of code
// a family is the name before the first - or _ when two or more entries share it, with no entry named it
const prefixRoot = path.join(tmp, "prefix-root");
gitRepo(path.join(prefixRoot, "game-port"), { "CLAUDE.md": "# port\n" });
gitRepo(path.join(prefixRoot, "game-invite"), { "CLAUDE.md": "# invite\n" });
make(prefixRoot, {
  "game-port_worktrees/feature/CLAUDE.md": "# port feature\n",
  "game-invite-old/CLAUDE.md": "# invite, old copy\n",
  "notes-a/x.txt": "x\n",
  "notes-b/x.txt": "x\n",
});
const rPre = tryJson(fc("--root", prefixRoot, "--json").out);
const preAt = (p) => (rPre?.findings || []).find((f) => f.path === p);
for (const p of ["game-port", "game-invite"])
  check(
    `P10: entries that share a prefix with a project among them are one family with no entry named it (${p} → game/${p})`,
    preAt(p)?.kind === "fix" && preAt(p).target === `game/${p}`,
    JSON.stringify(rPre?.findings),
  );
check(
  "P10: a prefix family leaves the worktrees and old-copy findings their own (game-port_worktrees, game-invite-old)",
  /worktrees/.test(preAt("game-port_worktrees")?.why || "") &&
    preAt("game-invite-old")?.target === "archive/game-invite-old",
  JSON.stringify(rPre?.findings),
);
for (const p of ["notes-a", "notes-b"])
  check(
    `P10: two plain folders that share a prefix (${p}) stay no-project asks, not a family`,
    preAt(p)?.kind === "ask" &&
      !preAt(p).target &&
      /no git and no CLAUDE\.md/.test(preAt(p).why),
    JSON.stringify(preAt(p)),
  );
// the creation-time note at a projects root: a new folder joins the prefix family
const preHome = path.join(tmp, "prefix-home");
fs.mkdirSync(path.join(preHome, ".claude"), { recursive: true });
fs.writeFileSync(
  path.join(preHome, ".claude", "setup-state.json"),
  JSON.stringify({ projects: fwd(prefixRoot) }),
);
const preNote = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `const m = await import(${JSON.stringify(new URL("../skills/file-upkeep/file-check.mjs", import.meta.url).href)});
console.log(JSON.stringify(m.newPathNotes(${JSON.stringify(prefixRoot)}, "game-web/CLAUDE.md")));`,
  ],
  {
    encoding: "utf8",
    env: { ...process.env, HOME: preHome, USERPROFILE: preHome },
  },
);
const preNoteOut = tryJson(preNote.stdout);
check(
  "newPathNotes: a new folder at the projects root that shares a family's prefix gets P10 and game/game-web",
  preNoteOut?.[0]?.rule === "P10" && preNoteOut[0].target === "game/game-web",
  `${preNote.stdout}${preNote.stderr}`,
);
// a family named in the root's .claude/file-standard.json ("families"), and a broken file stops
const setRoot = path.join(tmp, "set-family-root");
make(setRoot, {
  ".claude/file-standard.json": JSON.stringify({ families: ["shop"] }),
  "shop-web/CLAUDE.md": "# web\n",
});
const rSet = tryJson(fc("--root", setRoot, "--json").out);
check(
  "P10: a family set in the root's .claude/file-standard.json takes its one project (shop-web → shop/shop-web)",
  (rSet?.findings || []).find((f) => f.path === "shop-web")?.target ===
    "shop/shop-web",
  JSON.stringify(rSet?.findings ?? rSet),
);
for (const [text, what] of [
  ["{ families: ", "not valid JSON"],
  [JSON.stringify({ families: "shop" }), "families"],
]) {
  fs.writeFileSync(path.join(setRoot, ".claude", "file-standard.json"), text);
  const r = fc("--root", setRoot, "--json");
  check(
    `--root stops with a clear error on a broken root .claude/file-standard.json (${what})`,
    r.code === 1 &&
      r.out.includes("file-standard.json") &&
      r.out.includes(what),
    `exit ${r.code}: ${r.out}`,
  );
}
// P8: a video render in docs/ no file names goes to shown/; a linked one, a docs page (.html) and a PDF stay
// (a PDF in docs/ is more often a document than a render, and shown/ takes it out of git; the lead took pdf out after S6)
const prevApp = path.join(tmp, "elsewhere", "preview-project");
gitRepo(prevApp, {
  "README.md": "# previews\n\n[demo](docs/demo.webm)\n",
  "docs/render.mp4": "",
  "docs/demo.webm": "",
  "docs/clip.mov": "",
  "docs/report.pdf": "",
  "docs/page.html": "",
});
const rPrev = json(prevApp);
for (const p of ["docs/render.mp4", "docs/clip.mov"])
  check(
    `P8: an unlinked render in docs/ (${p}) goes to shown/`,
    byPath(rPrev, p)?.rules.includes("P8") &&
      byPath(rPrev, p).target === p.replace(/^docs\//, "shown/"),
    JSON.stringify(rPrev.findings),
  );
for (const p of ["docs/demo.webm", "docs/page.html", "docs/report.pdf"])
  check(
    `guard: ${p} stays in docs/ (a linked video, or a docs page), with P8 on renders live`,
    byPath(rPrev, "docs/render.mp4")?.rules.includes("P8") && !byPath(rPrev, p),
    JSON.stringify(byPath(rPrev, p)),
  );
// P9: draft-* is run output at the top, under docs/ or a scratch folder; below source it is a module
const draftApp = path.join(tmp, "elsewhere", "draft-project");
gitRepo(draftApp, {
  "src/draft-editor/Main Panel.ts": "",
  "draft-07/out.txt": "",
  "docs/draft-02/out.txt": "",
});
const rDraft = json(draftApp);
check(
  "P9: src/draft-editor/ is a module, no run output, and its files keep the other rules (N4 on a space)",
  !byPath(rDraft, "src/draft-editor") &&
    byPath(rDraft, "src/draft-editor/Main Panel.ts")?.rules.includes("N4"),
  JSON.stringify(rDraft.findings),
);
for (const p of ["draft-07", "docs/draft-02"])
  check(
    `P9: a draft-* folder at the top or under docs/ is still run output (${p})`,
    byPath(rDraft, p)?.rules.includes("P9"),
    JSON.stringify(rDraft.findings),
  );
// A1: an archive of code counts as imported only by an import line of code, not by prose
const proseApp = path.join(tmp, "elsewhere", "prose-project");
gitRepo(proseApp, {
  "previous/old.mjs": "",
  "notes/log.md": "Carried over from the previous job.\n",
  "src/app.mjs": "// keeps what we learned from the previous build\n",
});
const proseWhy = byPath(json(proseApp), "previous")?.why || "";
check(
  "A1: prose or a comment that says 'from the previous …' does not make previous/ imported",
  proseWhy === "holds code",
  proseWhy,
);
for (const [name, files] of [
  [
    "a JS import",
    {
      "previous/a.mjs": "",
      "src/main.mjs": 'import { a } from "../previous/a.mjs";\n',
    },
  ],
  [
    "a Python from-import",
    { "previous/lib.py": "", "app.py": "from previous.lib import x\n" },
  ],
]) {
  const dir = path.join(
    tmp,
    "elsewhere",
    `import-${name.replace(/\W+/g, "-")}`,
  );
  gitRepo(dir, files);
  const why = byPath(json(dir), "previous")?.why || "";
  check(
    `A1: ${name} of previous/ from outside it says so`,
    why === "holds code imported from outside it",
    why,
  );
}

// ---- 13. a folder a build tool names keeps its name: one that holds a build file, and the folders an Xcode project
// names beside it (App/ next to App.xcodeproj); a build file does not exempt what is below or beside it
const buildApp = path.join(tmp, "elsewhere", "build-folders");
gitRepo(buildApp, {
  "package.json": "{}\n",
  "ios/App/App/AppDelegate.swift": "",
  "ios/App/App.xcodeproj/project.pbxproj":
    '/* group */ path = AppTests; sourceTree = "<group>";\n',
  "ios/App/AppTests/AppTests.swift": "",
  "ios/App/Podfile": "",
  "ios/Pods/Target.xcworkspace/contents.xcworkspacedata": "",
  "Android/build.gradle": "",
  "Tools/settings.gradle.kts": "",
  "Engine/CMakeLists.txt": "",
  "Engine/Shaders/bloom.glsl": "",
  "MyCrate/Cargo.toml": "",
  "Shop.Web/Shop.Web.csproj": "",
  "Solution/Shop.sln": "",
});
const rBuild = tryJson(fc("--report", buildApp, "--json").out);
const buildHits = (rBuild?.findings || []).map(
  (f) => `${f.path} → ${f.target}`,
);
for (const dir of [
  "ios/App",
  "ios/App/App",
  "ios/App/AppTests",
  "ios/Pods",
  "Android",
  "Tools",
  "Engine",
  "MyCrate",
  "Shop.Web",
  "Solution",
])
  check(
    `N1: --report keeps the name of ${dir}/, a folder a build tool names (no finding renames it)`,
    !(rBuild?.findings || []).some(
      (f) =>
        f.path.startsWith(`${dir}/`) &&
        f.target &&
        !f.target.startsWith(`${dir}/`),
    ),
    JSON.stringify(buildHits),
  );
check(
  "N1: a folder below a build-tool folder that holds no build file is still renamed (Engine/Shaders → Engine/shaders)",
  buildHits.includes("Engine/Shaders/bloom.glsl → Engine/shaders/bloom.glsl"),
  JSON.stringify(buildHits),
);
const rootBuild = path.join(tmp, "elsewhere", "root-build-file");
gitRepo(rootBuild, {
  "Cargo.toml": "",
  "App.csproj": "",
  "Bad_Name.md": "",
  "Notes/plan.md": "",
});
const rootHits = (
  tryJson(fc("--report", rootBuild, "--json").out)?.findings || []
).map((f) => `${f.path} → ${f.target}`);
check(
  "N1: a Cargo.toml or .csproj at the root exempts nothing: a badly named file and folder beside it are still renamed",
  rootHits.some(
    (h) => h.startsWith("Bad_Name.md → ") && h.endsWith("bad-name.md"),
  ) && rootHits.includes("Notes/plan.md → notes/plan.md"),
  JSON.stringify(rootHits),
);

// ---- 14. file names a build tool reads keep their form: each name an Xcode project.pbxproj names (below the folder
// that holds the project), and everything under an Android res/ folder (beside an AndroidManifest.xml); the other
// files in those trees are still checked
const toolFiles = path.join(tmp, "elsewhere", "build-file-names");
gitRepo(toolFiles, {
  "package.json": "{}\n",
  "ios/App/App.xcodeproj/project.pbxproj":
    'A1 /* Main.storyboard */ = {isa = PBXFileReference; path = Main.storyboard; sourceTree = "<group>"; };\n' +
    'A2 = {isa = PBXFileReference; path = "Launch Screen.storyboard"; sourceTree = "<group>"; };\n' +
    'A3 = {isa = PBXGroup; path = Shared_Views; sourceTree = "<group>"; };\n',
  "ios/App/App/Main.storyboard": "",
  "ios/App/App/Launch Screen.storyboard": "",
  "ios/App/App/Shared_Views/Card.swift": "",
  "ios/App/App/Old_Notes.txt": "",
  "android/app/src/main/AndroidManifest.xml": "",
  "android/app/src/main/res/mipmap-hdpi/ic_launcher.png": "",
  "android/app/src/main/res/drawable/splash_screen.xml": "",
  "android/app/Build_Notes.txt": "",
  "web/res/Big_Icon.png": "",
});
const rFiles = tryJson(fc("--report", toolFiles, "--json").out);
const fileHits = (rFiles?.findings || []).map((f) => `${f.path} → ${f.target}`);
for (const kept of [
  "ios/App/App/Main.storyboard",
  "ios/App/App/Launch Screen.storyboard",
  "ios/App/App/Shared_Views/Card.swift",
  "android/app/src/main/res/mipmap-hdpi/ic_launcher.png",
  "android/app/src/main/res/drawable/splash_screen.xml",
])
  check(
    `N1: --report keeps ${kept}, a name a build tool reads (no finding for it)`,
    !(rFiles?.findings || []).some((f) => f.path === kept),
    JSON.stringify(fileHits),
  );
for (const [from, to] of [
  ["ios/App/App/Old_Notes.txt", "ios/App/App/old-notes.txt"],
  ["android/app/Build_Notes.txt", "android/app/build-notes.txt"],
  ["web/res/Big_Icon.png", "web/res/big-icon.png"],
])
  check(
    `N1: ${from}, which no build tool names, is still renamed (→ ${to})`,
    fileHits.includes(`${from} → ${to}`),
    JSON.stringify(fileHits),
  );

// a folder given before the mode, or a word no mode takes, stops with the form to use instead of checking the current
// folder
for (const [name, argv] of [
  ["a folder before --report", [toolFiles, "--report"]],
  ["a second folder after --report", ["--report", toolFiles, rootBuild]],
]) {
  const r = fc(...argv);
  check(
    `the command line: ${name} stops and names the form --report <folder> (does not check the current folder)`,
    r.code === 1 && /file-check stopped: .*--report <folder>/.test(r.out),
    `exit ${r.code}: ${r.out}`,
  );
}
// a mode that takes no folder (--status, --skip, --report --homes) stops on a word after it, instead of dropping it
for (const argv of [
  ["--status", toolFiles, "--homes"],
  ["--skip", toolFiles, "--homes"],
  ["--report", toolFiles, "--homes"],
]) {
  const r = fc(...argv);
  check(
    `the command line: ${argv.join(" ")} stops on the folder ${argv[0]} --homes does not take (exit 1, nothing done)`,
    r.code === 1 &&
      new RegExp(`file-check stopped: .*${argv[0]} --homes takes none`).test(
        r.out,
      ),
    `exit ${r.code}: ${r.out}`,
  );
}

// ---- 15. a name a build tool reads stays when a folder above it is renamed: the rename is a fix, not an ask that
// says the kept name still breaks N1, and a ledger with those moves checks ok
const underRenamed = path.join(tmp, "elsewhere", "kept-under-renamed");
gitRepo(underRenamed, {
  "package.json": "{}\n",
  "Root_X/ios/App/App.xcodeproj/project.pbxproj":
    'path = Main.storyboard;\npath = "Launch Screen.storyboard";\n',
  "Root_X/ios/App/App/Main.storyboard": "",
  "Root_X/ios/App/App/Launch Screen.storyboard": "",
  "Mobile_Client/app/src/main/AndroidManifest.xml": "",
  "Mobile_Client/app/src/main/res/drawable/splash_screen.xml": "",
});
const rUnder = tryJson(fc("--report", underRenamed, "--json").out);
const underHits = (rUnder?.findings || []).map(
  (f) => `${f.kind} ${f.path} → ${f.target}`,
);
for (const [from, to] of [
  ["Root_X/ios/App/App/Main.storyboard", "root-x/ios/App/App/Main.storyboard"],
  [
    "Root_X/ios/App/App/Launch Screen.storyboard",
    "root-x/ios/App/App/Launch Screen.storyboard",
  ],
  [
    "Root_X/ios/App/App.xcodeproj/project.pbxproj",
    "root-x/ios/App/App.xcodeproj/project.pbxproj",
  ],
  [
    "Mobile_Client/app/src/main/res/drawable/splash_screen.xml",
    "mobile-client/app/src/main/res/drawable/splash_screen.xml",
  ],
])
  check(
    `N1: under a renamed parent, ${from} keeps its build-tool names and is a fix (→ ${to}), not an ask`,
    underHits.includes(`fix ${from} → ${to}`),
    JSON.stringify(underHits),
  );
const underCheck = rUnder
  ? fc(
      "--check",
      writeLedger(ledgerFrom(rUnder), "kept-under-renamed-ledger.json"),
    ).out
  : "no report";
check(
  "--check: a ledger that renames a parent of names a build tool reads checks ok (the kept names do not break N1)",
  underCheck.includes("check: ok"),
  underCheck,
);

// breaks() imported without a project: the name rules alone, no kept build-tool names
let bare;
try {
  bare = [breaks("docs/notes.md"), breaks("Docs/notes.md")];
} catch (e) {
  bare = [e.message];
}
check(
  "breaks(path) without a project works on the name rules alone (does not crash on the missing project)",
  bare[0] === "" && bare[1] === "N1",
  JSON.stringify(bare),
);

// ---- 16. an Xcode project keeps only the paths its project.pbxproj names: a folder chain from the project folder
// down, not every file or folder in the tree that shares a name with a build setting or group (Debug, Release,
// Products); a ../ path is resolved from the project folder and kept, with the named files below it
const rootXcode = path.join(tmp, "elsewhere", "root-xcode");
gitRepo(rootXcode, {
  "App.xcodeproj/project.pbxproj":
    "path = Main.storyboard;\nname = Debug;\nname = Release;\nname = Products;\n",
  "App/Main.storyboard": "",
  "Release/Plan.md": "",
  "notes/Debug/Run.md": "",
  "notes/Products/List.md": "",
});
const xcodeHits = (
  tryJson(fc("--report", rootXcode, "--json").out)?.findings || []
).map((f) => `${f.path} → ${f.target}`);
check(
  "N1: App/Main.storyboard, a path the root project.pbxproj names, keeps its name (no finding)",
  !xcodeHits.some((h) => h.startsWith("App/Main.storyboard ")),
  JSON.stringify(xcodeHits),
);
for (const [from, to] of [
  ["Release/Plan.md", "release/plan.md"],
  ["notes/Debug/Run.md", "notes/debug/run.md"],
  ["notes/Products/List.md", "notes/products/list.md"],
])
  check(
    `N1: ${from}, which a root Xcode project does not name as a path, is still renamed (→ ${to})`,
    xcodeHits.includes(`${from} → ${to}`),
    JSON.stringify(xcodeHits),
  );
const upXcode = path.join(tmp, "elsewhere", "up-xcode");
gitRepo(upXcode, {
  "package.json": "{}\n",
  "ios/App/App.xcodeproj/project.pbxproj":
    'path = "../Shared_Code";\npath = Net_Client.swift;\npath = ../Shared_Kit/Kit_Main.swift;\n',
  "ios/Shared_Code/Net_Client.swift": "",
  "ios/Shared_Code/Old_Notes.txt": "",
  "ios/Shared_Kit/Kit_Main.swift": "",
});
const upHits = (
  tryJson(fc("--report", upXcode, "--json").out)?.findings || []
).map((f) => `${f.path} → ${f.target}`);
for (const kept of [
  "ios/Shared_Code/Net_Client.swift",
  "ios/Shared_Kit/Kit_Main.swift",
])
  check(
    `N1: ${kept}, named by a ../ path in ios/App's project.pbxproj, keeps its name and folder (no finding)`,
    !upHits.some((h) => h.startsWith(`${kept} `)),
    JSON.stringify(upHits),
  );
check(
  "N1: ios/Shared_Code/Old_Notes.txt, which the project does not name, keeps the folder and gets a new file name",
  upHits.includes(
    "ios/Shared_Code/Old_Notes.txt → ios/Shared_Code/old-notes.txt",
  ),
  JSON.stringify(upHits),
);

// ---- 17. a build file that names the projects below it by path (a .sln, settings.gradle, a Cargo workspace, CMake
// add_subdirectory) keeps the folders between it and each such project; a project of another tool, and a folder
// with no project in it, are still renamed
const between = path.join(tmp, "elsewhere", "between-build-files");
gitRepo(between, {
  "Shop.sln": "",
  "Src_Code/Shop.Web/Shop.Web.csproj": "",
  "settings.gradle": "",
  "Apps_Dir/Mobile/build.gradle": "",
  "Cargo.toml": "",
  "Crates_Dir/Core/Cargo.toml": "",
  "Engine/CMakeLists.txt": "",
  "Engine/Third_Party/Zlib/CMakeLists.txt": "",
  "Misc_Stuff/Lib/Package.swift": "",
  "Notes_Dir/Plan.md": "",
});
const betweenHits = (
  tryJson(fc("--report", between, "--json").out)?.findings || []
).map((f) => `${f.path} → ${f.target}`);
for (const dir of ["Src_Code", "Apps_Dir", "Crates_Dir", "Engine/Third_Party"])
  check(
    `N1: ${dir}/, between a build file and a project it names by path, keeps its name (no finding renames it)`,
    !betweenHits.some((h) => h.startsWith(`${dir}/`)),
    JSON.stringify(betweenHits),
  );
for (const [from, to] of [
  ["Misc_Stuff/Lib/Package.swift", "misc-stuff/Lib/Package.swift"],
  ["Notes_Dir/Plan.md", "notes-dir/plan.md"],
])
  check(
    `N1: ${from}, under no build file that names it, still gets its folder renamed (→ ${to})`,
    betweenHits.includes(`${from} → ${to}`),
    JSON.stringify(betweenHits),
  );

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
