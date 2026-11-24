// wakeup-note patch: on a temp copy of the installed app.asar (the unpatched app.asar.orig when there), the
// patch applies once with the other real patches, a second run changes nothing, and the patched main bundle
// still passes the compile check. Then the patched code is cut out and run: sendWakeupAsNote against a stand-in
// steer script (the arguments and text the Note button uses; exit 0 is a note, exit 3 and a missing script are
// not), and the wakeup executor with stand-ins for the AI service: a session mid-turn whose note steer takes is
// not queued, every other case is. The same executor cut from the unpatched bundle queues the mid-turn wakeup,
// so this test fails without the patch. Skips when Nimbalyst is not installed (CI runners).
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "..", "scripts", "nimbalyst-patch");

const res =
  process.env.LOCALAPPDATA &&
  path.join(process.env.LOCALAPPDATA, "Programs", "Nimbalyst", "resources");
const REAL =
  res &&
  (fs.existsSync(path.join(res, "app.asar.orig"))
    ? path.join(res, "app.asar.orig")
    : path.join(res, "app.asar"));
if (!REAL || !fs.existsSync(REAL)) {
  console.log(`skipped: Nimbalyst is not installed (no app.asar at ${REAL})`);
  process.exit(0);
}

const { readAsar, readEntry, plan, compileCheck, writeAsar, loadPatches } =
  await import(pathToFileURL(path.join(TOOL, "patch.mjs")).href);
const { NOTE_HEAD } = await import(
  pathToFileURL(path.join(TOOL, "patches", "wakeup-note.mjs")).href
);

let failed = 0,
  passed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${detail}`}`,
  );
}

const MAIN = "out/main/index.js";
const T = fs.mkdtempSync(path.join(os.tmpdir(), "nimbalyst-wakeup-note-"));
try {
  const copy = path.join(T, "app.asar");
  fs.copyFileSync(REAL, copy);
  const all = await loadPatches(path.join(TOOL, "patches"));
  const mine = all.filter((p) => p.id === "wakeup-note");
  check("the patch loads from the patches folder", mine.length === 1);

  // 1. with all real patches on the unpatched copy: would apply, to the main bundle only, which still compiles
  const asar = readAsar(copy);
  const first = plan(asar, all);
  const st = first.results.find((r) => r.id === "wakeup-note");
  check(
    "on the installed app.asar copy: would apply, to out/main/index.js only",
    st?.state === "would apply" &&
      st.files.length === 1 &&
      st.files[0] === MAIN,
    JSON.stringify(st),
  );
  const errors = compileCheck(first.changed);
  check(
    "the patched files pass the patcher's compile check",
    !errors.length,
    errors.join("; "),
  );

  // 2. written once, a second run changes nothing
  const once = path.join(T, "app.asar.once");
  writeAsar(asar, first.changed, once);
  const again = plan(readAsar(once), mine);
  check(
    "a second run: already applied, nothing to change",
    again.results[0].state === "applied" && again.changed.size === 0,
    JSON.stringify(again.results[0]),
  );

  // 3. the patched bundle: each edit replaced once; the mid-turn check it calls is the bundle's status test
  const patched = readEntry(readAsar(once), MAIN).toString("utf8");
  const orig = readEntry(asar, MAIN).toString("utf8");
  const count = (s) => patched.split(s).length - 1;
  check(
    "each edit is in the patched bundle once, its anchor only inside it",
    mine[0].edits.every(
      (e) =>
        count(e.replace) === 1 &&
        count(e.anchor) === e.replace.split(e.anchor).length - 1,
    ),
  );
  const fnSource = (chunk, name) => {
    const m = chunk.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}$`, "m"));
    if (!m) throw new Error(`function ${name} not found in ${MAIN}`);
    return m[0];
  };
  check(
    "isSessionMidTurn is the bundle's running / waiting_for_input test",
    /status === "running" \|\| status === "waiting_for_input"/.test(
      fnSource(patched, "isSessionMidTurn"),
    ),
  );

  // 4. sendWakeupAsNote against a stand-in steer script in a fake home folder
  const home = path.join(T, "home");
  const steerDir = path.join(home, ".claude", "skills", "steer");
  const record = path.join(T, "steer-call.json");
  const logs = [];
  const logger = {
    info: (m, o) => logs.push(["info", m, o]),
    warn: (m, o) => logs.push(["warn", m, o]),
  };
  const realRequire = createRequire(import.meta.url);
  const ctx = vm.createContext({
    logger$5: logger,
    Promise,
    require: (m) => (m === "os" ? { homedir: () => home } : realRequire(m)),
  });
  const constLine = (name) => {
    const m = patched.match(new RegExp(`^const ${name} = .*;$`, "m"));
    if (!m) throw new Error(`const ${name} not found in ${MAIN}`);
    return m[0];
  };
  vm.runInContext(
    [
      constLine("WAKEUP_NOTE_MS"),
      constLine("WAKEUP_NOTE_HEAD"),
      fnSource(patched, "sendWakeupAsNote"),
      "this.send = sendWakeupAsNote;",
    ].join("\n"),
    ctx,
  );
  const steerWith = (code) => {
    fs.mkdirSync(steerDir, { recursive: true });
    fs.writeFileSync(
      path.join(steerDir, "steer.mjs"),
      `import fs from "node:fs";
let input = "";
for await (const c of process.stdin) input += c;
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), input, cwd: process.cwd() }));
console.log(${code === 0 ? '"Queued for the session.\\nNote id: n-test1"' : '"NOT SENT: the session is idle"'});
process.exit(${code});
`,
    );
    fs.rmSync(record, { force: true });
  };
  const ws = path.join(T, "workspace");
  fs.mkdirSync(ws);

  steerWith(0);
  const sent = await ctx.send("sess-1", ws, "check the CI run");
  const call = JSON.parse(fs.readFileSync(record, "utf8"));
  check(
    "steer takes the note (exit 0): true, logged with the note id",
    sent === true &&
      logs.some((l) => l[0] === "info" && l[2]?.noteId === "n-test1"),
    JSON.stringify(logs),
  );
  check(
    "steer gets the Note button's arguments: send --to <id> - --nowait",
    JSON.stringify(call.args) ===
      JSON.stringify(["send", "--to", "sess-1", "-", "--nowait"]),
    JSON.stringify(call.args),
  );
  check(
    "the note text on stdin: the wakeup line, then the prompt",
    call.input === `${NOTE_HEAD}\ncheck the CI run`,
    JSON.stringify(call.input),
  );
  check(
    "steer runs in the session's workspace folder",
    path.resolve(call.cwd).toLowerCase() === path.resolve(ws).toLowerCase(),
    call.cwd,
  );

  steerWith(3);
  logs.length = 0;
  check(
    "steer finds the session not busy (exit 3): false, logged with steer's output",
    (await ctx.send("sess-1", ws, "x")) === false &&
      logs.some((l) => l[2]?.code === 3 && /NOT SENT/.test(l[2]?.out)),
    JSON.stringify(logs),
  );

  fs.rmSync(steerDir, { recursive: true });
  logs.length = 0;
  check(
    "no steer script: false, with a warning",
    (await ctx.send("sess-1", ws, "x")) === false &&
      logs.some((l) => l[0] === "warn"),
    JSON.stringify(logs),
  );

  // 5. the executor, cut out of the bundle, with stand-ins for the AI service and the two checks
  const executorOf = (chunk) => {
    const start = chunk.indexOf(
      "      executor: async ({ sessionId, workspacePath, prompt }) => {\n",
    );
    const end = chunk.indexOf("\n      broadcastChanged: (row) => {", start);
    if (start < 0 || end < 0)
      throw new Error(`the wakeup executor not found in ${MAIN}`);
    return chunk
      .slice(start, end)
      .trim()
      .replace(/^executor: /, "")
      .replace(/,$/, "");
  };
  const runExecutor = async (chunk, { midTurn, noteTaken }) => {
    const seen = { queued: [], drives: [], notes: [] };
    const c = vm.createContext({
      aiSvcRef: {
        queuePromptForSession: async (...a) => seen.queued.push(a),
        driveQueuedPrompts: async (...a) => {
          seen.drives.push(a);
          return { kind: "dispatched" };
        },
      },
      isSessionMidTurn: () => midTurn,
      sendWakeupAsNote: async (...a) => {
        seen.notes.push(a);
        return noteTaken;
      },
    });
    const executor = vm.runInContext(`(${executorOf(chunk)})`, c);
    seen.result = await executor({
      sessionId: "sess-1",
      workspacePath: ws,
      prompt: "check the CI run",
    });
    return seen;
  };

  const mid = await runExecutor(patched, { midTurn: true, noteTaken: true });
  check(
    "mid-turn, steer takes the note: fired as a note, nothing queued",
    mid.result.triggered === true &&
      mid.queued.length === 0 &&
      mid.drives.length === 0 &&
      JSON.stringify(mid.notes) ===
        JSON.stringify([["sess-1", ws, "check the CI run"]]),
    JSON.stringify(mid),
  );
  const refused = await runExecutor(patched, {
    midTurn: true,
    noteTaken: false,
  });
  check(
    "mid-turn, steer does not take it: queued and driven as before",
    refused.result.triggered === true &&
      refused.queued.length === 1 &&
      refused.queued[0][3]?.promptOrigin === "wakeup_resume" &&
      refused.drives.length === 1,
    JSON.stringify(refused),
  );
  const idle = await runExecutor(patched, { midTurn: false, noteTaken: true });
  check(
    "idle: no note tried, queued and driven as before (a new turn)",
    idle.notes.length === 0 &&
      idle.queued.length === 1 &&
      idle.drives.length === 1,
    JSON.stringify(idle),
  );
  const before = await runExecutor(orig, { midTurn: true, noteTaken: true });
  check(
    "without the patch a mid-turn wakeup is queued (the bug this patch fixes)",
    before.queued.length === 1 && before.notes.length === 0,
    JSON.stringify(before),
  );
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
