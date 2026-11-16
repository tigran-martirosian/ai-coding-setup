// Tests for files and diffs in a session (skills/phone-bot/pc/actions/files.mjs, the file rule in core/files.mjs and
// the step fields in core/transcripts.mjs). A fixture nimbalyst.sqlite, a fixture transcript and project folder in a
// temp home and a fake door (project list only) stand in for Nimbalyst; actions are called through the registry.
// Run: node tests/test-phone-pc-files.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PC = path.join(ROOT, "skills", "phone-bot", "pc");

let pass = 0;
let failed = 0;
// Cases of Windows-only behaviour (the installed Nimbalyst version is read from its per-user Windows
// install; drive-letter paths), skipped on other systems.
const WINDOWS_ONLY = [
  "links: /C:/",
  "outside by text, no disk call: /Windows/",
];
const check = (name, ok, extra = "") => {
  if (
    process.platform !== "win32" &&
    WINDOWS_ONLY.some((w) => name.startsWith(w))
  ) {
    console.log(`skip ${name} (Windows only)`);
    return;
  }
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const show = (v) => JSON.stringify(v)?.slice(0, 400);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-pc-files-"));
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
fs.mkdirSync(path.join(home, ".phone-app"), { recursive: true });
fs.writeFileSync(path.join(home, ".phone-app", "pc-keys.json"), "{}");

// ---- the project folder
const PROJECT = path.join(tmp, "proj");
const OUTSIDE = path.join(tmp, "outside");
const put = (rel, text, root = PROJECT) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
};
put("src/app.js", "a\nc\nd\n");
put("src/new.js", "x\ny\nz\n");
put("README.md", "# Read me\n");
put(
  "docs/guide/a.md",
  "See [b](b.md), [up](../notes.md) and [far](../../../outside/o.md).\n",
);
put("docs/guide/b.md", "# B\n");
put("docs/notes.md", "# Notes\n");
put("my notes.md", "spaced\n");
put(".env", "KEY=1\n");
put(".git/config", "[core]\n");
put(".mcp.json", "{}\n");
put(".dev.vars", "A=1\n");
put(".envrc", "x\n");
put(".credentials.json", "{}\n");
put("owner-secrets.json", "{}\n");
put("pc-keys.json", "{}\n");
put(".phone-app/x.txt", "x\n");
put("tokens.css", ":root{}\n");
put("swap/s.md", "# swap\n");
put("o.md", "outside\n", OUTSIDE);
put("secret.md", "outside too\n", OUTSIDE);
const lines400 = Array.from({ length: 900 }, (_, i) => `line ${i + 1}`).join(
  "\n",
);
put("long.txt", `${lines400}\n`);
put("big.txt", `${"0123456789abcdef\n".repeat((2 * 1024 * 1024) / 17 + 1)}`);
const PIC = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  crypto.randomBytes(300 * 1024),
]);
put("pic.png", PIC);
put("huge.png", Buffer.alloc(9 * 1024 * 1024, 1));
fs.symlinkSync(OUTSIDE, path.join(PROJECT, "linked"), "junction");
fs.symlinkSync(
  path.join(home, ".phone-app"),
  path.join(PROJECT, "appdir"),
  "junction",
);

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
const addSession = (id, project, provider) => {
  const now = new Date().toISOString();
  fx.prepare(
    `INSERT INTO ai_sessions (id, workspace_id, title, status, provider_session_id, model, created_at, updated_at)
     VALUES (?, ?, 'S', 'idle', ?, 'claude-code:opus', ?, ?)`,
  ).run(id, project, provider, now, now);
  return id;
};
const T1 = "11111111-aaaa-4bbb-8ccc-000000000001";
const T2 = "11111111-aaaa-4bbb-8ccc-000000000002";
const S1 = addSession("00000000-0000-4000-8000-000000000001", PROJECT, T1);
const S2 = addSession("00000000-0000-4000-8000-000000000002", PROJECT, T2);
const SHOME = addSession("00000000-0000-4000-8000-000000000003", home, T1);

// ---- the fixture transcript: a prompt, then an answer with two Edits, a Write, a Bash, a Read and text with links
const folderName = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-");
const tdir = (p) => path.join(home, ".claude", "projects", folderName(p));
const ts = "2026-11-15T10:00:00.000Z";
const prompt = (text) => ({
  type: "user",
  timestamp: ts,
  message: { role: "user", content: text },
});
const use = (id, name, input) => ({
  type: "assistant",
  timestamp: ts,
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
  },
});
const say = (text) => ({
  type: "assistant",
  timestamp: ts,
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const res = (id, toolUseResult, content = "ok", extra = {}) => ({
  type: "user",
  timestamp: ts,
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content, ...extra }],
  },
  toolUseResult,
});
const P = (rel) => path.join(PROJECT, rel);
const patch = (lines) => [
  { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines },
];
const BIG_OUT = "x".repeat(100 * 1024);
const BIG_EDIT = Array.from(
  { length: 3000 },
  (_, i) => `+line ${i} ${"y".repeat(60)}`,
);
const LINES = [
  prompt("Start"),
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
  use("e3", "Edit", { file_path: P(".env"), old_string: "1", new_string: "2" }),
  res("e3", {
    filePath: P(".env"),
    structuredPatch: patch(["-KEY=1", "+KEY=2"]),
  }),
  use("b1", "Bash", { command: "node build.mjs" }),
  res("b1", { stdout: BIG_OUT, stderr: "", interrupted: false }),
  use("b2", "Bash", { command: "cat .env" }),
  res("b2", { stdout: "KEY=1", stderr: "", interrupted: false }),
  use("b3", "Bash", { command: "cat README.md" }),
  res("b3", { stdout: "# Read me", stderr: "", interrupted: false }),
  use("b4", "Bash", { command: "node --env-file=.env x.mjs" }),
  res("b4", { stdout: "KEY=1", stderr: "", interrupted: false }),
  use("b5", "Bash", { command: "echo $(cat .env)" }),
  res("b5", { stdout: "KEY=1", stderr: "", interrupted: false }),
  use("b6", "Bash", { command: "cat ~/.phone-app/state.json" }),
  res("b6", { stdout: "{}", stderr: "", interrupted: false }),
  use("g1", "Grep", { pattern: "KEY", path: ".env" }),
  res("g1", { mode: "content" }, "KEY=1"),
  use("g2", "Glob", { pattern: "**/.env*" }),
  res("g2", { filenames: [] }, ".env"),
  use("g3", "Grep", { pattern: "BEGIN", glob: "*.pem" }),
  res("g3", { mode: "content" }, "x.pem"),
  use("g4", "Glob", { pattern: "**/*.css" }),
  res("g4", { filenames: [] }, "tokens.css"),
  use("r1", "Read", { file_path: P("long.txt"), offset: 100, limit: 20 }),
  res("r1", {
    type: "text",
    file: {
      filePath: P("long.txt"),
      content: "SECRET TEXT",
      numLines: 20,
      startLine: 100,
      totalLines: 900,
    },
  }),
  use("r2", "Read", { file_path: P("docs/guide/a.md") }),
  res("r2", {
    type: "text",
    file: {
      filePath: P("docs/guide/a.md"),
      content: "",
      numLines: 1,
      startLine: 1,
      totalLines: 1,
    },
  }),
  use("big", "Edit", {
    file_path: P("src/big.js"),
    old_string: "",
    new_string: "",
  }),
  res("big", {
    filePath: P("src/big.js"),
    structuredPatch: [
      {
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 3000,
        lines: BIG_EDIT,
      },
    ],
  }),
  use("k1", "Write", {
    file_path: path.join(home, ".phone-app", "state.json"),
    content: "{}\n",
  }),
  res("k1", {
    filePath: path.join(home, ".phone-app", "state.json"),
    structuredPatch: patch([" {", "+}"]),
  }),
  say(
    "Done: [app](src/app.js:2), [pic](pic.png), [big](big.txt), [huge](huge.png), [readme](/" +
      PROJECT.replace(/\\/g, "/") +
      "/README.md), [sp](my%20notes.md), [swap](swap/s.md), [tok](tokens.css), [web](https://example.com), " +
      "[out](../outside/o.md), [lnk](linked/secret.md), [env](.env), [git](.git/config), [mcp](.mcp.json), " +
      "[dv](.dev.vars), [rc](.envrc), [cr](.credentials.json), [os](owner-secrets.json), [pk](pc-keys.json), " +
      "[pa](.phone-app/x.txt), [ak](appdir/pc-keys.json), [unc](//host/share/a.md), [bin](src/app.js)",
  ),
  use("run", "Bash", { command: "sleep 9" }),
  prompt("Next"),
  say("Second answer."),
];
const OFF = [];
let text = "";
for (const l of LINES) {
  OFF.push(Buffer.byteLength(text));
  text += `${JSON.stringify(l)}\n`;
}
const at = (id) =>
  OFF[
    LINES.findIndex(
      (l) => l.message.content[0]?.id === id && l.type === "assistant",
    )
  ];
fs.mkdirSync(tdir(PROJECT), { recursive: true });
fs.writeFileSync(path.join(tdir(PROJECT), `${T1}.jsonl`), text);
fs.writeFileSync(
  path.join(tdir(PROJECT), `${T2}.jsonl`),
  `${JSON.stringify(prompt("Other"))}\n`,
);
fs.mkdirSync(tdir(home), { recursive: true });
fs.writeFileSync(path.join(tdir(home), `${T1}.jsonl`), text);

// ---- the fake door (only the project list is read) and the real registry
const { startFakeDoor } = await import("./phone-bot/fake-door.mjs");
const door = await startFakeDoor({
  endpointFile: path.join(NIM, "mcp-endpoint.json"),
  workspaces: [
    { name: "proj", path: PROJECT },
    { name: "home", path: home },
  ],
  tools: [],
  handle: (name) => {
    throw new Error(`the fake door has no ${name}`);
  },
});
const { createRegistry } = await import(
  "../skills/phone-bot/pc/core/registry.mjs"
);
const files = await import("../skills/phone-bot/pc/core/files.mjs");
const registry = createRegistry();
await registry.load(path.join(PC, "actions"));
let n = 0;
const ask = async (a, d, page = "ok") =>
  registry.handle({ k: "req", id: `r${++n}`, a, d }, { device: "dev-a", page });
const ok = (r) => (r.ok ? r.d : { failed: r });

try {
  // ---- steps on session.older's turns
  const size = Buffer.byteLength(text);
  const older = ok(
    await ask("session.older", { session: S1, before: OFF[LINES.length - 2] }),
  );
  const steps = new Map(
    (older.items ?? []).flatMap((t) => t.steps ?? []).map((s) => [s.id, s]),
  );
  // Every turn keeps its transcript position, and that position as `at` finds the turn's own steps.
  const placed = older.items ?? [];
  const found = [];
  for (const t of placed.filter((x) => x.steps?.length))
    for (const s of t.steps) {
      const r = await ask("step.detail", {
        session: S1,
        step: s.id,
        at: t.pos,
      });
      found.push(r.ok); // a call with no result yet answers kind "running": found too
    }
  check(
    "session.older: every turn carries an integer pos, and that pos as at finds its steps",
    placed.length > 0 &&
      placed.every((t) => Number.isInteger(t.pos) && t.pos >= 0) &&
      found.length > 0 &&
      found.every(Boolean),
    show({ pos: placed.map((t) => t.pos), found }),
  );
  const e1 = steps.get("e1");
  check(
    "turn steps: an Edit's counts",
    e1?.add === 2 && e1?.del === 1 && e1.error === false,
    show(e1),
  );
  check(
    "turn steps: a Write that made a file",
    steps.get("w1")?.add === 3 && steps.get("w1")?.del === 0,
    show(steps.get("w1")),
  );
  check(
    "turn steps: a Bash has no counts or file",
    steps.get("b1")?.add === null && steps.get("b1")?.file === null,
    show(steps.get("b1")),
  );
  check(
    "turn steps: a .env edit has no handle",
    steps.get("e3")?.file === null,
    show(steps.get("e3")),
  );
  check(
    "turn steps: the running call has no result yet",
    steps.get("run")?.error === null,
    show(steps.get("run")),
  );
  const linkTurn = (older.items ?? []).find((t) => t.links?.length > 3);
  const link = (target) => linkTurn?.links.find((l) => l.target === target);
  check("links: a URL is not a link to a file", !link("https://example.com"));
  check(
    "links: a trailing :2 is the line",
    link("src/app.js:2")?.line === 2 && link("src/app.js:2")?.file,
    show(link("src/app.js:2")),
  );

  // ---- step.detail
  const detail = async (id) =>
    ok(await ask("step.detail", { session: S1, step: id, at: at(id) }));
  const d1 = await detail("e1");
  check(
    "step.detail: an Edit gives its changed lines and counts",
    d1.kind === "diff" &&
      d1.add === 2 &&
      d1.del === 1 &&
      d1.hunks?.[0]?.lines.join("|") === " a|-b|+c|+d" &&
      d1.file === e1.file,
    show(d1),
  );
  const w1 = await detail("w1");
  check(
    "step.detail: a Write that made a file",
    w1.created === true &&
      w1.add === 3 &&
      w1.del === 0 &&
      w1.hunks[0].lines.length === 3,
    show(w1),
  );
  const b1 = await detail("b1");
  check(
    "step.detail: a command's output is cut at 64 KB",
    b1.kind === "output" &&
      b1.cut === true &&
      b1.bytes === BIG_OUT.length &&
      Buffer.byteLength(b1.out) === 64 * 1024 &&
      b1.command === "node build.mjs",
    show({ ...b1, out: b1.out?.length }),
  );
  const b3 = await detail("b3");
  check(
    "output rule: cat README.md shows",
    b3.out === "# Read me" && !b3.hidden,
    show(b3),
  );
  for (const id of ["b2", "b4", "b5", "b6", "g1", "g2", "g3"]) {
    const h = await detail(id);
    check(
      `output rule: ${id} is hidden`,
      h.kind === "output" &&
        h.hidden &&
        h.out === undefined &&
        !String(h.command ?? "").includes(".env"),
      show(h),
    );
  }
  check(
    "output rule: the hidden answer names the file",
    (await detail("b2")).name === ".env",
  );
  check(
    "output rule: a Glob **/*.css shows",
    (await detail("g4")).out === "tokens.css",
  );
  const r1 = await detail("r1");
  check(
    "step.detail: a Read gives its handle and lines, no file text",
    r1.kind === "read" &&
      r1.file &&
      r1.startLine === 100 &&
      r1.numLines === 20 &&
      !JSON.stringify(r1).includes("SECRET TEXT"),
    show(r1),
  );
  const e3 = await detail("e3");
  check(
    "step.detail: a .env diff gives counts only",
    e3.refused === "secret file name" && e3.add === 1 && !e3.hunks,
    show(e3),
  );
  const k1 = await detail("k1");
  check(
    "step.detail: a diff under ~/.phone-app gives counts only",
    k1.refused && !k1.hunks,
    show(k1),
  );
  const big = await ask("step.detail", {
    session: S1,
    step: "big",
    at: at("big"),
  });
  const bigLines = big.d?.hunks?.reduce((s, h) => s + h.lines.length, 0);
  check(
    "step.detail: a 3,000-line diff stops at the cap",
    big.ok &&
      big.d.cut &&
      bigLines <= 2000 &&
      Buffer.byteLength(JSON.stringify(big)) < 192 * 1024,
    show({ bigLines, cut: big.d?.cut, more: big.d?.more }),
  );
  check(
    "step.detail: a call with no result is running",
    (await detail("run")).kind === "running",
  );
  const noStep = await ask("step.detail", {
    session: S1,
    step: "e1",
    at: at("b1"),
  });
  check(
    "step.detail: an at past the call is no-step",
    noStep.err === "no-step",
    show(noStep),
  );
  for (const [what, a] of [
    ["-1", -1],
    ["x", "x"],
    ["mid-line", at("e1") + 3],
    ["past the end", size + 1],
  ]) {
    const r = await ask("step.detail", { session: S1, step: "e1", at: a });
    check(
      `step.detail: at ${what} is bad-input`,
      r.err === "bad-input",
      show(r),
    );
  }

  // ---- session.changes
  const ch1 = ok(await ask("session.changes", { session: S1, at: at("b1") }));
  const ch2 = ok(await ask("session.changes", { session: S1, at: at("e1") }));
  const app = ch1.files?.find((f) => f.name === "app.js");
  check(
    "session.changes: the files in order with their sums and steps",
    ch1.files?.[0]?.name === "app.js" &&
      ch1.files[1].name === "new.js" &&
      app.add === 3 &&
      app.del === 2 &&
      app.steps.join() === "e1,e2",
    show(ch1),
  );
  check(
    "session.changes: a .env change has counts and no steps",
    ch1.files?.find((f) => f.name === ".env")?.refused === "secret file name" &&
      ch1.files.find((f) => f.name === ".env").steps.length === 0,
  );
  check(
    "session.changes: at on another turn of the answer gives the same",
    JSON.stringify(ch1) === JSON.stringify(ch2),
  );
  const ch3 = ok(
    await ask("session.changes", { session: S1, at: OFF[LINES.length - 1] }),
  );
  check(
    "session.changes: the next answer has none",
    ch3.files?.length === 0,
    show(ch3),
  );

  // ---- file.open
  const open = (file, more) => ask("file.open", { session: S1, file, ...more });
  const r1Open = ok(await open(r1.file, { line: 96, count: 28 }));
  const got = Buffer.from(r1Open.bytes ?? "", "base64")
    .toString("utf8")
    .split("\n");
  check(
    "file.open: a file the session read opens by its handle",
    r1Open.kind === "text" &&
      r1Open.firstLine === 96 &&
      r1Open.lineCount === 28 &&
      got[0] === "line 96" &&
      r1Open.lines === 900,
    show(r1Open),
  );
  const aMd = ok(await open(steps.get("r2").file, { offset: 0 }));
  const mdLink = (t) => aMd.links?.find((l) => l.target === t);
  check(
    "file.open: Markdown with its links",
    aMd.kind === "markdown" && aMd.links?.length === 3,
    show(aMd),
  );
  const bMd = ok(await open(mdLink("b.md")?.file, { offset: 0 }));
  check(
    "Markdown links: b.md opens docs/guide/b.md",
    bMd.path === "docs/guide/b.md",
    show(bMd),
  );
  const nMd = ok(await open(mdLink("../notes.md")?.file, { offset: 0 }));
  check(
    "Markdown links: ../notes.md opens docs/notes.md",
    nMd.path === "docs/notes.md",
    show(nMd),
  );
  check(
    "Markdown links: a link out of the project is refused",
    mdLink("../../../outside/o.md")?.why === "outside the session's folders",
    show(mdLink("../../../outside/o.md")),
  );
  const sp = ok(await open(link("my%20notes.md")?.file, { offset: 0 }));
  check(
    "links: my%20notes.md opens my notes.md",
    sp.name === "my notes.md",
    show(sp),
  );
  const rd = link(`/${PROJECT.replace(/\\/g, "/")}/README.md`);
  check("links: /C:/... inside the project opens", !!rd?.file, show(rd));
  check("links: tokens.css opens", !!link("tokens.css")?.file);

  // A picture arrives whole from pieces.
  const pieces = [];
  let next = 0;
  while (next !== null && pieces.length < 10) {
    const p = ok(await open(link("pic.png")?.file, { offset: next }));
    pieces.push(Buffer.from(p.bytes ?? "", "base64"));
    next = p.next ?? null;
    if (p.mime !== "image/png") break;
  }
  const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
  check(
    "file.open: a 300 KB picture arrives whole from four pieces",
    pieces.length === 4 && sha(Buffer.concat(pieces)) === sha(PIC),
    `${pieces.length} pieces`,
  );
  const huge = ok(await open(link("huge.png")?.file, { offset: 0 }));
  check(
    "file.open: a 9 MB picture answers too big with no bytes",
    huge.tooBig === true &&
      huge.bytes === undefined &&
      huge.size === 9 * 1024 * 1024,
    show(huge),
  );
  let off = 0;
  let count = 0;
  let last;
  while (off !== null && count < 20) {
    last = ok(await open(link("big.txt")?.file, { offset: off }));
    off = last.next ?? null;
    count++;
  }
  check(
    "file.open: a 2 MB text stops at the first 1 MB",
    count === 11 &&
      last.next === null &&
      last.offset + Buffer.from(last.bytes, "base64").length === 1024 * 1024,
    `${count} pieces ${show({ ...last, bytes: undefined })}`,
  );

  // ---- refusals, each with its rule named
  const stale = await open("AAAAAAAAAAAAAAAA", { offset: 0 });
  check(
    "refused: an unknown handle",
    stale.err === "stale-handle",
    show(stale),
  );
  const other = await ask("file.open", {
    session: S2,
    file: r1.file,
    offset: 0,
  });
  check(
    "refused: a handle of another session",
    other.err === "stale-handle",
    show(other),
  );
  for (const [target, rule] of [
    ["../outside/o.md", "outside the session's folders"],
    ["linked/secret.md", "outside the session's folders"],
    [".env", "secret file name"],
    [".git/config", "secret folder"],
    [".mcp.json", "secret file name"],
    [".dev.vars", "secret file name"],
    [".envrc", "secret file name"],
    [".credentials.json", "secret file name"],
    ["owner-secrets.json", "secret file name"],
    ["pc-keys.json", "secret file name"],
    [".phone-app/x.txt", "secret folder"],
    ["appdir/pc-keys.json", "secret file name"],
    ["//host/share/a.md", "path form"],
  ])
    check(
      `refused: ${target} as ${rule}`,
      link(target) && link(target).file === null && link(target).why === rule,
      show(link(target)),
    );
  // The rule runs again at every open: a folder made a link out after the handle was given.
  const swap = link("swap/s.md")?.file;
  fs.rmSync(path.join(PROJECT, "swap"), { recursive: true });
  fs.symlinkSync(OUTSIDE, path.join(PROJECT, "swap"), "junction");
  fs.copyFileSync(path.join(OUTSIDE, "o.md"), path.join(OUTSIDE, "s.md"));
  const swapped = await open(swap, { offset: 0 });
  check(
    "refused: a link that now points outside, at open",
    swapped.err === "file-refused" &&
      swapped.rule === "outside the session's folders",
    show(swapped),
  );
  const homeRow = ok(
    await ask("session.older", {
      session: SHOME,
      before: OFF[LINES.length - 2],
    }),
  );
  const homeLinks =
    homeRow.items?.find((t) => t.links?.length > 3)?.links ?? [];
  check(
    "refused: a project whose folder is the home folder",
    homeLinks.length > 0 &&
      homeLinks.every(
        (l) =>
          l.file === null &&
          (l.why === "folder too wide" || l.why === "path form"),
      ),
    show(homeLinks.slice(0, 2)),
  );

  // Path form, with no disk call.
  const wrapped = ["existsSync", "statSync"].map((k) => [fs, k, fs[k]]);
  wrapped.push([fs.realpathSync, "native", fs.realpathSync.native]);
  const calls = [];
  // The refusal's own log line (~/.phone-app/pc.log) is not a call on the path checked.
  for (const [o, k, f] of wrapped)
    o[k] = (...a) => {
      if (!String(a[0]).endsWith("pc.log")) calls.push(k);
      return f(...a);
    };
  const folders = [PROJECT];
  const ruleOf = (p) => {
    try {
      files.checkSessionFile(p, folders);
      return "passed";
    } catch (e) {
      return e.rule ?? e.message;
    }
  };
  for (const p of [
    "\\\\host\\share\\a.md",
    "//host/share/a.md",
    "/\\\\host/a.md",
    "\\\\?\\C:\\x\\a.md",
    "\\\\.\\PhysicalDrive0",
    "//./COM1",
    path.join(PROJECT, "docs", "CON.md"),
    "C:a.md",
    `${PROJECT}\\a.md::$DATA`,
    `${PROJECT}\\a.md:hidden`,
    `${PROJECT}\\a\u0000.md`,
  ])
    check(
      `path form, no disk call: ${JSON.stringify(p).slice(0, 40)}`,
      ruleOf(p) === "path form" && !calls.length,
      `${ruleOf(p)} ${calls}`,
    );
  check(
    "path form: bad%ZZ.md",
    files.linkTarget("bad%ZZ.md", PROJECT).why === "path form" && !calls.length,
  );
  for (const p of [
    "C:/Windows/win.ini",
    path.resolve(PROJECT, "../../other/a.md"),
  ])
    check(
      `outside by text, no disk call: ${p.slice(-16)}`,
      ruleOf(p) === "outside the session's folders" && !calls.length,
      `${ruleOf(p)} ${calls}`,
    );
  // Node turns a junction's network target into a local one when it makes it, so a folder link stands in (it needs
  // Windows developer mode); tested only where the network target reads back.
  let junction = true;
  try {
    fs.symlinkSync("\\\\server\\share", path.join(PROJECT, "net"), "dir");
    junction = /^[\\/]{2}|^UNC/i.test(
      fs.readlinkSync(path.join(PROJECT, "net")),
    );
  } catch {
    junction = false;
  }
  if (junction)
    check(
      "path form: a junction to \\\\server\\share, no disk call",
      ruleOf(path.join(PROJECT, "net", "a.md")) === "path form" &&
        !calls.length,
      calls.join(),
    );
  else
    console.log("skip a junction to a network share: this PC cannot make one");
  for (const [o, k, f] of wrapped) o[k] = f;

  // ---- page check and bad inputs
  for (const [a, d] of [
    ["step.detail", { session: S1, step: "e1", at: at("e1") }],
    ["session.changes", { session: S1, at: at("e1") }],
    ["file.open", { session: S1, file: r1.file, offset: 0 }],
  ])
    check(
      `${a}: an unchecked page gets page-unverified`,
      (await ask(a, d, "unverified")).err === "page-unverified",
    );
  for (const [what, more] of [
    ["offset past the size", { offset: 10 ** 9 }],
    ["line 0", { line: 0, count: 5 }],
    ["count 401", { line: 1, count: 401 }],
    ["offset and line", { offset: 0, line: 1, count: 5 }],
  ])
    check(
      `file.open: ${what} is bad-input`,
      (await open(r1.file, more)).err === "bad-input",
    );
} finally {
  await door.close();
  (await import("../skills/phone-bot/pc/core/db.mjs")).closeDb();
  fx.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
