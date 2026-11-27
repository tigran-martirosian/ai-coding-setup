#!/usr/bin/env node
// Tests workers/tracker-sync.mjs and its hook body workers/tracker-sync-hook.sh against a fake Nimbalyst tracker
// endpoint (a small http server here), temp git repos and a temp home folder holding a copy of the two worker files
// in .claude/workers. Nothing here touches the real tracker, a real repo or the real ~/.claude.
// Run: node tests/test-tracker-sync.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(fileURLToPath(import.meta.url), "..", "..");
const SCRIPT = join(REPO, "workers", "tracker-sync.mjs");
const HOOK = join(REPO, "workers", "tracker-sync-hook.sh");
const TOKEN = "tok-5ecret-abc123";
const WIN = process.platform === "win32";
// A Mac's temp folder is a link (/var -> /private/var); git answers with the real path.
const root = fs.realpathSync(
  fs.mkdtempSync(join(tmpdir(), "tracker-sync-test-")),
);
// The home folder every run here sees: its .claude/workers holds the setup's two files, as an install puts them.
const home = join(root, "home");
fs.mkdirSync(join(home, ".claude", "workers"), { recursive: true });
fs.copyFileSync(SCRIPT, join(home, ".claude", "workers", "tracker-sync.mjs"));
fs.copyFileSync(HOOK, join(home, ".claude", "workers", "tracker-sync-hook.sh"));
const emptyHome = join(root, "empty-home"); // a PC without the setup
fs.mkdirSync(emptyHome);
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "tester",
  GIT_AUTHOR_EMAIL: "tester@example.com",
  GIT_COMMITTER_NAME: "tester",
  GIT_COMMITTER_EMAIL: "tester@example.com",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  HOME: home,
  USERPROFILE: home,
});
delete process.env.TRACKER_SYNC;

// ---- fake endpoint: the four tracker tools over MCP JSON-RPC, answers as SSE like the real one ----
// Its tracker belongs to the workspace `trackerWs`; like the real endpoint, any other workspacePath sees an empty list.
let items = [];
let calls = [];
let delayMs = 0;
let leakToken = false;
let extraEvent = false; // a progress notification event before the answer, in the same SSE body
let failOnce = null; // a tool name whose next call answers isError
let trackerWs = null;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => {
    body += c;
  });
  req.on("end", async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const u = new URL(req.url, "http://x");
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end("bad token");
      return;
    }
    if (u.pathname !== "/mcp/trackers") {
      res.writeHead(404).end(`wrong url ${req.url}`);
      return;
    }
    const ws = u.searchParams.get("workspacePath");
    const msg = JSON.parse(body);
    if (msg.method === "initialize") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "mcp-session-id": "s1",
      });
      res.end(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} })}\n\n`,
      );
      return;
    }
    if (req.headers["mcp-session-id"] !== "s1") {
      res.writeHead(400).end("no session");
      return;
    }
    if (msg.method === "notifications/initialized") {
      res.writeHead(202).end();
      return;
    }
    const { name, arguments: a } = msg.params;
    calls.push({ name, args: a, ws });
    if (leakToken) {
      res.writeHead(500).end(`internal error, token was ${TOKEN}`);
      return;
    }
    const sse = (reply) => {
      const pre = extraEvent
        ? `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } })}\n\n`
        : "";
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`${pre}event: message\ndata: ${JSON.stringify(reply)}\n\n`);
    };
    if (failOnce === name) {
      failOnce = null;
      sse({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: "tool failed" }],
          isError: true,
        },
      });
      return;
    }
    const mine = ws === trackerWs ? items : [];
    let out;
    if (name === "tracker_list") {
      // Like the real tool: the step filter ignores letter case, and the list has no custom fields.
      const w = a.where[0];
      const found = mine.filter(
        (i) =>
          String(i.customFields[w.field]).toLowerCase() ===
          String(w.value).toLowerCase(),
      );
      out = {
        structured: {
          count: found.length,
          items: found.map(({ id, title, status }) => ({ id, title, status })),
        },
      };
    } else if (name === "tracker_get") {
      out = { structured: { item: mine.find((i) => i.id === a.id) } };
    } else if (name === "tracker_update") {
      const it = mine.find((i) => i.id === a.id);
      it.status = a.status;
      Object.assign(it.customFields, a.fields);
      out = { structured: { action: "updated" } };
    } else if (name === "tracker_add_comment") {
      mine.find((i) => i.id === a.trackerId).comments.push(a.body);
      out = { structured: { action: "commented" } };
    } else throw new Error(`fake endpoint: unknown tool ${name}`);
    sse({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(out) }],
        isError: false,
      },
    });
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const endpointFile = join(root, "mcp-endpoint.json");
const stateDir = join(root, "state");
const logFile = join(stateDir, "tracker-sync.log");
fs.writeFileSync(endpointFile, JSON.stringify({ port, token: TOKEN }));
const env = {
  TRACKER_SYNC_ENDPOINT_FILE: endpointFile,
  TRACKER_SYNC_STATE_DIR: stateDir,
};

const item = (id, step, status) => ({
  id,
  title: `item ${id}`,
  status,
  customFields: { step },
  comments: [],
});
const get = (id) => items.find((i) => i.id === id);
const readLog = () =>
  fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
const stateFile = join(stateDir, "tracker-sync.json");
const readState = () => JSON.parse(fs.readFileSync(stateFile, "utf8"));
const stepCalls = (step) =>
  calls.filter(
    (c) => c.name === "tracker_list" && c.args.where[0].value === step,
  );

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}
// The workspace Nimbalyst knows a repo by: its top folder, with backslashes on Windows.
const wsOf = (dir) => {
  const top = git(dir, "rev-parse", "--show-toplevel");
  return WIN ? top.replace(/\//g, "\\") : top;
};
let repoCount = 0;
function newRepo(name = `repo${++repoCount}`) {
  const dir = join(root, name);
  fs.mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  return dir;
}
let fileCount = 0;
function commit(dir, message) {
  fs.writeFileSync(join(dir, `f${++fileCount}.txt`), String(fileCount));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}
// Runs the script with spawn, so the fake server in this process keeps answering.
function sync(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const runEnv = { ...process.env, ...env, ...extraEnv };
    for (const k of Object.keys(runEnv))
      if (runEnv[k] === undefined) delete runEnv[k];
    const p = spawn(process.execPath, [SCRIPT, ...args], { env: runEnv });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
    });
    p.stderr.on("data", (d) => {
      out += d;
    });
    p.on("error", reject);
    p.on("close", (status) => resolve({ status, out, end: Date.now() }));
  });
}
const waitFor = async (ok, ms = 30000) => {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until)
    await new Promise((r) => setTimeout(r, 200));
};

const repo = newRepo("project-a");
const repoWs = wsOf(repo);
let failed = 0;
async function test(name, fn) {
  items = [];
  calls = [];
  delayMs = 0;
  leakToken = false;
  extraEvent = false;
  failOnce = null;
  trackerWs = repoWs;
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message.split("\n").join("\n     ")}`);
  }
}

await test("a done line moves exactly the one item whose step matches, with proof and one comment", async () => {
  items = [
    item("t1", "P9-1", "in-progress"),
    item("t2", "P9-1 S2", "in-progress"),
    item("t3", "p9-1", "to-do"),
  ];
  const sha = commit(repo, "feat: x\n\nStep: P9-1 done\n");
  const r = await sync(["--commit", repo, sha]);
  assert.equal(r.status, 0, `--commit must exit 0: ${r.out}`);
  assert.equal(
    get("t1").status,
    "done",
    "a 'Step: P9-1 done' line must set the item with step P9-1 to done",
  );
  assert.equal(
    get("t1").customFields.proof,
    sha,
    "the proof field must start with the commit sha (where-are-we runs git merge-base on it)",
  );
  assert.deepEqual(
    get("t1").comments,
    ["A commit in project-a marked this finished."],
    "one plain comment naming the repo, no hash",
  );
  assert.equal(
    get("t2").status,
    "in-progress",
    "an item whose step only starts with P9-1 must not move",
  );
  assert.equal(
    get("t3").status,
    "to-do",
    "an item whose step differs in letter case must not move (the list filter ignores case)",
  );
});

await test("the workspace asked for is the repo's top folder in Nimbalyst's spelling (backslashes on Windows)", async () => {
  items = [item("w1", "P9-40", "to-do")];
  const sha = commit(repo, "w\n\nStep: P9-40 done");
  const r = await sync(["--commit", repo, sha]);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(
    [...new Set(calls.map((c) => c.ws))],
    [wsOf(repo)],
    "every call must name the repo's top folder as the workspace",
  );
  assert.equal(
    get("w1").status,
    "done",
    "an item in the repo's own workspace must move",
  );
});

await test("a commit in a worktree goes to the main checkout's workspace", async () => {
  items = [item("v1", "P9-41", "to-do")];
  const wt = join(root, "project-a-wt");
  git(repo, "worktree", "add", "-q", "-b", "wt-branch", wt);
  const sha = commit(wt, "v\n\nStep: P9-41 done");
  const r = await sync(["--commit", wt, sha]);
  assert.equal(r.status, 0, r.out);
  assert.equal(
    get("v1").status,
    "done",
    "a worktree commit must move the item in the main checkout's workspace, not one named after the worktree",
  );
  git(repo, "worktree", "remove", "--force", wt);
});

await test("the map file sends a repo to another workspace; its folder matches ignoring case and slash kind", async () => {
  const mapped = newRepo("mapped");
  const target = WIN ? "C:/Shared/Tracker" : "/shared/tracker";
  const config = join(root, "map.json");
  const key = WIN
    ? mapped.replace(/\//g, "\\").toUpperCase()
    : mapped.toUpperCase();
  fs.writeFileSync(
    config,
    JSON.stringify({ workspaces: { [`${key}/`]: target } }),
  );
  trackerWs = WIN ? "C:\\Shared\\Tracker" : "/shared/tracker";
  items = [item("m1", "P9-42", "to-do")];
  const sha = commit(mapped, "m\n\nStep: P9-42 done");
  const r = await sync(["--commit", mapped, sha], {
    TRACKER_SYNC_CONFIG: config,
  });
  assert.equal(r.status, 0, r.out);
  assert.equal(
    get("m1").status,
    "done",
    "a repo in the map must sync to the mapped workspace",
  );
  assert.deepEqual(
    [...new Set(calls.map((c) => c.ws))],
    [trackerWs],
    "the mapped workspace must be asked for in Nimbalyst's spelling",
  );
  fs.writeFileSync(config, "{ not json");
  const bad = await sync(
    ["--commit", mapped, commit(mapped, "m2\n\nStep: P9-42 done")],
    { TRACKER_SYNC_CONFIG: config },
  );
  assert.notEqual(
    bad.status,
    0,
    "a broken map file must fail, not fall back to the repo's own workspace",
  );
  assert.match(
    readLog(),
    /map\.json is not valid JSON/,
    "a broken map file must be named in the log",
  );
});

await test("a running line sets in-progress; several Step lines in one commit move each item", async () => {
  items = [item("r1", "P9-2", "to-do"), item("r2", "P9-3", "in-progress")];
  const sha = commit(repo, "feat: y\n\nStep: P9-2 running\nStep: P9-3 done\n");
  const r = await sync(["--commit", repo, sha]);
  assert.equal(r.status, 0, r.out);
  assert.equal(
    get("r1").status,
    "in-progress",
    "a 'Step: P9-2 running' line must set in-progress",
  );
  assert.equal(
    get("r2").status,
    "done",
    "a second Step line in the same commit must move its item too",
  );
});

await test("an item already in that status is left alone: no update, no comment", async () => {
  items = [item("a1", "P9-4", "done")];
  const sha = commit(repo, "fix: z\n\nStep: P9-4 done");
  const r = await sync(["--commit", repo, sha]);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(
    calls.filter(
      (c) => c.name === "tracker_update" || c.name === "tracker_add_comment",
    ),
    [],
    "no write call for an item already done",
  );
  assert.match(readLog(), /P9-4.*already done/, "the no-op must be logged");
});

await test("an unknown step is logged and nothing moves", async () => {
  items = [item("u1", "P9-5", "to-do")];
  const sha = commit(repo, "chore: u\n\nStep: P9-404 done");
  const r = await sync(["--commit", repo, sha]);
  assert.equal(r.status, 0, r.out);
  assert.equal(get("u1").status, "to-do");
  assert.equal(
    calls.filter((c) => c.name === "tracker_update").length,
    0,
    "an unknown step must not update anything",
  );
  assert.match(
    readLog(),
    /P9-404.*no tracker item/,
    "an unknown step must be logged",
  );
});

await test("two items with the same step: none moves, and it is logged", async () => {
  items = [item("d1", "P9-6", "to-do"), item("d2", "P9-6", "to-do")];
  const sha = commit(repo, "chore: d\n\nStep: P9-6 done");
  const r = await sync(["--commit", repo, sha]);
  assert.equal(r.status, 0, r.out);
  assert.equal(
    get("d1").status,
    "to-do",
    "with two matches neither item may move",
  );
  assert.equal(
    get("d2").status,
    "to-do",
    "with two matches neither item may move",
  );
  assert.match(
    readLog(),
    /P9-6.*2 tracker items/,
    "two matches must be logged",
  );
});

await test("a commit with no Step line does nothing and calls nothing", async () => {
  const sha = commit(repo, "docs: no step line\n\nStep:P9-7 done (malformed)");
  const r = await sync(["--commit", repo, sha]);
  assert.equal(r.status, 0, r.out);
  assert.equal(calls.length, 0, "no Step line must mean no endpoint call");
});

await test("TRACKER_SYNC=off makes --commit do nothing", async () => {
  items = [item("z1", "P9-43", "to-do")];
  const sha = commit(repo, "z\n\nStep: P9-43 done");
  const r = await sync(["--commit", repo, sha], { TRACKER_SYNC: "off" });
  assert.equal(r.status, 0, r.out);
  assert.equal(
    calls.length,
    0,
    "TRACKER_SYNC=off must stop --commit from calling the endpoint",
  );
  assert.equal(get("z1").status, "to-do");
});

await test("Nimbalyst down: --commit logs one line and exits 0; --catch-up exits non-zero", async () => {
  items = [item("n1", "P9-8", "to-do")];
  const sha = commit(repo, "chore: n\n\nStep: P9-8 done");
  // A port that was just free: nothing listens there (fetch refuses some low ports like 1 on its own).
  const closed = http.createServer();
  await new Promise((r) => closed.listen(0, "127.0.0.1", r));
  const deadPort = closed.address().port;
  await new Promise((r) => closed.close(r));
  for (const [why, file] of [
    ["endpoint file missing", join(root, "no-such-endpoint.json")],
    ["connection refused", join(root, "dead-endpoint.json")],
  ]) {
    fs.writeFileSync(
      join(root, "dead-endpoint.json"),
      JSON.stringify({ port: deadPort, token: TOKEN }),
    );
    const before = readLog().split("\n").length;
    const r = await sync(["--commit", repo, sha], {
      TRACKER_SYNC_ENDPOINT_FILE: file,
    });
    assert.equal(
      r.status,
      0,
      `--commit must exit 0 when Nimbalyst is down (${why}): ${r.out}`,
    );
    const added = readLog().split("\n").length - before;
    assert.equal(
      added,
      1,
      `--commit must log exactly one line when Nimbalyst is down (${why}), got ${added}`,
    );
    assert.match(
      readLog(),
      /not running/,
      `the log must say Nimbalyst is not running (${why})`,
    );
    const c = await sync(["--catch-up"], {
      TRACKER_SYNC_ENDPOINT_FILE: file,
      TRACKER_SYNC_REPOS: JSON.stringify([[repo, "main"]]),
    });
    assert.notEqual(
      c.status,
      0,
      `--catch-up must exit non-zero when Nimbalyst is down (${why})`,
    );
    assert.match(
      c.out,
      /Nimbalyst is not running/,
      "--catch-up must say why it failed",
    );
  }
  assert.equal(get("n1").status, "to-do");
});

await test("catch-up: the first run records HEAD only; later runs sync only commits after the last synced one", async () => {
  const cu = newRepo("catchup");
  trackerWs = wsOf(cu);
  const repos = { TRACKER_SYNC_REPOS: JSON.stringify([[cu, "main"]]) };
  items = [
    item("c1", "P9-10", "to-do"),
    item("c2", "P9-11", "to-do"),
    item("c3", "P9-12", "to-do"),
    item("c4", "P9-13", "to-do"),
  ];
  commit(cu, "old\n\nStep: P9-10 done");
  let r = await sync(["--catch-up"], repos);
  assert.equal(r.status, 0, r.out);
  assert.equal(
    get("c1").status,
    "to-do",
    "the first catch-up must not sync commits older than its start",
  );
  commit(cu, "new 1\n\nStep: P9-11 done");
  const viaHook = commit(cu, "new 2\n\nStep: P9-12 running");
  r = await sync(["--commit", cu, viaHook]);
  assert.equal(r.status, 0, r.out);
  commit(cu, "new 3\n\nStep: P9-13 done");
  calls = [];
  r = await sync(["--catch-up"], repos);
  assert.equal(r.status, 0, r.out);
  assert.equal(
    get("c1").status,
    "to-do",
    "a commit before the recorded start must stay unsynced",
  );
  assert.equal(
    get("c2").status,
    "done",
    "a commit after the last synced one must be synced",
  );
  assert.equal(get("c4").status, "done", "every later commit must be synced");
  assert.equal(
    stepCalls("P9-12").length,
    0,
    "a commit --commit already synced must not be looked up again by catch-up",
  );
  calls = [];
  r = await sync(["--catch-up"], repos);
  assert.equal(r.status, 0, r.out);
  assert.equal(
    calls.length,
    0,
    "a second catch-up with no new commits must call nothing",
  );
});

await test("catch-up with no repo list walks the repos the state knows and the map's, on their current branch", async () => {
  const own = {
    TRACKER_SYNC_STATE_DIR: join(root, "state-walk"),
    TRACKER_SYNC_CONFIG: join(root, "walk-map.json"),
  };
  const known = newRepo("known");
  const onlyMapped = newRepo("only-mapped");
  const gone = newRepo("gone");
  commit(onlyMapped, "start");
  fs.writeFileSync(
    own.TRACKER_SYNC_CONFIG,
    JSON.stringify({ workspaces: { [onlyMapped]: onlyMapped } }),
  );
  trackerWs = wsOf(known);
  items = [item("k1", "P9-44", "to-do"), item("k2", "P9-45", "to-do")];
  let r = await sync(
    ["--commit", known, commit(known, "a\n\nStep: P9-44 done")],
    own,
  );
  assert.equal(r.status, 0, r.out);
  r = await sync(
    ["--commit", gone, commit(gone, "g\n\nStep: P9-99 done")],
    own,
  );
  fs.rmSync(gone, { recursive: true, force: true });
  git(known, "checkout", "-q", "-b", "feature");
  r = await sync(["--catch-up"], own);
  assert.equal(r.status, 0, `a gone folder must not fail catch-up: ${r.out}`);
  assert.match(
    r.out,
    /known: first catch-up, recorded HEAD/,
    "a repo known only from --commit must be walked",
  );
  assert.match(
    r.out,
    /only-mapped: first catch-up/,
    "a repo in the map must be walked",
  );
  assert.match(
    r.out,
    /gone: the folder is gone; dropped/,
    "a known repo whose folder is gone must be dropped",
  );
  commit(known, "b\n\nStep: P9-45 done");
  r = await sync(["--catch-up"], own);
  assert.equal(r.status, 0, r.out);
  assert.equal(
    get("k2").status,
    "done",
    "catch-up must walk the current branch's HEAD, not a fixed branch name",
  );
});

await test("the token never appears in the log, even when the endpoint echoes it in an error", async () => {
  items = [item("k1", "P9-14", "to-do")];
  leakToken = true;
  const sha = commit(repo, "chore: k\n\nStep: P9-14 done");
  const r = await sync(["--commit", repo, sha]);
  assert.notEqual(
    r.status,
    0,
    "an endpoint error that is not 'not running' must exit non-zero",
  );
  assert.match(readLog(), /HTTP 500/, "the endpoint error must be logged");
  assert.ok(
    !readLog().includes(TOKEN),
    "the bearer token must never be written to the log",
  );
  assert.ok(!r.out.includes(TOKEN), "the bearer token must never be printed");
});

await test("forward only: running never moves an item back; done never reopens wont-do or duplicate", async () => {
  items = [
    item("f1", "P9-20", "done"),
    item("f2", "P9-21", "wont-do"),
    item("f3", "P9-22", "waits-for-you"),
    item("f4", "P9-23", "in-progress"),
    item("f5", "P9-24", "duplicate"),
    item("f6", "P9-25", undefined),
  ];
  const sha = commit(
    repo,
    "replayed\n\nStep: P9-20 running\nStep: P9-21 done\nStep: P9-22 running\nStep: P9-23 running\nStep: P9-24 done\nStep: P9-25 running",
  );
  const r = await sync(["--commit", repo, sha]);
  assert.equal(r.status, 0, r.out);
  assert.equal(
    get("f1").status,
    "done",
    "a replayed running line must not move a done item back",
  );
  assert.equal(
    get("f2").status,
    "wont-do",
    "a done line must not reopen a wont-do item",
  );
  assert.equal(
    get("f5").status,
    "duplicate",
    "a done line must not reopen a duplicate item",
  );
  assert.equal(
    get("f3").status,
    "in-progress",
    "running must move a waits-for-you item",
  );
  assert.equal(
    get("f6").status,
    "in-progress",
    "running must move an item with no status",
  );
  assert.deepEqual(
    calls
      .filter((c) => c.name === "tracker_update")
      .map((c) => c.args.id)
      .sort(),
    ["f3", "f6"],
    "only the forward moves may write",
  );
  assert.match(readLog(), /P9-20.*skipped/, "a skipped move must be logged");
});

await test("proof: the sha first; a session id after the old sha is kept", async () => {
  items = [item("p1", "P9-26", "to-do")];
  get("p1").customFields.proof = "0123abc sess-42";
  const sha = commit(repo, "p\n\nStep: P9-26 done");
  const r = await sync(["--commit", repo, sha]);
  assert.equal(r.status, 0, r.out);
  assert.equal(
    get("p1").customFields.proof,
    `${sha} sess-42`,
    "the old proof's session id must stay after the new sha",
  );
});

await test("an SSE answer with a notification event before the reply is read by its id", async () => {
  items = [item("e1", "P9-27", "to-do")];
  extraEvent = true;
  const sha = commit(repo, "e\n\nStep: P9-27 done");
  const r = await sync(["--commit", repo, sha]);
  assert.equal(
    r.status,
    0,
    `the reply with the request's id must be used, not the first event: ${r.out}`,
  );
  assert.equal(get("e1").status, "done");
});

await test("the comment is written before the status, so a failed comment leaves the status for the retry", async () => {
  items = [item("o1", "P9-28", "to-do")];
  failOnce = "tracker_add_comment";
  const sha = commit(repo, "o\n\nStep: P9-28 done");
  let r = await sync(["--commit", repo, sha]);
  assert.equal(r.status, 1, "a failed tool call must exit 1");
  assert.equal(
    get("o1").status,
    "to-do",
    "the status must not change before the comment is written",
  );
  r = await sync(["--commit", repo, sha]);
  assert.equal(r.status, 0, r.out);
  assert.equal(get("o1").status, "done", "the retry must finish the move");
  assert.equal(
    get("o1").comments.length,
    1,
    "the retry must write the comment once",
  );
});

await test("a commit that could not sync is pending; catch-up retries it first, on any branch", async () => {
  const pr = newRepo("pending");
  trackerWs = wsOf(pr);
  items = [item("q1", "P9-29", "to-do")];
  commit(pr, "base");
  git(pr, "checkout", "-q", "-b", "side");
  const sha = commit(pr, "side work\n\nStep: P9-29 done");
  git(pr, "checkout", "-q", "main");
  const r = await sync(["--commit", pr, sha], {
    TRACKER_SYNC_ENDPOINT_FILE: join(root, "no-such-endpoint.json"),
  });
  assert.equal(r.status, 0, r.out);
  assert.ok(
    readState().pending.some((p) => p.sha === sha),
    "a commit that could not sync must be recorded as pending",
  );
  const c = await sync(["--catch-up"], {
    TRACKER_SYNC_REPOS: JSON.stringify([[pr, "main"]]),
  });
  assert.equal(c.status, 0, c.out);
  assert.equal(
    get("q1").status,
    "done",
    "catch-up must sync a pending commit even when it is not on the walked branch",
  );
  assert.ok(
    !readState().pending.some((p) => p.sha === sha),
    "a synced pending commit must leave the pending list",
  );
});

await test("the state lock: a fresh lock is waited for, a stale one (over 60 s) is taken over", async () => {
  const lock = join(stateDir, "tracker-sync.json.lock");
  items = [item("l1", "P9-31", "to-do")];
  const sha = commit(repo, "l\n\nStep: P9-31 done");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(lock, "other");
  const t0 = Date.now();
  const run = sync(["--commit", repo, sha]);
  await new Promise((r) => setTimeout(r, 1500));
  fs.rmSync(lock, { force: true });
  const r = await run;
  assert.equal(r.status, 0, r.out);
  assert.ok(
    r.end - t0 >= 1400,
    `the state write must wait while another process holds the lock (ended after ${r.end - t0} ms)`,
  );
  assert.ok(
    Object.values(readState().repos).some((s) => s.synced.includes(sha)),
    "the sha must be recorded after the lock is free",
  );
  items = [item("l2", "P9-32", "to-do")];
  const sha2 = commit(repo, "l2\n\nStep: P9-32 done");
  fs.writeFileSync(lock, "stale");
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(lock, old, old);
  const r2 = await sync(["--commit", repo, sha2]);
  assert.equal(r2.status, 0, r2.out);
  assert.ok(
    Object.values(readState().repos).some((s) => s.synced.includes(sha2)),
    "a stale lock must not block the state write",
  );
  assert.ok(!fs.existsSync(lock), "the lock must be removed after the write");
});

await test("no endpoint file given: Windows needs APPDATA (a clear error); a Mac or Linux looks under the home folder", async () => {
  items = [item("x1", "P9-33", "to-do")];
  const sha = commit(repo, "x\n\nStep: P9-33 done");
  const r = await sync(["--commit", repo, sha], {
    APPDATA: undefined,
    TRACKER_SYNC_ENDPOINT_FILE: undefined,
  });
  if (WIN) {
    assert.match(
      readLog(),
      /APPDATA is not set/,
      "a missing APPDATA must be named in the log",
    );
    assert.notEqual(
      r.status,
      0,
      "a missing APPDATA is an error, not 'Nimbalyst not running'",
    );
  } else {
    const base =
      process.platform === "darwin"
        ? join(home, "Library", "Application Support")
        : join(home, ".config");
    assert.ok(
      readLog().includes(
        `no endpoint file ${join(base, "@nimbalyst", "electron", "mcp-endpoint.json")}`,
      ),
      `off Windows the endpoint file must be Nimbalyst's under ${base}: ${r.out}`,
    );
    assert.equal(
      r.status,
      0,
      "off Windows a missing endpoint file means Nimbalyst is not running: exit 0",
    );
  }
});

await test("catch-up: one repo failing is logged, the next repo still syncs, and the run exits non-zero", async () => {
  const good = newRepo("good");
  trackerWs = wsOf(good);
  items = [item("g1", "P9-30", "to-do")];
  commit(good, "start");
  let r = await sync(["--catch-up"], {
    TRACKER_SYNC_REPOS: JSON.stringify([[good, "main"]]),
  });
  assert.equal(r.status, 0, r.out);
  commit(good, "g\n\nStep: P9-30 done");
  const bad = join(root, "not-a-repo");
  fs.mkdirSync(bad, { recursive: true });
  r = await sync(["--catch-up"], {
    TRACKER_SYNC_REPOS: JSON.stringify([
      [bad, "main"],
      [good, "main"],
    ]),
  });
  assert.notEqual(
    r.status,
    0,
    "a failed repo must make catch-up exit non-zero",
  );
  assert.equal(
    get("g1").status,
    "done",
    "a failed repo must not stop the next repo",
  );
  assert.match(readLog(), /not-a-repo/, "the failed repo must be logged");
});

// ---- --install / --uninstall and the hook ----
const hooksDir = (dir) => join(dir, ".git", "hooks");
const read = (f) => fs.readFileSync(f, "utf8");

await test("--install on a repo with no post-commit writes one; twice changes nothing; --uninstall deletes it", async () => {
  const ir = newRepo("install-new");
  const file = join(hooksDir(ir), "post-commit");
  let r = await sync(["--install", ir]);
  assert.equal(r.status, 0, r.out);
  assert.equal(
    r.out.trim().split("\n").length,
    1,
    `--install must print one line: ${r.out}`,
  );
  assert.match(
    r.out,
    /wrote the post-commit hook/,
    "--install must say it wrote the hook",
  );
  const first = read(file);
  assert.match(
    first,
    /tracker-sync-hook\.sh/,
    "the written hook must run the hook body from ~/.claude/workers",
  );
  r = await sync(["--install", ir]);
  assert.match(
    r.out,
    /already in .*nothing changed/,
    "a second --install must say nothing changed",
  );
  assert.equal(
    read(file),
    first,
    "a second --install must not change the hook",
  );
  r = await sync(["--uninstall", ir]);
  assert.equal(r.status, 0, r.out);
  assert.ok(
    !fs.existsSync(file),
    "--uninstall must delete the hook --install wrote",
  );
});

await test("--install on a repo with its own post-commit appends one line; --uninstall restores it exactly", async () => {
  const ir = newRepo("install-own");
  const file = join(hooksDir(ir), "post-commit");
  for (const own of [
    "#!/bin/sh\necho mine > ran-own-hook.txt\n",
    "#!/usr/bin/env bash\necho mine > ran-own-hook.txt",
  ]) {
    fs.writeFileSync(file, own, { mode: 0o755 });
    let r = await sync(["--install", ir]);
    assert.equal(r.status, 0, r.out);
    assert.match(
      r.out,
      /added one line to the existing/,
      "--install must say it added a line",
    );
    const after = read(file);
    assert.ok(
      after.startsWith(own),
      "the existing hook's text must stay as it was",
    );
    assert.equal(
      after.slice(own.length).trim().split("\n").length,
      1,
      "--install must add exactly one line",
    );
    r = await sync(["--install", ir]);
    assert.equal(
      read(file),
      after,
      "a second --install must not add the line again",
    );
    r = await sync(["--uninstall", ir]);
    assert.equal(r.status, 0, r.out);
    assert.equal(
      read(file),
      own,
      "--uninstall must take out exactly what --install added",
    );
  }
  fs.writeFileSync(file, "#!/usr/bin/env python3\nprint('mine')\n");
  const r = await sync(["--install", ir]);
  assert.notEqual(
    r.status,
    0,
    "a post-commit that is not a shell script must be refused",
  );
  assert.equal(
    read(file),
    "#!/usr/bin/env python3\nprint('mine')\n",
    "a refused hook must be left as it was",
  );
});

await test("--install from a worktree writes into the shared hooks folder", async () => {
  const main = newRepo("install-wt");
  commit(main, "base");
  const wt = join(root, "install-wt-2");
  git(main, "worktree", "add", "-q", "-b", "wt2", wt);
  const r = await sync(["--install", wt]);
  assert.equal(r.status, 0, r.out);
  assert.ok(
    fs.existsSync(join(hooksDir(main), "post-commit")),
    "a worktree's hook must go into the main checkout's hooks folder, which every worktree runs",
  );
});

await test("the installed hook returns at once, the item moves in the background, and the repo's own hook still runs", async () => {
  const hr = newRepo("hooked");
  trackerWs = wsOf(hr);
  fs.writeFileSync(
    join(hooksDir(hr), "post-commit"),
    "#!/bin/sh\necho mine > ran-own-hook.txt\n",
  );
  assert.equal((await sync(["--install", hr])).status, 0);
  items = [item("h1", "P9-15", "to-do")];
  delayMs = 3000;
  const hookEnv = { ...process.env, ...env };
  fs.writeFileSync(join(hr, "a.txt"), "a");
  git(hr, "add", "-A");
  const t0 = Date.now();
  const c = spawnSync(
    "git",
    ["commit", "-q", "-m", "feat: h\n\nStep: P9-15 done"],
    { cwd: hr, encoding: "utf8", env: hookEnv },
  );
  const took = Date.now() - t0;
  assert.equal(c.status, 0, `the commit must succeed: ${c.stderr}`);
  assert.ok(
    took < 2500,
    `the hook must not wait for the endpoint (commit took ${took} ms, endpoint delay 3000 ms)`,
  );
  assert.ok(
    fs.existsSync(join(hr, "ran-own-hook.txt")),
    "the repo's own post-commit must still run",
  );
  await waitFor(() => get("h1").status === "done");
  assert.equal(
    get("h1").status,
    "done",
    "the background sync started by the hook must move the item",
  );
  // A commit with no Step line starts nothing, and nor does TRACKER_SYNC=off.
  calls = [];
  delayMs = 0;
  for (const [msg, extra] of [
    ["docs: nothing", {}],
    ["off\n\nStep: P9-15 done", { TRACKER_SYNC: "off" }],
  ]) {
    fs.writeFileSync(join(hr, `${calls.length}${Date.now()}.txt`), "b");
    git(hr, "add", "-A");
    spawnSync("git", ["commit", "-q", "-m", msg], {
      cwd: hr,
      env: { ...hookEnv, ...extra },
    });
  }
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(
    calls.length,
    0,
    "a commit with no Step line, or with TRACKER_SYNC=off, must not start a sync",
  );
});

await test("on a PC without the setup the hook does nothing, prints nothing and never fails the commit", async () => {
  const nr = newRepo("no-setup");
  assert.equal((await sync(["--install", nr])).status, 0);
  commit(nr, "base\n\nStep: P9-16 done");
  const bare = {
    ...process.env,
    ...env,
    HOME: emptyHome,
    USERPROFILE: emptyHome,
  };
  const direct = spawnSync("sh", [HOOK], {
    cwd: nr,
    encoding: "utf8",
    env: bare,
  });
  assert.equal(
    direct.status,
    0,
    `the hook body must exit 0 when ~/.claude/workers/tracker-sync.mjs is missing: ${direct.stderr}`,
  );
  assert.equal(
    direct.stdout + direct.stderr,
    "",
    "the hook body must print nothing when the worker is missing",
  );
  fs.writeFileSync(join(nr, "c.txt"), "c");
  git(nr, "add", "-A");
  const c = spawnSync("git", ["commit", "-q", "-m", "c\n\nStep: P9-16 done"], {
    cwd: nr,
    encoding: "utf8",
    env: bare,
  });
  assert.equal(
    c.status,
    0,
    `the commit must succeed without the setup: ${c.stderr}`,
  );
  assert.equal(
    c.stderr,
    "",
    "the installed line must print nothing when the setup is not there",
  );
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(
    calls.length,
    0,
    "without the setup nothing may call the endpoint",
  );
});

server.close();
// The hook's background sync can still hold the log open for a moment.
fs.rmSync(root, {
  recursive: true,
  force: true,
  maxRetries: 20,
  retryDelay: 250,
});
await test("saving the state rides out a file held open for a moment (Windows EPERM), but not other errors", async () => {
  const { renameRetry } = await import(
    new URL("../workers/tracker-sync.mjs", import.meta.url)
  );
  let tries = 0;
  const busyTwice = () => {
    if (++tries <= 2)
      throw Object.assign(new Error("EPERM: operation not permitted, rename"), {
        code: "EPERM",
      });
  };
  renameRetry("a", "b", busyTwice);
  assert.equal(tries, 3);
  tries = 0;
  const missing = () => {
    tries++;
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
  assert.throws(() => renameRetry("a", "b", missing), /ENOENT/);
  assert.equal(tries, 1);
});

if (failed) {
  console.log(`${failed} test(s) failed`);
  process.exit(1);
}
console.log("all tracker-sync tests passed");
