// Tests for attach in the phone page's message box (phone/page/screens/session-attach.js and its part of
// session.js). The session screen runs in Node on a DOM stand-in and asks the real PC registry (actions/attach.mjs
// saves into a temp %TEMP%), which reads a fixture nimbalyst.sqlite and talks to a fake door. The channel's
// sendStream is a stand-in that hands the bytes to the registry's takeStream, and can hold or break an upload.
// Run: node tests/test-phone-page-attach.mjs
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
const show = (v) => JSON.stringify(v)?.slice(0, 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(20);
  }
}

// A temp home and %TEMP% for this run: the PC saves attachments under %TEMP%\nimbalyst-attachments.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-page-attach-"));
const home = path.join(tmp, "home");
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
  TEMP: path.join(tmp, "temp"),
  TMP: path.join(tmp, "temp"),
  TMPDIR: path.join(tmp, "temp"),
});
fs.mkdirSync(process.env.TEMP, { recursive: true });
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
const BETA = path.join(tmp, "projects", "beta");
fs.mkdirSync(BETA, { recursive: true });

// ---- the fixture database: a finished session and a working one
const fx = new DatabaseSync(path.join(NIM, "sqlite-db", "nimbalyst.sqlite"));
fx.exec(`
  CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT,
    provider_session_id TEXT, worktree_id TEXT, model TEXT, metadata TEXT NOT NULL DEFAULT '{}',
    is_archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE ai_agent_messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'claude-code', direction TEXT NOT NULL, content TEXT NOT NULL, message_kind TEXT);
  CREATE TABLE queued_prompts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, prompt TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE worktrees (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, path TEXT NOT NULL);
`);
let idn = 0;
const addSession = (title, status) => {
  const id = `00000000-0000-4000-8000-${(++idn).toString(16).padStart(12, "0")}`;
  const now = new Date().toISOString();
  fx.prepare(
    `INSERT INTO ai_sessions (id, workspace_id, title, status, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'claude-code:opus', ?, ?)`,
  ).run(id, BETA, title, status, now, now);
  return id;
};
const S = {
  idle: addSession("Finished", "idle"),
  idle2: addSession("Finished too", "idle"),
  running: addSession("Works", "running"),
};

// ---- the fake door
const door = {
  [S.idle]: { status: "idle" },
  [S.idle2]: { status: "idle" },
  [S.running]: { status: "running" },
};
function handle(name, a) {
  const s = door[a.sessionId];
  switch (name) {
    case "workspace_open":
      return "opened";
    case "get_session_status":
      return { status: s.status, waitingForInput: false };
    case "get_session_result":
      return { status: s.status, pendingPrompt: null };
    case "list_queued_prompts":
      return { sessionId: a.sessionId, count: 0, prompts: [] };
    case "send_prompt":
      return {
        statusBeforeQueue: s.status,
        processingTriggered: s.status === "idle",
      };
    default:
      throw new Error(`the fake door has no ${name}`);
  }
}
const { startFakeDoor } = await import("./phone-bot/fake-door.mjs");
const fake = await startFakeDoor({
  endpointFile: path.join(NIM, "mcp-endpoint.json"),
  workspaces: [{ name: "beta", path: BETA }],
  tools: [
    "workspace_open",
    "get_session_status",
    "get_session_result",
    "list_queued_prompts",
    "send_prompt",
  ],
  handle,
});
const prompts = (session) =>
  fake.calls.filter(
    (c) => c.name === "send_prompt" && c.args.sessionId === session,
  );

// ---- the real registry; streams the stand-in channel sent wait here for takeStream
const { createRegistry } = await import(
  "../skills/phone-bot/pc/core/registry.mjs"
);
const registry = createRegistry();
await registry.load(path.join(PC, "actions"));
const whole = new Map();
const pcCtx = {
  page: "ok",
  device: "dev-test",
  setupVersion: "0.0.0",
  push: () => {},
  onEnd: () => () => {},
  takeStream(id) {
    const kept = whole.get(id);
    whole.delete(id);
    return kept ?? null;
  },
};
let rn = 0;
const asked = [];
const ask = (a, d) => {
  asked.push({ a, d });
  return registry.handle({ k: "req", id: `r-${++rn}`, a, d }, pcCtx);
};
const askedOf = (a) => asked.filter((x) => x.a === a);

// The stand-in channel: `hold` keeps the next upload half way until released; `breakNext` ends it as a closed link.
const link = { hold: null, breakNext: false, streams: 0 };
let sn = 0;
async function sendStream(bytes, mime, onProgress) {
  link.streams++;
  onProgress(0.5);
  if (link.hold) await link.hold.promise;
  if (link.breakNext) {
    link.breakNext = false;
    throw Object.assign(new Error("closed"), { code: "closed" });
  }
  onProgress(1);
  const id = `s-${++sn}`;
  whole.set(id, { bytes: Buffer.from(bytes), mime });
  return { ok: true, d: { stream: id } };
}
const holdUploads = () => {
  let release;
  const promise = new Promise((r) => (release = r));
  link.hold = { promise, release };
};
const releaseUploads = () => {
  link.hold?.release();
  link.hold = null;
};

// ---- the page side: a DOM stand-in with what frame/dom.js and the session files use
class FakeNode {
  constructor() {
    this.childNodes = [];
  }
  append(...kids) {
    for (const k of kids)
      this.childNodes.push(k instanceof FakeNode ? k : new FakeText(String(k)));
  }
  replaceChildren(...kids) {
    this.childNodes = [];
    this.append(...kids);
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }
}
class FakeText extends FakeNode {
  constructor(text) {
    super();
    this.data = text;
  }
  get textContent() {
    return this.data;
  }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.className = "";
    this.attrs = {};
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.isConnected = true;
    this.style = { setProperty: (k, v) => (this.style[k] = String(v)) };
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.files = null;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  get scrollHeight() {
    return 22;
  }
  get clientHeight() {
    return 22;
  }
  get selectionEnd() {
    return this.value.length;
  }
  set selectionEnd(_) {}
  setSelectionRange() {}
  scrollIntoView() {}
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  fire(type, e = {}) {
    for (const fn of this.listeners[type] || []) fn({ target: this, ...e });
  }
  click() {
    this.fire("click");
  }
  focus() {}
  blur() {}
}
Object.assign(globalThis, {
  Node: FakeNode,
  document: {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
  },
  IntersectionObserver: class {
    observe() {}
    disconnect() {}
  },
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
});

const walk = (n, out = []) => {
  out.push(n);
  for (const c of n.childNodes) walk(c, out);
  return out;
};
const hasClass = (n, c) => n.className?.split(" ").includes(c);
const byClass = (root, c) => walk(root).filter((n) => hasClass(n, c));
const byTag = (root, t) => walk(root).filter((n) => n.tagName === t);

const pageUrl = (rel) => pathToFileURL(path.join(PAGE, rel)).href;
const screens = await import(pageUrl("frame/screens.js"));
await import(pageUrl("screens/session.js")); // registers the session screen

const projects = await ask("projects.list");
const beta = projects.d?.find((p) => p.name === "beta")?.project;

function drawSession(session) {
  const c = {
    connected: true,
    params: { session, project: beta, title: "t" },
    tg: { platform: "ios" },
    offered: () => true,
    ask,
    sendStream,
    go: () => {},
    onEvent: () => {},
    beforeSleep: () => () => {},
    haptic: () => {},
    mainButton: () => {},
    scrollBox: { scrollTop: 0, scrollHeight: 2000, clientHeight: 800 },
  };
  const out = screens.screen("session").render(c);
  const root = new FakeElement("div");
  root.append(out.content, out.bottom);
  return root;
}
// The parts of a drawn box, read fresh each time (the dock draws again after a load).
const box = (root) => {
  const main = byClass(root, "send")[0];
  return {
    field: byTag(root, "textarea")[0],
    main,
    input: byClass(root, "attach-pick")[0],
    clip: byClass(root, "clip")[0],
    chips: byClass(root, "chip"),
    lines: byClass(root, "chiplines")[0],
    compIn: byClass(root, "compose-in")[0],
  };
};
const type = (root, text) => {
  const { field } = box(root);
  field.value = text;
  field.fire("input");
};
const pick = (root, ...files) => {
  const { input } = box(root);
  input.files = files;
  input.fire("change");
};
// A real PNG's first bytes, so the PC finds a picture.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
]);
const photo = (name = "IMG_4021.png") =>
  new File([PNG], name, { type: "image/png" });
const textFile = (name) =>
  new File(["checkout failed at 12:01\n"], name, { type: "text/plain" });

let failure = null;
try {
  check(
    "projects.list names the fixture project",
    Boolean(beta),
    show(projects),
  );

  // ---- a picked photo: chip, upload, Send carries its id
  const a = drawSession(S.idle);
  await until(() => box(a).field);
  check(
    "the message box has the paperclip, labelled, with a hidden picker for photos and files",
    box(a).clip?.attrs["aria-label"] === "Attach a file or photo" &&
      !box(a).clip.hidden &&
      box(a).input?.attrs.type === "file" &&
      box(a).input.attrs.multiple === "" &&
      box(a).input.attrs.accept.includes("image/jpeg") &&
      box(a).input.attrs.accept.includes(".pdf"),
    show(box(a).input?.attrs),
  );
  type(a, "Why does checkout fail?");
  holdUploads();
  pick(a, photo());
  await until(() => link.streams === 1);
  const uploading = box(a);
  check(
    "a picked photo shows a chip with its name and the percent, and the box puts the field on its own line",
    uploading.chips.length === 1 &&
      uploading.chips[0].textContent.includes("IMG_4021.png") &&
      uploading.chips[0].textContent.includes("50%") &&
      byClass(uploading.chips[0], "bar").length === 1 &&
      hasClass(uploading.compIn, "has-files"),
    show(uploading.chips.map((c) => c.textContent)),
  );
  check(
    "Send is off while the file uploads, and the line says why",
    uploading.main.disabled &&
      uploading.lines.textContent.includes(
        "Uploading 1 file… Send waits for it.",
      ),
    show({ off: uploading.main.disabled, line: uploading.lines.textContent }),
  );
  releaseUploads();
  const put = await until(() =>
    box(a).chips[0]?.textContent.includes(" B") ? askedOf("attach.put") : null,
  );
  check(
    "the upload goes to the PC as a stream, attach.put names the session and the file, and the chip shows its size",
    put?.length === 1 &&
      put[0].d.session === S.idle &&
      put[0].d.name === "IMG_4021.png" &&
      /^s-\d+$/.test(put[0].d.stream) &&
      !box(a).main.disabled,
    show({ put, chip: box(a).chips[0]?.textContent }),
  );
  box(a).main.click();
  const sent = await until(() => askedOf("session.send")[0]);
  const prompt = await until(() => prompts(S.idle)[0]);
  check(
    "Send carries the file's id in attachments, and the PC names the saved file in the prompt",
    /^[0-9a-f]{16}$/.test(sent?.d.attachments?.[0]) &&
      sent.d.attachments.length === 1 &&
      sent.d.text === "Why does checkout fail?" &&
      prompt?.args.prompt.includes(
        "Attached files (open each with your read tool):",
      ) &&
      /\.png\b/.test(prompt.args.prompt),
    show({ sent, prompt: prompt?.args.prompt }),
  );
  check(
    "after Send the chips leave with the text",
    Boolean(await until(() => box(a).chips.length === 0)) &&
      box(a).field.value === "" &&
      !hasClass(box(a).compIn, "has-files"),
    show(box(a).chips.map((c) => c.textContent)),
  );

  // ---- remove: attach.drop, the chip goes
  const b = drawSession(S.idle2);
  await until(() => box(b).field);
  pick(b, textFile("notes.txt"));
  await until(() => box(b).chips[0]?.textContent.includes(" B"));
  const x = byTag(box(b).chips[0], "button").find(
    (n) => n.attrs["aria-label"] === "Remove notes.txt",
  );
  check("the chip's X is labelled with the full name", Boolean(x));
  x?.click();
  const dropped = await until(() => askedOf("attach.drop")[0]);
  const id = askedOf("attach.put").length && dropped?.d.id;
  const again = id && (await ask("attach.drop", { id }));
  check(
    "remove calls attach.drop with the chip's id, the chip goes, and the PC no longer has the file",
    /^[0-9a-f]{16}$/.test(id) &&
      box(b).chips.length === 0 &&
      again?.err === "attachment-unknown",
    show({ dropped, again, chips: box(b).chips.length }),
  );

  // ---- a failed upload keeps the chip and the text, says why; Retry sends it
  type(b, "Here is the screen");
  link.breakNext = true;
  pick(b, photo("IMG_4022.png"));
  const bad = await until(() =>
    box(b).chips[0]?.textContent.includes("Not sent") ? box(b) : null,
  );
  check(
    "a failed upload keeps the chip as Not sent and the typed text, and its line says why",
    bad?.chips.length === 1 &&
      hasClass(bad.chips[0], "bad") &&
      bad.field.value === "Here is the screen" &&
      bad.lines.textContent.includes(
        "IMG_4022.png did not reach the PC: the link to the PC closed. Retry, or remove it to send.",
      ),
    show({ chip: bad?.chips[0]?.textContent, line: bad?.lines.textContent }),
  );
  check("Send is off while a file has failed", bad?.main.disabled === true);
  byTag(box(b).lines, "button")
    .find((n) => n.textContent === "Retry")
    ?.click();
  check(
    "Retry sends the file again and Send comes back on",
    Boolean(
      await until(
        () =>
          box(b).chips[0]?.textContent.includes(" B") && !box(b).main.disabled,
      ),
    ) && !box(b).lines.textContent.includes("did not reach"),
    show(box(b).lines.textContent),
  );

  // ---- too big: refused on the phone, no upload
  const streamsBefore = link.streams;
  pick(
    b,
    new File([new Uint8Array(11 * 1024 * 1024)], "scan.pdf", {
      type: "application/pdf",
    }),
  );
  const big = await until(() =>
    box(b).chips[1]?.textContent.includes("Too big") ? box(b) : null,
  );
  check(
    "a too-big file is refused on the phone with its line, no upload and no Retry, and Send is off",
    big?.lines.textContent.includes(
      "scan.pdf is 11 MB. The limit is 10 MB. Remove it to send.",
    ) &&
      link.streams === streamsBefore &&
      !byTag(big.lines, "button").some((n) => n.textContent === "Retry") &&
      big.main.disabled,
    show({ line: big?.lines.textContent, streams: link.streams }),
  );
  pick(b, new File(["PK"], "project-backup.zip", { type: "application/zip" }));
  check(
    "a kind the PC can't take is refused with its line",
    box(b).lines.textContent.includes(
      "project-backup.zip: a .zip can't be sent. Pictures, PDFs and text files can. Remove it to send.",
    ),
    show(box(b).lines.textContent),
  );
  pick(b, ...Array.from({ length: 6 }, (_, i) => textFile(`n${i}.txt`)));
  check(
    "a ninth file adds no chip, only the line",
    box(b).chips.length === 8 &&
      box(b).lines.textContent.includes("8 files at most in one message."),
    show({ chips: box(b).chips.length, line: box(b).lines.textContent }),
  );

  // ---- Queue on a working session carries the files too
  const q = drawSession(S.running);
  await until(() => box(q).main?.attrs["data-action"] === "session.queue");
  type(q, "Then look at this");
  pick(q, textFile("later.txt"));
  await until(() => box(q).chips[0]?.textContent.includes(" B"));
  box(q).main.click();
  const queued = await until(() => askedOf("session.queue")[0]);
  check(
    "Queue carries the file's id in attachments",
    /^[0-9a-f]{16}$/.test(queued?.d.attachments?.[0]),
    show(queued),
  );

  // ---- no type from the phone: the first bytes decide, as on the PC
  const t = drawSession(S.idle);
  await until(() => box(t).input);
  pick(
    t,
    new File(["build:\n\tnode make.mjs\n"], "Makefile", { type: "" }),
    new File([new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 1])], "core", {
      type: "",
    }),
  );
  const sniffed = await until(() =>
    box(t)
      .chips.find((c) => c.textContent.includes("Makefile"))
      ?.textContent.includes(" B")
      ? box(t)
      : null,
  );
  check(
    "a file with no type and no known name is taken as text when its first bytes are UTF-8 with no NUL, and refused when not",
    Boolean(sniffed) &&
      sniffed.lines.textContent.includes(
        "core: a file of this kind can't be sent.",
      ) &&
      !sniffed.lines.textContent.includes("Makefile"),
    show(box(t).lines?.textContent),
  );
} catch (e) {
  failure = e;
} finally {
  await fake.close();
  fx.close();
  (await import("../skills/phone-bot/pc/core/db.mjs")).closeDb();
}
if (failure) {
  console.log(`FAIL the run stopped: ${failure.stack}`);
  failed++;
}
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
