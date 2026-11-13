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
const { dateIn, fixName, refSpans } = await import(new URL("../skills/file-upkeep/file-check.mjs", import.meta.url));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "file-check-test-")));
const home = path.join(tmp, "home");
const claude = path.join(home, ".claude");
fs.mkdirSync(claude, { recursive: true });
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${detail}`}`); };
const fwd = (p) => p.replace(/\\/g, "/");
const read = (f) => fs.readFileSync(f, "utf8");
const fc = (...flags) => {
  const r = spawnSync(process.execPath, [FC, "--home", home, ...flags], { encoding: "utf8" });
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
      else out[fwd(path.relative(root, full))] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  };
  walk(root);
  return out;
};
const sameSnap = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const byPath = (r, p) => r.findings.find((f) => f.path === p);
// a ledger from the report: every fix as proposed, asks as given in answers {path: entry fields}
const ledgerFrom = (r, answers = {}) => ({
  project: r.project,
  entries: r.findings.filter((f) => f.kind !== "note").map((f) => ({ id: f.id, path: f.path, sha: f.sha,
    ...(answers[f.path] || (f.target ? { action: f.action, to: f.target } : { action: f.action })) })),
});
const writeLedger = (l, name = "ledger.json") => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, JSON.stringify(l, null, 2));
  return f;
};

// ---- 1. the rules, each with a hit and a guard
const rules = path.join(tmp, "rules-project");
gitRepo(rules, {
  "README.md": "# x\n", "DECISIONS.md": "- see docs/2025-01-02-linked-plan.md\n", "CLAUDE.md": "x\n".repeat(201),
  "package.json": JSON.stringify({ name: "x", main: "server-start.mjs" }), "server-start.mjs": "", "index.js": "", "install.mjs": "",
  "drift.mjs": "", "test-kit.mjs": "", "tests/test-a.mjs": "", "snippets.md": "",
  "docs/Setup_Notes.md": "", "docs/temperature.md": "", "docs/untitled.md": "",
  "docs/turn-cap-candidates-2026-10-11.md": "", "docs/research/folders.md": "", "docs/research/2026-01-01-handoff-study.md": "",
  "docs/history-handoff-2026-11-06.md": "", "docs/decisions-archive-2026-11-02.md": "- old\n",
  "docs/prices.md": "", "docs/prices.md.bak": "", "docs/api-v2.md": "", "docs/notes.md": "", "docs/notes-old.md": "",
  "docs/2025-01-01-old-plan.md": "", "docs/2025-01-02-linked-plan.md": "",
  "tools/tts-worker.py": "", "tools/__init__.py": "",
  "lib/read-file.mjs": "", "lib/read-data.mjs": "", "lib/writeFile.mjs": "", "ui/Voice.tsx": "", "ui/useVoice.ts": "",
  "kit/Install on Windows.cmd": "", "scripts/check-20261002.sh": "", "scripts/release-1.0.4.sh": "",
  "scripts/a3f20261002b.txt": "", "scripts/release-2026-11-10.sh": "", "scripts/test-lib-copy.mjs": "",
  "audits/repo-push.sh": "", ".claude/notes.md": "", ".claude/settings.json": "{}",
  "patches/superseded/a.md": "", "hooks/handoff-brief.mjs": "",
});
const r1 = json(rules);
const hit = (p, rule, target) => {
  const f = byPath(r1, p);
  check(`${rule}: ${p}${target ? ` → ${target}` : ""}`, f && f.rules.includes(rule) && (!target || f.target === target), JSON.stringify(f));
};
const noRule = (p, rule) => check(`guard: ${p} is not ${rule}`, !byPath(r1, p)?.rules.includes(rule), JSON.stringify(byPath(r1, p)));
const clean = (p) => check(`guard: ${p} passes`, !byPath(r1, p), JSON.stringify(byPath(r1, p)));
hit("docs/Setup_Notes.md", "N1", "docs/setup-notes.md");
hit("tools/tts-worker.py", "N2", "tools/tts_worker.py"); clean("tools/__init__.py");
hit("lib/writeFile.mjs", "N3", "lib/write-file.mjs"); clean("lib/read-file.mjs"); clean("ui/Voice.tsx"); clean("ui/useVoice.ts");
hit("kit/Install on Windows.cmd", "N4", "kit/install-on-windows.cmd");
hit("scripts/check-20261002.sh", "N6a", "scripts/2026-10-02-check.sh");
clean("scripts/release-1.0.4.sh"); clean("scripts/a3f20261002b.txt"); clean("scripts/release-2026-11-10.sh");
hit("docs/turn-cap-candidates-2026-10-11.md", "N6b", "docs/2026-10-11-turn-cap-candidates.md");
const now = new Date();
const today = new Date(now.getTime() - now.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); // local day, as the checker and git use
hit("docs/research/folders.md", "N6c", `docs/research/${today}-folders.md`);
hit("docs/untitled.md", "N7"); check("N7 is an ask", byPath(r1, "docs/untitled.md")?.kind === "ask"); clean("docs/temperature.md");
hit("drift.mjs", "P1", "scripts/drift.mjs"); clean("index.js"); clean("install.mjs"); clean("server-start.mjs");
hit("test-kit.mjs", "P2a", "tests/test-kit.mjs"); clean("tests/test-a.mjs");
hit("snippets.md", "P3", "docs/snippets.md"); clean("README.md"); clean("DECISIONS.md");
hit("audits/repo-push.sh", "P4"); check("P4 is an ask", byPath(r1, "audits/repo-push.sh")?.kind === "ask");
hit(".claude/notes.md", "P5"); clean(".claude/settings.json");
hit("CLAUDE.md", "P6");
hit("docs/history-handoff-2026-11-06.md", "R1"); check("R1 tracked is a delete fix", byPath(r1, "docs/history-handoff-2026-11-06.md")?.action === "delete" && byPath(r1, "docs/history-handoff-2026-11-06.md")?.kind === "fix");
noRule("docs/research/2026-01-01-handoff-study.md", "R1"); clean("hooks/handoff-brief.mjs");
hit("docs/decisions-archive-2026-11-02.md", "R2", "docs/decisions-archive.md");
hit("docs/2025-01-01-old-plan.md", "R3"); clean("docs/2025-01-02-linked-plan.md");
hit("patches/superseded", "A1"); check("A1 takes the folder whole", !byPath(r1, "patches/superseded/a.md"));
hit("docs/prices.md.bak", "A2"); hit("docs/notes-old.md", "A2"); clean("docs/api-v2.md"); noRule("scripts/test-lib-copy.mjs", "A2");
check("the text report has the header and the estimate", /· \d+ to fix · \d+ to ask · \d+ notes/.test(fc("--report", rules).out) && /Reorganize: about \d+ minutes/.test(fc("--report", rules).out));
check("unit: N6a on a compact date, none on a hash", dateIn("check-20261002")?.iso === "2026-10-02" && dateIn("a3f20261002b") === null && dateIn("release-1.0.4") === null);
check("unit: a reversed date", fixName("report-02-10-2026.md", "docs")[0] === "2026-10-02-report.md");

// ---- 2. the reorganize of a git project, with git-ignored data beside it
const bake = path.join(tmp, "projects", "bakery");
const winRoot = bake.replace(/\//g, "\\"), slashRoot = fwd(bake);
const lowDrive = (p) => p.replace(/^([A-Z]):/, (_, d) => `${d.toLowerCase()}:`);
const IGNORED = { "logs/Run_Log.txt": "run 1\n", "logs/old/backup.bak": "x\n", "data/Cache_Old.db": "db\n", "data/notes.db": "db2\n", "Run_Data/run.log": "r\n" };
gitRepo(bake, {
  ".gitignore": "logs/\ndata/*.db\n*.log\n",
  "CLAUDE.md": "# Bakery\nRun `node resize.mjs` after a photo. Menu notes: docs/Menu_Ideas.md\n",
  "HANDOFF.md": `- ${slashRoot}/docs/Menu_Ideas.md\n- ${winRoot}\\docs\\Menu_Ideas.md\n- ${lowDrive(slashRoot)}/docs/Menu_Ideas.md\n- see ./docs/Menu_Ideas.md\n`,
  "resize.mjs": "export {};\n",
  "scripts/build.mjs": "const menu = '../docs/Menu_Ideas.md';\nconst built = path.join('docs', 'Menu_Ideas.md');\n",
  "docs/Menu_Ideas.md": "# Menu\n",
  "docs/2026-10-01-record.md": "Then the menu lived in docs/Menu_Ideas.md.\n",
  "docs/prices.md": "1\n", "docs/prices.md.bak": "0\n",
  "docs/decisions-archive-2026-11-02.md": "- an old decision\n",
  "data/schema.md": "tables\n", "Run_Data/summary.md": "s\n",
  ".claude/systems-map.json": JSON.stringify({ things: [{ id: "menu", start: ["docs/Menu_Ideas.md", "resize.mjs"], read: ["docs\\Menu_Ideas.md"] }] }, null, 2) + "\n",
});
make(bake, { ...IGNORED, "docs/notes.md": "n\n", "docs/notes-old.md": "untracked copy\n" });
const ignoredBefore = Object.fromEntries(Object.keys(IGNORED).map((f) => [f, read(path.join(bake, f))]));
const r2 = json(bake);
const named = r2.findings.map((f) => f.path).join(" ");
check("ignored data is never in the report (logs/, data/*.db, *.log)", !/logs\/|\.db|run\.log/.test(named), named);
check("a folder that holds ignored data is not renamed", !r2.findings.some((f) => f.path.startsWith("Run_Data/")), named);
check("data/schema.md (tracked, beside ignored databases) passes", !byPath(r2, "data/schema.md"));
check("the untracked copy is an ask", byPath(r2, "docs/notes-old.md")?.kind === "ask");
check("the report names the files a move changes", (byPath(r2, "docs/Menu_Ideas.md")?.refs || []).includes("CLAUDE.md") && byPath(r2, "docs/Menu_Ideas.md").refs.includes(".claude/systems-map.json"), JSON.stringify(byPath(r2, "docs/Menu_Ideas.md")));
const answers = { "docs/notes-old.md": { action: "keep", reason: "the person keeps it" } };
const good = ledgerFrom(r2, answers);
check("check: ok on a full ledger", fc("--check", writeLedger(good)).out.includes("check: ok"), fc("--check", writeLedger(good)).out);
// one ledger per fault kind
const menuId = byPath(r2, "docs/Menu_Ideas.md").id, bakId = byPath(r2, "docs/prices.md.bak").id, copyId = byPath(r2, "docs/notes-old.md").id;
const mutate = (fn) => { const l = JSON.parse(JSON.stringify(good)); fn(l); return fc("--check", writeLedger(l, "bad.json")).out; };
const ent = (l, id) => l.entries.find((e) => e.id === id);
check("fault: a finding with no entry", mutate((l) => { l.entries = l.entries.filter((e) => e.id !== bakId); }).includes(`${bakId}: no entry`));
check("fault: a finding with two entries", mutate((l) => { l.entries.push({ ...ent(l, bakId) }); }).includes(`${bakId}: 2 entries`));
check("fault: a file changed since the report", mutate((l) => { ent(l, menuId).sha = "0".repeat(64); }).includes("changed since the report"));
check("fault: two moves to one target", mutate((l) => { ent(l, bakId).action = "move"; ent(l, bakId).to = "docs/menu-ideas.md"; }).includes("is also the target of"));
check("fault: a target that exists", mutate((l) => { ent(l, menuId).to = "docs/prices.md"; }).includes("docs/prices.md exists"));
check("fault: a target that breaks a rule", mutate((l) => { ent(l, menuId).to = "docs/Menu Ideas.md"; }).includes("breaks N4"));
check("fault: an untracked delete without the person's answer", mutate((l) => { ent(l, copyId).action = "delete"; delete ent(l, copyId).reason; }).includes('needs the person\'s answer'));
check("fault: a path outside the project", mutate((l) => { ent(l, menuId).to = "../elsewhere.md"; }).includes("outside the project"));
const before = snapshot(bake);
const applied = fc("--apply", writeLedger(good));
check("apply runs", applied.code === 0 && applied.out.includes("applied:"), applied.out);
const st = git(bake, "status", "--porcelain");
check("apply moves tracked files with git mv", /^R {2}docs\/Menu_Ideas\.md -> docs\/menu-ideas\.md$/m.test(st) && /^R {2}resize\.mjs -> scripts\/resize\.mjs$/m.test(st), st);
check("apply deletes the tracked copy with git rm", /^D {2}docs\/prices\.md\.bak$/m.test(st), st);
const at = (f) => read(path.join(bake, f));
check("CLAUDE.md: the root file's path and the moved doc are fixed", at("CLAUDE.md").includes("node scripts/resize.mjs") && at("CLAUDE.md").includes("docs/menu-ideas.md"), at("CLAUDE.md"));
const map = JSON.parse(at(".claude/systems-map.json")).things[0];
check("the systems map's paths are rewritten (both slash forms)", map.start.join() === "docs/menu-ideas.md,scripts/resize.mjs" && map.read[0] === "docs\\menu-ideas.md", JSON.stringify(map));
const ho = at("HANDOFF.md");
check("absolute Windows paths are fixed: forward, back slashes, lower-case drive", ho.includes(`${slashRoot}/docs/menu-ideas.md`) && ho.includes(`${winRoot}\\docs\\menu-ideas.md`) && ho.includes(`${lowDrive(slashRoot)}/docs/menu-ideas.md`) && !ho.includes("Menu_Ideas"), ho);
check("a ./ path is fixed", ho.includes("./docs/menu-ideas.md"));
check("a path relative to the citing file is fixed", at("scripts/build.mjs").includes("'../docs/menu-ideas.md'"), at("scripts/build.mjs"));
check("a path built in code is listed, not changed", at("scripts/build.mjs").includes("'Menu_Ideas.md'") && applied.out.includes("by hand: scripts/build.mjs:2"), applied.out);
check("a dated record keeps its old path", at("docs/2026-10-01-record.md").includes("docs/Menu_Ideas.md"));
check("the dated decisions archive is merged", at("docs/decisions-archive.md").includes("- an old decision") && !fs.existsSync(path.join(bake, "docs/decisions-archive-2026-11-02.md")));
check("a keep goes to .claude/file-standard.json with its reason", JSON.parse(at(".claude/file-standard.json")).reason["docs/notes-old.md"] === "the person keeps it");
check("after the apply the folder reports clean", (() => { const r = json(bake); return r.fix + r.ask === 0; })(), fc("--report", bake).out);
const logs = path.join(claude, "setup-logs");
const savedName = fs.readdirSync(logs).find((n) => n.startsWith("file-moves-"));
const saved = savedName && JSON.parse(read(path.join(logs, savedName)));
check("the saved ledger holds every move, delete, merge and edit with old and new", saved && saved.ops.some((o) => o.op === "move" && o.from === "resize.mjs")
  && saved.ops.some((o) => o.op === "delete") && saved.ops.some((o) => o.op === "merge") && saved.edits.some((e) => e.file === "CLAUDE.md" && e.edits.some((x) => x.old === "resize.mjs" && x.new === "scripts/resize.mjs")));
const ignoredSame = () => Object.entries(ignoredBefore).every(([f, t]) => fs.existsSync(path.join(bake, f)) && read(path.join(bake, f)) === t);
check("apply leaves the ignored data as it was", ignoredSame());
const undone = fc("--undo");
check("undo runs from the saved ledger", undone.code === 0 && undone.out.includes("undone:"), undone.out);
const afterUndo = snapshot(bake);
check("undo leaves the folder byte-identical", sameSnap(before, afterUndo), JSON.stringify(Object.keys(before).filter((k) => before[k] !== afterUndo[k]).concat(Object.keys(afterUndo).filter((k) => !(k in before)))));
check("undo leaves the ignored data as it was", ignoredSame());
check("a second undo finds nothing left", fc("--undo").out.includes("no ledger to undo"));

// ---- 3. a folder that is not a git project
const plain = path.join(tmp, "plain-folder");
make(plain, { "README.md": "see Notes_Draft.md\n", "Notes_Draft.md": "d\n", "a.md": "a\n", "a.md.bak": "old a\n", "node_modules/Bad_Name/x.md": "", "nested/.git/HEAD": "", "nested/Bad_Name.md": "" });
const r3 = json(plain);
check("not git: the walk skips node_modules and nested repos", !r3.findings.some((f) => /node_modules|nested/.test(f.path)), r3.findings.map((f) => f.path).join(" "));
check("not git: a copy is an ask (no history holds it)", byPath(r3, "a.md.bak")?.kind === "ask");
const plainBefore = snapshot(plain);
const l3 = ledgerFrom(r3, { "a.md.bak": { action: "delete", answer: "yes" } });
const a3 = fc("--apply", writeLedger(l3, "plain.json"));
check("not git: apply renames and sends the delete to the trash folder", a3.code === 0 && !fs.existsSync(path.join(plain, "a.md.bak"))
  && fs.existsSync(path.join(claude, "setup-logs", "file-moves-trash")) && fs.existsSync(path.join(plain, "docs", "notes-draft.md")), a3.out);
check("not git: the root file's bare name is fixed", read(path.join(plain, "README.md")).includes("docs/notes-draft.md"));
const u3 = fc("--undo");
check("not git: undo is byte-identical", u3.code === 0 && sameSnap(plainBefore, snapshot(plain)), u3.out);

// ---- 4. path forms: macOS and Windows roots, a relative path, a bare name
const spans = (text, root, citing, rel) => refSpans(text, root, citing, rel).map((s) => s.text);
check("macOS: an absolute path under /Users/someone is found", spans("open /Users/someone/shop/docs/a.md now", "/Users/someone/shop", "CLAUDE.md", "docs/a.md").join() === "docs/a.md");
check("macOS: a path under another folder is not", spans("open /Users/someone/other/docs/a.md", "/Users/someone/shop", "CLAUDE.md", "docs/a.md").length === 0);
check("Windows: back slashes and a JSON-escaped path", spans('C:\\Users\\someone\\shop\\docs\\a.md and "docs\\\\a.md"', "C:/Users/someone/shop", "x.json", "docs/a.md").join("|") === "docs\\a.md|docs\\\\a.md");
check("Windows: the drive letter in any case", spans("c:/Users/someone/shop/docs/a.md", "C:/Users/someone/shop", "CLAUDE.md", "docs/a.md").length === 1);
check("a longer name is not a hit", spans("docs/a.md.bak docs/a.mdx xdocs/a.md", "/Users/someone/shop", "CLAUDE.md", "docs/a.md").length === 0);
check("a path relative to the citing file", spans("[a](../docs/a.md)", "/Users/someone/shop", "notes/b.md", "docs/a.md").join() === "../docs/a.md");

// ---- 5. the update's offer: --status --homes, then --skip --homes
const shop = path.join(tmp, "projects", "shop");
gitRepo(shop, { "CLAUDE.md": "# shop\n", "Price_List.md": "p\n" });
const projects = path.join(tmp, "projects");
const stateFile = path.join(claude, "setup-state.json");
fs.writeFileSync(stateFile, JSON.stringify({ projects: fwd(projects), written: { [`${fwd(shop)}/CLAUDE.md`]: "x", [`${fwd(bake)}/CLAUDE.md`]: "x" } }));
const s1 = fc("--status", "--homes");
check("status: one line per home and a pending key", s1.out.includes(`${fwd(shop)}: 1 fix`) && /^pending: [0-9a-f]{16}$/m.test(s1.out), s1.out);
check("status: the bakery home with uncommitted changes is skipped until committed", s1.out.includes(`${fwd(bake)}: skipped until its changes are committed`), s1.out);
check("status: one offer line with the folders, files and minutes", /^offer: 1 folder, 1 files to reorganize, about \d+ minutes; skipped until committed: .*bakery/m.test(s1.out), s1.out);
const sk = fc("--skip", "--homes");
check("skip marks the pending key offered", sk.out.startsWith("skipped: pending") && JSON.parse(read(stateFile)).fileOffered === /^pending: (\w+)$/m.exec(s1.out)[1], sk.out);
check("after skip the offer is none", fc("--status", "--homes").out.includes("offer: none (offered before"));
make(shop, { "Second_File.md": "s\n" });
git(shop, "add", "-A"); git(shop, "commit", "-q", "-m", "more");
check("a new finding brings the offer back", /^offer: 1 folder, 2 files/m.test(fc("--status", "--homes").out));

// ---- 6. relative references: a moved file's own imports, and a sibling ./name in a subfolder
const tool = path.join(tmp, "elsewhere", "tool-project");
gitRepo(tool, {
  "tool-one.mjs": 'import { a } from "./lib/a.mjs";\nimport { two } from "./helper-two.mjs";\nimport { b } from "./src/b.mjs";\nconsole.log(a + two + b);\n',
  "helper-two.mjs": 'import { a } from "./lib/a.mjs";\nexport const two = "2" + a;\n',
  "lib/a.mjs": 'export const a = "a";\n',
  "src/b.mjs": 'import { two } from "./helper-two.mjs";\nexport const b = two;\n',
  "src/helper-two.mjs": 'export const two = "s";\n',
});
const r6 = json(tool);
check("P1: a root script is an ask, not a fix", byPath(r6, "tool-one.mjs")?.kind === "ask" && byPath(r6, "helper-two.mjs")?.target === "scripts/helper-two.mjs", JSON.stringify(r6.findings));
const toolBefore = snapshot(tool), srcB = read(path.join(tool, "src/b.mjs"));
const a6 = fc("--apply", writeLedger(ledgerFrom(r6), "tool.json"));
const ran = spawnSync(process.execPath, [path.join(tool, "scripts", "tool-one.mjs")], { encoding: "utf8", cwd: tmp });
check("a moved file's imports still reach the files that stayed and the one that moved: node runs it", a6.code === 0 && ran.status === 0 && ran.stdout.trim() === "a2as", `${a6.out}\n${ran.stderr}\n${read(path.join(tool, "scripts", "tool-one.mjs"))}`);
check("a sibling ./helper-two.mjs in src/ is not taken for the root file", read(path.join(tool, "src/b.mjs")) === srcB, read(path.join(tool, "src/b.mjs")));
const u6 = fc("--undo");
check("undo of the relative fixes is byte-identical", u6.code === 0 && sameSnap(toolBefore, snapshot(tool)), u6.out);

// ---- 7. files a tool needs at the root are never proposed
const ROOT_TOOLS = ["gradlew", "gradlew.bat", "next-env.d.ts", "middleware.ts", "instrumentation.ts", "wsgi.py", "asgi.py", "manage.py"];
const web = path.join(tmp, "elsewhere", "web-project");
gitRepo(web, Object.fromEntries([...ROOT_TOOLS, "other-tool.mjs"].map((f) => [f, "x\n"])));
const r7 = json(web);
for (const f of ROOT_TOOLS) check(`a tool's root file stays: ${f}`, !byPath(r7, f), JSON.stringify(byPath(r7, f)));
check("another root script is an ask", byPath(r7, "other-tool.mjs")?.kind === "ask", JSON.stringify(byPath(r7, "other-tool.mjs")));

// ---- 8. a run that stops on the 3rd of 5 moves: the journal holds the 2 done, undo restores them
const half = path.join(tmp, "elsewhere", "half-project");
make(half, { "Alpha_Notes.md": "a\n", "Beta_Notes.md": "b\n", "Gamma_Notes.md": "c\n", "Delta_Notes.md": "d\n", "Omega_Notes.md": "e\n", "blocker": "a file, so no folder can be made here\n" });
const r8 = json(half), l8 = ledgerFrom(r8);
check("five moves planned", l8.entries.filter((e) => e.action === "move").length === 5, JSON.stringify(l8.entries));
l8.entries[2].to = "blocker/third.md"; // its folder cannot be made: the 3rd action fails
const halfBefore = snapshot(half);
const a8 = fc("--apply", writeLedger(l8, "half.json"));
check("the stopped run says so and names its journal", a8.code === 1 && a8.out.includes("stopped midway"), a8.out);
const u8 = fc("--undo");
check("undo after a stop midway is byte-identical", u8.code === 0 && u8.out.includes("undone: 2 steps") && sameSnap(halfBefore, snapshot(half)), `${u8.out}\n${JSON.stringify(snapshot(half))}`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
