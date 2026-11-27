#!/usr/bin/env node
// tracker-sync: moves Nimbalyst tracker items from commit messages, with no model turn. A commit line
// `Step: <step> done` or `Step: <step> running` (one per item, several allowed) sets the item whose custom field
// `step` is exactly <step> to done / in-progress, adds one comment first, then sets the status and writes the commit
// sha into `proof` (a session id after the old sha is kept). Moves go forward only: running only from to-do,
// waits-for-you or no status; done from anything but done, wont-do and duplicate (a rebase or squash-merge replays
// old lines). No match or more than one match: logged, nothing moves.
//
// The tracker a commit goes to is the Nimbalyst workspace of its repo: the repo's main checkout folder (a worktree
// counts as its main checkout), spelled as Nimbalyst spells it (on Windows backslashes and the drive letter as git
// gives it; the endpoint answers an empty list for any other spelling). ~/.claude/tracker-sync.json can send a repo
// to another workspace, so one tracker holds the steps of several repos:
//   { "workspaces": { "<repo folder>": "<workspace folder>" } }    (folders compared ignoring case and slash kind)
// Talks to Nimbalyst's local MCP endpoint (/mcp/trackers). The bearer token stays in memory and is scrubbed from
// every log line and message.
//
// Run: node ~/.claude/workers/tracker-sync.mjs --install <repo>     once per repo: adds the post-commit hook
//      node ~/.claude/workers/tracker-sync.mjs --uninstall <repo>   takes out exactly what --install added
//      node ~/.claude/workers/tracker-sync.mjs --commit <repo> <sha> what the hook runs, detached
//      node ~/.claude/workers/tracker-sync.mjs --catch-up           pending commits, then each repo's new commits
// --install: the hook goes into the repo's hooks folder (`git rev-parse --git-path hooks`, so worktrees and a
// core.hooksPath inside the repo work). With no post-commit there it writes one; an existing shell post-commit keeps
// its text and gets one marked line at the end that runs ours. The line runs workers/tracker-sync-hook.sh.
// --commit: a commit that could not sync is kept as pending; Nimbalyst not running -> one log line, exit 0.
// TRACKER_SYNC=off makes --commit (and the hook) do nothing.
// --catch-up: Nimbalyst not running -> exit 1 with a message. Retries pending commits first, then walks every repo
// the state knows and every repo in the map file, each from its last handled commit to the HEAD of its current
// branch (the first run for a repo records its HEAD only). A failing repo is logged and the next one still runs; any
// failure exits 1. A known repo whose folder is gone is dropped from the state.
// State: ~/.claude/state/tracker-sync/tracker-sync.json (`pending`; per repo `last`, the newest commit catch-up
// handled, and `synced`, the commits --commit handled), changed only under the lock file tracker-sync.json.lock.
// Log: tracker-sync.log in the same folder, one line per action.
// Test seams: TRACKER_SYNC_ENDPOINT_FILE, TRACKER_SYNC_STATE_DIR, TRACKER_SYNC_CONFIG (the map file),
// TRACKER_SYNC_REPOS (JSON [[path, ref], ...]: the repos catch-up walks, instead of the state's and the map's).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLAUDE = path.join(os.homedir(), ".claude");
const STATE_DIR =
  process.env.TRACKER_SYNC_STATE_DIR ||
  path.join(CLAUDE, "state", "tracker-sync");
const STATE_FILE = path.join(STATE_DIR, "tracker-sync.json");
const LOCK_FILE = `${STATE_FILE}.lock`;
const LOG_FILE = path.join(STATE_DIR, "tracker-sync.log");
const CONFIG_FILE =
  process.env.TRACKER_SYNC_CONFIG || path.join(CLAUDE, "tracker-sync.json");
const TIMEOUT_MS = 30000;
const SYNCED_KEEP = 500;
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 60000;
const STATUS = { done: "done", running: "in-progress" };
// The statuses each line may move an item from. `null` is an item with no status.
const MOVES_FROM = {
  running: (s) => !s || s === "to-do" || s === "waits-for-you",
  done: (s) => !["done", "wont-do", "duplicate"].includes(s),
};
const COMMENT_WORD = { done: "finished", running: "started" };

// The same places skills/phone-bot/bot/nimbalyst.mjs reads: APPDATA on Windows, Application Support on a Mac,
// ~/.config elsewhere.
function endpointFile() {
  if (process.env.TRACKER_SYNC_ENDPOINT_FILE)
    return process.env.TRACKER_SYNC_ENDPOINT_FILE;
  const tail = ["@nimbalyst", "electron", "mcp-endpoint.json"];
  if (process.platform === "win32") {
    if (!process.env.APPDATA)
      throw new Error(
        "APPDATA is not set and TRACKER_SYNC_ENDPOINT_FILE is not given; cannot find Nimbalyst's endpoint file",
      );
    return path.join(process.env.APPDATA, ...tail);
  }
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", ...tail);
  return path.join(os.homedir(), ".config", ...tail);
}

let token = null;
const scrub = (s) => (token ? String(s).split(token).join("***") : String(s));

function log(line) {
  const text = scrub(line);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${text}\n`);
  console.log(text);
}

function notRunning(why) {
  const e = new Error(`Nimbalyst is not running (${why})`);
  e.code = "NOT_RUNNING";
  return e;
}

// ---- folders and workspaces ----
// A folder's full long name: Windows can spell one folder with a short 8.3 name (PROGRA~1 for Program Files) that git never
// uses, and fs.realpathSync keeps the short spelling; the native one expands it. A missing folder stays as written.
const longName = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return String(p);
  }
};
// Folders are compared by long name, ignoring letter case and slash kind (Windows and a Mac's default disk ignore case).
const sameFolder = (p) =>
  longName(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const nimbalystSpelling = (p) =>
  process.platform === "win32" ? p.replace(/\//g, "\\") : p;

function readMap() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  let d;
  try {
    d = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (e) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${e.message}`);
  }
  if (!d || typeof d.workspaces !== "object" || Array.isArray(d.workspaces))
    throw new Error(
      `${CONFIG_FILE} has no "workspaces" object ({ "workspaces": { "<repo folder>": "<workspace folder>" } })`,
    );
  return d.workspaces;
}

// The workspace whose tracker holds the steps of the repo with main checkout `key`.
export function workspaceFor(key) {
  const map = readMap();
  const hit = Object.keys(map).find((k) => sameFolder(k) === sameFolder(key));
  return nimbalystSpelling(hit ? map[hit] : key);
}

// ---- MCP client: one session per workspace and run, opened on the first call ----
// The reply is plain JSON or an SSE body; an SSE body can carry notification events before the answer, so the event
// whose id is the request's id is the answer. An event's data lines are joined with newlines.
function parseRpc(text, id) {
  const t = text.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  for (const event of t.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    const msg = JSON.parse(data);
    if (msg.id === id) return msg;
  }
  throw new Error(`no answer with id ${id} in the endpoint's reply`);
}

export function makeClient(workspace) {
  let url = null;
  let session = null;
  let nextId = 1;
  async function post(body) {
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (session) headers["mcp-session-id"] = session;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      if (e.cause && e.cause.code === "ECONNREFUSED")
        throw notRunning("connection refused");
      throw new Error(`endpoint: ${scrub(e.message)}`);
    }
    session = res.headers.get("mcp-session-id") || session;
    return { status: res.status, text: await res.text() };
  }
  async function open() {
    const file = endpointFile();
    if (!fs.existsSync(file)) throw notRunning(`no endpoint file ${file}`);
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!d.port || !d.token) throw new Error(`${file} has no port or token`);
    token = d.token;
    url = `http://127.0.0.1:${d.port}/mcp/trackers?${new URLSearchParams({ workspacePath: workspace })}`;
    const init = await post({
      jsonrpc: "2.0",
      id: nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "tracker-sync", version: "1" },
      },
    });
    if (init.status !== 200)
      throw new Error(
        `initialize: HTTP ${init.status} ${scrub(init.text).slice(0, 200)}`,
      );
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
  async function call(tool, args) {
    if (!url) await open();
    const id = nextId++;
    const r = await post({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: tool, arguments: args },
    });
    if (r.status !== 200)
      throw new Error(
        `${tool}: HTTP ${r.status} ${scrub(r.text).slice(0, 200)}`,
      );
    const msg = parseRpc(r.text, id);
    if (msg.error)
      throw new Error(
        `${tool}: ${scrub(msg.error.message || JSON.stringify(msg.error))}`,
      );
    const text = (msg.result.content || []).map((p) => p.text || "").join("\n");
    if (msg.result.isError)
      throw new Error(`${tool}: ${scrub(text).slice(0, 300)}`);
    try {
      return JSON.parse(text).structured;
    } catch {
      throw new Error(
        `${tool}: the answer was not JSON: ${scrub(text).slice(0, 200)}`,
      );
    }
  }
  // Opens the session now, so a caller learns early that Nimbalyst is not running.
  call.open = async () => {
    if (!url) await open();
  };
  return call;
}

// One client per workspace for the whole run.
function clients() {
  const made = new Map();
  return (workspace) => {
    if (!made.has(workspace)) made.set(workspace, makeClient(workspace));
    return made.get(workspace);
  };
}

// The list filter ignores letter case and returns no custom fields, so each candidate is read back and its `step`
// compared exactly.
export async function findByStep(call, step) {
  const list = await call("tracker_list", {
    where: [{ field: "step", op: "=", value: step }],
    includeClosed: true,
  });
  const found = [];
  for (const c of list.items) {
    const { item } = await call("tracker_get", { id: c.id });
    if (item.customFields && item.customFields.step === step) found.push(item);
  }
  return found;
}

// ---- git ----
function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(
      `git ${args.join(" ")} in ${cwd} failed: ${r.stderr.trim()}`,
    );
  return r.stdout.trim();
}

// A worktree resolves to its main checkout, so state, workspace and the repo name are the same for every worktree.
function mainCheckout(repo) {
  return path
    .dirname(
      git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    )
    .replace(/\\/g, "/");
}

export function stepLines(message) {
  const out = [];
  for (const line of message.split(/\r?\n/)) {
    const m = /^Step: (.+) (done|running)\s*$/.exec(line);
    if (m) out.push({ step: m[1].trim(), word: m[2] });
  }
  return out;
}

// ---- state: read freely (the file is replaced whole), changed only under the lock ----
function readState() {
  if (!fs.existsSync(STATE_FILE)) return { repos: {}, pending: [] };
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}
function repoState(state, key) {
  return (state.repos[key] ||= { last: null, synced: [] });
}
const pause = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function takeLock() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(LOCK_FILE, "wx"));
      return;
    } catch (e) {
      if (e.code !== "EEXIST" && e.code !== "EPERM") throw e; // EPERM: Windows, the lock is being deleted
    }
    let age;
    try {
      age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    } catch {
      continue; // freed meanwhile
    }
    if (age > LOCK_STALE_MS) {
      fs.rmSync(LOCK_FILE, { force: true });
      continue;
    }
    if (Date.now() > until)
      throw new Error(
        `the state lock ${LOCK_FILE} was held for over ${LOCK_WAIT_MS / 1000} s`,
      );
    pause(50);
  }
}
// Windows refuses a rename over a file another process has open (a reader without the lock, the indexer, antivirus):
// EPERM, EACCES or EBUSY. That lasts milliseconds, so it is retried for up to 2 s before the error goes up.
export function renameRetry(from, to, rename = fs.renameSync) {
  const until = Date.now() + 2000;
  for (;;) {
    try {
      return rename(from, to);
    } catch (e) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(e.code) || Date.now() > until)
        throw e;
      pause(50);
    }
  }
}
// Re-reads the state under the lock, lets `change` edit it, and writes it back whole.
function changeState(change) {
  takeLock();
  try {
    const state = readState();
    change(state);
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    renameRetry(tmp, STATE_FILE);
  } finally {
    fs.rmSync(LOCK_FILE, { force: true });
  }
}
function markSynced(state, key, sha) {
  const rs = repoState(state, key);
  rs.synced = [...rs.synced.filter((s) => s !== sha), sha].slice(-SYNCED_KEEP);
  state.pending = state.pending.filter((p) => p.sha !== sha);
}

// ---- one commit ----
// The comment goes first: a sync that stops after it still has the status left to set, so a retry finishes it.
// Throws on an endpoint failure; the commit then counts as not synced.
async function syncCommit(clientFor, repo, sha) {
  const key = mainCheckout(repo);
  const name = path.basename(key);
  const lines = stepLines(git(repo, "log", "-1", "--format=%B", sha));
  if (!lines.length) return;
  const workspace = workspaceFor(key);
  const call = clientFor(workspace);
  for (const { step, word } of lines) {
    const where = `${name} ${sha.slice(0, 7)} "${step}"`;
    const found = await findByStep(call, step);
    if (found.length !== 1) {
      log(
        `${where}: ${found.length ? `${found.length} tracker items` : "no tracker item"} with this step in workspace ${workspace}; nothing moved`,
      );
      continue;
    }
    const it = found[0];
    const status = STATUS[word];
    if (it.status === status) {
      log(`${where}: ${it.id} already ${status}; nothing written`);
      continue;
    }
    if (!MOVES_FROM[word](it.status)) {
      log(
        `${where}: ${it.id} is ${it.status}; a ${word} line does not move it there, skipped`,
      );
      continue;
    }
    // where-are-we reads proof as `<commit sha> [<session>]`.
    const session = String(it.customFields.proof || "")
      .trim()
      .split(/\s+/)[1];
    await call("tracker_add_comment", {
      trackerId: it.id,
      body: `A commit in ${name} marked this ${COMMENT_WORD[word]}.`,
    });
    await call("tracker_update", {
      id: it.id,
      status,
      fields: { proof: session ? `${sha} ${session}` : sha },
    });
    log(`${where}: ${it.id} ${it.status || "no status"} -> ${status}`);
  }
}

async function commitMode(repo, sha) {
  if (process.env.TRACKER_SYNC === "off") return 0;
  if (!stepLines(git(repo, "log", "-1", "--format=%B", sha)).length) return 0;
  const full = git(repo, "rev-parse", sha);
  const key = mainCheckout(repo);
  const where = `${path.basename(key)} ${full.slice(0, 7)}`;
  try {
    await syncCommit(clients(), repo, full);
  } catch (e) {
    changeState((s) => {
      if (!s.pending.some((p) => p.sha === full))
        s.pending.push({ repo: key, sha: full });
    });
    if (e.code === "NOT_RUNNING") {
      log(`${where}: ${e.message}; left for --catch-up`);
      return 0;
    }
    log(`${where}: failed, left for --catch-up: ${e.message}`);
    return 1;
  }
  changeState((s) => markSynced(s, key, full));
  return 0;
}

// The commits --commit could not sync, on any branch, oldest first. A commit gone from the repo is dropped.
async function retryPending(clientFor) {
  let failures = 0;
  for (const p of readState().pending) {
    const where = `${path.basename(p.repo)} ${p.sha.slice(0, 7)}`;
    try {
      if (
        !fs.existsSync(p.repo) ||
        spawnSync("git", ["cat-file", "-e", `${p.sha}^{commit}`], {
          cwd: p.repo,
        }).status !== 0
      ) {
        changeState((s) => {
          s.pending = s.pending.filter((x) => x.sha !== p.sha);
        });
        log(`${where}: pending commit is no longer in the repo; dropped`);
        continue;
      }
      await syncCommit(clientFor, p.repo, p.sha);
      changeState((s) => markSynced(s, p.repo, p.sha));
    } catch (e) {
      if (e.code === "NOT_RUNNING") throw e;
      failures++;
      log(`${where}: pending retry failed: ${e.message}`);
    }
  }
  return failures;
}

// The repos catch-up walks: every repo the state knows (synced, pending, last) and every repo in the map, each on
// the HEAD of its current branch. `known` marks a repo that came from the state, so a gone folder is dropped.
function catchUpRepos() {
  if (process.env.TRACKER_SYNC_REPOS)
    return JSON.parse(process.env.TRACKER_SYNC_REPOS).map(([repo, ref]) => ({
      repo,
      ref: ref || "HEAD",
      known: false,
    }));
  const state = readState();
  const out = new Map();
  const add = (repo, known) => {
    if (!out.has(sameFolder(repo)))
      out.set(sameFolder(repo), { repo, ref: "HEAD", known });
  };
  for (const repo of Object.keys(state.repos)) add(repo, true);
  for (const p of state.pending) add(p.repo, true);
  for (const repo of Object.keys(readMap())) add(repo, false);
  return [...out.values()];
}

async function catchUpRepo(clientFor, repo, ref) {
  const key = mainCheckout(repo);
  const head = git(repo, "rev-parse", ref);
  const last = repoState(readState(), key).last;
  if (!last) {
    changeState((s) => {
      repoState(s, key).last = head;
    });
    log(
      `${path.basename(key)}: first catch-up, recorded ${ref} ${head.slice(0, 7)}; older commits are not synced`,
    );
    return;
  }
  for (const sha of git(repo, "rev-list", "--reverse", `${last}..${head}`)
    .split("\n")
    .filter(Boolean)) {
    if (!repoState(readState(), key).synced.includes(sha))
      await syncCommit(clientFor, repo, sha);
    changeState((s) => {
      repoState(s, key).last = sha;
    });
  }
}

// The main checkout when the folder is a repo, else the folder itself (that repo's own catch-up then logs why).
function mainCheckoutOr(repo) {
  try {
    return mainCheckout(repo);
  } catch {
    return repo.replace(/\\/g, "/");
  }
}

async function catchUpMode() {
  const clientFor = clients();
  const repos = catchUpRepos();
  const first = repos[0] || readState().pending[0];
  // The nightly must hear that Nimbalyst is closed even when no commit is new.
  if (first) await clientFor(workspaceFor(mainCheckoutOr(first.repo))).open();
  let failures = await retryPending(clientFor);
  for (const { repo, ref, known } of repos) {
    if (known && !fs.existsSync(repo)) {
      changeState((s) => {
        delete s.repos[repo];
        s.pending = s.pending.filter((p) => p.repo !== repo);
      });
      log(`${repo}: the folder is gone; dropped from the state`);
      continue;
    }
    try {
      await catchUpRepo(clientFor, repo, ref);
    } catch (e) {
      if (e.code === "NOT_RUNNING") throw e;
      failures++;
      log(`${repo}: catch-up failed: ${e.message}`);
    }
  }
  if (failures)
    throw new Error(`${failures} commit(s) or repo(s) failed; see ${LOG_FILE}`);
}

// ---- the post-commit hook in a repo ----
// The one marked line --install adds. It runs the hook body the setup keeps in ~/.claude/workers, so a setup update
// reaches every repo, and a setup that is gone leaves a line that does nothing. USERPROFILE first: node's home
// folder on Windows is USERPROFILE, and Git Bash's HOME can be set to another folder.
const HOOK_BODY =
  '"${USERPROFILE:-$HOME}/.claude/workers/tracker-sync-hook.sh"';
export const HOOK_LINE = `if [ -f ${HOOK_BODY} ]; then sh ${HOOK_BODY}; fi # tracker-sync: added by tracker-sync.mjs --install`;
const WRITTEN = `#!/bin/sh\n# Written by tracker-sync.mjs --install; tracker-sync.mjs --uninstall deletes it.\n${HOOK_LINE}\n`;

const inside = (dir, base) => {
  const r = path.relative(base, dir);
  return !r.startsWith("..") && !path.isAbsolute(r);
};
// The repo's post-commit file. A core.hooksPath outside the repo is refused: a hook there runs for every repo.
function hookFile(repo) {
  const dir = path.resolve(repo, git(repo, "rev-parse", "--git-path", "hooks"));
  fs.mkdirSync(dir, { recursive: true });
  const real = fs.realpathSync.native(dir);
  const top = fs.realpathSync.native(git(repo, "rev-parse", "--show-toplevel"));
  const common = fs.realpathSync.native(
    git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"),
  );
  if (!inside(real, top) && !inside(real, common))
    throw new Error(
      `the hooks folder ${dir} (core.hooksPath) is outside the repo, so a hook there runs for every repo that uses it; to have that anyway, add this line to its post-commit by hand:\n${HOOK_LINE}`,
    );
  return path.join(dir, "post-commit");
}

function install(repo) {
  const file = hookFile(repo);
  const note = fs.existsSync(
    path.join(CLAUDE, "workers", "tracker-sync-hook.sh"),
  )
    ? ""
    : " (~/.claude/workers/tracker-sync-hook.sh is not there yet, so the hook does nothing until the setup is installed)";
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, WRITTEN, { mode: 0o755 });
    return `tracker-sync: wrote the post-commit hook ${file}${note}`;
  }
  const text = fs.readFileSync(file, "utf8");
  if (text.split(/\r?\n/).includes(HOOK_LINE))
    return `tracker-sync: already in ${file}; nothing changed${note}`;
  if (!/^#!.*\b(sh|bash|dash|zsh|ksh)\b/.test(text))
    throw new Error(
      `${file} is not a shell script, so a shell line cannot be added to it; add this where it runs commands:\n${HOOK_LINE}`,
    );
  const last = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .pop();
  if (last && /^(exit|exec)\b/.test(last))
    throw new Error(
      `${file} ends with "${last}", so a line after it never runs; add this line before it by hand:\n${HOOK_LINE}`,
    );
  fs.appendFileSync(
    file,
    text.endsWith("\n") ? `${HOOK_LINE}\n` : `\n${HOOK_LINE}`,
  );
  return `tracker-sync: added one line to the existing post-commit hook ${file}${note}`;
}

function uninstall(repo) {
  const file = hookFile(repo);
  if (!fs.existsSync(file))
    return `tracker-sync: no post-commit hook in ${path.dirname(file)}; nothing changed`;
  const text = fs.readFileSync(file, "utf8");
  if (text === WRITTEN) {
    fs.rmSync(file);
    return `tracker-sync: deleted ${file} (--install wrote it)`;
  }
  let rest = null;
  if (text.endsWith(`\n${HOOK_LINE}`))
    rest = text.slice(0, -(HOOK_LINE.length + 1));
  else if (text.includes(`${HOOK_LINE}\n`))
    rest = text.replace(`${HOOK_LINE}\n`, "");
  if (rest === null) return `tracker-sync: not in ${file}; nothing changed`;
  fs.writeFileSync(file, rest);
  return `tracker-sync: took the tracker-sync line out of ${file}`;
}

const USAGE =
  "usage: node ~/.claude/workers/tracker-sync.mjs --install <repo> | --uninstall <repo> | --commit <repo> <sha> | --catch-up";

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if ((mode === "--install" || mode === "--uninstall") && rest.length === 1) {
    try {
      console.log(mode === "--install" ? install(rest[0]) : uninstall(rest[0]));
    } catch (e) {
      console.error(`tracker-sync ${mode} failed: ${e.message}`);
      process.exitCode = 1;
    }
    return;
  }
  if (mode === "--commit" && rest.length === 2) {
    process.exitCode = await commitMode(rest[0], rest[1]);
    return;
  }
  if (mode === "--catch-up" && rest.length === 0) {
    try {
      await catchUpMode();
    } catch (e) {
      log(`catch-up stopped: ${e.message}`);
      console.error(
        scrub(
          e.code === "NOT_RUNNING"
            ? `tracker-sync --catch-up: ${e.message}; start Nimbalyst and run it again`
            : `tracker-sync --catch-up failed: ${e.message}`,
        ),
      );
      process.exitCode = 1;
    }
    return;
  }
  console.error(USAGE);
  process.exitCode = 2;
}

// Imported (tests, a real-endpoint probe) it runs nothing. Windows paths ignore case; a Mac temp folder is a link.
const self = fileURLToPath(import.meta.url).toLowerCase();
if (
  process.argv[1] &&
  fs.realpathSync(path.resolve(process.argv[1])).toLowerCase() === self
)
  await main();
