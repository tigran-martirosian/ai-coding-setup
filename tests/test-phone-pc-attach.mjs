// Tests for files and photos from the phone (skills/phone-bot/pc/actions/attach.mjs, the attach place in
// core/files.mjs, and the attachments of session.send, session.queue and session.new). The page's channel
// session and the PC's channel are joined in this process, so each file arrives as real stream pieces; a fake
// door and a fixture nimbalyst.sqlite in a temp home stand in for Nimbalyst, and TEMP is a temp folder.
// Run: node tests/test-phone-pc-attach.mjs
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PC = path.join(ROOT, "skills", "phone-bot", "pc");
const PAGE = path.join(ROOT, "phone", "page");

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const show = (v) => JSON.stringify(v)?.slice(0, 400);
const sha = (b) => createHash("sha256").update(b).digest("hex");

// ---- a temp home and a temp TEMP for this whole run
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-pc-attach-"));
const home = path.join(tmp, "home");
const temp = path.join(tmp, "temp");
for (const d of [home, temp]) fs.mkdirSync(d, { recursive: true });
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
  TEMP: temp,
  TMP: temp,
  TMPDIR: temp,
});
// Where the PC program looks for Nimbalyst's data (core/files.mjs nimbalystDir), on each system.
const NIM =
  process.platform === "win32"
    ? path.join(process.env.APPDATA, "@nimbalyst", "electron")
    : path.join(
        os.homedir(),
        ...(process.platform === "darwin"
          ? ["Library", "Application Support"]
          : [".config"]),
        "@nimbalyst",
        "electron",
      );
fs.mkdirSync(path.join(NIM, "sqlite-db"), { recursive: true });

const P = {
  alpha: path.join(tmp, "projects", "alpha"),
  beta: path.join(tmp, "projects", "beta"),
  linked: path.join(tmp, "projects", "linked"),
};
for (const p of Object.values(P)) fs.mkdirSync(p, { recursive: true });

// ---- the fixture database: the tables the actions read
const fx = new DatabaseSync(path.join(NIM, "sqlite-db", "nimbalyst.sqlite"));
fx.exec(`
  CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT,
    provider_session_id TEXT, worktree_id TEXT, model TEXT, metadata TEXT NOT NULL DEFAULT '{}',
    is_archived INTEGER NOT NULL DEFAULT 0, is_pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL);
  CREATE TABLE ai_agent_messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'claude-code', direction TEXT NOT NULL, content TEXT NOT NULL, message_kind TEXT);
  CREATE TABLE queued_prompts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, prompt TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE worktrees (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, path TEXT NOT NULL);
`);
let idn = 0;
const addSession = (workspace, title, status = "idle") => {
  const id = `00000000-0000-4000-8000-${(++idn).toString(16).padStart(12, "0")}`;
  const now = new Date().toISOString();
  fx.prepare(
    `INSERT INTO ai_sessions (id, workspace_id, title, status, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'claude-code:opus', ?, ?)`,
  ).run(id, workspace, title, status, now, now);
  return id;
};
const S = {
  alpha: addSession(P.alpha, "Alpha"),
  alphaBroken: addSession(P.alpha, "Alpha, whose send fails"),
  alphaBusy: addSession(P.alpha, "Alpha, working", "running"),
  beta: addSession(P.beta, "Beta"),
  linked: addSession(P.linked, "Linked"),
};

// ---- the fake door: send_prompt fails for alphaBroken, queues for a running session
const { startFakeDoor } = await import("./phone-bot/fake-door.mjs");
const queued = [];
const door = await startFakeDoor({
  endpointFile: path.join(NIM, "mcp-endpoint.json"),
  workspaces: Object.entries(P).map(([name, p]) => ({ name, path: p })),
  tools: [
    "workspace_open",
    "get_session_status",
    "list_queued_prompts",
    "send_prompt",
    "list_recent_sessions",
    "spawn_session",
  ],
  handle(name, a, call) {
    if (name === "workspace_open") return "opened";
    if (name === "list_queued_prompts")
      return {
        sessionId: a.sessionId,
        count: queued.length,
        prompts: queued.map((q) => ({
          id: q.id,
          status: "pending",
          createdAt: 0,
          promptPreview: q.prompt.slice(0, 300),
        })),
      };
    if (name === "send_prompt") {
      if (a.sessionId === S.alphaBroken)
        throw { rpc: "no such session in this window" };
      if (a.sessionId === S.alphaBusy) {
        queued.push({ id: `queued-${queued.length + 1}`, prompt: a.prompt });
        return { statusBeforeQueue: "running", processingTriggered: false };
      }
      return { statusBeforeQueue: "idle", processingTriggered: true };
    }
    if (name === "list_recent_sessions") return `1. "Alpha" (${S.alpha}) - now`;
    if (name === "spawn_session")
      return { sessionId: addSession(call.workspacePath, "Spawned") };
    throw new Error(`the fake door has no ${name}`);
  },
});
const callsOf = (name, from = 0) =>
  door.calls.slice(from).filter((c) => c.name === name);

// ---- the linked project's key folder is a link to a folder outside the attach root
const { attachKey } = await import(
  pathToFileURL(path.join(PC, "core", "files.mjs")).href
);
const ROOT_DIR = path.join(temp, "nimbalyst-attachments");
const elsewhere = path.join(tmp, "elsewhere");
fs.mkdirSync(elsewhere, { recursive: true });
fs.mkdirSync(ROOT_DIR, { recursive: true });
fs.symlinkSync(elsewhere, path.join(ROOT_DIR, attachKey(P.linked)), "junction");
const placeOf = (p) => path.join(ROOT_DIR, attachKey(p), "saved", "phone");

// Every file under a folder, without following links.
const filesUnder = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (!e.isSymbolicLink()) out.push(p);
    }
  };
  walk(dir);
  return out;
};
const tempBefore = new Set(filesUnder(temp));

// ---- the real registry with every action module, the PC's channel and the page's channel session
const seal = await import("../phone/shared/seal.mjs");
const { createChannel } = await import(
  pathToFileURL(path.join(PC, "core", "channel.mjs")).href
);
const { createRegistry } = await import(
  pathToFileURL(path.join(PC, "core", "registry.mjs")).href
);
const { projectHandle } = await import(
  pathToFileURL(path.join(PC, "core", "door.mjs")).href
);
const attach = await import(
  pathToFileURL(path.join(PC, "actions", "attach.mjs")).href
);
const pageChannel = await import(
  pathToFileURL(path.join(PAGE, "frame", "channel.js")).href
);
const registry = createRegistry();
await registry.load(path.join(PC, "actions"));
const K = seal.randomBytes(32);
const dev = seal.toB64u(seal.randomBytes(16));
const toPage = new Set();
const channel = createChannel({
  keys: { devices: [{ device: dev, K: seal.toB64u(K) }] },
  send: (f) =>
    setImmediate(() => {
      for (const fn of [...toPage]) fn(f);
    }),
  registry,
  context: () => ({ page: "ok", setupVersion: "0.0.0" }),
  pcVersion: "0.0.0",
});
const link = {
  send(f) {
    setImmediate(() => channel.onApp(f));
  },
  listen(fn) {
    toPage.add(fn);
    return () => toPage.delete(fn);
  },
  next(match, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error("no answer"));
      }, ms);
      const off = link.listen((f) => {
        if (!match(f)) return;
        clearTimeout(timer);
        off();
        resolve(f);
      });
    });
  },
  onClose: () => () => {},
  buffered: 0,
};
// Another paired device, asking the registry straight (it sends no stream here).
const other = (a, d) =>
  registry.handle(
    { k: "req", id: "other", a, d },
    { page: "ok", device: "dev-other", push: () => {}, takeStream: () => null },
  );

const MB = 1024 * 1024;
const withHead = (head, size, fill = null) => {
  const b = fill === null ? randomBytes(size) : Buffer.alloc(size, fill);
  Buffer.from(head).copy(b);
  return new Uint8Array(b);
};
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const text = (s) => new Uint8Array(Buffer.from(s, "utf8"));
const NAME = /^\d{8}-\d{6}-\d+_/;

let failure = null;
try {
  const session = await pageChannel.openSession(link, {
    K,
    dev,
    pageVersion: "0.0.0",
    onEvent: () => {},
  });
  const ask = (a, d) => session.ask(a, d);
  const put = async (bytes, name, where = { session: S.alpha }, mime = "") => {
    const sent = await session.sendStream(
      bytes,
      mime || "application/octet-stream",
    );
    return ask("attach.put", { stream: sent.d.stream, name, ...where });
  };
  const savedName = (place, id, r) => {
    const files = fs.existsSync(place) ? fs.readdirSync(place) : [];
    return { files, r, id };
  };

  // ---- a 3 MB picture arrives whole from 16 pieces; the prompt names it with Nimbalyst's block
  const pic = withHead(PNG_HEAD, 3 * MB);
  const p1 = await put(pic, "IMG_4021.png", { session: S.alpha }, "image/png");
  const alphaPlace = fs.realpathSync.native(placeOf(P.alpha));
  const picFiles = fs.readdirSync(alphaPlace);
  const picName = picFiles.find((f) => f.endsWith("_IMG_4021.png"));
  check(
    "attach.put of a 3 MB PNG answers a 16-hex id and saves it whole under <time>-<n>_<stem>.png",
    p1.ok === true &&
      /^[0-9a-f]{16}$/.test(p1.d.id) &&
      Object.keys(p1.d).join() === "id" &&
      NAME.test(picName ?? "") &&
      sha(fs.readFileSync(path.join(alphaPlace, picName))) === sha(pic),
    show(savedName(alphaPlace, p1.d?.id, p1)),
  );
  const m1 = door.calls.length;
  const s1 = await ask("session.send", {
    session: S.alpha,
    text: "What is on this picture?",
    attachments: [p1.d.id],
  });
  const prompt1 = callsOf("send_prompt", m1)[0]?.args.prompt;
  check(
    "session.send appends after one empty line the block with the saved name and its full path",
    s1.ok === true &&
      // sendPrompt adds its phone note after the block, as after any text.
      prompt1?.startsWith(
        `What is on this picture?\n\nAttached files (open each with your read tool):\n- ${picName}: ${path.join(alphaPlace, picName)}\n\n`,
      ),
    show({ s1, prompt1 }),
  );

  // ---- used once: the same id again is unknown, and nothing is sent
  const m2 = door.calls.length;
  const again = await ask("session.send", {
    session: S.alpha,
    text: "Again",
    attachments: [p1.d.id],
  });
  check(
    "a used id gives attachment-unknown and sends nothing",
    again.err === "attachment-unknown" &&
      callsOf("send_prompt", m2).length === 0,
    show(again),
  );

  // ---- refused by its rule: over the cap, a kind off the list
  const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
  const p2 = await put(withHead(PDF_HEAD, 10 * MB + 1, 0x41), "scan.pdf");
  check(
    "a PDF over 10 MB is refused with too-big",
    p2.ok === false && p2.err === "too-big",
    show(p2),
  );
  const zip = withHead([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00], 4096);
  const p3 = await put(
    zip,
    "project-backup.zip",
    { session: S.alpha },
    "image/png",
  );
  check(
    "a zip (named a PNG by the phone) is refused by its bytes with kind-not-allowed",
    p3.ok === false && p3.err === "kind-not-allowed",
    show(p3),
  );

  // ---- a name with a path in it: the folder part dropped, the file inside the attach place
  const p4 = await put(
    text("notes\n"),
    "..\\..\\..\\Windows/../evil\\Notes v2!.MD",
  );
  const p5 = await put(text("Write-Host hi\n"), "C:\\scripts\\deploy.ps1");
  const p6 = await put(text("not a secret\n"), "token-notes.txt");
  const after = fs.readdirSync(alphaPlace);
  check(
    "a name with a path keeps only its last part, cut to safe characters, inside the attach place",
    p4.ok === true &&
      after.some((f) => NAME.test(f) && f.endsWith("_Notes v2.md")),
    show({ p4, after }),
  );
  check(
    "a text file off the list is saved as .txt with its old extension in the stem; token-notes.txt is accepted",
    p5.ok === true &&
      after.some((f) => NAME.test(f) && f.endsWith("_deploy-ps1.txt")) &&
      p6.ok === true &&
      after.some((f) => f.endsWith("_token-notes.txt")),
    show({ p5, p6, after }),
  );

  // ---- the attach place refuses a link below TEMP
  const p7 = await put(text("hello\n"), "a.txt", { session: S.linked });
  check(
    "a link below TEMP on the way to the attach place gives attach-place and writes nothing there",
    p7.ok === false &&
      p7.err === "attach-place" &&
      filesUnder(elsewhere).length === 0,
    show({ p7, there: filesUnder(elsewhere) }),
  );

  // ---- another device, another project, one id twice, an unknown id
  const m3 = door.calls.length;
  const o1 = await other("session.send", {
    session: S.alpha,
    text: "Mine now",
    attachments: [p4.d.id],
  });
  const o2 = await other("attach.drop", { id: p4.d.id });
  const twice = await ask("session.send", {
    session: S.alpha,
    text: "Twice",
    attachments: [p4.d.id, p4.d.id],
  });
  const wrongProject = await ask("session.send", {
    session: S.beta,
    text: "Elsewhere",
    attachments: [p4.d.id],
  });
  const mixed = await ask("session.send", {
    session: S.alpha,
    text: "One good, one unknown",
    attachments: [p4.d.id, "0123456789abcdef"],
  });
  check(
    "another device's id, an id listed twice, another project's id and an unknown id each refuse the whole send with attachment-unknown",
    [o1, o2, twice, wrongProject, mixed].every(
      (r) => r.ok === false && r.err === "attachment-unknown",
    ) && callsOf("send_prompt", m3).length === 0,
    show({ o1, o2, twice, wrongProject, mixed }),
  );
  const badId = await ask("session.send", {
    session: S.alpha,
    text: "Bad",
    attachments: ["NOT-HEX"],
  });
  check(
    "an attachment that is not 16 hex is bad-input",
    badId.err === "bad-input" && badId.field === "attachments",
    show(badId),
  );

  // ---- a send that fails gives the ids back; the 20,000-character check runs before the block
  const m4 = door.calls.length;
  const broken = await ask("session.send", {
    session: S.alphaBroken,
    text: "This one fails",
    attachments: [p4.d.id, p5.d.id],
  });
  const long = "x".repeat(20000);
  const retry = await ask("session.send", {
    session: S.alpha,
    text: long,
    attachments: [p4.d.id, p5.d.id],
  });
  const retried = callsOf("send_prompt", m4).pop()?.args.prompt ?? "";
  check(
    "a failed send gives its ids back: the same ids then go with a 20,000-character text",
    broken.ok === false &&
      retry.ok === true &&
      retried.startsWith(
        `${long}\n\nAttached files (open each with your read tool):\n- `,
      ) &&
      (retried.match(/\n- \d{8}-\d{6}-\d+_/g) ?? []).length === 2,
    show({ broken, retry, tail: retried.slice(20000) }),
  );

  // ---- session.queue and session.new take attachments too
  const q = await put(text("queued\n"), "q.log", {
    project: projectHandle(P.alpha),
  });
  const queuedSend = await ask("session.queue", {
    session: S.alphaBusy,
    text: "Later",
    attachments: [q.d.id],
  });
  check(
    "session.queue sends the block with the message it queues",
    queuedSend.ok === true &&
      queuedSend.d.queued === true &&
      /^Later\n\nAttached files \(open each with your read tool\):\n- \d{8}-\d{6}-\d+_q\.log: /.test(
        queued.at(-1)?.prompt ?? "",
      ),
    show({ queuedSend, queued }),
  );
  const n = await put(text("new\n"), "n.csv", {
    project: projectHandle(P.alpha),
  });
  const m5 = door.calls.length;
  const made = await ask("session.new", {
    project: projectHandle(P.alpha),
    text: "Start here",
    attachments: [n.d.id],
  });
  const spawned = callsOf("spawn_session", m5)[0];
  check(
    "session.new sends the block with its first message",
    made.ok === true &&
      /\n\nAttached files \(open each with your read tool\):\n- \d{8}-\d{6}-\d+_n\.csv: /.test(
        JSON.stringify(spawned?.args ?? {}).replace(/\\n/g, "\n"),
      ),
    show({ made, spawned }),
  );

  // ---- attach.drop deletes the file; 8 unused files per device at most
  const d1 = await put(text("drop me\n"), "drop-me.txt");
  const dropped = await ask("attach.drop", { id: d1.d.id });
  const droppedAgain = await ask("attach.drop", { id: d1.d.id });
  check(
    "attach.drop deletes the unused file; its id is then unknown",
    dropped.ok === true &&
      !fs.readdirSync(alphaPlace).some((f) => f.endsWith("_drop-me.txt")) &&
      droppedAgain.err === "attachment-unknown",
    show({ dropped, droppedAgain }),
  );
  await ask("attach.drop", { id: p6.d.id });
  const many = [];
  for (let i = 0; i < 8; i++) many.push(await put(text(`${i}\n`), `f${i}.txt`));
  const ninth = await put(text("nine\n"), "f9.txt");
  check(
    "a ninth unused file of one device is refused with too-many and not kept",
    many.every((r) => r.ok === true) &&
      ninth.err === "too-many" &&
      !fs.readdirSync(alphaPlace).some((f) => f.endsWith("_f9.txt")),
    show({ many: many.map((r) => r.ok), ninth }),
  );
  for (const r of many) await ask("attach.drop", { id: r.d.id });

  // ---- nothing outside the attach place: every new file under TEMP is in a project's attach place
  const newInTemp = filesUnder(temp).filter((f) => !tempBefore.has(f));
  check(
    "every file written under TEMP is inside the attach place",
    newInTemp.length > 0 &&
      newInTemp.every((f) => path.dirname(f) === placeOf(P.alpha)),
    show(newInTemp),
  );

  // ---- clean-up: files older than 7 days go, newer ones stay
  const old = path.join(alphaPlace, "20200101-000000-1_old.txt");
  fs.writeFileSync(old, "old\n");
  const longAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(old, longAgo, longAgo);
  attach.cleanOld();
  check(
    "the clean-up deletes files older than 7 days and keeps the rest",
    !fs.existsSync(old) && fs.existsSync(path.join(alphaPlace, picName)),
  );

  // ---- a reopened page says hello again: the old channel session's unused files go, so the caps start empty
  const left = [];
  for (let i = 0; i < 8; i++)
    left.push(await put(text(`${i}\n`), `left${i}.txt`));
  const reopened = await pageChannel.openSession(link, {
    K,
    dev,
    pageVersion: "0.0.0",
    onEvent: () => {},
  });
  const putAgain = async (bytes, name) => {
    const sent = await reopened.sendStream(bytes, "text/plain");
    return reopened.ask("attach.put", {
      stream: sent.d.stream,
      name,
      session: S.alpha,
    });
  };
  const fresh = await putAgain(text("fresh\n"), "fresh.txt");
  const stale = await reopened.ask("attach.drop", { id: left[0].d.id });
  check(
    "a new hello deletes the old session's unused files; a pick after it is not refused",
    left.every((r) => r.ok === true) &&
      fresh.ok === true &&
      stale.err === "attachment-unknown" &&
      !fs.readdirSync(alphaPlace).some((f) => /_left\d\.txt$/.test(f)),
    show({ fresh, stale, files: fs.readdirSync(alphaPlace) }),
  );
  const isFresh = (f) => f.endsWith("_fresh.txt");
  const freshBefore = fs.readdirSync(alphaPlace).some(isFresh);
  channel.closeDevice(dev);
  check(
    "removing the device deletes its unused files",
    freshBefore && !fs.readdirSync(alphaPlace).some(isFresh),
    show(fs.readdirSync(alphaPlace)),
  );
} catch (e) {
  failure = e;
}

await door.close();
fx.close();
(await import("../skills/phone-bot/pc/core/db.mjs")).closeDb();
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
if (failure) {
  console.log(`FAIL the run stopped: ${failure.stack}`);
  failed++;
}
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
