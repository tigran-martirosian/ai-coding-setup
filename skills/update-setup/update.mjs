#!/usr/bin/env node
// Brings an installed setup up to the newest released version.
//   node update.mjs                  check, and if a newer version is out: download it and install it
//   node update.mjs --check          only say whether a newer version is out
//   node update.mjs --replace <file> take this version's copy of one of the setup's files the user
//                                    changed (hooks/sql-guard.mjs; a dated copy is kept), and
//   --replace-all                    of every such file. With nothing newer out, these and the two below
//                                    run the installed version's installer again with them.
//   --leave-out "<lead>"             leave the shipped rule with this lead out of ~/.claude/CLAUDE.md from
//   --put-back "<lead>"              now on, or take it back (passed on to install.mjs)
//   --keep-model                     keep (or put back) "model": "sonnet" when the update would move an
//                                    install from before 1.0.74 to opus at medium effort
//   --keep-home-model                keep (or put back) "model": "sonnet" in the quick-tasks folder, which the
//                                    update moves to opus once (passed on to install.mjs)
//   --files-only                     the self-install hooks/update-check.mjs starts, for releases that are all
//                                    `kind: files` or `nimbalyst` in version.json `releases`: downloads the tag as below, checks
//                                    those labels for every missed changelog line, then runs its install.mjs
//                                    --files-only (the hook, skill, agent and worker files still as the setup
//                                    last wrote them, and the record of them; no settings, plugins, extensions,
//                                    rules or project folder files written; the cleanup of what earlier versions left still moves their copies beside files, in ~/.claude and
//                                    the two project folders, into setup-logs), asks nothing, writes its result to ~/.claude/update-check.json
//                                    `auto` ({version, from, headline, at, ok, error, kept: the files left as the
//                                    user's}) and frees the hook's lock, ~/.claude/update-auto.lock
//   --quiet                          the self-install for releases that ask the person nothing: every missed one must be
//                                    `kind: files`, `nimbalyst` or `quiet`. Runs the tag's full install.mjs unseen (output
//                                    captured as --files-only does; extensions built aside, scripts/extensions.mjs, and
//                                    swapped in only while Nimbalyst is closed). Claude Code is only checked against
//                                    claudeCodeMin (its own update fails while Claude runs); below it nothing is
//                                    installed. No pending question is asked and no offer follows. With panels waiting
//                                    it runs deliver.mjs --stage, then --wait, so staged.json is final. `auto` as above
//                                    plus extFailed (the extensions whose build failed) and panels: null (no panel
//                                    changed), "in" (in now), "at-close" (waiting, staged.json has atClose: true, so
//                                    Nimbalyst's close puts them in) or "waiting" (until /update-setup)
//   --extensions yes|no              with --quiet: passed on to install.mjs (tests)
//   --backup yes|no                 only put the answer to the backup question on record (setup-state.json `backup`),
//                                    so it is not asked again; nothing else runs
//   --auto-mode yes|no              only put the answer to the auto mode question on record (setup-state.json
//                                    `autoMode`), so it is not asked again; nothing else runs
//   --home <folder>                  work on <folder>/.claude instead of the home folder's (tests)
// The opt-ins, after a foreground run (not --check, not --files-only): Handy is never asked here; with no answer on
// record and Handy found on this computer, `handy: true` goes on record without a word. The backup gets one line
// for the skill, from setup-state.json `backup` and the backup's folder (CLAUDE_BACKUP_HOME, else ~/.claude-backup).
// With no answer on record and config.json there (/backup was run without the question), `backup: true` goes on
// record the same way. Then: `Backup: not asked` (no answer yet, no config.json), `Backup: setup not finished,
// /backup finishes it` (yes, no config.json),
// `Backup: last run failed: <error>; /backup shows why` (last-run.json `ok: false`) or `Backup: last good run <n>
// days ago; /backup now runs one` (more than 7 days ago); nothing otherwise, and nothing for a no with no config.json.
// Auto mode (Nimbalyst's per-project "Agent-verified" permission) gets `Auto mode: not asked` while no answer is on
// record; nothing once there is one.
// How: the newest version is the one in version.json on the repository's main branch. Its files are
// the tag v<version>, downloaded as one archive and unpacked to ~/.claude/setup-source/v<version>.
// Then that folder's install.mjs runs. It takes the projects folder, the answer about Codex
// and Node from ~/.claude/setup-state.json, so nothing is asked again, and it only writes the setup's
// own files: anything else in ~/.claude (other skills, hooks, settings) stays as it is, and so does
// one of the setup's files that the user changed (the installer lists those at the end).
// A run by hand (not --check) stops while a self-install holds ~/.claude/update-auto.lock, so two never run at once.
// A failed download changes nothing. An install that fails part way says so; running the update again finishes it.
// Nimbalyst, delivered by the setup (scripts/nimbalyst-patch/deliver.mjs): after an install, deliver.mjs --stage starts
// (NIMBALYST_FOLLOW=off, in the environment or settings.json's env, stops that); on the newest version it starts again
// when nothing is staged or the last attempt failed (the retry); every run but
// --files-only prints the one `nimbalyst:` line of deliver.mjs --status. --files-only does neither: the hook that
// started it starts the stage when it says the result. `kind: nimbalyst` releases install with --files-only too.
// SETUP_UPDATE_BASE points it at another address that serves version.json and v<version>.tar.gz (tests).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readChangelog } from "../../hooks/lib/changelog.mjs";

const setupModule = (folder, name) => { // the pieces shared with install.mjs, from a setup folder
  const file = path.join(folder, "scripts", name);
  if (!fs.existsSync(file))
    stop(
      `the setup's folder (${fwd(folder)}) has no scripts/${name}; run the install from the downloaded setup again.`,
    );
  return import(pathToFileURL(file).href);
};

const REPO_URL = "https://github.com/tigran-martirosian/ai-coding-setup"; // where this setup is published
const BASE = process.env.SETUP_UPDATE_BASE;
const VERSION_URL = BASE
  ? `${BASE}/version.json`
  : `${REPO_URL.replace("github.com", "raw.githubusercontent.com")}/main/version.json`;
const archiveUrl = (v) =>
  BASE ? `${BASE}/v${v}.tar.gz` : `${REPO_URL}/archive/refs/tags/v${v}.tar.gz`;

const args = process.argv.slice(2);
const homeAt = args.indexOf("--home");
const home = homeAt === -1 ? os.homedir() : path.resolve(args[homeAt + 1]);
const CLAUDE = path.join(home, ".claude");
const AUTO_LOCK = path.join(CLAUDE, "update-auto.lock"); // held by a self-install (hooks/update-check.mjs)
const fwd = (p) => p.replace(/\\/g, "/");
const FILES_ONLY = args.includes("--files-only");
const QUIET = args.includes("--quiet");
// the two self-installs the hook starts: nobody watches them
const UNSEEN = FILES_ONLY || QUIET;
// --files-only and --quiet: the result goes to update-check.json `auto`, where the hook says it once; the hook's own
// `autoRun` (a self-install under way) goes
const auto = { version: null, from: null, headline: "" };
function recordAuto(result) {
  const file = path.join(CLAUDE, "update-check.json");
  let kept = {};
  if (fs.existsSync(file)) {
    try {
      kept = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      console.log(
        `${fwd(file)} was not valid JSON (${e.message}); it is written anew.`,
      );
    }
  }
  // stopped before version.json was read: the version the hook started this for
  if (result)
    kept.auto = {
      ...auto,
      version: auto.version || kept.autoRun?.version || null,
      at: new Date().toISOString(),
      ...result,
    };
  delete kept.autoRun;
  fs.writeFileSync(`${file}.part`, JSON.stringify(kept));
  fs.renameSync(`${file}.part`, file);
  fs.rmSync(AUTO_LOCK, { force: true });
}
const stop = (why) => {
  console.log(`Update stopped: ${why}`);
  if (UNSEEN && fs.existsSync(CLAUDE))
    recordAuto({ ok: false, error: why });
  process.exit(1);
};
// --files-only and --quiet run unseen: anything thrown outside stop() (a locked folder, a broken setup-state.json)
// still goes on record with its own message, instead of the hook's "did not finish" much later
if (UNSEEN) {
  const crashed = (e) => {
    try {
      stop(`${e?.code ? `${e.code} ` : ""}${e?.message || e}`);
    } catch (inner) {
      console.log(
        `Update stopped: ${e?.message || e}; its result could not be recorded either: ${inner.message}`,
      );
      process.exit(1);
    }
  };
  process.on("uncaughtException", crashed);
  process.on("unhandledRejection", crashed);
}
if (FILES_ONLY && QUIET) stop("--files-only and --quiet: give one of them.");
// A run by hand that writes (not --check) stops while a self-install holds the hook's lock: both use the same
// setup-source folders and install.mjs writes the same files. The hook frees a lock left by a run that died.
if (!UNSEEN && !args.includes("--check") && fs.existsSync(AUTO_LOCK))
  stop(
    `an update is installing itself right now (${fwd(AUTO_LOCK)} is there); try again in a few minutes.`,
  );
const extAt = args.indexOf("--extensions");
const extAnswer = extAt === -1 ? null : args[extAt + 1] || "";
if (extAt !== -1 && (!QUIET || !["yes", "no"].includes(extAnswer)))
  stop(
    `--extensions ${extAnswer}: it goes with --quiet, and the answer is yes or no.`,
  );
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) =>
    String(v || "0")
      .split(".")
      .map(Number),
  );
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
// Reads an address, following redirects. Not fetch: on Windows, Node can crash when a process ends
// right after one.
const get = (url, ms, hops = 5) =>
  new Promise((resolve, reject) => {
    const req = (url.startsWith("https:") ? https : http).get(
      url,
      { timeout: ms, headers: { "user-agent": "setup-update" } },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location &&
          hops > 0
        ) {
          res.resume();
          const next = new URL(res.headers.location, url).href;
          // never from https down to plain http
          if (url.startsWith("https:") && !next.startsWith("https:"))
            return reject(new Error(`redirect to ${next} is not https`));
          return resolve(get(next, ms, hops - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const parts = [];
        res.on("data", (d) => parts.push(d));
        res.on("end", () => resolve(Buffer.concat(parts)));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("no answer in time")));
    req.on("error", reject);
  });

const stateFile = path.join(CLAUDE, "setup-state.json");
if (!fs.existsSync(stateFile))
  stop(
    `${fwd(stateFile)} is missing, so this setup was not put in place by install.mjs. Download ${REPO_URL} and run its install once.`,
  );
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const installed = state.version || "0";
auto.from = installed;
// the installed version's folder is what a changed extension is told by; without it every one would count as changed
if (
  FILES_ONLY &&
  (!state.repo || !fs.existsSync(path.join(state.repo, "install.mjs")))
)
  stop(
    `the setup's folder (${state.repo || "none on record"}) is gone, so a change to the extensions can't be told; /update-setup installs it.`,
  );
const saveState = (next) =>
  fs.writeFileSync(stateFile, JSON.stringify(next, null, 2) + "\n");
// --backup yes|no: the answer to the backup question, on record so it is never asked again; nothing else runs
if (args.includes("--backup")) {
  const said = args[args.indexOf("--backup") + 1];
  if (!["yes", "no"].includes(said))
    stop(`--backup ${said || ""}: the answer is yes or no.`);
  saveState({ ...state, backup: said === "yes" });
  console.log(`backup: answer on record (${said}); not asked again`);
  process.exit(0);
}

// --auto-mode yes|no: the answer to the auto mode question, on record so it is never asked again; nothing else runs
if (args.includes("--auto-mode")) {
  const said = args[args.indexOf("--auto-mode") + 1];
  if (!["yes", "no"].includes(said))
    stop(`--auto-mode ${said || ""}: the answer is yes or no.`);
  saveState({ ...state, autoMode: said === "yes" });
  console.log(`auto mode: answer on record (${said}); not asked again`);
  process.exit(0);
}

// The opt-ins after a foreground run (header): Handy found goes on record unasked, the backup gets its one line.
// Handy is looked for where its installer and its first start put it; with --home (tests) only inside that home.
function handyFound() {
  const inHome = homeAt !== -1;
  const places =
    process.platform === "darwin"
      ? [
          path.join(home, "Library", "Application Support", "com.pais.handy"),
          ...(inHome ? [] : ["/Applications/Handy.app"]),
        ]
      : [
          [
            inHome
              ? path.join(home, "AppData", "Roaming")
              : process.env.APPDATA,
            "com.pais.handy",
          ],
          [
            inHome
              ? path.join(home, "AppData", "Local")
              : process.env.LOCALAPPDATA,
            "Handy",
            "handy.exe",
          ],
        ]
          .filter(([dir]) => dir)
          .map((parts) => path.join(...parts));
  return places.some((p) => fs.existsSync(p));
}
const DAY_MS = 24 * 60 * 60 * 1000;
const backupDir = () =>
  process.env.CLAUDE_BACKUP_HOME
    ? path.resolve(process.env.CLAUDE_BACKUP_HOME)
    : path.join(home, ".claude-backup");
function backupLine(answer) {
  const dir = backupDir();
  if (typeof answer !== "boolean") return "Backup: not asked";
  if (!fs.existsSync(path.join(dir, "config.json")))
    return answer ? "Backup: setup not finished, /backup finishes it" : null;
  const lastFile = path.join(dir, "last-run.json");
  if (!fs.existsSync(lastFile)) return null;
  let last;
  try {
    last = JSON.parse(fs.readFileSync(lastFile, "utf8"));
  } catch (e) {
    return `Backup: ${fwd(lastFile)} could not be read (${e.message}); /backup shows why`;
  }
  const at = Date.parse(last?.time);
  if (typeof last?.ok !== "boolean" || Number.isNaN(at))
    return `Backup: ${fwd(lastFile)} has no ok (true or false) and time of the last run; /backup shows why`;
  if (!last.ok)
    return `Backup: last run failed: ${last.error || "no error recorded"}; /backup shows why`;
  if (Date.now() - at > 7 * DAY_MS)
    return `Backup: last good run ${Math.floor((Date.now() - at) / DAY_MS)} days ago; /backup now runs one`;
  return null;
}
function optIns() {
  const now = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  let next = now;
  if (typeof next.handy !== "boolean" && handyFound())
    next = { ...next, handy: true };
  // /backup run without the question: its config.json is the yes
  if (
    typeof next.backup !== "boolean" &&
    fs.existsSync(path.join(backupDir(), "config.json"))
  )
    next = { ...next, backup: true };
  if (next !== now) saveState(next);
  const line = backupLine(next.backup);
  if (line) console.log(line);
  if (typeof next.autoMode !== "boolean") console.log("Auto mode: not asked");
}

// Runs a version's installer with the flags that are passed on
// A foreground update ends with the setup's own leftovers cleaned (workers/disk-tidy.mjs --auto): its `disk:` and
// `offer:` lines are passed on as they are. Not with --home (tests): the tool would look at this computer's temp folder.
function diskTidy() {
  const worker = path.join(CLAUDE, "workers", "disk-tidy.mjs");
  if (homeAt !== -1) return;
  if (!fs.existsSync(worker)) {
    console.log(
      `disk: not checked (${fwd(worker)} is missing; the installer puts it there)`,
    );
    return;
  }
  const r = spawnSync(process.execPath, [worker, "--auto"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.stdout.trim()) console.log(r.stdout.trim());
  if (r.status !== 0)
    console.log(
      `disk: the cleanup stopped: ${(r.stderr || "").trim().split("\n")[0] || `exit ${r.status}`}`,
    );
}
// The programs the setup uses (workers/update-tools.mjs --budget 15: plugins, the setup's global npm packages,
// yt-dlp, winget programs), under a `Programs:` heading, after a foreground run that is not --check (on the newest
// version only a plain run, none of the flags passed on to install.mjs). UPDATE_TOOLS=off turns it off. A failure
// there is said in one `Programs failed:` line with the retry command and does not fail the update. Not with
// --home (tests): it would update this computer's programs.
const TOOLS_BUDGET_MIN = 15;
function programs() {
  const worker = path.join(CLAUDE, "workers", "update-tools.mjs");
  if (homeAt !== -1) return;
  if (!fs.existsSync(worker)) {
    console.log(
      `Programs: not updated (${fwd(worker)} is missing; the installer puts it there)`,
    );
    return;
  }
  const r = spawnSync(
    process.execPath,
    [worker, "--budget", String(TOOLS_BUDGET_MIN)],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: (TOOLS_BUDGET_MIN + 1) * 60 * 1000,
    },
  );
  console.log("Programs:");
  for (const line of `${r.stdout || ""}${r.stderr || ""}`.split(/\r?\n/))
    if (line.trim()) console.log(`  ${line}`);
  if (r.status !== 0)
    console.log(
      `Programs failed: ${r.error ? `update-tools.mjs ${r.error.code === "ETIMEDOUT" ? `did not end within ${TOOLS_BUDGET_MIN + 1} minutes` : `could not run (${r.error.message})`}` : "see FAILED above"}; the setup itself is updated. Retry: node ~/.claude/workers/update-tools.mjs`,
    );
}
// Then the file reorganize offer (file-upkeep's file-check.mjs --status --homes): its last `offer:` line is passed on as
// `files-offer:`, so the skill can tell it from the disk offer; `offer: none` prints nothing. With --home it looks at that home.
function filesOffer() {
  const checker = path.join(CLAUDE, "skills", "file-upkeep", "file-check.mjs");
  if (!fs.existsSync(checker)) {
    console.log(
      `files: not checked (${fwd(checker)} is missing; the installer puts it there)`,
    );
    return;
  }
  const r = spawnSync(
    process.execPath,
    [
      checker,
      "--status",
      "--homes",
      ...(homeAt !== -1 ? ["--home", home] : []),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (r.status !== 0) {
    console.log(
      `files: the check stopped: ${(r.stderr || r.stdout || "").trim().split("\n").at(-1) || `exit ${r.status}`}`,
    );
    return;
  }
  const offer = (r.stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.startsWith("offer:"))
    .at(-1);
  if (offer && !offer.startsWith("offer: none")) console.log(`files-${offer}`);
}
// The project pass level the stamp holds (install.mjs writes version.json's projectPass there); none yet is 0. When
// the install raised it and folders are behind (skills/update-project/pass.mjs --list), one line for the skill's card:
// `project-pass: level <old> → <new>, <n> folders behind`.
const passStamp = path.join(CLAUDE, "project-pass.json");
const passLevelNow = () =>
  fs.existsSync(passStamp)
    ? JSON.parse(fs.readFileSync(passStamp, "utf8")).level || 0
    : 0;
function passOffer(old) {
  const now = passLevelNow();
  if (now <= old) return;
  const script = path.join(CLAUDE, "skills", "update-project", "pass.mjs");
  if (!fs.existsSync(script)) {
    console.log(
      `project-pass: not checked (${fwd(script)} is missing; the installer puts it there)`,
    );
    return;
  }
  const r = spawnSync(
    process.execPath,
    [script, "--list", ...(homeAt !== -1 ? ["--home", home] : [])],
    { encoding: "utf8", windowsHide: true },
  );
  const behind = (r.stdout || "").match(
    /^project-pass list · \d+ folders · (\d+) behind/m,
  );
  if (r.status !== 0 || !behind) {
    console.log(
      `project-pass: the list stopped: ${(r.stdout || r.stderr || "").trim().split(/\r?\n/).at(-1) || `exit ${r.status}`}`,
    );
    return;
  }
  if (Number(behind[1]))
    console.log(
      `project-pass: level ${old} → ${now}, ${behind[1]} folders behind`,
    );
}
// Nimbalyst's delivery: deliver.mjs --stage runs and returns within seconds (it hands a download or an install to
// a run of its own, so the update never waits for one, and its status is up to date when it returns); then the
// `nimbalyst:` status line is passed on as it is. `stage: "always"` stages after an install; `stage: "retry"` (on
// the newest version) stages only when the line says nothing is staged or the last attempt failed.
const DELIVER = path.join(CLAUDE, "scripts", "nimbalyst-patch", "deliver.mjs");
// Starts deliver.mjs --stage unless NIMBALYST_FOLLOW=off; returns whether it ran
function runStage() {
  const file = path.join(CLAUDE, "settings.json");
  const offIn = (v) => String(v || "").toLowerCase() === "off";
  let off;
  try {
    off =
      offIn(process.env.NIMBALYST_FOLLOW) ||
      (fs.existsSync(file) &&
        offIn(JSON.parse(fs.readFileSync(file, "utf8")).env?.NIMBALYST_FOLLOW));
  } catch (e) {
    console.log(
      `Nimbalyst update not started: ${fwd(file)} could not be read (${e.message}).`,
    );
    return false;
  }
  if (off) return false;
  // its failures go to its status.json, which the line below says; a start that fails is said here
  const r = spawnSync(process.execPath, [DELIVER, "--stage"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 120 * 1000,
  });
  if (r.error)
    console.log(
      `Nimbalyst update not started: deliver.mjs --stage ${r.error.code === "ETIMEDOUT" ? "did not return within 2 minutes" : `could not run (${r.error.message})`}.`,
    );
  return true;
}
// --quiet: where the panels the run built stand. null: no panel changed; "in": in now (Nimbalyst was closed);
// "at-close": waiting, and staged.json has atClose: true, so Nimbalyst's close listener puts them in; "waiting":
// until /update-setup. Waiting panels get deliver.mjs --stage (it keeps a marker job when the close listener is
// there) and then --wait, which returns once a --stage-work it handed off has ended, so staged.json is final when
// read. Its folder is deliver.mjs's dataDir(): NIMBALYST_DELIVER_DATA, else %LOCALAPPDATA%\ai-coding-setup\nimbalyst
// (Windows only; elsewhere nothing is staged).
function panelsState({ installed, waiting }) {
  if (!waiting.length) return installed.length ? "in" : null;
  if (!fs.existsSync(DELIVER)) {
    console.log(
      `panels: not staged (${fwd(DELIVER)} is missing; the installer puts it there)`,
    );
    return "waiting";
  }
  if (process.platform !== "win32") {
    console.log(
      "panels: waiting for /update-setup (the close listener and deliver.mjs are Windows-only)",
    );
    return "waiting";
  }
  if (!runStage()) return "waiting";
  const w = spawnSync(process.execPath, [DELIVER, "--wait"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 11 * 60 * 1000,
  });
  if (w.status !== 0) {
    console.log(
      `panels: deliver.mjs --wait ${w.error ? `could not run (${w.error.message})` : `ended with exit ${w.status}`}, so the staged job is not known`,
    );
    return "waiting";
  }
  const data = process.env.NIMBALYST_DELIVER_DATA
    ? path.resolve(process.env.NIMBALYST_DELIVER_DATA)
    : process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "ai-coding-setup", "nimbalyst");
  const file = data && path.join(data, "staged.json");
  if (!file || !fs.existsSync(file)) return "waiting";
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).atClose === true
      ? "at-close"
      : "waiting";
  } catch (e) {
    console.log(`panels: ${fwd(file)} could not be read (${e.message})`);
    return "waiting";
  }
}
function nimbalyst({ stage }) {
  if (!fs.existsSync(DELIVER)) {
    console.log(
      `nimbalyst: not checked (${fwd(DELIVER)} is missing; the installer puts it there)`,
    );
    return;
  }
  const status = () => {
    const r = spawnSync(process.execPath, [DELIVER, "--status"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const line = (r.stdout || "")
      .split(/\r?\n/)
      .filter((l) => l.startsWith("nimbalyst: "))
      .at(-1);
    return (
      line ||
      `nimbalyst: the status check stopped: ${(r.stderr || r.stdout || "").trim().split(/\r?\n/).at(-1) || `exit ${r.status}`}`
    );
  };
  let line = null;
  if (stage === "always") runStage();
  else if (
    stage === "retry" &&
    /^nimbalyst: (not staged|failed:)/.test((line = status())) &&
    runStage()
  )
    line = null;
  console.log(line || status());
}
const passed = args.flatMap((a, i) =>
  [
    "--replace-all",
    "--keep-model",
    "--keep-home-model",
    "--theme-done",
  ].includes(a)
    ? [a]
    : ["--replace", "--language", "--leave-out", "--put-back"].includes(a) &&
        args[i + 1]
      ? [a, args[i + 1]]
      : [],
);
// The phone add-on's voice notes, as install.mjs does them, on a run that does not start the installer: when the
// add-on is in place and voice is not set up (no ~/.phone-app/voice.json), its speech model downloads in the
// background, nothing asked. `dry` (--check) only says so. Not with --home.
function phoneVoice(dry) {
  const setup = path.join(CLAUDE, "skills", "phone-bot", "pc", "setup.mjs");
  if (homeAt !== -1 || !fs.existsSync(setup)) return;
  if (fs.existsSync(path.join(home, ".phone-app", "voice.json"))) return;
  if (dry)
    return console.log(
      `phone voice: would start its setup in the background: node ${fwd(setup)} voice --background`,
    );
  const r = spawnSync(process.execPath, [setup, "voice", "--background"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0)
    console.log(
      `phone voice: its setup did not start (${(r.stderr || r.stdout || String(r.error)).trim().split("\n").pop()}). Run: node ${fwd(setup)} voice`,
    );
  else console.log(`phone voice: ${r.stdout.trim()}`);
}

// --files-only and --quiet return what the run did: { kept, installed, waiting, failed } (extensions by repo name)
function install(folder) {
  const flags = FILES_ONLY
    ? ["--files-only"]
    : QUIET
      ? extAt === -1
        ? []
        : ["--extensions", extAnswer]
      : [...passed];
  if (homeAt !== -1) flags.push("--home", home);
  if (UNSEEN) {
    // no one watches it: the installer's last line is the error the hook passes on. --quiet has checked Claude Code
    // against the minimum already, so the installer does not try to update it (SETUP_CC_CHECK=done)
    const r = spawnSync(
      process.execPath,
      [path.join(folder, "install.mjs"), ...flags],
      {
        encoding: "utf8",
        windowsHide: true,
        env: QUIET ? { ...process.env, SETUP_CC_CHECK: "done" } : process.env,
      },
    );
    const out = r.stdout || "";
    process.stdout.write(out);
    const lastLine =
      `${out}${r.stderr || ""}`.trim().split("\n").at(-1) ||
      String(r.error || "no output");
    if (r.status !== 0)
      stop(
        `install.mjs${FILES_ONLY ? " --files-only" : ""} in ${fwd(folder)} ended with an error: ${lastLine.trim()}`,
      );
    const lines = out.split(/\r?\n/);
    // the files the user changed, which stayed theirs: --files-only prints "Kept as yours (...): a, b"; the full
    // installer (scripts/report.mjs) "Kept as yours, because ...:" and then one indented line per file
    const yours = out.match(/^Kept as yours \([^)]*\): (.+?)\r?$/m);
    const listAt = lines.findIndex((l) => /^Kept as yours, /.test(l));
    const list = listAt === -1 ? [] : lines.slice(listAt + 1);
    const listEnd = list.findIndex((l) => !/^ {2}\S/.test(l));
    const kept = yours
      ? yours[1].split(", ")
      : list.slice(0, listEnd === -1 ? list.length : listEnd).map((l) => l.trim());
    // the extension lines of scripts/extensions.mjs, by the name before the first space or bracket
    const named = (lead) =>
      lines
        .filter((l) => l.startsWith(lead))
        .map((l) => l.slice(lead.length).match(/^[^\s(]+/)[0]);
    return {
      kept,
      installed: named("extension installed: "),
      waiting: [...new Set(named("extension waiting: "))],
      failed: named("extension failed: "),
    };
  }
  // its output is passed on as it is, and read for the panels that failed (a retry keeps only those on record)
  const r = spawnSync(
    process.execPath,
    [path.join(folder, "install.mjs"), ...flags],
    {
      stdio: ["inherit", "pipe", "inherit"],
      encoding: "utf8",
      windowsHide: true,
    },
  );
  process.stdout.write(r.stdout || "");
  if (r.status !== 0)
    stop(`install.mjs in ${fwd(folder)} ended with an error (see above).`);
  return {
    failed: (r.stdout || "")
      .split(/\r?\n/)
      .filter((l) => l.startsWith("extension failed: "))
      .map((l) => l.slice("extension failed: ".length).match(/^[^\s(]+/)[0]),
  };
}

let latest;
try {
  latest = JSON.parse(await get(VERSION_URL, 15000));
} catch (e) {
  stop(
    `could not read ${VERSION_URL} (${e.message}). Check the internet connection and try again.`,
  );
}
if (!/^\d+(\.\d+)*$/.test(String(latest.version)))
  stop(`${VERSION_URL} has no usable version number.`);
auto.version = latest.version;
auto.headline = String(latest.releases?.[latest.version]?.headline || "")
  .trim()
  .replace(/\.$/, "");

if (UNSEEN && !newer(latest.version, installed)) {
  // updated some other way since the hook started this
  console.log(`Already on the newest version (${installed}).`);
  recordAuto(null);
  process.exit(0);
}
if (!newer(latest.version, installed)) {
  console.log(`Already on the newest version (${installed}).`);
  // the installed version's folder, where the code below loads modules from: it must still be a setup folder
  // (a moved or replaced folder could hold anything)
  if (
    state.repo &&
    !["install.mjs", "version.json", "scripts/setup-state.mjs"].every((f) =>
      fs.existsSync(path.join(state.repo, f)),
    )
  )
    stop(
      `the setup's folder (${fwd(state.repo)}) is not a setup folder (no install.mjs, version.json and scripts/setup-state.mjs), so nothing is loaded from it. Download ${REPO_URL} and run its install once.`,
    );
  // an Ink theme the last update could not set (Nimbalyst was open) is named again until a chat has set it,
  // unless the person has picked a theme since (--app-settings <file> is another settings file: tests)
  if (state.themePending) {
    const mod =
      state.repo && path.join(state.repo, "scripts", "ink-default.mjs");
    if (!mod || !fs.existsSync(mod))
      stop(
        `the setup's folder (${state.repo}) has no scripts/ink-default.mjs, so the pending theme can't be checked.`,
      );
    const { pickedSincePending, PENDING_LINE } = await import(
      pathToFileURL(mod).href
    );
    const { nimbalystHome } = await setupModule(
      state.repo,
      "nimbalyst-paths.mjs",
    );
    const { themeDone, writeState } = await setupModule(
      state.repo,
      "setup-state.mjs",
    );
    const appAt = args.indexOf("--app-settings");
    const appFile =
      appAt !== -1
        ? path.resolve(args[appAt + 1])
        : path.join(nimbalystHome(), "app-settings.json");
    const app = JSON.parse(fs.readFileSync(appFile, "utf8"));
    if (pickedSincePending(app, state.themePendingFrom)) {
      writeState(stateFile, themeDone(state));
      console.log(`theme: left as it is (${app.theme})`);
    } else console.log(PENDING_LINE);
  }
  // panels the last quiet run (of this version) could not build: the installer runs again to build them
  const checkFile = path.join(CLAUDE, "update-check.json");
  const lastAuto = fs.existsSync(checkFile)
    ? JSON.parse(fs.readFileSync(checkFile, "utf8")).auto
    : null;
  const retryPanels =
    lastAuto?.version === installed && lastAuto.extFailed?.length
      ? lastAuto.extFailed
      : [];
  if ((passed.length || retryPanels.length) && !args.includes("--check")) {
    if (!state.repo || !fs.existsSync(path.join(state.repo, "install.mjs")))
      stop(
        `the setup's folder (${state.repo}) is gone, so its installer can't run again.`,
      );
    if (retryPanels.length)
      console.log(
        `The installer runs again: the last update could not build ${retryPanels.length === 1 ? "the panel" : "the panels"} ${retryPanels.join(", ")}.`,
      );
    const ran = install(state.repo); // install.mjs checks Claude Code itself
    if (retryPanels.length) {
      // tried again: only the panels that failed again stay on record, so the next /update-setup retries them
      const kept = JSON.parse(fs.readFileSync(checkFile, "utf8"));
      kept.auto = {
        ...kept.auto,
        extFailed: retryPanels.filter((n) => ran.failed.includes(n)),
      };
      fs.writeFileSync(`${checkFile}.part`, JSON.stringify(kept));
      fs.renameSync(`${checkFile}.part`, checkFile);
    }
  } else {
    // nothing else runs the installer here, so Claude Code is checked now (once per run; a newer version's install.mjs does it on the other path)
    const mod =
      state.repo && path.join(state.repo, "scripts", "claude-code-version.mjs");
    if (!mod || !fs.existsSync(mod))
      console.log(
        "Claude Code: version check skipped (the setup's folder has no scripts/claude-code-version.mjs).",
      );
    else {
      const { checkClaudeCode, pointNimbalyst } = await import(
        pathToFileURL(mod).href
      );
      const min = JSON.parse(
        fs.readFileSync(path.join(state.repo, "version.json"), "utf8"),
      ).claudeCodeMin;
      const { stop: tooOld } = checkClaudeCode({
        min,
        dry: args.includes("--check"),
      });
      if (tooOld) stop(tooOld);
      // Nimbalyst on the Claude Code just checked, or back on its own after a newer Nimbalyst (as install.mjs does)
      if (homeAt === -1) {
        const { appDataDir, nimbalystHome } = await setupModule(
          state.repo,
          "nimbalyst-paths.mjs",
        );
        const { writeState } = await setupModule(state.repo, "setup-state.mjs");
        const appData = appDataDir();
        const { set } = pointNimbalyst({
          file:
            appData && path.join(nimbalystHome(appData), "ai-settings.json"),
          min,
          previous: state.nimbalystClaude || null,
          dry: args.includes("--check"),
        });
        if (
          !args.includes("--check") &&
          (set || null) !== (state.nimbalystClaude || null)
        ) {
          const next = { ...state };
          if (set) next.nimbalystClaude = set;
          else delete next.nimbalystClaude;
          writeState(stateFile, next);
        }
      }
    }
    phoneVoice(args.includes("--check"));
  }
  nimbalyst({ stage: args.includes("--check") ? null : "retry" });
  if (!args.includes("--check")) {
    // a run for one change (--replace, --leave-out, --language, ...) leaves the programs to the plain run
    if (!passed.length) programs();
    diskTidy();
    filesOffer();
    optIns();
  }
  process.exit(0);
}
console.log(
  `Newer version: ${latest.version} (installed: ${installed === "0" ? "an older one, no version on record" : installed}).`,
);
if (latest.summary) console.log(`What is new: ${latest.summary}`);
if (args.includes("--check")) {
  phoneVoice(true);
  nimbalyst({ stage: false });
  process.exit(0);
}

// ---- download and unpack. The folder gets its final name only when it is complete.
const sources = path.join(CLAUDE, "setup-source");
const target = path.join(sources, `v${latest.version}`);
const part = `${target}.part`;
fs.rmSync(part, { recursive: true, force: true });
fs.mkdirSync(part, { recursive: true });
try {
  fs.writeFileSync(
    path.join(part, "source.tar.gz"),
    await get(archiveUrl(latest.version), 120000),
  );
} catch (e) {
  fs.rmSync(part, { recursive: true, force: true });
  stop(`could not download ${archiveUrl(latest.version)} (${e.message}).`);
}
// Windows has its own tar in System32; a tar from Git reads "C:" in a path as another computer,
// so the archive is named without its folder and tar runs inside it.
const winTar = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "tar.exe",
);
const tar =
  process.platform === "win32" && fs.existsSync(winTar) ? winTar : "tar";
const un = spawnSync(tar, ["-xzf", "source.tar.gz", "--strip-components=1"], {
  cwd: part,
  encoding: "utf8",
  windowsHide: true,
});
fs.rmSync(path.join(part, "source.tar.gz"), { force: true });
if (un.status !== 0 || !fs.existsSync(path.join(part, "install.mjs"))) {
  fs.rmSync(part, { recursive: true, force: true });
  stop(
    `could not unpack the download with tar${un.error ? ` (${un.error.message})` : un.stderr ? ` (${un.stderr.trim().split("\n")[0]})` : ""}.`,
  );
}
fs.rmSync(target, { recursive: true, force: true });
fs.renameSync(part, target);
console.log(`Downloaded to ${fwd(target)}`);

// --files-only: every release from the installed one up to this, as its changelog lists them, must be `kind: files`
// or `kind: nimbalyst`; --quiet takes `kind: quiet` too (one with no entry counts as setup)
const SELF_KINDS = QUIET ? ["files", "nimbalyst", "quiet"] : ["files", "nimbalyst"];
if (UNSEEN) {
  const log = fs.readFileSync(path.join(target, "CHANGELOG.md"), "utf8");
  let listed;
  try {
    listed = readChangelog(log);
  } catch (e) {
    stop(`the changelog of ${latest.version} can't be read (${e.message}).`);
  }
  const missed = listed
    .map((r) => r.version)
    .filter((v) => newer(v, installed) && !newer(v, latest.version));
  if (!missed.includes(latest.version))
    stop(
      `the changelog of ${latest.version} has no line for it, so what it changes can't be told.`,
    );
  const notFiles = missed.filter(
    (v) => !SELF_KINDS.includes(latest.releases?.[v]?.kind),
  );
  if (notFiles.length)
    stop(
      `${notFiles.join(", ")} ${notFiles.length === 1 ? "is not a release" : "are not releases"} ${QUIET ? "that installs itself" : "of files only"}; /update-setup installs ${notFiles.length === 1 ? "it" : "them"}.`,
    );
}
// --quiet: Claude Code only against the new version's minimum; below it nothing is installed
if (QUIET) {
  const { checkClaudeCode } = await setupModule(
    target,
    "claude-code-version.mjs",
  );
  const min = JSON.parse(
    fs.readFileSync(path.join(target, "version.json"), "utf8"),
  ).claudeCodeMin;
  if (!/^\d+\.\d+\.\d+$/.test(String(min)))
    stop(
      `the version.json of ${latest.version} has no claudeCodeMin, so Claude Code can't be checked.`,
    );
  const { stop: tooOld } = checkClaudeCode({ min, minOnly: true });
  if (tooOld) stop(tooOld);
}

// ---- which editor extensions changed: they are built from source, which the installer doesn't do
// the installer's fingerprint of an extension's source (scripts/extensions.mjs), from the new version
const { sourceText } = await setupModule(target, "extensions.mjs");
const { sha } = await setupModule(target, "files.mjs");
const print = (dir) => sha(sourceText(dir));
const extDir = path.join(target, "extensions");
const changed = (fs.existsSync(extDir) ? fs.readdirSync(extDir) : [])
  .filter((n) => fs.existsSync(path.join(extDir, n, "package.json")))
  .filter(
    (n) =>
      !state.repo ||
      !fs.existsSync(path.join(state.repo, "extensions", n)) ||
      print(path.join(state.repo, "extensions", n)) !==
        print(path.join(extDir, n)),
  );
if (FILES_ONLY && changed.length)
  stop(
    `${latest.version} changes the extension${changed.length === 1 ? "" : "s"} ${changed.join(", ")}, which only /update-setup builds.`,
  );

const passBefore = passLevelNow();
const ran = install(target);

// The folders of earlier updates go; the folder the setup was first installed from is left alone
for (const name of fs.readdirSync(sources)) {
  if (name !== `v${latest.version}`)
    fs.rmSync(path.join(sources, name), { recursive: true, force: true });
}
for (const name of changed)
  console.log(
    `extension changed: ${name} (source in ${fwd(path.join(extDir, name))})`,
  );
if (FILES_ONLY) recordAuto({ ok: true, kept: ran.kept });
if (QUIET)
  recordAuto({
    ok: true,
    kept: ran.kept,
    extFailed: ran.failed,
    panels: panelsState(ran),
  });
console.log(
  `Updated to version ${latest.version}. The full list of changes: ${fwd(path.join(target, "CHANGELOG.md"))}`,
);
if (!UNSEEN) {
  nimbalyst({ stage: "always" });
  programs();
  diskTidy();
  filesOffer();
  passOffer(passBefore);
  optIns();
}
