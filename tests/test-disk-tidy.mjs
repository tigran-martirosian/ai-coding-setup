// node tests/test-disk-tidy.mjs
// Builds a made-up home, temp folder, projects folder and Nimbalyst folder under the system temp, runs
// workers/disk-tidy.mjs on them and checks what it reports, removes, archives and leaves; then the chat-archive
// part of hooks/pc-tidy-nudge.mjs (every 3 days, only after the person's yes). Real git for the worktrees.
process.env.HOOK_ERRORS_LOG = "off";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { normPath, under, globMatch, fmtBytes, cwdOf, isReplayLine } from "../workers/disk-tidy.mjs";

const WORKER = path.join(import.meta.dirname, "..", "workers", "disk-tidy.mjs");
const HOOK = path.join(import.meta.dirname, "..", "hooks", "pc-tidy-nudge.mjs");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "disk-tidy-test-"));
const HOME = path.join(T, "home"), TMP = path.join(T, "tmp"), APPDATA = path.join(T, "appdata"), ROOT = path.join(T, "projects");
const CL = path.join(HOME, ".claude"), PROJ = path.join(CL, "projects"), NIM = path.join(APPDATA, "@nimbalyst", "electron");
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
let failed = 0, passed = 0;
function check(name, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${String(detail).slice(0, 600)}`}`);
}
const ago = (days) => new Date(NOW - days * DAY);
function put(file, content, daysOld = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  fs.utimesSync(file, ago(daysOld), ago(daysOld));
}
function big(file, mb, daysOld) { put(file, ""); fs.truncateSync(file, mb * 1024 * 1024); fs.utimesSync(file, ago(daysOld), ago(daysOld)); }
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", DISK_TIDY_PROGRAM_DIRS: path.join(T, "no-programs") };
function sh(cwd, ...a) {
  const r = spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8", env: ENV });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
const GITLOG = path.join(T, "git.log");
const WRAP = path.join(T, "gitwrap.mjs");
fs.writeFileSync(WRAP, `import { spawnSync } from "node:child_process"; import fs from "node:fs";
const a = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(GITLOG)}, JSON.stringify(a) + "\\n");
if (a.includes("--force") || a.includes("-f")) { console.error("forced"); process.exit(9); }
const r = spawnSync("git", a, { stdio: "inherit" }); process.exit(r.status ?? 1);\n`);
const PS_YES = path.join(T, "ps-yes.txt"), PS_NO = path.join(T, "ps-no.txt");
fs.writeFileSync(PS_YES, "C:\\Windows\\explorer.exe\npython replay.py --agent worker --cases 4\n");
fs.writeFileSync(PS_NO, "C:\\Windows\\explorer.exe\nnode server.mjs\n");
function tidy(...a) {
  const ps = a.includes("--ps-file") ? [] : ["--ps-file", PS_NO];
  const sc = a.includes("--scanner") ? [] : ["--scanner", "node"];
  const r = spawnSync(process.execPath, [WORKER, "--home", HOME, "--tmp", TMP, "--appdata", APPDATA, "--roots", ROOT, "--now", new Date(NOW).toISOString(), "--git-wrapper", WRAP, ...ps, ...sc, ...a], { encoding: "utf8", env: ENV });
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}
const json = (...a) => { const r = tidy("--json", ...a); try { return JSON.parse(r.out); } catch { throw new Error(`--json gave no JSON: ${r.all}`); } };
const ex = (p) => fs.existsSync(p);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
// every file and folder with its size and times: the same before and after means nothing changed
function treeHash(dir, skip = []) {
  const h = crypto.createHash("sha256");
  const go = (d) => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      if (skip.some((s) => p.startsWith(s))) continue;
      const st = fs.lstatSync(p);
      h.update(`${p}|${st.size}|${st.mtimeMs}\n`);
      if (st.isDirectory()) go(p);
    }
  };
  go(dir);
  return h.digest("hex");
}

// ---- 8. path cases, Windows and macOS forms on any computer
const win = { platform: "win32", home: "C:\\Users\\someone" }, mac = { platform: "darwin", home: "/Users/someone" }, lin = { platform: "linux", home: "/home/someone" };
check("a python process running replay.py counts as a running replay",
  ["python replay.py --agent worker", "\"C:\\Python313\\python.exe\" tools\\setup-replay\\replay.py", "/usr/bin/python3.12 tools/setup-replay/replay.py", "py -3 replay.py"].every(isReplayLine));
check("a shell or grep that only names replay.py does not",
  ["\"C:\\Program Files\\Git\\bin\\bash.exe\" -c \"pgrep -af replay.py\"", "grep -n replay.py notes.md", "node server.mjs", ""].every((l) => !isReplayLine(l)));
check("windows: backslashes, case and trailing slash", normPath("C:\\Users\\Someone\\AppData\\Local\\Temp\\", win) === "c:/users/someone/appdata/local/temp");
check("windows: a Temp chat cwd is under the temp folder", under("C:\\Users\\someone\\AppData\\Local\\Temp\\cr-1", "c:/users/someone/appdata/local/temp", win));
check("windows: ~ expands to the home folder", normPath("~/.claude/scratch", win) === "c:/users/someone/.claude/scratch");
check("macOS: /private/var is /var", under("/private/var/folders/ab/T/cr-1", "/var/folders/ab/T", mac));
check("macOS: $HOME expands", normPath("$HOME/Projects/", mac) === "/Users/someone/Projects");
check("a name that only starts the same is not under it", !under("/tmp/ab", "/tmp/a", lin) && !under("C:/Projects/proj-old", "C:/Projects/proj", win));
check("linux paths keep their case", !under("/Home/someone/x", "/home/someone", lin));
check("keepForever glob: the folder and what is inside it", globMatch("C:/Projects/notes-lab*", "c:\\projects\\notes-lab\\notes", win) && !globMatch("C:/Projects/notes-lab", "C:/Projects/notes-laber", win));
check("keepForever glob on macOS", globMatch("~/Projects/*/research", "/Users/someone/Projects/a/research", mac) && !globMatch("~/Projects/*/research", "/Users/someone/Projects/a/b/research", mac));
check("cwd is read from the chat line", cwdOf(`{"type":"user","cwd":"C:\\\\Users\\\\someone\\\\AppData\\\\Local\\\\Temp\\\\cr-1"}`) === "C:\\Users\\someone\\AppData\\Local\\Temp\\cr-1");
check("sizes read plainly", fmtBytes(150 * 1024 * 1024) === "150 MB" && fmtBytes(14.1 * 1024 ** 3) === "14.1 GB");

// ---- the made-up computer
fs.mkdirSync(TMP, { recursive: true });
const tmpWin = TMP.replace(/\//g, "\\"); // the cwd as Windows writes it in a chat line
function chat(folder, id, cwd, daysOld, { side = false } = {}) {
  const lines = [
    { type: "summary", cwd, timestamp: ago(daysOld + 1).toISOString() },
    { type: "user", cwd, timestamp: ago(daysOld).toISOString(), message: { role: "user", content: `fix the thing in ${id}` } },
  ];
  const file = path.join(PROJ, folder, `${id}.jsonl`);
  put(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", daysOld);
  if (side) {
    put(path.join(PROJ, folder, id, "subagents", "agent-1.jsonl"), `{"cwd":${JSON.stringify(cwd)}}\n`, daysOld);
    put(path.join(PROJ, folder, id, "tool-results", "r1.txt"), "tool output ".repeat(500), daysOld);
  }
  return file;
}
const live = path.join(ROOT, "proj"), keeper = path.join(ROOT, "keeper");
fs.mkdirSync(keeper, { recursive: true });
chat("C--tmp-cr-1", "t1", `${tmpWin}\\setup-replay-wt\\abcd1234\\P01`, 5);   // 2: a setup test run, Windows form
chat("C--tmp-try-x", "x1", `${tmpWin}\\try-x`, 5);                            // the person's own work in temp: offered only
chat("gone", "g1", path.join(ROOT, "deleted-proj"), 5);                       // 3: its project folder is gone
chat("mem", "m1", `${tmpWin}\\cr-2`, 5); put(path.join(PROJ, "mem", "memory", "notes.md"), "a note", 5); // memory/: offered only
chat("fresh", "f1", `${tmpWin}\\cr-3`, 1);                                    // a day old: left
chat("named", "n1aaaa", `${tmpWin}\\cr-4`, 5);                                // a running Claude Code names it: left
put(path.join(CL, "sessions", "123.json"), JSON.stringify({ pid: 123, sessionId: "n1aaaa" }));
const c59 = chat("proj", "c59", live, 59, { side: true });
const c61 = chat("proj", "c61", live, 61, { side: true });
const c61bytes = fs.readFileSync(c61), c61side = fs.readFileSync(path.join(PROJ, "proj", "c61", "tool-results", "r1.txt"));
chat("proj", "c125", live, 125, { side: true });
chat("proj", "c61live", live, 61); put(path.join(CL, "sessions", "456.json"), JSON.stringify({ pid: 456, sessionId: "c61live" }));
put(path.join(PROJ, "proj", "memory", "MEMORY.md"), "remember", 100);
chat("keeper", "k125", keeper, 125);
put(path.join(CL, "settings.json"), JSON.stringify({ cleanupPeriodDays: 120 }));
// 4: the usage cache, 150 MB, unused for 10 days
big(path.join(CL, "reports", "usage-scan-cache.jsonl"), 150, 10);
// 5, 13: temp folders
put(path.join(TMP, "crash-log-abc", "x.log"), "old", 5);
put(path.join(TMP, "crash-log-new", "x.log"), "new", 0);
big(path.join(TMP, "n182", "blob.bin"), 120, 10);
put(path.join(TMP, "claude", "s1", "x.txt"), "claude code temp", 0);
// 9: scratch
put(path.join(CL, "scratch", "old20", "a.txt"), "old", 20);
put(path.join(CL, "scratch", "new3", "a.txt"), "new", 3);
put(path.join(CL, "scratch", "hooked", "a.txt"), "used by a hook", 20);
put(path.join(CL, "hooks", "uses-scratch.mjs"), `const dir = path.join(home, ".claude", "scratch/hooked");\n`);
// 17: video cache
put(path.join(CL, "video-cache", "v-old", "a.mp4"), "video", 40);
put(path.join(CL, "video-cache", "v-new", "a.mp4"), "video", 2);
// 14, 15: Nimbalyst
put(path.join(NIM, "app-settings.json"), JSON.stringify({ databaseMaintenance: { backupCopiesKept: 3 } }));
put(path.join(NIM, "sqlite-db.backups", "b1.db"), "backup one");
put(path.join(NIM, "sqlite-db.backups", "b2.db"), "backup two");
put(path.join(NIM, "sqlite-db", "data.db"), "database");
// 3, 6, 7, 8: a repo with worktrees
put(path.join(live, "README.md"), "proj\n"); put(path.join(live, ".gitignore"), "*.db\nnode_modules/\n");
sh(live, "init", "-q", "-b", "main"); sh(live, "add", "."); sh(live, "commit", "-q", "-m", "first");
const WT = {
  merged: path.join(ROOT, "proj_worktrees", "merged"),
  data: path.join(ROOT, "proj_worktrees", "data"),
  broken: path.join(ROOT, "proj_worktrees", "broken"),
  ahead: path.join(live, ".claude", "worktrees", "agent-a1"),
  dirty: path.join(ROOT, "proj_worktrees", "dirty"),
  gone: path.join(ROOT, "proj_worktrees", "gone"),
  replay: path.join(TMP, "setup-replay-wt", "abcd1234", "P01", "new", "0"),
};
sh(live, "worktree", "add", "-q", "-b", "merged", WT.merged); put(path.join(WT.merged, "node_modules", "x", "i.js"), "rebuilt by npm");
sh(live, "worktree", "add", "-q", "-b", "data", WT.data); put(path.join(WT.data, "runs.db"), "a git-ignored database"); // clean and merged, but holds data
sh(live, "worktree", "add", "-q", "-b", "broken", WT.broken); fs.rmSync(path.join(WT.broken, ".git")); fs.writeFileSync(path.join(WT.broken, ".git"), "gitdir: nowhere\n"); // git status fails here
sh(live, "worktree", "add", "-q", "-b", "agent-a1", WT.ahead);
put(path.join(WT.ahead, "more.txt"), "more"); sh(WT.ahead, "add", "."); sh(WT.ahead, "commit", "-q", "-m", "ahead");
sh(live, "worktree", "add", "-q", "-b", "dirty", WT.dirty); put(path.join(WT.dirty, "wip.txt"), "not committed");
sh(live, "worktree", "add", "-q", "-b", "gone", WT.gone); fs.rmSync(WT.gone, { recursive: true, force: true });
sh(live, "worktree", "add", "-q", "--detach", WT.replay);
// 10: old copies, 19: a folder named like an option
put(path.join(ROOT, "proj-old", "notes.txt"), "an old copy, no repo", 30);
const lib = path.join(ROOT, "lib");
put(path.join(lib, "a.txt"), "lib\n"); sh(lib, "init", "-q", "-b", "main"); sh(lib, "add", "."); sh(lib, "commit", "-q", "-m", "lib");
spawnSync("git", ["clone", "-q", lib, path.join(ROOT, "lib-old")], { env: ENV });
spawnSync("git", ["clone", "-q", lib, path.join(ROOT, "lib-backup")], { env: ENV }); put(path.join(ROOT, "lib-backup", "wip.txt"), "never committed\n");
put(path.join(ROOT, "lib-old", "b.txt"), "only here\n"); sh(path.join(ROOT, "lib-old"), "add", "."); sh(path.join(ROOT, "lib-old"), "commit", "-q", "-m", "only in the old copy");
put(path.join(ROOT, "--help", "data", "strains", "a.json"), "{}", 18);
const nimBefore = treeHash(NIM);
fs.mkdirSync(path.join(CL, "setup-logs")); // the ledger's folder: the one place a report writes

// ---- --report changes nothing
const skip = [path.join(CL, "setup-logs"), GITLOG];
const before = treeHash(T, skip);
const rep = tidy("--report");
check("--report runs", rep.code === 0, rep.all);
check("--report changes nothing", treeHash(T, skip) === before);
check("the report names the Nimbalyst copy count", /Nimbalyst backups: 3 copies/.test(rep.out), rep.out);
check("the report shows the replay worktrees and the setup leftovers", /replay worktrees, 1/.test(rep.out) && /test-run chat logs, 1/.test(rep.out) && /usage-scan cache, 1/.test(rep.out), rep.out);
check("the report offers the chat archive", /Chats older than 60 days: 3/.test(rep.out), rep.out);
check("a gone worktree folder is named, not touched", /folder already gone/.test(rep.out), rep.out);

const L = json();
const find = (pred) => L.items.find(pred);
// git names a worktree by its real path; T's path may hold a Windows 8.3 short name (RUNNER~1 on the CI runner)
const real = (p) => (fs.existsSync(p) ? fs.realpathSync.native(p) : p);
const samePath = (a, b) => normPath(real(a)) === normPath(real(b));
const byPath = (p) => find((i) => samePath(i.path, p));
check("the replay worktree is listed once, as a replay worktree", L.items.filter((i) => samePath(i.path, WT.replay)).map((i) => i.category).join() === "replay-worktree", JSON.stringify(L.items.filter((i) => samePath(i.path, WT.replay))));
check("test-run chats of a day ago and of a running session are not listed", !L.items.some((i) => /\/(fresh|named)$/.test(i.path)));
check("test-run chats with a memory/ folder are only offered", byPath(path.join(PROJ, "mem"))?.class === "P");
check("chats of a folder that still exists are not archived as gone", !byPath(path.join(PROJ, "proj")));
check("the dirty worktree is kept", /keep: 1 file not committed/.test(byPath(WT.dirty)?.reason || ""), JSON.stringify(byPath(WT.dirty)));
check("the worktree ahead of main is kept", /keep: 1 commit not on main/.test(byPath(WT.ahead)?.reason || ""));
check("the clean merged Nimbalyst worktree is offered, with the Nimbalyst reminder", byPath(WT.merged)?.action === "remove" && byPath(WT.merged).category === "nimbalyst-worktree" && /Nimbalyst/.test(byPath(WT.merged).reason));
check("scratch: the 3-day and the hook-named folders stay", byPath(path.join(CL, "scratch", "new3"))?.action === "keep" && /hook/.test(byPath(path.join(CL, "scratch", "hooked"))?.reason || ""));
check("scratch: the 20-day folder is offered", byPath(path.join(CL, "scratch", "old20"))?.action === "delete");
check("an old copy with a commit its project lacks is kept", /keep: 1 commit not in lib/.test(byPath(path.join(ROOT, "lib-old"))?.reason || ""), JSON.stringify(byPath(path.join(ROOT, "lib-old"))));
check("an old copy with no repo is offered to compare by hand, never as a delete", byPath(path.join(ROOT, "proj-old"))?.action === "look" && /compare by hand: no git history/.test(byPath(path.join(ROOT, "proj-old")).reason), JSON.stringify(byPath(path.join(ROOT, "proj-old"))));
check("an old copy with uncommitted work is kept", /keep: 1 file not committed/.test(byPath(path.join(ROOT, "lib-backup"))?.reason || ""), JSON.stringify(byPath(path.join(ROOT, "lib-backup"))));
check("a clean merged worktree with a git-ignored runs.db is kept and says why", byPath(WT.data)?.action === "keep" && /keep: 1 ignored file \(data\?\)/.test(byPath(WT.data).reason), JSON.stringify(byPath(WT.data)));
check("a worktree git cannot read is listed as kept and the scan goes on", /keep: git error/.test(byPath(WT.broken)?.reason || "") && byPath(WT.broken).action === "keep", JSON.stringify(byPath(WT.broken)));
check("chats of a person's own temp folder are only offered, with size and age", byPath(path.join(PROJ, "C--tmp-try-x"))?.class === "P" && /last used \d{4}-/.test(byPath(path.join(PROJ, "C--tmp-try-x")).reason), JSON.stringify(byPath(path.join(PROJ, "C--tmp-try-x"))));
check("a folder named --help is offered", byPath(path.join(ROOT, "--help"))?.category === "option-named");
check("big old temp of unknown maker is offered; Claude Code's temp is kept", byPath(path.join(TMP, "n182"))?.class === "P" && L.kept.some((k) => /Claude Code temp/.test(k.name)));
check("an unused video-cache entry is offered, a recent one is not", byPath(path.join(CL, "video-cache", "v-old")) && !byPath(path.join(CL, "video-cache", "v-new")));

// ---- --auto while a replay runs, then without
const a1 = tidy("--auto", "--ps-file", PS_YES);
check("--auto runs", a1.code === 0, a1.all);
check("with replay.py running no replay worktree is touched", ex(WT.replay));
check("and the reason is printed", /replay\.py is running/.test(a1.out), a1.out);
const after1 = JSON.parse(fs.readFileSync(path.join(CL, "setup-logs", `disk-tidy-${new Date(NOW).toISOString().slice(0, 10)}.json`), "utf8"));
const freedItems = after1.applied[0].results.filter((r) => /^deleted|^removed/.test(r.result)).map((r) => after1.items.find((i) => i.id === r.id));
const expected = freedItems.reduce((t, i) => t + i.bytes, 0);
check("the freed line gives the right total", new RegExp(`disk: freed ${fmtBytes(expected).replace(".", "\.")} of setup leftovers`).test(a1.out), `${fmtBytes(expected)} | ${a1.out}`);
check("--auto removes the test-run chats, the cache and the old setup temp", !ex(path.join(PROJ, "C--tmp-cr-1")) && !ex(path.join(CL, "reports", "usage-scan-cache.jsonl")) && !ex(path.join(TMP, "crash-log-abc")));
check("--auto leaves new setup temp, Claude Code temp and big temp of unknown maker", ex(path.join(TMP, "crash-log-new")) && ex(path.join(TMP, "claude")) && ex(path.join(TMP, "n182")));
check("--auto archives the chats of a deleted project", !ex(path.join(PROJ, "gone", "g1.jsonl")) && fs.readFileSync(path.join(HOME, ".claude-archive", "chats", "index.jsonl"), "utf8").includes('"id":"g1"') && /1 chat folder of deleted projects archived/.test(a1.out), a1.out);
check("--auto touches no item of the person's", [WT.merged, WT.dirty, WT.ahead, path.join(CL, "scratch", "old20"), path.join(ROOT, "proj-old"), path.join(PROJ, "mem"), path.join(ROOT, "--help")].every(ex));
check("--auto leaves the chats of a person's own temp folder", ex(path.join(PROJ, "C--tmp-try-x", "x1.jsonl")));
check("--auto archives no chat before the person's yes", ex(c61) && ex(path.join(PROJ, "proj", "c125.jsonl")));
check("--auto offers the person's own leftovers and the archive", /^offer: your own leftovers/m.test(a1.out) && /^offer: Chats older than 60 days/m.test(a1.out), a1.out);
const a2 = tidy("--auto");
check("with no replay running the replay worktree goes, and its empty folders", !ex(WT.replay) && !ex(path.join(TMP, "setup-replay-wt", "abcd1234")) && ex(path.join(TMP, "setup-replay-wt")), a2.all);
check("git worktree knows it is gone", !sh(live, "worktree", "list").includes("abcd1234"));
const a3 = tidy("--auto");
check("a second --auto with nothing new to clean prints only offers", !/^disk: freed/m.test(a3.out), a3.out);

// ---- --apply: only what was asked, re-checked first
const L2 = json();
const LEDGER = L2.ledgerFile;
const id = (p) => L2.items.find((i) => samePath(i.path, p))?.id;
put(path.join(CL, "scratch", "old20", "b.txt"), "touched after the report", 16); // newest file moves: the item changed
const ap = tidy("--apply", LEDGER, "--only", [id(WT.dirty), id(WT.ahead), id(WT.merged), id(path.join(CL, "scratch", "old20")), id(WT.data)].join(","));
check("the worktree holding ignored data stays even when its id is passed", ex(path.join(WT.data, "runs.db")) && /ignored file/.test(ap.out), ap.out);
check("--apply runs", ap.code === 0, ap.all);
check("the dirty worktree stays even when its id is passed", ex(WT.dirty) && /not committed/.test(ap.out), ap.out);
check("the worktree ahead of main stays even when its id is passed", ex(WT.ahead) && /not on main/.test(ap.out));
check("the clean merged worktree is removed, its branch kept", !ex(WT.merged) && sh(live, "branch", "--list", "merged").includes("merged"), ap.out);
check("an item changed after the report is skipped and named", ex(path.join(CL, "scratch", "old20")) && /changed since the report/.test(ap.out), ap.out);
check("git was never called with --force", !fs.readFileSync(GITLOG, "utf8").split("\n").some((l) => /"--force"|"-f"/.test(l)));
check("the ledger records what --apply did", JSON.parse(fs.readFileSync(LEDGER, "utf8")).applied?.some((a) => a.results.length === 5));
check("an id not in the ledger is refused", tidy("--apply", LEDGER, "--only", "W99").code === 1);
check("scratch/ itself is never removed", ex(path.join(CL, "scratch")));

// ---- the chat archive: only after the yes, 7 days below Claude Code's sweep, keep-forever kept
put(path.join(CL, "settings.json"), JSON.stringify({ cleanupPeriodDays: 30 }));
const on30 = tidy("--archive-on");
check("with cleanupPeriodDays 30 the tool refuses 60 and offers 23", on30.code === 3 && /--days 23/.test(on30.out) && !ex(path.join(CL, "disk-tidy.json")), on30.all);
fs.rmSync(path.join(CL, "settings.json"));
const onUnset = tidy("--archive-on");
check("with cleanupPeriodDays unset it counts Claude Code's default 30", onUnset.code === 3 && /unset, its default/.test(onUnset.out), onUnset.all);
put(path.join(CL, "settings.json"), JSON.stringify({ cleanupPeriodDays: 120 }));
const only1 = tidy("--auto", "--archive-only");
check("the archive step does nothing before the yes", only1.out === "" && ex(c61));
check("--keep-forever adds a project", tidy("--keep-forever", keeper).code === 0 && JSON.parse(fs.readFileSync(path.join(CL, "disk-tidy.json"), "utf8")).keepForever.length === 1);
check("--archive-on at 60 with cleanupPeriodDays 120", tidy("--archive-on").code === 0 && JSON.parse(fs.readFileSync(path.join(CL, "disk-tidy.json"), "utf8")).archive.afterDays === 60);
const arc = tidy("--auto", "--archive-only", "--note-file", path.join(T, "note.txt"));
const index = () => fs.readFileSync(path.join(HOME, ".claude-archive", "chats", "index.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const ids = index().map((r) => r.id);
check("the 61- and 125-day chats leave the live folder", !ex(c61) && !ex(path.join(PROJ, "proj", "c61")) && !ex(path.join(PROJ, "proj", "c125.jsonl")), arc.all);
check("the 59-day chat, the one a running session names and memory/ stay", ex(c59) && ex(path.join(PROJ, "proj", "c61live.jsonl")) && ex(path.join(PROJ, "proj", "memory", "MEMORY.md")));
const gz = path.join(HOME, ".claude-archive", "chats", "proj", "c61.jsonl.gz");
check("the archive copy reads back to the same sha256", ex(gz) && sha(zlib.gunzipSync(fs.readFileSync(gz))) === sha(c61bytes) && index().find((r) => r.id === "c61")?.sha256 === sha(c61bytes));
check("the session's own folder is archived too, each file gzipped", ex(path.join(HOME, ".claude-archive", "chats", "proj", "c61", "tool-results", "r1.txt.gz")));
check("an archived chat past cleanupPeriodDays is deleted from the archive", ids.includes("c61") && !ids.includes("c125") && !ex(path.join(HOME, ".claude-archive", "chats", "proj", "c125.jsonl.gz")), ids.join(","));
check("a keep-forever project's chat past 120 days stays in the archive", ids.includes("k125") && !ex(path.join(PROJ, "keeper", "k125.jsonl")));
check("the archive step writes its one line for the hook", /archived 3 chats older than 60 days/.test(fs.readFileSync(path.join(T, "note.txt"), "utf8")) && /deleted 1 archived chat past 120 days/.test(arc.out), arc.out);
check("--archive-list finds a chat by project", /c61\s/.test(tidy("--archive-list", "--project", "proj").out));
// a run stopped after the copy and the delete but before the index line (as the old end-of-run index left it)
const IDX = path.join(HOME, ".claude-archive", "chats", "index.jsonl");
fs.writeFileSync(IDX, index().filter((r) => r.id !== "c61").map((r) => `${JSON.stringify(r)}\n`).join(""));
const healed = tidy("--archive-list", "--project", "proj");
check("an archived chat with no index row is found again, its row rebuilt from the archive", /c61\s/.test(healed.out) && index().find((r) => r.id === "c61")?.sha256 === sha(c61bytes) && index().find((r) => r.id === "c61").files.length === 3, healed.all);
const rs = tidy("--restore", "c61");
check("--restore brings the exact bytes back", rs.code === 0 && ex(c61) && sha(fs.readFileSync(c61)) === sha(c61bytes) && sha(fs.readFileSync(path.join(PROJ, "proj", "c61", "tool-results", "r1.txt"))) === sha(c61side), rs.all);
check("--restore sets the file time to now", Math.abs(fs.statSync(c61).mtimeMs - NOW) < 2000);
check("--restore takes it out of the archive", !index().some((r) => r.id === "c61") && !ex(gz));
check("--restore with no match fails clearly", /no archived chat matches/.test(tidy("--restore", "zzz").err));

// ---- Nimbalyst: read, never written
check("no file under the Nimbalyst folder changed", treeHash(NIM) === nimBefore);
put(path.join(NIM, "app-settings.json"), JSON.stringify({ theme: "dark" }));
check("with no copies setting the report says Nimbalyst's default 2", /Nimbalyst backups: 2 copies/.test(tidy("--report").out));

// ---- scanner and the time cap
// PATH cut to the folders that hold git and no scanner: auto must fall back to the Node walker
const onPath = (d, n) => ex(path.join(d, n)) || ex(path.join(d, `${n}.exe`));
const PATH_KEY = Object.keys(ENV).find((k) => k.toUpperCase() === "PATH");
const noScanPath = String(ENV[PATH_KEY]).split(path.delimiter).filter((d) => onPath(d, "git") && !["gdu", "gdu-go", "dust"].some((n) => onPath(d, n))).join(path.delimiter);
const ns = spawnSync(process.execPath, [WORKER, "--home", HOME, "--tmp", TMP, "--appdata", APPDATA, "--roots", ROOT, "--now", new Date(NOW).toISOString(), "--git-wrapper", WRAP, "--ps-file", PS_NO,
  "--report", "--scanner", "auto", "--timeout-per-folder", "0"], { encoding: "utf8", env: { ...ENV, [PATH_KEY]: noScanPath } });
const noScan = { code: ns.status, out: ns.stdout, all: ns.stdout + ns.stderr };
check("no scanner on PATH: the Node walker", noScanPath !== "" && noScan.code === 0 && /scanner: node/.test(noScan.out), noScan.all);
check("a folder over the time cap is reported with ≥", /≥ /.test(noScan.out), noScan.out);

// ---- the hook: the archive at most every 3 days, only after the yes, one line when something was archived
const HH = path.join(T, "hook-home");
const HSTATE = path.join(HH, ".claude", "hooks", "state", "pc-tidy-nudge");
const MARK = path.join(T, "worker-ran.txt");
put(path.join(HH, ".claude", "workers", "disk-tidy.mjs"), `import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(MARK)}, process.argv.slice(2).join(" ") + "\\n");
const i = process.argv.indexOf("--note-file"); fs.writeFileSync(process.argv[i + 1], "disk: archived 2 chats older than 60 days");\n`);
function hook(prompt = "hello") {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ prompt }), encoding: "utf8",
    env: { ...process.env, HOME: HH, USERPROFILE: HH, CLAUDE_CODE_ENTRYPOINT: "cli", PC_TIDY_NUDGE: "" } });
  return r.stdout;
}
function ran() { // the worker runs detached: wait up to 5 s for its mark
  for (const end = Date.now() + 5000; Date.now() < end;) { if (ex(MARK)) return true; spawnSync(process.execPath, ["-e", "setTimeout(()=>{},100)"]); }
  return false;
}
const runs = () => (ex(MARK) ? fs.readFileSync(MARK, "utf8").split("\n").filter(Boolean).length : 0);
const cfg = (c) => put(path.join(HH, ".claude", "disk-tidy.json"), JSON.stringify(c));
hook();
spawnSync(process.execPath, ["-e", "setTimeout(()=>{},800)"]);
check("hook: no archive before the person said yes", !ex(MARK));
cfg({ archive: { off: true, since: "2026-11-10" } }); hook();
spawnSync(process.execPath, ["-e", "setTimeout(()=>{},800)"]);
check("hook: no archive when it was turned off", !ex(MARK));
cfg({ archive: { afterDays: 60, since: "2026-11-10" } });
check("hook: the archive runs quietly once it is on", hook() === "" && ran() && /--auto --archive-only/.test(fs.readFileSync(MARK, "utf8")));
for (const end = Date.now() + 5000; !ex(path.join(HSTATE, "disk-archive-note.txt")) && Date.now() < end;) spawnSync(process.execPath, ["-e", "setTimeout(()=>{},100)"]);
const shown = hook();
check("hook: the next prompt shows the archive's one line, once", /archived 2 chats/.test(JSON.parse(shown || "{}").systemMessage || "") && hook() === "", shown);
check("hook: not again within 3 days", runs() === 1);
put(path.join(HSTATE, "disk-archive.json"), JSON.stringify({ ranAt: Date.now() - 2.9 * DAY }));
hook(); spawnSync(process.execPath, ["-e", "setTimeout(()=>{},800)"]);
check("hook: 2.9 days after the last run it still waits", runs() === 1);
put(path.join(HSTATE, "disk-archive.json"), JSON.stringify({ ranAt: Date.now() - 3.1 * DAY }));
hook();
for (const end = Date.now() + 5000; runs() < 2 && Date.now() < end;) spawnSync(process.execPath, ["-e", "setTimeout(()=>{},100)"]);
check("hook: 3 days after the last run it runs again", runs() === 2);
check("hook: a /command does not start it", (() => { put(path.join(HSTATE, "disk-archive.json"), JSON.stringify({ ranAt: 0 })); hook("/disk-tidy"); spawnSync(process.execPath, ["-e", "setTimeout(()=>{},800)"]); return runs() === 2; })());
// a failed run: the 3-day clock does not start, and the next prompt says so once
put(path.join(HH, ".claude", "workers", "disk-tidy.mjs"), `console.error("disk-tidy: the archive folder is read-only"); process.exit(1);\n`);
fs.rmSync(path.join(HSTATE, "disk-archive-note.txt"), { force: true });
put(path.join(HSTATE, "disk-archive.json"), JSON.stringify({ ranAt: Date.now() - 3.1 * DAY }));
hook();
for (const end = Date.now() + 5000; !ex(path.join(HSTATE, "disk-archive-note.txt")) && Date.now() < end;) spawnSync(process.execPath, ["-e", "setTimeout(()=>{},100)"]);
const failNote = hook();
check("hook: a failed archive run saves no new ranAt and the next prompt shows the failure once",
  JSON.parse(fs.readFileSync(path.join(HSTATE, "disk-archive.json"), "utf8")).ranAt < Date.now() - 3 * DAY && /archive run failed \(disk-tidy: the archive folder is read-only\)/.test(JSON.parse(failNote || "{}").systemMessage || "") && hook() === "", failNote);

// leave nothing behind (wait for a detached worker still writing its note)
spawnSync(process.execPath, ["-e", "setTimeout(()=>{},500)"]);
fs.rmSync(T, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
