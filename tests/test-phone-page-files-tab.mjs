// The phone page's Files tab (docs/2026-11-17-phone-files-screens-design.md), part 1: the list, folders, drop in
// with progress, the 50 MB refusal, the waiting line, Send to chat, the greyed tab, the kept list and the skeleton.
// The screen runs on a DOM stand-in against a fake PC that keeps phone-inbox in memory; the frame cases run app.js on
// stand-ins for Telegram, the key store and the channel, as tests/test-phone-page.mjs does.
// Run: node tests/test-phone-page-files-tab.mjs
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAGE = path.join(ROOT, "phone", "page");
const pageUrl = (rel) => pathToFileURL(path.join(PAGE, rel)).href;
const MB = 1024 * 1024;

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  if (ok) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${extra ? `\n  ${extra}` : ""}`);
  }
};
const show = (v) => JSON.stringify(v)?.slice(0, 600);
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await tick();
  }
  return fn();
}

// ---- a DOM stand-in: what frame/dom.js, app.js and files.js use. A node is in the page when an ancestor is.
class FakeNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }
  append(...kids) {
    for (const k of kids) {
      const n = k instanceof FakeNode ? k : new FakeText(String(k));
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  replaceChildren(...kids) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...kids);
  }
  get isConnected() {
    return !!this.attached || !!this.parentNode?.isConnected;
  }
  get childElementCount() {
    return this.childNodes.filter((c) => c instanceof FakeElement).length;
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
    // The style object a browser element has: the upload bar sets its share through it, as the CSP drops style="".
    this.styleProps = {};
    this.style = { setProperty: (k, v) => (this.styleProps[k] = v) };
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  fire(type, e = {}) {
    for (const fn of this.listeners[type] || []) fn(e);
  }
  click() {
    this.fire("click", {});
  }
}
const walk = (n, out = []) => {
  out.push(n);
  for (const c of n.childNodes) walk(c, out);
  return out;
};
const byClass = (root, c) =>
  walk(root).filter((n) => n.className?.split(" ").includes(c));

// The page's elements, as index.html has them; the shell's content holds each tab's shapes
const els = Object.fromEntries(
  [
    "app",
    "fatal",
    "content",
    "bottom",
    "bottom-extra",
    "tabbar",
    "main-btn",
    "shell",
    "sk-home",
    "sk-projects",
    "sk-settings",
  ].map((id) => [id, new FakeElement("div")]),
);
for (const n of Object.values(els)) n.attached = true;
const skContent = new FakeElement("main");
els.shell.append(skContent);
for (const tab of ["home", "projects", "settings"])
  skContent.append(els[`sk-${tab}`]);
globalThis.Node = FakeNode;
globalThis.document = {
  hidden: false,
  createElement: (tag) => new FakeElement(tag),
  createElementNS: (_ns, tag) => new FakeElement(tag),
  createTextNode: (text) => new FakeText(text),
  querySelector: (sel) => (sel === "#shell .sk-content" ? skContent : null),
  getElementById: (id) =>
    els[id] ?? walk(els.shell).find((x) => x.attrs?.id === id) ?? null,
  addEventListener: () => {},
};
const keptItems = new Map();
globalThis.localStorage = {
  get length() {
    return keptItems.size;
  },
  key: (i) => [...keptItems.keys()][i] ?? null,
  getItem: (k) => keptItems.get(k) ?? null,
  setItem: (k, v) => keptItems.set(k, String(v)),
  removeItem: (k) => keptItems.delete(k),
};

// ---- the fake PC: phone-inbox in memory, with folder.mjs's action names and answers. gates[action] (a promise)
// holds that action's answer; refuse[action] answers it once with a refusal.
const disk = new Map(); // path -> { kind, size, at }
const pcLog = [];
const gates = {};
const refuse = {};
const join = (dir, name) => (dir ? `${dir}/${name}` : name);
const parentOf = (p) => p.split("/").slice(0, -1).join("/");
const under = (p, top) => p === top || p.startsWith(`${top}/`);
const streams = new Map(); // stream id -> { size }; held until the folder.put naming it is answered
let waiters = [];
let linkN = 1;
async function fakePc(a, d) {
  pcLog.push([a, d]);
  if (gates[a]) await gates[a];
  if (refuse[a]) {
    const r = refuse[a];
    delete refuse[a];
    return r;
  }
  if (a === "folder.list") {
    const items = [...disk]
      .filter(([p]) => parentOf(p) === d.dir)
      .map(([p, v]) => ({
        name: p.split("/").at(-1),
        ...v,
        at: new Date(v.at).toISOString(),
      })); // the real PC sends ISO times (folder.mjs)
    return { ok: true, d: { dir: d.dir, items, more: false, free: 1e12 } };
  }
  if (a === "folder.make") {
    const p = join(d.dir, d.name);
    if (disk.has(p)) return { ok: false, err: "exists" };
    disk.set(p, { kind: "folder", size: 0, at: Date.now() });
    return { ok: true, d: { name: d.name } };
  }
  if (a === "folder.rename") {
    if (!disk.has(d.path)) return { ok: false, err: "not-found" };
    const to = join(parentOf(d.path), d.name);
    for (const [p, v] of [...disk])
      if (under(p, d.path)) {
        disk.delete(p);
        disk.set(to + p.slice(d.path.length), v);
      }
    return { ok: true, d: { name: d.name } };
  }
  if (a === "folder.remove") {
    for (const p of [...disk.keys()]) if (under(p, d.path)) disk.delete(p);
    return { ok: true, d: { removed: d.path } };
  }
  if (a === "folder.put") {
    const s = streams.get(d.stream);
    if (!s) return { ok: false, err: "stream-gone" };
    streams.delete(d.stream);
    for (const w of waiters.splice(0)) w();
    disk.set(join(d.dir, d.name), {
      kind: "file",
      size: s.size,
      at: Date.now(),
    });
    return { ok: true, d: { name: d.name, size: s.size } };
  }
  if (a === "folder.send") {
    if (!disk.has(d.path)) return { ok: false, err: "not-found" };
    return { ok: true, d: { sent: true } };
  }
  if (a === "folder.move") {
    if (!disk.has(d.path)) return { ok: false, err: "not-found" };
    const to = join(d.to, d.path.split("/").at(-1));
    if (disk.has(to)) return { ok: false, err: "exists" };
    for (const [p, v] of [...disk])
      if (under(p, d.path)) {
        disk.delete(p);
        disk.set(to + p.slice(d.path.length), v);
      }
    return { ok: true, d: { path: to } };
  }
  if (a === "folder.link") {
    if (!disk.has(d.path)) return { ok: false, err: "not-found" };
    const name = d.path.split("/").at(-1);
    return {
      ok: true,
      d: {
        url: `https://relay.test/dl/tok-${linkN++}`,
        until: "2026-11-17T22:00:00Z",
        name,
        size: disk.get(d.path).size,
      },
    };
  }
  if (a === "folder.copy" || a === "folder.show") {
    if (!disk.has(d.path)) return { ok: false, err: "not-found" };
    return {
      ok: true,
      d: a === "folder.copy" ? { copied: d.path } : { shown: d.path },
    };
  }
  return { ok: false, err: "unknown-action" };
}

// ---- the frame (frame/app.js) on stand-ins; each case is a new open of the page with the link held until release()
const frameFake = { events: {}, back: null, asked: [], askedMs: [] };
globalThis.frameFake = frameFake;
const APP_URL = pageUrl("frame/app.js");
const STAND_INS = {
  [pageUrl("screens.generated.js")]: `export const PAGE_VERSION = "test";
export const LATER = [];
export const loadRest = async () => [];
export const STORE_SUFFIX = "";`,
  [pageUrl("frame/boot.js")]: `const f = globalThis.frameFake;
export const stylesLoaded = Promise.resolve();
export const telegramLoaded = Promise.resolve();
export const shellTab = () => f.shellTab ?? "home";`,
  [pageUrl("frame/telegram.js")]: `const f = globalThis.frameFake;
export const startTelegram = () => ({ initData: "signed", isVersionAtLeast: () => true,
  onEvent: (name, fn) => { f.events[name] = fn; } });
export const hasHost = () => true;
export const haptic = () => {};
export const setMainButton = () => {};
export const setBackButton = (_tg, onBack) => { f.back = onBack; };`,
  [pageUrl("frame/zoom.js")]: `export const setZoom = () => {};
export const lockGestures = () => {};`,
  [pageUrl("frame/keystore.js")]:
    `export const loadPairing = async () => ({ K: "key", pcId: "pc", dev: "dev" });
export const restorePairing = async () => null;
export const savePairing = async () => "test";
export const forgetPairing = async () => {};`,
  [pageUrl("frame/channel.js")]: `const f = globalThis.frameFake;
export class ChannelError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; this.extra = extra; }
}
export const socketUrl = () => "wss://relay.test/";
export const openLink = async () => {
  if (f.linkWait) await f.linkWait;
  const link = { listeners: new Set(), closed: null, listen(fn) { link.listeners.add(fn); },
    close() { link.closed = {}; }, drop() { link.closed = {}; } };
  return link;
};
export const pair = async () => { throw new Error("no pairing in this test"); };
export const join = async () => { throw new Error("no device join in this test"); };
export const openSession = async () => {
  const ended = new Promise(() => {});
  return { hello: { page: f.helloPage ?? "ok", actions: f.helloActions === undefined ? f.allActions : f.helloActions }, ended, bye: async () => {},
    ask: (a, d, ms) => { f.asked.push(a); f.askedMs.push([a, ms]); return f.pc(a, d); },
    sendStream: async () => { throw new Error("no streams in the frame cases"); } };
};`,
};
registerHooks({
  resolve(specifier, context, next) {
    // The build-only screens.generated.js is stood in for every page file that imports it (cache.js, outbox.js).
    const code =
      (context.parentURL?.split("?")[0] === APP_URL &&
        STAND_INS[new URL(specifier, APP_URL).href]) ||
      (specifier.endsWith("screens.generated.js") &&
        STAND_INS[new URL(specifier, context.parentURL).href]);
    if (code)
      return {
        url: `data:text/javascript,${encodeURIComponent(code)}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
globalThis.addEventListener = () => {};
globalThis.location = new URL("https://page.test/");
globalThis.IntersectionObserver = class {
  observe() {}
  disconnect() {}
};
frameFake.pc = fakePc;
// A current PC names its actions in the hello (frame/offers.js); null stands for a 26.3.3 PC, which names none.
frameFake.allActions = [
  "pc.status",
  "folder.copy",
  "folder.link",
  "folder.list",
  "folder.make",
  "folder.move",
  "folder.put",
  "folder.remove",
  "folder.rename",
  "folder.send",
  "folder.show",
];

const screens = await import(pageUrl("frame/screens.js"));
const cache = await import(pageUrl("frame/cache.js"));
const { FILES_STREAM_MAX } = await import(pageUrl("frame/channel.js"));
const { UPDATE_LINE, causeWords } = await import(pageUrl("screens/files.js"));

async function openAgain(name, tab) {
  frameFake.shellTab = tab;
  let release;
  frameFake.linkWait = new Promise((r) => {
    release = r;
  });
  els.fatal.hidden = true;
  frameFake.asked = [];
  await import(`${APP_URL}?${name}`);
  for (let i = 0; i < 5; i++) await tick();
  if (!els.fatal.hidden)
    throw new Error(`the frame stopped: ${els.fatal.textContent}`);
  return async () => {
    frameFake.linkWait = null;
    release();
    for (let i = 0; i < 8; i++) await tick();
  };
}
const markText = () =>
  byClass(els.content, "status-mark")[0]?.textContent ?? "";
const content = () => els.content.textContent;

try {
  // Nothing kept, no link yet: the Files shapes (built by files.js into the shell) stand in for the screen
  keptItems.clear();
  frameFake.helloActions = null;
  let release = await openAgain("nothing-kept", "files");
  const shapes = walk(els.content).find((n) => n.attrs?.id === "sk-files");
  check(
    "skeleton: with nothing kept, the Files shapes (tool row, Folders and Files rows) show before the first hello",
    !!shapes &&
      shapes.textContent.includes("Folders") &&
      byClass(shapes, "sk-row").length === 6 &&
      frameFake.asked.length === 0,
    show(content()),
  );

  // A 26.3.3 PC: it verifies the page but names no actions, so it lacks the folder actions; the tab greys with the Files line
  await release();
  check(
    "greyed: a PC without the folder actions shows the Files update line, draws no list and asks nothing of Files",
    content().includes(UPDATE_LINE) &&
      !content().includes("You can look, not act") &&
      !frameFake.asked.some((a) => a.startsWith("folder.")) &&
      byClass(els.content, "files-tools").length === 0,
    show({ text: content(), asked: frameFake.asked }),
  );

  // Files kept, no link yet: the kept list is drawn, marked Updating, asking nothing; the fresh list replaces it
  frameFake.helloActions = undefined;
  keptItems.clear();
  cache.keep("files", {
    items: [
      {
        name: "kept-report.pdf",
        kind: "file",
        size: 2_400_000,
        at: Date.now() - 60_000,
      },
    ],
    more: false,
  });
  disk.set("fresh.txt", { kind: "file", size: 1000, at: Date.now() });
  release = await openAgain("kept-files", "files");
  const keptText = content();
  const keptMark = markText();
  const keptAsked = [...frameFake.asked];
  check(
    "kept: with Files kept and no link, the kept list is drawn marked Updating before the first hello, asking nothing",
    keptText.includes("kept-report.pdf") &&
      keptMark.startsWith("Updating · as of") &&
      keptAsked.length === 0,
    show({ keptText, keptMark, keptAsked }),
  );
  await release();
  await until(() => content().includes("fresh.txt"));
  check(
    "kept: after the first hello the fresh list replaces the kept one and is kept in its place",
    content().includes("fresh.txt") &&
      !content().includes("kept-report.pdf") &&
      cache.kept("files")?.data.items.some((i) => i.name === "fresh.txt"),
    show({ text: content(), kept: cache.kept("files")?.data }),
  );
  // Send to chat through the frame: the PC may take up to 5 minutes, so the frame's ask passes that wait to the
  // channel; the list keeps the channel's own 30 s
  frameFake.askedMs = [];
  byClass(els.content, "files-send")[0]?.click();
  await until(() => frameFake.askedMs.some(([a]) => a === "folder.send"));
  const sendWait = frameFake.askedMs.find(([a]) => a === "folder.send")?.[1];
  check(
    "long wait: Send to chat asks the channel with a 5 minute wait through the frame's ask (FAIL: it times out at 30 s while the PC sends)",
    sendWait === 5 * 60 * 1000 &&
      frameFake.askedMs
        .filter(([a]) => a === "folder.list")
        .every(([, ms]) => ms === undefined),
    show(frameFake.askedMs),
  );
  disk.clear();
  pcLog.length = 0;

  // ---- the screen itself, on a ctx of its own: Telegram Desktop, connected, the stream line as channel.js keeps it
  // (a stream is held until the ask naming it is answered; past 50 MB held, the next one waits)
  const scrollBox = new FakeElement("div");
  const screenBox = new FakeElement("div");
  screenBox.attached = true;
  const popups = [];
  const downloads = [];
  const fakeTg = {
    platform: "tdesktop",
    version: "9.6",
    isVersionAtLeast: () => true,
    showPopup: (p, cb) => popups.push({ p, cb }),
    downloadFile: (p, cb) => downloads.push({ p, cb }),
  };
  let offered = () => true;
  const askMs = [];
  const streamMaxes = [];
  const progressSeen = [];
  let streamN = 0;
  const screenText = () => screenBox.textContent;
  async function fakeSendStream(bytes, _mime, onProgress, max, onWait) {
    streamMaxes.push(max);
    if (bytes.length > max)
      throw Object.assign(new Error("too-big"), { code: "too-big" });
    const held = () => [...streams.values()].reduce((n, s) => n + s.size, 0);
    if (streams.size && held() + bytes.length > FILES_STREAM_MAX) {
      onWait(true);
      while (streams.size && held() + bytes.length > FILES_STREAM_MAX)
        await new Promise((r) => waiters.push(r));
      onWait(false);
    }
    const id = `st-${++streamN}`;
    streams.set(id, { size: bytes.length });
    onProgress(0.5);
    progressSeen.push({
      text: screenText(),
      bars: byClass(screenBox, "files-bar").length,
    });
    await tick();
    onProgress(1);
    return { ok: true, d: { stream: id } };
  }
  let cur = null;
  function open(id, params = {}) {
    const ctx = {
      params,
      tg: fakeTg,
      connected: true,
      updating: false,
      scrollBox,
      offered: (a) => offered(a),
      ask: (a, d, ms) => {
        askMs.push([a, ms]);
        return fakePc(a, d);
      },
      sendStream: fakeSendStream,
      go: (to, p) => open(to, p),
      back: () => open("files"),
      redraw: () => open(cur.id, cur.params),
      haptic: () => {},
    };
    cur = { id, params };
    screenBox.replaceChildren(screens.screen(id).render(ctx));
  }
  const drop = (files) =>
    scrollBox.fire("drop", {
      dataTransfer: { types: ["Files"], files },
      preventDefault: () => {},
    });
  const fileRow = (name) =>
    walk(screenBox).find((n) => n.attrs?.["data-file"] === name);
  const folderRow = (name) =>
    walk(screenBox).find((n) => n.attrs?.["data-folder"] === name);
  const button = (cls, text) =>
    byClass(screenBox, cls).find(
      (n) => text === undefined || n.textContent === text,
    );
  const typeName = (name) =>
    button("files-name").fire("input", { target: { value: name } });

  disk.set("older.txt", {
    kind: "file",
    size: 10,
    at: Date.now() - 86_400_000,
  });
  open("files");
  await until(() => !screenText().includes("Loading files…"));

  // Two files dropped: each goes up as a stream with the Files cap, shows its progress, then is in the list
  drop([
    new File([new Uint8Array(300_000)], "photo one.jpg"),
    new File([new Uint8Array(2 * MB)], "report.pdf"),
  ]);
  await until(() => fileRow("photo one.jpg") && fileRow("report.pdf"));
  check(
    "drop in: two dropped files upload with a progress line and bar, with the 50 MB Files cap, then appear in the list",
    progressSeen.length === 2 &&
      progressSeen.every(
        (s) => s.text.includes("Uploading · ") && s.bars > 0,
      ) &&
      progressSeen.some((s) => s.text.includes("Uploading · 1.0 of 2.0 MB")) &&
      streamMaxes.every((m) => m === FILES_STREAM_MAX) &&
      disk.has("photo one.jpg") &&
      disk.has("report.pdf") &&
      !!fileRow("photo one.jpg") &&
      !!fileRow("report.pdf"),
    show({
      progressSeen: progressSeen.map((s) => s.text.slice(0, 160)),
      streamMaxes,
      text: screenText(),
    }),
  );
  const fileOrder = () =>
    walk(screenBox)
      .filter((n) => n.attrs?.["data-file"])
      .map((n) => n.attrs["data-file"]);
  check(
    "drop in: the files just uploaded show at the top of the list, above older files (FAIL: a new upload lands at the bottom)",
    fileOrder().slice(0, 2).sort().join() === "photo one.jpg,report.pdf" &&
      fileOrder().length > 2,
    show(fileOrder()),
  );

  // A file over 50 MB: refused in words, never read and never streamed
  let readBig = false;
  const streamsBefore = streamMaxes.length;
  const big = {
    name: "holiday.mov",
    size: 72 * MB,
    type: "video/quicktime",
    arrayBuffer: async () => {
      readBig = true;
      return new ArrayBuffer(0);
    },
  };
  drop([big]);
  await tick(20);
  check(
    "too big: a file over 50 MB is refused in words before any upload (not read, no stream, no folder.put)",
    screenText().includes("Too big: 72 MB. The limit is 50 MB.") &&
      !readBig &&
      streamMaxes.length === streamsBefore &&
      !pcLog.some(([a, d]) => a === "folder.put" && d.name === "holiday.mov"),
    show({ readBig, text: screenText() }),
  );
  button("files-x").click();

  // A 50 MB file uploading (its folder.put held), then a second file dropped: it shows Waiting · its size
  let openPut;
  gates["folder.put"] = new Promise((r) => {
    openPut = r;
  });
  drop([new File([new Uint8Array(FILES_STREAM_MAX)], "movie.mp4")]);
  await until(() =>
    pcLog.some(([a, d]) => a === "folder.put" && d.name === "movie.mp4"),
  );
  drop([new File([new Uint8Array(Math.round(4.1 * MB))], "notes.txt")]);
  const waited = await until(() => screenText().includes("Waiting · 4.1 MB"));
  delete gates["folder.put"];
  openPut();
  await until(() => fileRow("movie.mp4") && fileRow("notes.txt"));
  check(
    "waiting: a second file dropped while a 50 MB one uploads shows Waiting · 4.1 MB, then both upload",
    waited &&
      disk.has("movie.mp4") &&
      disk.has("notes.txt") &&
      !screenText().includes("Waiting ·"),
    show({ waited, text: screenText() }),
  );

  // Many files dropped at once: each is read only when its turn comes, never all into memory first
  let reading = 0;
  let mostReading = 0;
  const counted = (name) => ({
    name,
    size: 1000,
    type: "application/octet-stream",
    arrayBuffer: async () => {
      reading++;
      mostReading = Math.max(mostReading, reading);
      await tick(5);
      reading--;
      return new ArrayBuffer(1000);
    },
  });
  const many = ["a.bin", "b.bin", "c.bin", "d.bin"];
  drop(many.map(counted));
  await until(() => many.every((n) => fileRow(n)));
  check(
    "drop in: four dropped files are read one at a time (FAIL: every dropped file is read into memory at once)",
    mostReading === 1 && many.every((n) => disk.has(n)),
    show({ mostReading, onDisk: many.filter((n) => disk.has(n)) }),
  );

  // Send to chat from a file's menu: Sending, then Sent with the toast; a refusal shows its cause in words
  let openSend;
  gates["folder.send"] = new Promise((r) => {
    openSend = r;
  });
  walk(fileRow("report.pdf"))
    .find((n) => n.className?.includes("files-more"))
    .click();
  button("files-choice", "Send to chat").click();
  await tick();
  const sendingText = fileRow("report.pdf")?.textContent ?? "";
  delete gates["folder.send"];
  openSend();
  await until(() => screenText().includes("Sent to chat"));
  const asked = pcLog.find(([a]) => a === "folder.send");
  check(
    "send to chat: the file's menu asks the PC with its path, shows Sending, then Sent to chat and the Files-topic toast",
    sendingText.includes("Sending to chat…") &&
      asked?.[1].path === "report.pdf" &&
      fileRow("report.pdf").textContent.includes("Sent to chat") &&
      screenText().includes("Sent to the Files topic.") &&
      screenText().includes("Drag it out of the Files topic to save it."),
    show({ sendingText, asked, text: screenText() }),
  );
  refuse["folder.send"] = { ok: false, err: "relay-too-old" };
  // On Telegram Desktop the card's own button is Download (the Download route), so Send to chat is in the menu
  walk(fileRow("notes.txt"))
    .find((n) => n.className?.includes("files-more"))
    .click();
  button("files-choice", "Send to chat").click();
  await until(() => screenText().includes("Couldn't send to chat"));
  check(
    "send to chat: a refusal shows its cause in words and stays until closed",
    screenText().includes(
      "Couldn't send to chat: your relay needs an update for this.",
    ) && byClass(screenBox, "files-toast").length === 1,
    show(screenText()),
  );
  walk(byClass(screenBox, "files-toast")[0])
    .find((n) => n.className?.includes("files-x"))
    .click();

  // Folders: make one, enter it, rename it, then remove it with a confirm (Cancel keeps it)
  button("files-new").click();
  typeName("Trips");
  button("files-save").click();
  await until(() => folderRow("Trips"));
  const made = disk.get("Trips")?.kind === "folder" && !!folderRow("Trips");
  folderRow("Trips").click();
  await until(() => screenText().includes("This folder is empty."));
  const entered = cur.id === "files-folder" && cur.params.dir === "Trips";
  button("files-folder-menu").click();
  button("files-choice", "Rename folder").click();
  typeName("Holidays");
  button("files-save").click();
  await until(() => cur.params.dir === "Holidays");
  const renamed =
    disk.has("Holidays") && !disk.has("Trips") && cur.id === "files-folder";
  button("files-folder-menu").click();
  button("files-choice", "Remove folder").click();
  const popup = popups.at(-1);
  popup?.cb("cancel");
  await tick(20);
  const keptOnCancel = disk.has("Holidays");
  button("files-folder-menu").click();
  button("files-choice", "Remove folder").click();
  popups.at(-1)?.cb("remove");
  await until(
    () => cur.id === "files" && !disk.has("Holidays") && !folderRow("Holidays"),
  );
  check(
    "folders: New folder makes one, a tap enters it, Rename renames it, Remove asks first (Cancel keeps it) then removes it",
    made &&
      entered &&
      renamed &&
      keptOnCancel &&
      popup?.p.message.startsWith("Remove the folder Holidays?") &&
      popup.p.message.includes(".removed folder") &&
      popup.p.buttons.some(
        (b) => b.type === "destructive" && b.text === "Remove",
      ) &&
      !disk.has("Holidays") &&
      cur.id === "files" &&
      !folderRow("Holidays"),
    show({
      made,
      entered,
      renamed,
      keptOnCancel,
      popup: popup?.p,
      cur,
      text: screenText(),
    }),
  );
  // A name with / or \ is refused in the sheet, in words, without asking the PC; the PC's own refusal of such a
  // name (bad-input) names both its causes. Changed on purpose: bad-input also comes for a name over 120 characters
  // (a dropped file's long name), so slash words alone gave that refusal the wrong reason.
  const makesBefore = pcLog.filter(([a]) => a === "folder.make").length;
  button("files-new").click();
  typeName("Trips/2026");
  button("files-save").click();
  await tick(20);
  const slashSheet = {
    err: byClass(screenBox, "files-sheet-err")[0]?.textContent ?? null,
    asked: pcLog.filter(([a]) => a === "folder.make").length - makesBefore,
    pcWords: causeWords({ ok: false, err: "bad-input" }),
  };
  byClass(screenBox, "btn")
    .find((n) => n.textContent === "Cancel")
    ?.click();
  check(
    "a folder name with / or \\ is refused in the name sheet in plain words without asking the PC, and the PC's bad-input names the length limit and the slashes (FAIL: the PC asked, or 'Bad-input.')",
    slashSheet.err === "That name can't have / or \\ in it." &&
      slashSheet.asked === 0 &&
      slashSheet.pcWords ===
        "a name can have at most 120 characters and no / or \\" &&
      byClass(screenBox, "files-sheet-err").length === 0,
    show(slashSheet),
  );

  // ---- part 2: drag out by the recorded Checks, Copy file, Show in folder, Move
  const menuOf = (name) => {
    walk(fileRow(name))
      .find((n) => n.className?.includes("files-more"))
      .click();
    return byClass(screenBox, "files-choice").map((n) => n.textContent);
  };
  const closeToast = () => {
    const t = byClass(screenBox, "files-toast")[0];
    if (t)
      walk(t)
        .find((n) => n.className?.includes("files-x"))
        .click();
  };
  const sendMs = askMs.find(([a]) => a === "folder.send")?.[1];
  check(
    "long wait: Send to chat asks the PC with a 5 minute wait, other asks keep the frame's own (FAIL: Send to chat times out at 30 s)",
    sendMs === 5 * 60 * 1000 &&
      askMs
        .filter(([a]) => a !== "folder.send")
        .every(([, ms]) => ms === undefined),
    show(askMs),
  );

  // Telegram Desktop takes the Download route (DownloadURL no, download box yes): the menu's Download makes a
  // one-time link and hands it to Telegram's download box; the card's button and the hint name Download
  disk.set("Inbox", { kind: "folder", size: 0, at: Date.now() });
  open("files");
  await until(() => folderRow("Inbox"));
  const deskMenu = menuOf("report.pdf");
  button("files-choice", "Download").click();
  await until(() => downloads.length === 1);
  const link = pcLog.findLast(([a]) => a === "folder.link");
  downloads[0]?.cb(true);
  await tick();
  check(
    "download route: on Telegram Desktop the file's Download asks folder.link and gives its link and name to Telegram's download box, then says where to drag it from",
    link?.[1].path === "report.pdf" &&
      downloads[0]?.p.url === "https://relay.test/dl/tok-1" &&
      downloads[0]?.p.file_name === "report.pdf" &&
      screenText().includes("Download started.") &&
      screenText().includes("Then drag it from the folder it saved to.") &&
      byClass(screenBox, "files-download").length > 0 &&
      byClass(screenBox, "files-send").length === 0 &&
      screenText().includes(
        "choose Download, then drag it from the folder it saved to.",
      ),
    show({ link, downloads: downloads.map((x) => x.p), text: screenText() }),
  );
  closeToast();

  // Copy file and Show in folder: on Telegram Desktop, each asks the PC with the file's path and says done, or the
  // PC's refusal in words
  check(
    "desktop menu: a file's menu on Telegram Desktop shows Send to chat, Download, Copy file, Show in folder, Move and Remove",
    show(deskMenu) ===
      show([
        "Send to chat",
        "Download",
        "Copy file",
        "Show in folder",
        "Move to folder…",
        "Remove",
        "Cancel",
      ]),
    show(deskMenu),
  );
  menuOf("report.pdf");
  button("files-choice", "Copy file").click();
  await until(() => screenText().includes("Copied on your PC."));
  const copied = pcLog.findLast(([a]) => a === "folder.copy");
  closeToast();
  refuse["folder.copy"] = {
    ok: false,
    err: "copy-failed",
    why: "Access is denied",
  };
  menuOf("report.pdf");
  button("files-choice", "Copy file").click();
  const copyRefused = await until(() =>
    screenText().includes(
      "Couldn't copy the file: the PC couldn't put it on its clipboard (Access is denied).",
    ),
  );
  check(
    "copy file: Copy file asks folder.copy with the file's path and says Copied, and a refusal shows the PC's reason in words",
    copied?.[1].path === "report.pdf" && copyRefused,
    show({ copied, text: screenText() }),
  );
  closeToast();
  menuOf("report.pdf");
  button("files-choice", "Show in folder").click();
  await until(() => screenText().includes("Its folder is open on your PC."));
  const shown = pcLog.findLast(([a]) => a === "folder.show");
  closeToast();
  refuse["folder.show"] = {
    ok: false,
    err: "show-failed",
    why: "explorer.exe did not start",
  };
  menuOf("report.pdf");
  button("files-choice", "Show in folder").click();
  const showRefused = await until(() =>
    screenText().includes(
      "Couldn't show it in its folder: the PC couldn't open its folder (explorer.exe did not start).",
    ),
  );
  check(
    "show in folder: Show in folder asks folder.show with the file's path and says its folder is open, and a refusal shows the PC's reason in words",
    shown?.[1].path === "report.pdf" && showRefused,
    show({ shown, text: screenText() }),
  );
  closeToast();

  // A PC without folder.copy and folder.show: neither shows on Telegram Desktop
  offered = (a) => a !== "folder.copy" && a !== "folder.show";
  open("files");
  const noActionsMenu = menuOf("report.pdf");
  button("files-cancel").click();
  offered = () => true;
  // The iPhone: the download box was never tried there, so its route is Send to chat; no Desktop items
  fakeTg.platform = "ios";
  open("files");
  const phoneMenu = menuOf("report.pdf");
  button("files-cancel").click();
  const phoneCard =
    byClass(screenBox, "files-send").length > 0 &&
    byClass(screenBox, "files-download").length === 0;
  fakeTg.platform = "tdesktop";
  check(
    "no desktop items: Copy file and Show in folder are absent on a PC without those actions and on the iPhone, where the route is Send to chat",
    !noActionsMenu.includes("Copy file") &&
      !noActionsMenu.includes("Show in folder") &&
      noActionsMenu.includes("Download") &&
      show(phoneMenu) ===
        show(["Send to chat", "Move to folder…", "Remove", "Cancel"]) &&
      phoneCard,
    show({ noActionsMenu, phoneMenu, phoneCard }),
  );

  // Move to folder: the sheet lists Files (Here now, greyed) and its folders; a tap asks folder.move and says Moved
  open("files");
  menuOf("notes.txt");
  button("files-choice", "Move to folder…").click();
  await until(() => byClass(screenBox, "files-move-to").length === 2);
  const tree = byClass(screenBox, "files-move-to").map((n) => [
    n.textContent,
    n.disabled,
  ]);
  byClass(screenBox, "files-move-to")
    .find((n) => n.attrs?.["data-to"] === "Inbox")
    .click();
  await until(() => screenText().includes("Moved to Inbox."));
  const moved = pcLog.findLast(([a]) => a === "folder.move");
  check(
    "move: Move to folder… lists Files (Here now) and the folders, and a tap asks folder.move, moves the file out of the list and says Moved to Inbox.",
    show(tree) ===
      show([
        ["FilesHere now", true],
        ["Inbox", false],
      ]) &&
      moved?.[1].path === "notes.txt" &&
      moved?.[1].to === "Inbox" &&
      disk.has("Inbox/notes.txt") &&
      (await until(() => !fileRow("notes.txt"))),
    show({ tree, moved, text: screenText() }),
  );
  closeToast();
  disk.set("Inbox/report.pdf", { kind: "file", size: 10, at: Date.now() });
  menuOf("report.pdf");
  button("files-choice", "Move to folder…").click();
  await until(() => byClass(screenBox, "files-move-to").length === 2);
  byClass(screenBox, "files-move-to")
    .find((n) => n.attrs?.["data-to"] === "Inbox")
    .click();
  check(
    "move: a name already in the folder shows the refusal in words and the file stays",
    (await until(() =>
      screenText().includes(
        "There is already a file called report.pdf in Inbox.",
      ),
    )) && !!fileRow("report.pdf"),
    show(screenText()),
  );
} catch (e) {
  failed++;
  console.log(`FAIL the Files tab test stopped: ${e.stack}`);
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
