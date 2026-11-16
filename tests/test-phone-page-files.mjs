// Tests for file previews and diffs on the phone page (phone/page/screens/session-files.js, its wiring in session.js,
// session-live.js and frame/markdown.js, and its block in page.css). The session screen runs in Node on a DOM
// stand-in and asks the real PC registry, which reads a fixture nimbalyst.sqlite, a fixture transcript (one answer
// with two Edits and a Write over two files, and a reply with file links) and a fixture project folder in a temp home.
// Run: node tests/test-phone-page-files.mjs
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
const show = (v) => JSON.stringify(v)?.slice(0, 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(20);
  }
}

// A temp home for this whole run; the PC program reads it through os.homedir() and APPDATA.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-page-files-"));
const home = path.join(tmp, "home");
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
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

// ---- the project folder and its files
const PROJECT = path.join(tmp, "projects", "garden");
const put = (rel, data) => {
  fs.mkdirSync(path.dirname(path.join(PROJECT, rel)), { recursive: true });
  fs.writeFileSync(path.join(PROJECT, rel), data);
};
put("src/app.js", "a\nc\nd\ne\n");
put("src/new.js", "x\ny\nz\n");
put("docs/notes.md", "# Notes\n\nSome **bold** words.\n");
put(".env", "KEY=2\n");
put("huge.png", Buffer.alloc(9 * 1024 * 1024));

// ---- the fixture database: the columns the reads use
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
const SESSION = "00000000-0000-4000-8000-0000000000f1";
const T = "11111111-aaaa-4bbb-8ccc-0000000000f1";
const now = new Date().toISOString();
fx.prepare(
  `INSERT INTO ai_sessions (id, workspace_id, title, status, provider_session_id, model, created_at, updated_at)
     VALUES (?, ?, 'Tidy the app', 'idle', ?, 'claude-code:opus', ?, ?)`,
).run(SESSION, PROJECT, T, now, now);

// ---- the transcript: a prompt, two Edits of src/app.js and a Write of src/new.js, then a reply with links
const ts = "2026-11-15T10:00:00.000Z";
const P = (rel) => path.join(PROJECT, rel);
const use = (id, name, input) => ({
  type: "assistant",
  timestamp: ts,
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
  },
});
const res = (id, toolUseResult) => ({
  type: "user",
  timestamp: ts,
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content: "ok" }],
  },
  toolUseResult,
});
const patch = (lines) => [
  { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines },
];
const tdir = path.join(
  home,
  ".claude",
  "projects",
  PROJECT.replace(/[^A-Za-z0-9]/g, "-"),
);
fs.mkdirSync(tdir, { recursive: true });
fs.writeFileSync(
  path.join(tdir, `${T}.jsonl`),
  [
    {
      type: "user",
      timestamp: ts,
      message: { role: "user", content: "Tidy the app" },
    },
    use("e1", "Edit", {
      file_path: P("src/app.js"),
      old_string: "b",
      new_string: "c\nd",
    }),
    res("e1", {
      filePath: P("src/app.js"),
      structuredPatch: patch([" a", "-b", "+c", "+d"]),
    }),
    use("w1", "Write", { file_path: P("src/new.js"), content: "x\ny\nz\n" }),
    res("w1", {
      type: "create",
      filePath: P("src/new.js"),
      content: "x\ny\nz\n",
      structuredPatch: [],
    }),
    use("e2", "Edit", {
      file_path: P("src/app.js"),
      old_string: "d",
      new_string: "e",
    }),
    res("e2", {
      filePath: P("src/app.js"),
      structuredPatch: patch([" c", "-d", "+e"]),
    }),
    {
      type: "assistant",
      timestamp: ts,
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Done. See [notes](docs/notes.md), [app](src/app.js), [secret](.env), [huge](huge.png) and [the site](https://example.com).",
          },
        ],
      },
    },
  ]
    .map((o) => `${JSON.stringify(o)}\n`)
    .join(""),
);

// ---- the fake door: Nimbalyst is open and the session is finished
const { startFakeDoor } = await import("./phone-bot/fake-door.mjs");
const fake = await startFakeDoor({
  endpointFile: path.join(NIM, "mcp-endpoint.json"),
  workspaces: [{ name: "garden", path: PROJECT }],
  tools: [
    "workspace_open",
    "get_session_status",
    "get_session_result",
    "list_queued_prompts",
  ],
  handle: (name, a) => {
    if (name === "workspace_open") return "opened";
    if (name === "list_queued_prompts")
      return { sessionId: a.sessionId, count: 0, prompts: [] };
    if (name === "get_session_status")
      return { status: "idle", waitingForInput: false };
    if (name === "get_session_result")
      return { status: "idle", pendingPrompt: null };
    throw new Error(`the fake door has no ${name}`);
  },
});

// ---- the real registry with every action module, behind a stand-in channel session
const { createRegistry } = await import(
  "../skills/phone-bot/pc/core/registry.mjs"
);
const registry = createRegistry();
await registry.load(path.join(PC, "actions"));
let rn = 0;
const pcCtx = {
  page: "ok",
  device: "dev-test",
  setupVersion: "0.0.0",
  push: () => {},
};
const asked = [];
const ask = (a, d) => {
  asked.push(a);
  return registry.handle({ k: "req", id: `r-${++rn}`, a, d }, pcCtx);
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
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  click() {
    for (const fn of this.listeners.click || []) fn({ target: this });
  }
  focus() {}
  blur() {}
  scrollIntoView() {}
}
Object.assign(globalThis, {
  Node: FakeNode,
  document: {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
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
const button = (root, test) =>
  byTag(root, "button").find((b) => !b.hidden && test(b));

const pageUrl = (rel) => pathToFileURL(path.join(PAGE, rel)).href;
const screens = await import(pageUrl("frame/screens.js"));
await import(pageUrl("screens/session.js")); // registers the session screen

const c = {
  connected: true,
  params: { session: SESSION, title: "Tidy the app" },
  // Telegram's Back button, recorded: a sheet takes it over and gives it back when the last sheet closes.
  tg: {
    platform: "ios",
    isVersionAtLeast: () => true,
    BackButton: {
      handlers: new Set(),
      onClick(fn) {
        this.handlers.add(fn);
      },
      offClick(fn) {
        this.handlers.delete(fn);
      },
      show() {},
      hide() {},
    },
  },
  offered: (a) => a !== "session.watch",
  ask,
  go: () => {},
  onEvent: () => {},
  beforeSleep: () => () => {},
  haptic: () => {},
  mainButton: () => {},
  scrollBox: { scrollTop: 0, scrollHeight: 2000, clientHeight: 800 },
};
const out = screens.screen("session").render(c);
const view = out.content;
const sheet = () => byClass(view, "xsheet")[0] ?? null;
const sheetText = () => sheet()?.textContent ?? "";
const close = () =>
  button(view, (b) => b.attrs["data-action"] === "files.close")?.click();
const lines = (kind) =>
  byClass(sheet() ?? view, "xl").filter((n) => hasClass(n, kind));
const signOf = (row) => byClass(row, "xs")[0]?.textContent;
const textOf = (row) => byClass(row, "xt")[0]?.textContent;

try {
  const reply = await until(() =>
    byClass(view, "reply").find((r) => r.textContent.startsWith("Done.")),
  );
  check("the session's reply is drawn", Boolean(reply), view.textContent);

  // ---- a tap on an Edit row: its added and removed lines, each with its sign (the 3 steps fold into one row first)
  byClass(view, "work-sum")[0]?.click();
  const editRow = await until(() =>
    button(view, (b) => b.attrs["data-step"] === "e1"),
  );
  editRow?.click();
  await until(() => lines("add").length);
  const adds = lines("add");
  const dels = lines("del");
  check(
    "a tap on an Edit row shows its added lines with + and its removed line with −, numbered",
    adds.length === 2 &&
      dels.length === 1 &&
      adds.every((r) => signOf(r) === "+") &&
      signOf(dels[0]) === "−" &&
      show(adds.map(textOf)) === show(["c", "d"]) &&
      textOf(dels[0]) === "b" &&
      byClass(adds[0], "xn")[0]?.textContent === "2" &&
      byClass(sheet(), "xhunk")[0]?.textContent === "Lines 1–3",
    sheetText(),
  );
  check(
    "the diff sheet's head names the file, its folder, the tool and the counts, with Whole file",
    byClass(sheet(), "xname")[0]?.textContent === "app.js" &&
      byClass(sheet(), "xmeta")[0]?.textContent === "src/ · Edit · +2 −1" &&
      Boolean(button(view, (b) => b.attrs["data-action"] === "files.whole")),
    sheetText(),
  );
  close();
  check("Close closes the sheet", !sheet(), sheetText());

  // ---- a file link in the answer: the Markdown file, rendered
  const link = (words) =>
    byClass(reply, "md-file").find((b) => b.textContent === words);
  check(
    "file links in the answer are tappable; a web link stays a web link",
    byClass(reply, "md-file").length === 4 &&
      byClass(reply, "md-a").some(
        (a) => a.tagName === "a" && a.attrs.href === "https://example.com",
      ),
    show(byClass(reply, "md-a").map((a) => [a.tagName, a.textContent])),
  );
  link("notes")?.click();
  await until(() => byClass(view, "xmd").length);
  const md = byClass(view, "xmd")[0];
  check(
    "a tap on a Markdown file link shows the file with its Markdown rendered",
    Boolean(md) &&
      byClass(md, "md-h")[0]?.textContent === "Notes" &&
      byTag(md, "strong")[0]?.textContent === "bold" &&
      byClass(sheet(), "xmeta")[0]?.textContent === "docs/ · Markdown" &&
      /^\d+ B · changed /.test(byClass(sheet(), "xlast")[0]?.textContent),
    sheetText(),
  );
  close();

  // ---- a code file: plain lines with numbers
  link("app")?.click();
  await until(() => byClass(view, "xcode").length);
  const code = byClass(sheet() ?? view, "xl");
  check(
    "a tap on a code file link shows its lines, each with its number",
    show(code.map((r) => [byClass(r, "xn")[0]?.textContent, textOf(r)])) ===
      show([
        ["1", "a"],
        ["2", "c"],
        ["3", "d"],
        ["4", "e"],
      ]),
    sheetText(),
  );
  close();

  // ---- a refused file: its reason
  link("secret")?.click();
  await until(() => byClass(view, "xstate").length);
  check(
    "a refused file shows its reason and no file text",
    sheet()?.className.includes("short") &&
      sheetText().includes("Not shown on the phone") &&
      sheetText().includes(
        "Files named like a key or a secret never open on the phone. This file is “.env”.",
      ) &&
      sheetText().includes("To see it, open it on the PC.") &&
      !sheetText().includes("KEY="),
    sheetText(),
  );
  close();

  // ---- too big: a 9 MB picture
  link("huge")?.click();
  await until(() => byClass(view, "xstate").length);
  check(
    "a picture over 8 MB shows the too-big state with its size",
    sheetText().includes("Too big for the phone") &&
      sheetText().includes(
        "This picture is 9 MB. The phone can show pictures up to 8 MB.",
      ),
    sheetText(),
  );
  close();

  // ---- the changed-files line: two files, then a file's diff
  const line = await until(() =>
    button(view, (b) => b.attrs["data-action"] === "files.changes"),
  );
  check(
    "the answer ends in its changed-files line with the sums",
    line?.textContent === "2 files changed+6 −2",
    line?.textContent,
  );
  line?.click();
  const rows = byClass(view, "xfile");
  check(
    "a tap lists the answer's two files with their folder, edits and counts",
    show(rows.map((r) => r.textContent)) ===
      show(["app.jssrc/ · 2 edits+3 −2", "new.jssrc/ · 1 edit+3 −0"]) &&
      byClass(sheet(), "xmeta")[0]?.textContent === "This answer · +6 −2",
    show(rows.map((r) => r.textContent)),
  );
  rows[0]?.click();
  await until(() => byClass(view, "xedit").length === 2);
  check(
    "a tap on a file shows its two edits stacked, each with its lines and signs, with Back",
    show(byClass(view, "xedit").map((n) => n.textContent)) ===
      show(["Edit 1 of 2", "Edit 2 of 2"]) &&
      lines("add").length === 3 &&
      lines("del").length === 2 &&
      Boolean(button(view, (b) => b.attrs["data-action"] === "files.back")),
    sheetText(),
  );
  button(view, (b) => b.attrs["data-action"] === "files.back")?.click();
  check(
    "Back goes to the changed-files list, Close then closes it",
    byClass(view, "xfile").length === 2,
    sheetText(),
  );
  close();
  check("no sheet is left open", !sheet(), sheetText());

  // ---- the page's files block: nothing under 12 px, every control 44 px
  const css = fs.readFileSync(path.join(PAGE, "page.css"), "utf8");
  const block = css.slice(css.indexOf("/* ---- files: previews and diffs"));
  const sizes = [...block.matchAll(/(\d+)px\/\d+px|font-size:\s*(\d+)px/g)].map(
    (m) => Number(m[1] ?? m[2]),
  );
  const tall = (sel) =>
    new RegExp(
      `${sel.replace(/\./g, "\\.")}\\s*\\{[^}]*min-height:\\s*(4[4-9]|[5-9]\\d)px`,
    ).test(block);
  check(
    "the files block sets no text under 12 px, and its controls are at least 44 px",
    block.length > 0 &&
      sizes.every((n) => n >= 12) &&
      [".xband", ".work-step", ".xfile", ".xtry"].every(tall),
    show({ sizes }),
  );
} catch (e) {
  failed++;
  console.log(`FAIL the test stopped: ${e.stack}`);
}

console.log(`\n${pass} passed, ${failed} failed`);
await fake.close();
fx.close();
// The PC's own database reads may still hold the fixture open on Windows: the temp folder then stays, said once.
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (e) {
  console.log(`note: the temp folder ${tmp} stays (${e.code})`);
}
process.exit(failed ? 1 : 0);
