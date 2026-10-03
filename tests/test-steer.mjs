// Tests for skills/steer/steer.mjs (the /btw and /ask script): when a note reaches the
// busy session, and who it is sent to. Runs against a throwaway home folder; touches nothing real.
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const STEER = fileURLToPath(new URL("../skills/steer/steer.mjs", import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "steer-test-"));
const work = path.join(home, "work");
fs.mkdirSync(work);
const key = (c) => String(c).replace(/[^a-zA-Z0-9]/g, "-");
const inboxDir = path.join(home, ".claude", "steer");
const inbox = path.join(inboxDir, `${key(work)}.jsonl`);
const projDir = path.join(home, ".claude", "projects", key(work));
fs.mkdirSync(inboxDir, { recursive: true });
fs.mkdirSync(projDir, { recursive: true });

const run = (args, { input = "", env = {}, cwd = work } = {}) => {
  const r = spawnSync(process.execPath, [STEER, ...args], { input, cwd, encoding: "utf8",
    env: { ...process.env, USERPROFILE: home, HOME: home, CLAUDE_CODE_SESSION_ID: "", ...env } });
  return { out: r.stdout.trim(), code: r.status };
};
const hook = (ev, extra = {}) => {
  const r = run(["--hook"], { input: JSON.stringify({ hook_event_name: ev, session_id: "busy-1", cwd: work, ...extra }) });
  return r.out ? JSON.parse(r.out) : null;
};
const put = (notes, file = inbox) => fs.writeFileSync(file, notes.map((n) => JSON.stringify(n)).join("\n") + "\n");
const note = (msg, o = {}) => ({ ts: Date.now(), to: "busy-1", msg, ...o });
const left = (file = inbox) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const transcript = (id, lastStop, middle = []) => fs.writeFileSync(path.join(projDir, `${id}.jsonl`), [
  { type: "user", message: { content: `request of ${id}` } },
  ...middle,
  { type: "assistant", message: { stop_reason: lastStop, content: [lastStop === "end_turn" ? { type: "text", text: "All done." } : { type: "tool_use", name: "Bash", input: {} }] } },
].map((e) => JSON.stringify(e)).join("\n") + "\n");

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? "ok  " : "FAIL"}  ${name}`); };

// 1-3: before a tool call, the call is held with the note; calls of the same step are held too;
// the retry a moment later goes through.
put([note("use the blue one")]);
let o = hook("PreToolUse");
ok("before a tool call: the call is held and carries the note",
  o?.hookSpecificOutput?.permissionDecision === "deny" && o.hookSpecificOutput.permissionDecisionReason.includes("use the blue one"));
o = hook("PreToolUse");
ok("a second call of the same step is held too",
  o?.hookSpecificOutput?.permissionDecision === "deny" && o.hookSpecificOutput.permissionDecisionReason.includes("Held together"));
ok("a tool result in that moment does not repeat the note", hook("PostToolUse") === null);
sleep(1700);
ok("the retry goes through", hook("PreToolUse") === null);
ok("the delivered note is cleared", left().length === 0);

// 4: after a tool call, the note rides along with the result.
put([note("skip step 3")]);
o = hook("PostToolUse");
ok("after a tool call: the note comes with the result",
  o?.hookSpecificOutput?.hookEventName === "PostToolUse" && o.hookSpecificOutput.additionalContext.includes("skip step 3"));
ok("and is cleared", left().length === 0);

// 5: at the end of a reply, the session is kept going.
put([note("also check the footer")]);
o = hook("Stop");
ok("when finishing: the session is kept going with the note", o?.decision === "block" && o.reason.includes("also check the footer"));
ok("and is cleared", left().length === 0);
ok("finishing with no note: nothing happens", hook("Stop") === null);

// 6: a helper agent inside the busy session must not take the note.
put([note("for the main session")]);
ok("a subagent does not take the note", hook("PreToolUse", { agent_id: "sub-1" }) === null && left().length === 1);

// 7: another session leaves it alone.
ok("another session does not take the note", hook("PostToolUse", { session_id: "someone-else" }) === null && left().length === 1);

// 8: the session moved to another folder since the note was sent.
o = hook("PostToolUse", { cwd: path.join(home, "elsewhere") });
ok("a session that changed folder still gets the note", o?.hookSpecificOutput?.additionalContext.includes("for the main session"));

// 9: old notes are dropped silently.
put([note("stale", { ts: Date.now() - 21 * 60e3 })]);
ok("a note older than 20 minutes is dropped", hook("PreToolUse") === null && left().length === 0);

// 10: no inbox folder at all.
fs.rmSync(inboxDir, { recursive: true, force: true });
ok("no notes folder: nothing happens", hook("PreToolUse") === null);

// 11-13: who it is sent to.
transcript("aaaaaaaa-self", "tool_use");
transcript("bbbbbbbb-busy", "tool_use");
let r = run(["send", "hello"], { env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" } });
ok("the sending session is not offered as a target; an unnamed target is called by its last request",
  r.code === 0 && r.out === 'Sent to the session last asked "request of bbbbbbbb-busy". It reads the note before its next step.');
ok("the note is queued for the busy session", left().length === 1 && left()[0].to === "bbbbbbbb-busy");
transcript("bbbbbbbb-busy", "end_turn");
r = run(["send", "hello again"], { env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" } });
ok("a finished session: the note is left, with the 20 minute limit",
  r.code === 0 && r.out.startsWith("Left for ") && r.out.includes("idle") && r.out.includes("within 20 minutes"));
transcript("cccccccc-busy", "tool_use");
r = run(["send", "which one"], { env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" } });
ok("several targets: nothing is sent, each is marked busy or finished, and Claude is told to pick without asking",
  r.code === 2 && r.out.includes("NOT SENT") && r.out.includes("Don't ask the user") && /bbbbbbbb {2}finished its reply/.test(r.out) && /cccccccc {2}busy/.test(r.out));

// 14-17: the target is called by the name on its tab, so the user can tell where the note went.
const self = { env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" } };
transcript("bbbbbbbb-busy", "tool_use", [
  { type: "assistant", message: { content: [{ type: "tool_use", id: "tu-meta-1", name: "mcp__nimbalyst__update_session_meta", input: { phase: "implementing" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu-meta-1", content: [{ type: "text", text: JSON.stringify({ after: { name: "Juicer hunt" } }) }] }] } },
]);
r = run(["send", "--to", "bbbbbbbb", "hi"], self);
ok("a session is called by its Nimbalyst tab name", r.code === 0 && r.out === 'Sent to "Juicer hunt". It reads the note before its next step.');
transcript("cccccccc-busy", "tool_use", [{ type: "ai-title", aiTitle: "Title from Claude Code" }]);
r = run(["send", "--to", "cccccccc", "hi"], self);
ok("without a tab name, Claude Code's own title is used", r.code === 0 && r.out.startsWith('Sent to "Title from Claude Code". '));
r = run(["send", "which one"], self);
ok("the list of several targets shows the names", r.code === 2 && r.out.includes('bbbbbbbb  "Juicer hunt"  busy') && r.out.includes('cccccccc  "Title from Claude Code"  busy'));
transcript("cccccccc-busy", "tool_use", Array.from({ length: 40 }, () => ({ type: "assistant", message: { content: [{ type: "text", text: "x".repeat(100000) }] } })));
r = run(["send", "--to", "cccccccc", "hi"], self);
ok("a long session whose only request is at the start is still called by it", r.code === 0 && r.out.startsWith('Sent to the session last asked "request of cccccccc-busy". '));

fs.rmSync(home, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
