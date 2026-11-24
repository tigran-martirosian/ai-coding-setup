// node tests/test-nimbalyst-patch-real.mjs
// The real patch files (scripts/nimbalyst-patch/patches) on fixture code and, when Nimbalyst is installed, on a copy
// of its app.asar: updater-block, ask-line, files-and-agents, settled-repeat, files-chat-follows.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  check,
  cleanup,
  FILES,
  hashOf,
  makeApp,
  PATCHER,
  patchDir,
  R_MAIN,
  readAsar,
  run,
  stateOf,
  summary,
  T,
} from "./lib/nimbalyst-patch-fixture.mjs";

try {
  let r;
  const { loadPatches } = await import(pathToFileURL(PATCHER).href);
  const real = await loadPatches(path.join(path.dirname(PATCHER), "patches"));
  const block = real.find((p) => p.id === "updater-block");

  // 12. the real updater-block patch on a fixture main holding its six anchors as in 0.83.0, then the patched
  // main is run against a fake electron: the quit word quits, skips only the streaming-chat dialog, logs a line
  const UB_FILE = path.join(
    path.dirname(PATCHER),
    "patches",
    "updater-block.mjs",
  );
  const { QUIT_WORD } = await import(pathToFileURL(UB_FILE).href);
  check(
    "quit word: exported, a lowercase switch, used by the patch",
    typeof QUIT_WORD === "string" &&
      /^--[a-z-]+$/.test(QUIT_WORD) &&
      block?.edits.some((e) => e.replace.includes(JSON.stringify(QUIT_WORD))),
    String(QUIT_WORD),
  );
  const UB_MAIN = `const require$$1$2 = require("electron");
const logger$p = { main: { info() {} } };
const mainExports = { autoUpdater: { checkForUpdates: async () => "checked", checkForUpdatesAndNotify: async () => "checked" } };
const autoUpdaterService = { startAutoUpdateCheck() { require$$1$2.checks++; } };
const hasActiveStreamingSessions = () => true;
function boot() {
  if (require$$1$2.app.isPackaged) {
    logger$p.main.info("Starting auto-updater service");
    autoUpdaterService.startAutoUpdateCheck(60);
  }
}
function AutoUpdaterService() {
    mainExports.autoUpdater.autoDownload = true;
    mainExports.autoUpdater.autoInstallOnAppQuit = true;
}
const service = { sendToFrontmostWindow() {}, async checkForUpdatesWithUI() { await mainExports.autoUpdater.checkForUpdates(); } };
async function ipcCheck() { const result2 = await mainExports.autoUpdater.checkForUpdatesAndNotify(); return result2; }
if (require$$1$2.app.requestSingleInstanceLock()) {
    require$$1$2.app.on("second-instance", (_event, argv, workingDirectory) => {
      logger$p.main.info("[SingleInstance] second-instance event, argv:", argv);
      require$$1$2.opened.push(argv);
    });
}
require$$1$2.app.on("before-quit", async (event) => {
  if (hasActiveStreamingSessions() && !process.env.PLAYWRIGHT) {
    require$$1$2.dialogs++;
  }
  require$$1$2.cleanups++;
});
boot();
AutoUpdaterService();
return { service, ipcCheck };
`;
  const U = makeApp("updater-block", {
    files: { ...FILES, "out/main/index.js": UB_MAIN },
  });
  const UP = path.join(T, "patches-updater-block");
  fs.mkdirSync(UP);
  fs.copyFileSync(UB_FILE, path.join(UP, "updater-block.mjs"));
  r = run(["--app", U.res, "--patches", UP]);
  check(
    "updater-block on the fixture: all six edits apply",
    r.code === 0 && stateOf(r.out, "updater-block").startsWith("applied now"),
    r.out,
  );
  const uOnce = hashOf(U.asar);
  r = run(["--app", U.res, "--patches", UP]);
  check(
    "updater-block on the fixture: a second run changes nothing",
    r.code === 0 && /already applied/.test(r.out) && hashOf(U.asar) === uOnce,
    r.out,
  );
  const patchedMain = readAsar(U.asar)["out/main/index.js"].data.toString();
  const handlers = {},
    fake = { checks: 0, dialogs: 0, cleanups: 0, quits: 0, opened: [] };
  fake.app = {
    isPackaged: true,
    requestSingleInstanceLock: () => true,
    on: (n, f) => (handlers[n] ??= []).push(f),
    once: (n, f) => (handlers[n] ??= []).push(f),
    quit() {
      fake.quits++;
      for (const f of handlers["before-quit"]) f({ preventDefault() {} });
    },
  };
  const D = path.join(T, "deliver-data"),
    fakeProcess = { env: { NIMBALYST_DELIVER_DATA: D } };
  fs.mkdirSync(D);
  const fakeRequire = (m) =>
    m === "electron"
      ? fake
      : {
          fs,
          path,
          child_process: {
            spawn() {
              throw new Error("no spawn in this test");
            },
          },
        }[m];
  const out = new Function("require", "process", patchedMain)(
    fakeRequire,
    fakeProcess,
  );
  check(
    "patched main: no timed update check, the IPC check returns null",
    fake.checks === 0 && (await out.ipcCheck()) === null,
  );
  fake.app.quit();
  check(
    "patched main: a normal quit with a chat streaming still shows the dialog",
    fake.dialogs === 1 && fake.cleanups === 1,
    JSON.stringify(fake),
  );
  handlers["second-instance"][0](
    {},
    ["C:\\Nimbalyst\\Nimbalyst.exe", "C:\\work\\notes.md"],
    "C:\\work",
  );
  check(
    "patched main: a second launch without the word opens its target, no quit",
    fake.opened.length === 1 && fake.quits === 1,
    JSON.stringify(fake),
  );
  try {
    handlers["second-instance"][0](
      {},
      [
        "C:\\Nimbalyst\\Nimbalyst.exe",
        "--allow-file-access-from-files",
        QUIT_WORD,
      ],
      "C:\\Nimbalyst",
    );
    check(
      "patched main: the word quits through app.quit, skips only the dialog, cleanup runs, nothing opened",
      fake.quits === 2 &&
        fake.dialogs === 1 &&
        fake.cleanups === 2 &&
        fake.opened.length === 1,
      JSON.stringify(fake),
    );
    const log = fs.existsSync(path.join(D, "quit-hook.log"))
      ? fs.readFileSync(path.join(D, "quit-hook.log"), "utf8")
      : "";
    check(
      "patched main: the word writes a line to quit-hook.log",
      /^\S+ quit word received, quitting\n$/.test(log),
      log,
    );
    fakeProcess.env.NIMBALYST_DELIVER_DATA = path.join(
      T,
      "no-such-folder",
      "deeper",
    );
    handlers["second-instance"][0]({}, ["Nimbalyst.exe", QUIT_WORD], ".");
    check(
      "patched main: a log that can't be written does not stop the quit",
      fake.quits === 3 && fake.cleanups === 3,
      JSON.stringify(fake),
    );
  } finally {
    delete globalThis.__claudeSetupQuitWord;
  }

  // 13. the real ask-line patch: on a fixture main holding Nimbalyst's question block in a template literal,
  // then on a temp copy of the installed app.asar (when there is one): replaced once, a second run changes
  // nothing, a main without the block is skipped, --restore brings the original back
  const AL_FILE = path.join(path.dirname(PATCHER), "patches", "ask-line.mjs");
  const AL = (await import(pathToFileURL(AL_FILE).href)).default;
  const [alEdit] = AL.edits;
  const AL_MAIN = `const askUserQuestionTool = "ASK", promptForUserInputTool = "FORM";\nmodule.exports = \`## Interactive User Input\n\n${alEdit.anchor}\n\n## Visual Communication\`;\n`;
  const ALP = path.join(T, "patches-ask-line");
  fs.mkdirSync(ALP);
  fs.copyFileSync(AL_FILE, path.join(ALP, "ask-line.mjs"));
  const count = (s, part) => s.split(part).length - 1;
  const L = makeApp("ask-line", {
      files: { ...FILES, "out/main/index.js": AL_MAIN },
    }),
    lBefore = hashOf(L.asar);
  r = run(["--app", L.res, "--patches", ALP]);
  const lMain = readAsar(L.asar)["out/main/index.js"].data.toString();
  check(
    "ask-line on the fixture: applied, the block replaced once, the old sentence gone",
    r.code === 0 &&
      stateOf(r.out, "ask-line").startsWith("applied now") &&
      count(lMain, alEdit.replace) === 1 &&
      !lMain.includes("call an interactive tool instead"),
    r.out,
  );
  const lText = new Function(
    "module",
    lMain.replace(/^module\.exports = /m, "return "),
  )({});
  check(
    "ask-line on the fixture: the patched prompt still fills in both tool names",
    lText.includes("- ASK — a quick yes/no or pick-one") &&
      lText.includes("- FORM — only for a draft to edit") &&
      !lText.includes("${"),
    lText,
  );
  const lOnce = hashOf(L.asar);
  r = run(["--app", L.res, "--patches", ALP]);
  check(
    "ask-line on the fixture: a second run changes nothing",
    r.code === 0 && /already applied/.test(r.out) && hashOf(L.asar) === lOnce,
    r.out,
  );
  r = run(["--restore", "--app", L.res]);
  check(
    "ask-line on the fixture: --restore brings the original back",
    r.code === 0 && hashOf(L.asar) === lBefore && !fs.existsSync(L.marker),
    r.out,
  );
  const LM = makeApp("ask-line-missing"),
    lmBefore = hashOf(LM.asar);
  r = run(["--app", LM.res, "--patches", ALP]);
  check(
    "ask-line without the block: skipped with a clear reason, nothing written",
    r.code === 0 &&
      /^patch ask-line: SKIPPED, anchor changed: "Before writing a question/m.test(
        r.out,
      ) &&
      hashOf(LM.asar) === lmBefore &&
      !fs.existsSync(LM.orig),
    r.out,
  );
  // the installed app's unpatched original: app.asar.orig once the patcher has run
  const realRes =
    process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, "Programs", "Nimbalyst", "resources");
  const REAL =
    realRes &&
    (fs.existsSync(path.join(realRes, "app.asar.orig"))
      ? path.join(realRes, "app.asar.orig")
      : path.join(realRes, "app.asar"));
  if (REAL && fs.existsSync(REAL)) {
    const RC = makeApp("ask-line-real");
    fs.copyFileSync(REAL, RC.asar);
    const rcBefore = readAsar(RC.asar)["out/main/index.js"].data.toString();
    r = run(["--app", RC.res, "--patches", ALP]);
    const rcMain = readAsar(RC.asar)["out/main/index.js"].data.toString();
    check(
      "ask-line on a copy of the installed app.asar: the block replaced once, the old sentence gone, nothing else in main changed",
      r.code === 0 &&
        stateOf(r.out, "ask-line").startsWith("applied now") &&
        count(rcMain, alEdit.replace) === 1 &&
        !rcMain.includes("call an interactive tool instead") &&
        rcMain === rcBefore.replace(alEdit.anchor, () => alEdit.replace),
      r.out,
    );
    const rcOnce = hashOf(RC.asar);
    r = run(["--app", RC.res, "--patches", ALP]);
    check(
      "ask-line on a copy of the installed app.asar: a second run changes nothing",
      r.code === 0 &&
        /already applied/.test(r.out) &&
        hashOf(RC.asar) === rcOnce,
      r.out,
    );
    fs.rmSync(path.dirname(RC.install), { recursive: true, force: true });
  } else
    console.log(`skip ask-line on the installed app.asar: none at ${REAL}`);

  // 14. the real files-and-agents patch: on a fixture renderer chunk holding the menu list and the File viewer's
  // empty-state button, all three words change once and the mode ids stay; a chunk without the button is skipped
  const FA_FILE = path.join(
    path.dirname(PATCHER),
    "patches",
    "files-and-agents.mjs",
  );
  const FA = (await import(pathToFileURL(FA_FILE).href)).default;
  const FAP = path.join(T, "patches-files-and-agents");
  fs.mkdirSync(FAP);
  fs.copyFileSync(FA_FILE, path.join(FAP, "files-and-agents.mjs"));
  const [faMenu, faChat, faButton] = FA.edits;
  const FA_CHUNK = `const modes = [\n${faMenu.anchor}  { id: "review", label: "Review", icon: "rate_review" },\n${faChat.anchor}  { id: "file-viewer", label: "File viewer", icon: "tab" }\n];\nconst b = jsx("button", { onClick: () => setRightPanelMode({ workstreamId, ${faButton.anchor};\n`;
  const faFiles = (chunk) => ({
    ...FILES,
    "out/renderer/assets/index-AAAA1111.js": chunk,
  });
  const FG = makeApp("files-and-agents", { files: faFiles(FA_CHUNK) });
  r = run(["--app", FG.res, "--patches", FAP]);
  const fChunk = readAsar(FG.asar)[
    "out/renderer/assets/index-AAAA1111.js"
  ].data.toString();
  check(
    "files-and-agents on the fixture: three edits, each new word once, the old words gone, the mode ids kept",
    r.code === 0 &&
      FA.edits.length === 3 &&
      stateOf(r.out, "files-and-agents").startsWith("applied now") &&
      [
        'label: "Files & agents"',
        'label: "Chat with session"',
        'children: "Show files & agents"',
        'id: "edited-files"',
        'id: "session-chat"',
        'mode: "edited-files"',
      ].every((s) => count(fChunk, s) === 1) &&
      !/Edited Files|Chat with Session|Show edited files/.test(fChunk),
    r.out + fChunk,
  );
  const FM = makeApp("files-and-agents-missing", {
      files: faFiles(FA_CHUNK.replace("Show edited files", "Show changes")),
    }),
    fmBefore = hashOf(FM.asar);
  r = run(["--app", FM.res, "--patches", FAP]);
  check(
    "files-and-agents without the button: skipped with a clear reason, nothing written",
    r.code === 0 &&
      /^patch files-and-agents: SKIPPED, anchor changed: "mode: \\"edited-files\\" }\), children: \\"Show edited/m.test(
        r.out,
      ) &&
      hashOf(FM.asar) === fmBefore &&
      !fs.existsSync(FM.orig),
    r.out,
  );

  // 15. the real settled-repeat patch: on a fixture main holding its four anchors as in 0.83.0 (with a stand-in
  // for 1944, which it requires), then the patched main is run with made-up transcripts under a temp
  // CLAUDE_CONFIG_DIR. A result left out of the closed-process wake is D (dropped), one still named is K (kept).
  const SR_FILE = path.join(
    path.dirname(PATCHER),
    "patches",
    "settled-repeat.mjs",
  );
  const SR_MAIN = `const path$2 = require("path");
const fs$3 = require("fs");
function resolveClaudeConfigDir(env2 = process.env) {
  return env2.CLAUDE_CONFIG_DIR;
}
// fixture: patch 1944 stands here
const BACKGROUND_LAUNCH_ACK = /running in (the )?background|working in the background|async agent launched/i;
function extractToolResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block) => block && typeof block === "object" && typeof block.text === "string" ? block.text : "").join("\\n");
  }
  return "";
}
function isBackgroundLaunchAcknowledgement(resultContent) {
  return BACKGROUND_LAUNCH_ACK.test(extractToolResultText(resultContent));
}
function isReportable(n2) {
  return n2.status !== "stopped" || n2.killedByTeardown === true;
}
function shouldContinueWithTaskResults(cause, notifications) {
  return cause === "resolved" && notifications.some(isReportable);
}
function buildTaskResultContinuationMessage(notifications) {
  return "[System: background task(s) you launched have settled:\\n" + notifications.map((n2) => "- " + n2.description + " [" + n2.taskId + "]").join("\\n") + "]";
}
function hasRunningTasks(tasks) {
  for (const t2 of tasks) {
    if (t2.status === "running") return true;
  }
  return false;
}
function applySystemTaskChunk(params2) {
  const { subtype, chunk, tasks, notifications } = params2;
  if (subtype === "task_started") {
    tasks.set(chunk.task_id, { taskId: chunk.task_id, description: chunk.description || "", status: "running", startedAt: Date.now() - 5e3 });
    return true;
  }
  const existing = tasks.get(chunk.task_id);
  if (!existing) return false;
  if (subtype === "task_notification") {
    existing.status = chunk.status || "completed";
    const status = existing.status;
    const record2 = {
        taskId: chunk.task_id,
        description: existing.description,
        status,
        killedByTeardown: false,
        elapsedMs: Date.now() - existing.startedAt
      };
    notifications.push(record2);
    return true;
  }
  return false;
}
class Provider {
  constructor(claudeSessionId) {
    this.sessions = { getSessionId: (id) => (id === "nim-1" ? claudeSessionId : void 0) };
    this.emitted = [];
    this.activeTasks = new Map();
    this.drainTerminalNotifications = [];
    this.drainExitCause = "resolved";
  }
  emit(name, payload) {
    this.emitted.push([name, payload]);
  }
  finalizeBackgroundDrain(sessionId) {
    if (sessionId && shouldContinueWithTaskResults(this.drainExitCause, this.drainTerminalNotifications)) {
      const message = buildTaskResultContinuationMessage(this.drainTerminalNotifications);
      console.log(\`[CLAUDE-CODE] SUBAGENT_DRAIN: waking session \${sessionId} with \${this.drainTerminalNotifications.length} background task result(s)\`);
      this.teammateIdleMessagePending = true;
      this.emit("teammate:messageWhileIdle", { sessionId, message });
      return;
    }
    if (sessionId) {
      console.log(\`[CLAUDE-CODE] SUBAGENT_DRAIN: drain settled (cause=\${this.drainExitCause}); releasing deferred session end for \${sessionId}\`);
      this.emit("subagents:drainSettled", { sessionId });
    }
  }
}
return { isBackgroundLaunchAcknowledgement, applySystemTaskChunk, Provider };
`;
  const SRP = patchDir("settled-repeat", {
    1944: `files: ${R_MAIN}, upstream: null, edits: [{ anchor: "// fixture: patch 1944 stands here\\n", replace: "// fixture: patch 1944 applied\\n" }]`,
  });
  fs.copyFileSync(SR_FILE, path.join(SRP, "settled-repeat.mjs"));
  const SRA = makeApp("settled-repeat", {
    files: { ...FILES, "out/main/index.js": SR_MAIN },
  });
  r = run(["--app", SRA.res, "--patches", SRP]);
  check(
    "settled-repeat on the fixture: applied after 1944",
    r.code === 0 &&
      stateOf(r.out, "1944").startsWith("applied now") &&
      stateOf(r.out, "settled-repeat").startsWith("applied now"),
    r.out,
  );
  const srMain = readAsar(SRA.asar)["out/main/index.js"].data.toString();
  // runs a main; its console and CLAUDE_CONFIG_DIR are the test's
  const srBox = (main) => {
    const env = {},
      logs = [];
    const con = {
      log: (...a) => logs.push(a.map(String).join(" ")),
      warn: (...a) => logs.push(a.map(String).join(" ")),
    };
    const api = new Function("require", "process", "console", main)(
      (m) => ({ fs, path })[m],
      { env },
      con,
    );
    return { ...api, env, logs };
  };
  const SR = srBox(srMain);

  // E1: the launch test reads the first line only
  const usageScan = [
    "# Usage scan",
    "2026-11-12T02:23 to 2026-11-14T02:23 UTC.",
    "",
    "## Background tasks",
    'Agent = Agent/Task launched in the background (run_in_background: true, or without run_in_background: false and the result says "Async agent launched"). Bash = run_in_background: true.',
    "",
  ].join("\n");
  const notAck = {
    "the usage scan of chat 35fe9669": usageScan,
    "a helper hand-back quoting the panel": [
      {
        type: "text",
        text: '[Subagent hand-back] The text below is the final report of a helper you launched.\n\nThe panel now shows:\n- "Running in the background · 3m".\n',
      },
    ],
    "a Bash result quoting the panel":
      "FAIL css: the app's dots hidden only while our orb is there\n  expected: hidden\n  label: Running in the background·3m\n",
  };
  for (const [name, content] of Object.entries(notAck))
    check(
      `settled-repeat E1: ${name} is not a launch acknowledgement`,
      SR.isBackgroundLaunchAcknowledgement(content) === false,
    );
  const asyncAck =
    "Async agent launched successfully. (This tool result is internal metadata for you, not the user.)\nagentId: a45d4cfd28747670d\nThe agent is working in the background. You will be notified when it completes.";
  const isAck = {
    "a Bash launch":
      "Command running in background with ID: b1h63ua03. Output is being written to: C:\\Temp\\tasks\\b1h63ua03.output",
    "a helper launch": [{ type: "text", text: asyncAck }],
    "a helper launch after a blank line": "\n" + asyncAck,
  };
  for (const [name, content] of Object.entries(isAck))
    check(
      `settled-repeat E1: ${name} is still a launch acknowledgement`,
      SR.isBackgroundLaunchAcknowledgement(content) === true,
    );

  // E2: the record of a task end carries the start of its run
  {
    const tasks = new Map(),
      notifications = [];
    SR.applySystemTaskChunk({
      subtype: "task_started",
      chunk: { task_id: "b2start", description: "x" },
      tasks,
      notifications,
    });
    SR.applySystemTaskChunk({
      subtype: "task_notification",
      chunk: { task_id: "b2start", status: "completed" },
      tasks,
      notifications,
    });
    check(
      "settled-repeat E2: the task_notification record carries the task's startedAt",
      notifications.length === 1 &&
        typeof notifications[0].startedAt === "number" &&
        notifications[0].startedAt === tasks.get("b2start").startedAt,
      JSON.stringify(notifications),
    );
  }

  // E3 and E4: the proof, run through the closed-process wake
  const SID = "5e551011-0000-4000-8000-00000000c1a0",
    T0 = Date.parse("2026-11-12T10:00:00.000Z"),
    iso = (ms) => new Date(ms).toISOString();
  const noticeText = (id) =>
    `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>Agent "work" finished</summary>\n<result>done</result>\n</task-notification>`;
  const TL = {
    queued: (id, at) => ({
      type: "attachment",
      timestamp: iso(at),
      attachment: { type: "queued_command", prompt: noticeText(id) },
    }),
    own: (id, at) => ({
      type: "user",
      timestamp: iso(at),
      message: { role: "user", content: noticeText(id) },
    }),
    quoted: (id, at) => ({
      type: "user",
      timestamp: iso(at),
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_grep",
            content: noticeText(id),
          },
        ],
      },
    }),
    reply: (text, at) => ({
      type: "assistant",
      timestamp: iso(at),
      message: {
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text }],
      },
    }),
    toolUse: (at) => ({
      type: "assistant",
      timestamp: iso(at),
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "toolu_x", name: "Bash", input: {} }],
      },
    }),
    compact: (at) => ({
      type: "system",
      subtype: "compact_boundary",
      timestamp: iso(at),
      content: "Conversation compacted",
    }),
  };
  const jsonl = (entries) =>
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  // ~1 KB lines that hold none of the words the proof looks for
  const FILL_LINE =
    JSON.stringify({ type: "progress", data: "x".repeat(1000) }) + "\n";
  const filler = (mb) =>
    FILL_LINE.repeat(Math.ceil((mb * 1024 * 1024) / FILL_LINE.length));
  let srCase = 0;
  // writes a session (lead lines, helper files) under a fresh config folder; returns the lead path
  const session = (lead, helpers = {}) => {
    const cfg = path.join(T, `claude-config-${++srCase}`),
      dir = path.join(cfg, "projects", "C--work-demo");
    fs.mkdirSync(path.join(cfg, "projects", "C--other"), { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
    const leadFile = path.join(dir, `${SID}.jsonl`);
    if (lead !== null)
      fs.writeFileSync(leadFile, typeof lead === "string" ? lead : jsonl(lead));
    const sub = path.join(dir, SID, "subagents");
    for (const [name, lines] of Object.entries(helpers)) {
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(
        path.join(sub, `${name}.jsonl`),
        typeof lines === "string" ? lines : jsonl(lines),
      );
    }
    return { cfg, leadFile, sub };
  };
  const record = (id, startedAt = T0, extra = {}) => ({
    taskId: id,
    description: `task ${id}`,
    status: "completed",
    killedByTeardown: false,
    elapsedMs: 1000,
    startedAt,
    ...extra,
  });
  // one closed-process wake: which records the message names, whether the drain settled, the log
  const drain = (box, cfg, records, tasks = new Map()) => {
    box.env.CLAUDE_CONFIG_DIR = cfg;
    box.logs.length = 0;
    const p = new box.Provider(SID);
    p.drainTerminalNotifications = records;
    p.activeTasks = tasks;
    p.finalizeBackgroundDrain("nim-1");
    const wake = p.emitted.find(([n]) => n === "teammate:messageWhileIdle");
    const message = wake?.[1].message ?? null;
    return {
      message,
      named: (id) => message !== null && message.includes(`[${id}]`),
      settled: p.emitted.some(([n]) => n === "subagents:drainSettled"),
      log: box.logs.join("\n"),
    };
  };
  const NO_HELPER = srBox(
    srMain.replace(
      "const HELPER_READ_COUNTS = true;",
      "const HELPER_READ_COUNTS = false;",
    ),
  );
  const NO_TRIM = srBox(
    srMain.replace(
      "const TRIM_PROVEN_RESULTS = true;",
      "const TRIM_PROVEN_RESULTS = false;",
    ),
  );
  const reply = (at) => TL.reply("Merged both; the tests pass.", at);
  let s, d;

  s = session([
    TL.toolUse(T0 + 10e3),
    TL.queued("a1", T0 + 60e3),
    TL.toolUse(T0 + 70e3),
    reply(T0 + 90e3),
  ]);
  d = drain(SR, s.cfg, [record("a1")]);
  check(
    "settled-repeat 1: a mid-turn notice in the lead, then a real reply: D, no wake, the drain settles, one log line",
    !d.named("a1") &&
      d.message === null &&
      d.settled &&
      /1 of 1 background task result\(s\) already reached Claude in its transcript; not sent again: \[a1\]/.test(
        d.log,
      ),
    JSON.stringify(d),
  );
  for (const text of ["No response requested.", "No response requested", ""]) {
    s = session([TL.queued("a2", T0 + 60e3), TL.reply(text, T0 + 90e3)]);
    d = drain(SR, s.cfg, [record("a2")]);
    check(
      `settled-repeat 2: the only reply is ${JSON.stringify(text)}: K`,
      d.named("a2") && !d.settled,
      JSON.stringify(d),
    );
  }
  // Claude Code writes each block of a reply as its own entry, all with stop_reason end_turn (chat f2e7b76a)
  const thinking = (at) => ({
    type: "assistant",
    timestamp: iso(at),
    message: {
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "" }],
    },
  });
  s = session([
    TL.queued("a2b", T0 + 60e3),
    thinking(T0 + 80e3),
    reply(T0 + 90e3),
  ]);
  d = drain(SR, s.cfg, [record("a2b")]);
  check(
    "settled-repeat 2: a thinking-only entry, then the reply's text entry: D",
    !d.named("a2b") && d.settled,
    JSON.stringify(d),
  );
  s = session([
    TL.queued("a2c", T0 + 60e3),
    thinking(T0 + 80e3),
    TL.reply("No response requested.", T0 + 90e3),
    reply(T0 + 900e3),
  ]);
  d = drain(SR, s.cfg, [record("a2c")]);
  check(
    "settled-repeat 2: a thinking-only entry, then the stand-in reply: K",
    d.named("a2c"),
    JSON.stringify(d),
  );
  s = session([
    TL.queued("a3", T0 + 60e3),
    TL.toolUse(T0 + 70e3),
    TL.toolUse(T0 + 80e3),
  ]);
  d = drain(SR, s.cfg, [record("a3")]);
  check(
    "settled-repeat 3: the turn was cut after the notice: K",
    d.named("a3"),
    JSON.stringify(d),
  );
  s = session([TL.toolUse(T0 + 10e3)], {
    "agent-x": [TL.queued("a4", T0 + 60e3), reply(T0 + 90e3)],
  });
  d = drain(SR, s.cfg, [record("a4")]);
  check(
    "settled-repeat 4: the notice read and answered by a helper: D (helper reads count)",
    !d.named("a4") && d.settled,
    JSON.stringify(d),
  );
  d = drain(NO_HELPER, s.cfg, [record("a4")]);
  check(
    "settled-repeat 4: the same with HELPER_READ_COUNTS false: K",
    d.named("a4"),
    JSON.stringify(d),
  );
  s = session([TL.own("a5", T0 + 60e3), reply(T0 + 90e3)]);
  d = drain(SR, s.cfg, [record("a5")]);
  check(
    "settled-repeat 5: the notice as its own user turn, then a real reply: D",
    !d.named("a5") && d.settled,
    JSON.stringify(d),
  );
  s = session([TL.queued("a6", T0 - 60e3), reply(T0 - 30e3)]);
  d = drain(SR, s.cfg, [record("a6")]);
  check(
    "settled-repeat 6: the only notice is from an earlier run: K",
    d.named("a6"),
    JSON.stringify(d),
  );
  s = session([TL.queued("a7", T0 + 60e3), reply(T0 + 90e3)]);
  d = drain(SR, s.cfg, [record("a7", T0), record("a7", T0 + 600e3)]);
  check(
    "settled-repeat 7: two runs of one id, one notice in the first run's window: the first D, the second K",
    d.named("a7") &&
      /waking session nim-1 with 1 background task result\(s\)/.test(d.log),
    JSON.stringify(d),
  );
  s = session([TL.queued("a7b", T0 + 700e3), reply(T0 + 720e3)]);
  d = drain(
    SR,
    s.cfg,
    [record("a7b", T0)],
    new Map([
      ["a7b", { taskId: "a7b", status: "running", startedAt: T0 + 600e3 }],
    ]),
  );
  check(
    "settled-repeat 7: a notice from the next run, still in the task map, does not prove the first run: K",
    d.named("a7b"),
    JSON.stringify(d),
  );
  s = session([TL.quoted("a8", T0 + 60e3), reply(T0 + 90e3)]);
  d = drain(SR, s.cfg, [record("a8")]);
  check(
    "settled-repeat 8: the id only inside a tool result (a grep quoting the notice): K",
    d.named("a8"),
    JSON.stringify(d),
  );
  s = session([TL.queued("a9", T0 + 60e3), reply(T0 + 90e3)]);
  d = drain(SR, s.cfg, [
    record("a9", T0, { status: "stopped", killedByTeardown: true }),
  ]);
  check(
    "settled-repeat 9: a task killed by teardown: K",
    d.named("a9"),
    JSON.stringify(d),
  );
  s = session(null);
  d = drain(SR, s.cfg, [record("a10"), record("a10b")]);
  check(
    "settled-repeat 10: no transcript: all K, with the log line",
    d.named("a10") &&
      d.named("a10b") &&
      /no transcript .*\.jsonl found; sending every result/.test(d.log),
    JSON.stringify(d),
  );
  s = session([
    TL.toolUse(T0 + 3000e3),
    TL.toolUse(T0 + 3100e3),
    TL.queued("a11", T0 + 60e3),
    reply(T0 + 3200e3),
  ]);
  d = drain(SR, s.cfg, [record("a11")]);
  check(
    "settled-repeat 11: the notice stamped earlier than the lines before it, then a reply: D",
    !d.named("a11") && d.settled,
    JSON.stringify(d),
  );
  s = session([
    TL.queued("a12", T0 + 60e3),
    TL.compact(T0 + 70e3),
    reply(T0 + 90e3),
  ]);
  d = drain(SR, s.cfg, [record("a12")]);
  check(
    "settled-repeat 12: a compaction between the notice and the reply: K",
    d.named("a12"),
    JSON.stringify(d),
  );
  s = session([TL.queued("a13", T0 + 60e3), reply(T0 + 90e3)]);
  d = drain(SR, s.cfg, [record("a13")], {
    get() {
      throw new Error("broken task map");
    },
  });
  check(
    "settled-repeat 13: an error while checking (the task map throws): K, with the warn line",
    d.named("a13") &&
      /could not check which results Claude already has; sending every result: Error: broken task map/.test(
        d.log,
      ),
    JSON.stringify(d),
  );
  s = session(null);
  fs.mkdirSync(s.leadFile);
  d = drain(SR, s.cfg, [record("a13b")]);
  // on Windows a folder opens and reads as 0 bytes, so nothing throws there: the result is kept either way
  check(
    "settled-repeat 13: the transcript path is a folder: K",
    d.named("a13b") && !/not sent again/.test(d.log),
    JSON.stringify(d),
  );
  s = session(
    jsonl([TL.queued("a14", T0 + 60e3)]) +
      filler(16.5) +
      jsonl([reply(T0 + 90e3)]),
  );
  d = drain(SR, s.cfg, [record("a14")]);
  check(
    "settled-repeat 14: the notice more than 16 MB before the end of the file: K",
    d.named("a14"),
    JSON.stringify(d).slice(0, 400),
  );
  s = session([TL.toolUse(T0 + 10e3)], {
    "agent-old": [TL.queued("a14b", T0 + 60e3), reply(T0 + 90e3)],
  });
  fs.utimesSync(
    path.join(s.sub, "agent-old.jsonl"),
    (T0 - 3600e3) / 1e3,
    (T0 - 3600e3) / 1e3,
  );
  d = drain(SR, s.cfg, [record("a14b")]);
  check(
    "settled-repeat 14: a helper file last changed before the run started is not read: K",
    d.named("a14b"),
    JSON.stringify(d),
  );
  const big = filler(16.5);
  s = session(big, {
    "agent-a": big,
    "agent-b": big,
    "agent-c": big,
    "agent-z": [TL.queued("a14c", T0 + 60e3), reply(T0 + 90e3)],
  });
  d = drain(SR, s.cfg, [record("a14c")]);
  check(
    "settled-repeat 14: files past the 64 MB total are not read, with the log line: K",
    d.named("a14c") &&
      /transcript read limit \(64 MB\) reached before .*agent-z\.jsonl; results not yet proven are sent/.test(
        d.log,
      ),
    d.log,
  );
  fs.rmSync(s.cfg, { recursive: true, force: true });
  s = session([TL.queued("a15", T0 + 60e3), reply(T0 + 90e3)]);
  d = drain(SR, s.cfg, [record("a15"), record("a15b")]);
  check(
    "settled-repeat 15 (E4): one of two proven: the wake names only the other one",
    !d.named("a15") &&
      d.named("a15b") &&
      /waking session nim-1 with 1 background task result\(s\)/.test(d.log),
    JSON.stringify(d),
  );
  d = drain(NO_TRIM, s.cfg, [record("a15"), record("a15b")]);
  check(
    "settled-repeat 15: one of two proven with TRIM_PROVEN_RESULTS false: both sent",
    d.named("a15") && d.named("a15b"),
    JSON.stringify(d),
  );

  // 16. the real files-chat-follows patch: on a fixture renderer chunk holding a stand-in EditorMode and the
  // ChatSidebar lines, both edits go in once and, run with a stand-in React (an effect runs when its deps change),
  // the chat loads the open session when Files mode is shown and when the session changes (also after a start that
  // restores Files mode), never an id left from the project shown before; a second run adds no second copy; a chunk
  // without the anchor is skipped with a clear reason; on a copy of the installed app.asar both anchors are found once
  const FC_FILE = path.join(
    path.dirname(PATCHER),
    "patches",
    "files-chat-follows.mjs",
  );
  check(
    "files-chat-follows: the patch file exists",
    fs.existsSync(FC_FILE),
    FC_FILE,
  );
  if (fs.existsSync(FC_FILE)) {
    const FC = (await import(pathToFileURL(FC_FILE).href)).default;
    const [fcEdit, fcPickEdit] = FC.edits;
    const FCP = path.join(T, "patches-files-chat-follows");
    fs.mkdirSync(FCP);
    fs.copyFileSync(FC_FILE, path.join(FCP, "files-chat-follows.mjs"));
    const FC_ANCHOR =
      "  const handleWelcomeFocusAgent = reactExports.useCallback(";
    const FC_PICK =
      "    initializedWorkspaceRef.current = workspacePath2;\n    const initSession = async () => {";
    const FC_CHUNK = `const activeSessionIdAtom = {};
export const store = { open: null, get(atom) { return atom === activeSessionIdAtom ? this.open : undefined; } };
export const reactExports = { effects: [], refs: [], at: 0, useEffect(f, deps) { this.effects.push({ f, deps }); },
  useCallback: (f) => f, useRef(v) { const i = this.at++; if (!(i in this.refs)) this.refs[i] = { current: v }; return this.refs[i]; } };
const useAtomValue = (atom) => store.get(atom);
export function EditorMode2({ workspacePath: workspacePath2, isActive }, chatSidebarRef) {
${FC_ANCHOR}() => chatSidebarRef.current?.focusInput(), []);
  return handleWelcomeFocusAgent;
}
export function ChatSidebarStart(workspacePath2, initializedWorkspaceRef, explicitSelectionRef) {
${FC_PICK}
    };
    return initSession;
}
`;
    const fcFiles = (chunk) => ({
      ...FILES,
      "out/renderer/assets/index-AAAA1111.js": chunk,
    });
    const FCA = makeApp("files-chat-follows", { files: fcFiles(FC_CHUNK) });
    r = run(["--app", FCA.res, "--patches", FCP]);
    const fcChunk = readAsar(FCA.asar)[
      "out/renderer/assets/index-AAAA1111.js"
    ].data.toString();
    check(
      "files-chat-follows on the fixture: two edits, the EditorMode line and ChatSidebar's first pick, each goes in once",
      r.code === 0 &&
        FC.edits.length === 2 &&
        fcEdit.anchor === FC_ANCHOR &&
        fcPickEdit.anchor === FC_PICK &&
        stateOf(r.out, "files-chat-follows").startsWith("applied now") &&
        count(fcChunk, fcEdit.replace) === 1 &&
        count(fcChunk, fcPickEdit.replace) === 1 &&
        count(fcChunk, FC_ANCHOR) === 1 &&
        fcChunk ===
          FC_CHUNK.replace(FC_ANCHOR, () => fcEdit.replace).replace(
            FC_PICK,
            () => fcPickEdit.replace,
          ) &&
        fcChunk.indexOf("useAtomValue(activeSessionIdAtom)") <
          fcChunk.indexOf(FC_ANCHOR),
      r.out + fcChunk,
    );
    // run the patched stand-in as React would: one mounted EditorMode keeps its refs; each draw runs an effect only
    // when its deps changed since the last draw
    const fcMod = path.join(T, "files-chat-follows-chunk.mjs");
    fs.writeFileSync(fcMod, fcChunk);
    const fm = await import(pathToFileURL(fcMod).href);
    let lastDeps = [];
    const draw = (isActive, open, workspacePath) => {
      const loaded = [];
      fm.store.open = open;
      fm.reactExports.effects = [];
      fm.reactExports.at = 0;
      fm.EditorMode2(
        { isActive, workspacePath },
        { current: { loadSession: (id) => loaded.push(id) } },
      );
      const effects = fm.reactExports.effects;
      effects.forEach((e, i) => {
        if (JSON.stringify(e.deps) !== lastDeps[i]) e.f();
      });
      lastDeps = effects.map((e) => JSON.stringify(e.deps));
      return loaded.join() || "-";
    };
    const steps = [
      // a start that restores Files mode: the Sessions view sets the atom one draw later
      ["start in Files mode, atom not set yet", draw(true, null, "A"), "-"],
      ["the Sessions view sets A1", draw(true, "A1", "A"), "A1"],
      ["the same draw again", draw(true, "A1", "A"), "-"],
      ["Files mode left", draw(false, "A1", "A"), "-"],
      ["Files mode shown again", draw(true, "A1", "A"), "A1"],
      // a rail switch while in Files mode: one draw still holds A's session
      ["rail switch to B, atom still A1", draw(true, "A1", "B"), "-"],
      ["the Sessions view sets B1", draw(true, "B1", "B"), "B1"],
      // a rail switch while Files mode is hidden, then Files mode shown
      ["in Sessions, switch to A, atom still B1", draw(false, "B1", "A"), "-"],
      ["the Sessions view sets A2", draw(false, "A2", "A"), "-"],
      ["Files mode shown", draw(true, "A2", "A"), "A2"],
      // a project with no open session
      ["rail switch to C, atom still A2", draw(true, "A2", "C"), "-"],
      ["C has no open session", draw(true, null, "C"), "-"],
    ];
    const wrong = steps.filter(([, got, want]) => got !== want);
    check(
      "files-chat-follows run: loads the open session at a restored start, on each showing and when it changes; never an id left from the project before; nothing with none open or Files hidden",
      wrong.length === 0,
      JSON.stringify(wrong),
    );
    // the second edit: a new project clears the mark a loadSession left, before the panel's own pick
    const explicit = { current: true };
    fm.ChatSidebarStart("B", { current: "A" }, explicit);
    check(
      "files-chat-follows run: ChatSidebar's first pick in a new project starts with the user's-pick mark cleared",
      explicit.current === false,
      JSON.stringify(explicit),
    );
    const fcOnce = hashOf(FCA.asar);
    r = run(["--app", FCA.res, "--patches", FCP]);
    check(
      "files-chat-follows on the fixture: a second run adds no second copy",
      r.code === 0 &&
        /already applied/.test(r.out) &&
        stateOf(r.out, "files-chat-follows") === "applied" &&
        hashOf(FCA.asar) === fcOnce,
      r.out,
    );
    const FCM = makeApp("files-chat-follows-missing", {
        files: fcFiles(
          FC_CHUNK.replace("handleWelcomeFocusAgent", "handleWelcomeFocus"),
        ),
      }),
      fcmBefore = hashOf(FCM.asar);
    r = run(["--app", FCM.res, "--patches", FCP]);
    check(
      "files-chat-follows without the anchor: skipped with a clear reason naming the anchor, nothing written",
      r.code === 0 &&
        /^patch files-chat-follows: SKIPPED, anchor changed: " {2}const handleWelcomeFocusAgent = reactExports\.use\.\.\." found 0x in \d+ matching/m.test(
          r.out,
        ) &&
        hashOf(FCM.asar) === fcmBefore &&
        !fs.existsSync(FCM.orig),
      r.out,
    );
    if (REAL && fs.existsSync(REAL)) {
      const FR = makeApp("files-chat-follows-real");
      fs.copyFileSync(REAL, FR.asar);
      const frBefore = readAsar(FR.asar);
      const [frPath] = Object.keys(frBefore).filter(
        (p) => FC.files.test(p) && frBefore[p].data.includes(fcEdit.anchor),
      );
      r = run(["--app", FR.res, "--patches", FCP]);
      const frOld = frPath ? frBefore[frPath].data.toString() : "",
        frNew = frPath ? readAsar(FR.asar)[frPath].data.toString() : "";
      check(
        "files-chat-follows on a copy of the installed app.asar: both anchors once, in EditorMode's chunk with useAtomValue and activeSessionIdAtom; both edits go in once, nothing else changes",
        r.code === 0 &&
          stateOf(r.out, "files-chat-follows").startsWith("applied now") &&
          count(frOld, fcEdit.anchor) === 1 &&
          frOld.includes("const EditorMode = reactExports.forwardRef(") &&
          count(frOld, fcPickEdit.anchor) === 1 &&
          / as useAtomValue\b/.test(frOld) &&
          / as activeSessionIdAtom\b/.test(frOld) &&
          count(frNew, fcEdit.replace) === 1 &&
          count(frNew, fcPickEdit.replace) === 1 &&
          frNew ===
            frOld
              .replace(fcEdit.anchor, () => fcEdit.replace)
              .replace(fcPickEdit.anchor, () => fcPickEdit.replace),
        r.out + (frPath ?? "no chunk holds the anchor"),
      );
      fs.rmSync(path.dirname(FR.install), { recursive: true, force: true });
    } else
      console.log(
        `skip files-chat-follows on the installed app.asar: none at ${REAL}`,
      );
  }

  // the real patches on a copy of the installed app's unpatched original: settled-repeat and all the others apply
  if (REAL && fs.existsSync(REAL)) {
    const SC = makeApp("settled-repeat-real");
    fs.copyFileSync(REAL, SC.asar);
    r = run(["--dry-run", "--app", SC.res]);
    check(
      "settled-repeat on a copy of the installed app.asar: every real patch would apply, the changed code compiles",
      r.code === 0 &&
        stateOf(r.out, "settled-repeat").startsWith("would apply") &&
        real.every((p) => stateOf(r.out, p.id).startsWith("would apply")) &&
        /would change and compile/.test(r.out),
      r.out,
    );
    fs.rmSync(path.dirname(SC.install), { recursive: true, force: true });
  } else
    console.log(
      `skip settled-repeat on the installed app.asar: none at ${REAL}`,
    );
} finally {
  cleanup();
}
summary();
