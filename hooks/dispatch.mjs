#!/usr/bin/env node
// dispatch (PreToolUse, UserPromptSubmit, Stop): runs one group of hooks in one Node process, so a tool call starts
// one Node instead of one per hook (plan 2.8: "one dispatcher per matcher").
//   node ~/.claude/hooks/dispatch.mjs <group>      the groups: hooks/dispatch-groups.json, or DISPATCH_GROUPS=<file>
// DISPATCH=off (any case) ends it at once, silent: no hook of any group runs, the guards included.
// A group lists { hook: "<path under ~/.claude>", args: [...], guard: true|false, tools: "<regex>" }, run in order.
// A hook with `tools` runs only when the event's tool_name matches it whole (as an entry's matcher did). A file is
// listed once per group: Node runs a module once per process, so a second entry of it would do nothing.
// The event is read once from stdin. Each hook then runs as if it were the script being run: process.argv is its
// own, fs.readFileSync(0) and process.stdin give the event, what it writes on stdout (fs.writeSync(1) or
// process.stdout.write) is kept, process.exit ends only that hook (hook-io.mjs HookExit), and the exit code it gives
// through runHook or process.exit is its own (process.exitCode, one for the whole process, is not read).
// An updatedInput goes on to the next hooks' event, so download-guard's rewrite reaches command-explain. The guards
// must check the input that runs, so the hooks that rewrite are listed before them; a rewrite from a hook after a
// guard makes the guards that already ran check the new input again (runGroup).
// The answers become one JSON object on stdout: deny over ask over allow, any block blocks, the texts joined, and
// a guard's refusal names the guard. Exit 2 from a hook is a refusal with its stderr as the reason.
// A guard that throws, exits non-zero, cannot load or runs out of time stops the call with its name in the reason;
// a non-guard that does so is crash-logged and the hooks after it still run. Time: each hook gets HOOK_MS of async
// work, the whole group GROUP_MS from the process start, well under the pre-tool and stop entries' 60 s; a hook
// the group has no time left for does not run (a guard among them stops the call). Synchronous work cannot be cut
// off in-process: the entry's own timeout with onFailure "block" bounds it.
// Work a hook leaves running after it ended (a timer, a late callback) is kept out of the answer and its exit code;
// a crash in it is logged for that hook. After the answer it gets END_MS to finish before the process is ended.
// The dispatcher itself failing (its libraries or the groups file can't load, a group entry is malformed, the
// answer can't be written) keeps the refusal it has; without one it refuses only a call a guard of the group
// covers, and lets any other through with a crash-log line. A groups file that can't be read names no guard, so
// then the shell tools (SHELL) count as covered: every guard the setup ships checks shell commands.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

if ((process.env.DISPATCH || "").toLowerCase() === "off") process.exit(0);

const HOOK_MS = 20000;
const GROUP_MS = 45000;
const END_MS = 1000; // after the answer: time for the work hooks left to finish before the process is ended
const SHELL = /^(?:Bash|PowerShell)$/;
const CLAUDE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const real = {
  readFileSync: fs.readFileSync,
  writeSync: fs.writeSync,
  exit: process.exit.bind(process),
  stderr: process.stderr.write.bind(process.stderr),
};
const say = (s) => {
  try {
    real.stderr(s);
  } catch {
    // stderr is gone too: nothing more to tell
  }
};
// Until crash-log.mjs is loaded (it may be what fails to load), a crash is said on stderr
let crashLog = (name, err) => say(`[${name}] ${err?.message ?? err}\n`);

const group = process.argv[2];
const groupsFile =
  process.env.DISPATCH_GROUPS ||
  path.join(CLAUDE, "hooks", "dispatch-groups.json");

let text = "";
try {
  text = real.readFileSync(0, "utf8");
} catch {
  // no stdin: each hook handles the empty input its own way (a guard fails closed)
}
let event = null;
try {
  event = JSON.parse(text);
} catch {
  // each hook reads the text as it is and handles bad input its own way (a guard fails closed)
}
const eventName = String(event?.hook_event_name ?? "");

// Does this entry run for the event? Its tools match the tool whole; no tools, or an event that can't be read,
// runs it. A tools that is no regex counts as matching (the group is refused before it runs; see ready()).
function applies(entry) {
  if (!entry?.tools || !event) return true;
  const tool = event.tool_name;
  if (typeof tool !== "string") return false;
  try {
    return new RegExp(`^(?:${entry.tools})$`).test(tool);
  } catch {
    return true;
  }
}
// Does a guard of the group cover this call? With no group read: the shell tools (an unreadable event counts)
const covered = (list) =>
  Array.isArray(list)
    ? list.some((e) => e?.guard && applies(e))
    : !event || SHELL.test(String(event.tool_name ?? ""));

// The group, checked before any hook runs: a malformed entry is the dispatcher's failure, not a hook's
let list = null;
function ready() {
  let groups;
  try {
    groups = JSON.parse(real.readFileSync(groupsFile, "utf8"));
  } catch (err) {
    throw new Error(`${groupsFile} can't be read as JSON (${err.message})`);
  }
  const found = groups?.[group];
  if (!Array.isArray(found))
    throw new Error(`no group "${group}" in ${groupsFile}`);
  list = found;
  const files = new Set();
  list.forEach((e, i) => {
    const at = `entry ${i + 1} of group "${group}" in ${groupsFile}`;
    if (typeof e?.hook !== "string" || !e.hook)
      throw new Error(`${at} names no hook`);
    if (e.args !== undefined && !Array.isArray(e.args))
      throw new Error(`${at} (${e.hook}): args is not a list`);
    if (e.tools !== undefined)
      try {
        new RegExp(`^(?:${e.tools})$`);
      } catch (err) {
        throw new Error(
          `${at} (${e.hook}): tools is no regex (${err.message})`,
        );
      }
    const file = path.resolve(CLAUDE, e.hook).toLowerCase();
    if (files.has(file))
      throw new Error(
        `${e.hook} is listed twice in group "${group}" in ${groupsFile}: Node runs a file once per process`,
      );
    files.add(file);
  });
}

// The hook a write, an exit, an exit code or a crash belongs to: the async context it came from, else the one
// running. Between hooks and after a hook ended, they go to a record nobody reads.
const owner = new AsyncLocalStorage();
const idle = () => ({ name: "dispatch", out: "", err: "", done: true });
let current = idle();
const who = () => owner.getStore() ?? current;
let io = null; // hooks/lib/hook-io.mjs, once loaded

// The libraries, loaded here so a copy that fails to load (an older hook-io.mjs without these exports) is the
// dispatcher's failure, handled below, and not a crash before any of this runs
async function loadLog() {
  const log = await import("./lib/crash-log.mjs");
  crashLog = log.crashLog;
  // crash-log.mjs installed its handlers for "dispatch" when imported from the hooks folder: here a crash belongs
  // to the hook that is running, and must not end the process
  process.removeAllListeners("uncaughtException");
  process.removeAllListeners("unhandledRejection");
}
async function load() {
  const lib = await import("./lib/hook-io.mjs");
  const missing = ["dispatch", "HookExit", "offName"].filter((k) => !lib[k]);
  if (missing.length)
    throw new Error(
      `hooks/lib/hook-io.mjs has no ${missing.join(", ")}: it is older than dispatch.mjs`,
    );
  io = lib;
}

function takeOver() {
  const record = (fd, s) => {
    const h = who();
    if (fd === 1) h.out += s;
    else {
      h.err += s;
      if (!h.done) say(s);
    }
  };
  const asText = (data, offset, length) => {
    if (typeof data === "string") return data;
    const b = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const from = typeof offset === "number" ? offset : 0;
    const to = typeof length === "number" ? from + length : b.length;
    return b.subarray(from, to).toString("utf8");
  };
  fs.writeSync = (fd, data, ...rest) => {
    if (fd !== 1 && fd !== 2) return real.writeSync(fd, data, ...rest);
    const s = asText(data, ...rest);
    record(fd, s);
    return Buffer.byteLength(s);
  };
  fs.readFileSync = (p, options) => {
    if (p !== 0 && p !== "/dev/stdin") return real.readFileSync(p, options);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? text : Buffer.from(text);
  };
  syncBuiltinESMExports();
  for (const [fd, stream] of [
    [1, process.stdout],
    [2, process.stderr],
  ]) {
    stream.write = (chunk, encoding, cb) => {
      record(fd, typeof chunk === "string" ? chunk : asText(chunk));
      const done = typeof encoding === "function" ? encoding : cb;
      if (done) process.nextTick(done);
      return true;
    };
  }
  // A fresh stdin for each hook, holding the event as that hook gets it
  Object.defineProperty(process, "stdin", {
    configurable: true,
    enumerable: true,
    get() {
      const h = who();
      if (!h.stdin) {
        const buf = Buffer.from(h.text ?? "");
        h.stdin = new Readable({
          read() {
            this.push(buf);
            this.push(null);
          },
        });
      }
      return h.stdin;
    },
  });
  process.exit = (code) => {
    const e = new io.HookExit(code);
    e.owner = who();
    throw e;
  };
  const crashed = (err) => {
    const h = err instanceof io.HookExit && err.owner ? err.owner : current;
    if (h.settle && !h.done) return h.settle(err);
    if (!(err instanceof io.HookExit)) crashLog(h.name, err);
  };
  process.on("uncaughtException", crashed);
  process.on("unhandledRejection", crashed);
  // runHook's exit code, kept for the hook the work belongs to; from a hook that already ended it is dropped
  io.dispatch.code = (code) => {
    const h = who();
    if (!h.done) h.code = code;
  };
  io.dispatch.on = true;
}

// Runs one hook for at most `ms`; { code, failed (a message, when it threw, could not load or ran out of time),
// out, err }. A run `again` > 0 loads a fresh copy of the file (Node runs a module URL once per process).
async function runOne(entry, name, ms, again = 0) {
  const file = path.resolve(CLAUDE, entry.hook);
  process.argv = [process.argv[0], file, ...(entry.args ?? [])];
  io.dispatch.begin();
  const h = { name, out: "", err: "", text, done: false };
  current = h;
  let timer;
  const end = await new Promise((settle) => {
    h.settle = (err) => settle({ err });
    timer = setTimeout(
      () =>
        settle({
          err: new Error(`ran out of time (${Math.round(ms / 1000)} s)`),
        }),
      ms,
    );
    owner
      .run(h, async () => {
        await import(
          `${pathToFileURL(file).href}${again ? `?again=${again}` : ""}`
        );
        await Promise.all(io.dispatch.runs);
      })
      .then(
        () => settle({}),
        (err) => settle({ err }),
      );
  });
  clearTimeout(timer);
  h.done = true;
  current = idle();
  const exit = end.err instanceof io.HookExit;
  const code = (exit ? end.err.code : undefined) ?? h.code ?? 0;
  if (end.err && !exit) crashLog(name, end.err);
  return {
    code,
    failed: end.err && !exit ? String(end.err.message ?? end.err) : null,
    out: h.out,
    err: h.err,
  };
}

// ---- the answers, merged into one
const RANK = { allow: 1, ask: 2, deny: 3 };
let decision = null;
let decisionReasons = [];
const blocks = [],
  contexts = [],
  messages = [],
  stopReasons = [];
const extra = {};
let updatedInput;
let stop = false,
  suppress = false;

const decide = (d, reason) => {
  if (!RANK[d]) return;
  if (!decision || RANK[d] > RANK[decision]) {
    decision = d;
    decisionReasons = [];
  }
  if (d === decision && reason) decisionReasons.push(reason);
};
// A refusal of the dispatcher's own (a failed guard, an exit 2): deny a tool call, block anything else
const refuse = (reason) =>
  eventName === "PreToolUse" ? decide("deny", reason) : blocks.push(reason);
const refused = () =>
  decision === "deny" || decision === "ask" || blocks.length > 0 || stop;

function take(o, named) {
  const hs = o.hookSpecificOutput;
  if (hs && typeof hs === "object") {
    const {
      hookEventName,
      permissionDecision,
      permissionDecisionReason,
      updatedInput: input,
      additionalContext,
      ...rest
    } = hs;
    if (permissionDecision)
      decide(permissionDecision, named(permissionDecisionReason ?? ""));
    if (input && typeof input === "object") {
      updatedInput = input;
      if (event) {
        event = { ...event, tool_input: input };
        text = JSON.stringify(event);
      }
    }
    if (additionalContext) contexts.push(String(additionalContext));
    Object.assign(extra, rest);
  }
  if (o.decision === "block") blocks.push(named(o.reason ?? ""));
  if (o.continue === false) {
    stop = true;
    if (o.stopReason) stopReasons.push(String(o.stopReason));
  }
  if (o.systemMessage) messages.push(String(o.systemMessage));
  if (o.suppressOutput) suppress = true;
}

// The guards check the input that runs: a hook that rewrites the input after guards checked it makes them run
// again on the new input (a fresh copy of each guard's file, as Node runs a file once). A rewrite during that
// second run is refused, so it cannot go on for ever.
async function runGroup() {
  const checked = []; // the guard entries that ran on this call
  let seen = null; // the input they checked, as JSON
  let again = 0;
  let hinted = false;
  const inputNow = () => JSON.stringify(event?.tool_input ?? text);
  async function step(entry, rerun) {
    const name = path.basename(entry.hook, ".mjs");
    const left = GROUP_MS - process.uptime() * 1000;
    if (left <= 0) {
      const why = `the group "${group}" ran past its ${GROUP_MS / 1000} s`;
      if (entry.guard)
        refuse(
          `[${name}] The guard did not run (${why}), so the call is stopped. Set ${io.offName(name)}=off to bypass.`,
        );
      else say(`[dispatch] ${name} did not run (${why})\n`);
      return;
    }
    if (entry.guard && !rerun) {
      checked.push(entry);
      seen = inputNow();
    }
    const r = await runOne(
      entry,
      name,
      Math.min(HOOK_MS, left),
      rerun ? ++again : 0,
    );
    // A guard's refusal names it, so a refusal can be traced to the guard that made it
    const named = (reason) =>
      entry.guard && reason && !String(reason).includes(name)
        ? `[${name}] ${reason}`
        : String(reason);
    if (r.code === 2) {
      refuse(named(r.err.trim() || `${name} ended with exit 2`));
      return;
    }
    const said = r.out.trim();
    let rewrote = false;
    if (said) {
      let o = null;
      try {
        o = JSON.parse(said);
      } catch {
        // plain text: on UserPromptSubmit Claude Code reads it as context, elsewhere it shows it to no one
      }
      const rewrite = o?.hookSpecificOutput?.updatedInput;
      if (rerun && rewrite && typeof rewrite === "object") {
        refuse(
          `[dispatch] ${name} rewrote the input while the guards checked a rewrite, so the call is stopped.`,
        );
        delete o.hookSpecificOutput.updatedInput;
      }
      if (o && typeof o === "object" && !Array.isArray(o)) take(o, named);
      else if (eventName === "UserPromptSubmit") contexts.push(said);
      else
        say(
          `[dispatch] ${name} wrote text that is not JSON: ${said.slice(0, 200)}\n`,
        );
      rewrote = !rerun && checked.length > 0 && inputNow() !== seen;
    }
    const failed = r.failed ?? (r.code !== 0 ? `exit ${r.code}` : null);
    if (failed) {
      if (entry.guard) {
        const err = r.err.trim();
        refuse(
          err.includes(name)
            ? err
            : `[${name}] The guard itself failed (${failed}${err ? `: ${err}` : ""}), so the call is stopped. Set ${io.offName(name)}=off to bypass.`,
        );
      } else
        say(`[dispatch] ${name} failed (${failed}); the other hooks ran\n`);
    }
    if (!rewrote) return;
    if (!hinted) {
      hinted = true;
      say(
        `[dispatch] ${name} rewrote the input after the guards checked it, so they run again on it. In ${groupsFile}, list ${name} before the guards of group "${group}".\n`,
      );
    }
    for (const guard of checked) await step(guard, true);
    seen = inputNow();
  }
  for (const entry of list) if (applies(entry)) await step(entry, false);
}

function answerText() {
  const answer = {};
  if (stop) {
    answer.continue = false;
    if (stopReasons.length) answer.stopReason = stopReasons.join("\n\n");
  }
  if (suppress) answer.suppressOutput = true;
  if (messages.length) answer.systemMessage = messages.join("\n\n");
  if (blocks.length) {
    answer.decision = "block";
    answer.reason = blocks.join("\n\n");
  }
  const specific = { ...extra };
  if (decision) {
    specific.permissionDecision = decision;
    specific.permissionDecisionReason = decisionReasons.join("\n\n");
  }
  if (updatedInput) specific.updatedInput = updatedInput;
  if (contexts.length) specific.additionalContext = contexts.join("\n\n");
  if (Object.keys(specific).length)
    answer.hookSpecificOutput = { hookEventName: eventName, ...specific };
  return Object.keys(answer).length ? JSON.stringify(answer) : "";
}

// ---- run, and end fail-closed when the dispatcher itself fails
// The group is read even when crash-log.mjs fails to load: it tells which calls its guards cover
let failure = null;
const fail = (err) => {
  failure ??= err;
};
try {
  await loadLog();
} catch (err) {
  fail(err);
}
try {
  ready();
} catch (err) {
  fail(err);
}
if (!failure)
  try {
    await load();
    takeOver();
    await runGroup();
  } catch (err) {
    fail(err);
  }
if (failure) {
  crashLog("dispatch", failure);
  if (!refused() && covered(list))
    refuse(
      `[dispatch] The dispatcher itself failed (${failure.message}), so the call is stopped: a guard of group "${group}" covers it. Set DISPATCH=off to bypass.`,
    );
  else if (!refused())
    say(
      `[dispatch] ${failure.message}; no guard of group "${group}" covers this call, so it goes through\n`,
    );
}
let out = "";
let exitCode = 0;
try {
  out = answerText();
  if (out) real.writeSync(1, out);
} catch (err) {
  // The answer can't be written: a refusal goes out as exit 2, which Claude Code reads from stderr
  crashLog("dispatch", err);
  if (refused() || covered(list)) {
    say(
      [
        ...(decision === "allow" ? [] : decisionReasons),
        ...blocks,
        ...stopReasons,
      ].join("\n\n") ||
        `[dispatch] The dispatcher could not write its answer (${err.message}), so the call is stopped. Set DISPATCH=off to bypass.`,
    );
    exitCode = 2;
  }
}
// Ends here, with the answer written. Not by process.exit at once: while Node still closes something a hook used
// (fetch's socket just after a HEAD), process.exit aborts Node on Windows with "Assertion failed: !(handle->flags &
// UV_HANDLE_CLOSING)" (nodejs/node#56645), and the entry's onFailure "block" stops the call. So the work a hook left
// gets END_MS to finish and the process ends by itself; work still running then (a long timer, a child it waits on)
// must not hold the call, and process.exit ends it (that exit can still meet a closing handle, but only when a hook
// left work running for the whole END_MS). The exit code is the dispatcher's: a late hook can't change it.
process.exitCode = exitCode;
process.on("exit", () => {
  process.exitCode = exitCode;
});
setTimeout(() => real.exit(exitCode), END_MS).unref();
