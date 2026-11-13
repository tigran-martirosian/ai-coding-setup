// Tests for ~/.claude/skills/steer/steer.mjs (the /btw script and the Note button): when a note reaches the
// busy session, and who it is sent to. Runs against a throwaway home folder; touches nothing real.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";

const STEER = path.join(os.homedir(), ".claude", "skills", "steer", "steer.mjs");
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
    env: { ...process.env, USERPROFILE: home, HOME: home, CLAUDE_CODE_SESSION_ID: "", STEER_WAIT: "0", STEER_NIMBALYST_DB: path.join(home, "no-nimbalyst.sqlite"), ...env } });
  return { out: r.stdout.trim(), code: r.status };
};
const hook = (ev, extra = {}, env = {}) => {
  const r = run(["--hook"], { env, input: JSON.stringify({ hook_event_name: ev, session_id: "busy-1", cwd: work, ...extra }) });
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
o = hook("PostToolUse", { agent_id: "sub-1" });
ok("a subagent gets a copy after a tool call, to pass on in its report",
  o?.hookSpecificOutput?.additionalContext.includes("for the main session") && o.hookSpecificOutput.additionalContext.includes("User note received:"));
ok("only once per subagent", hook("PostToolUse", { agent_id: "sub-1" }) === null);
ok("another subagent gets its own copy", hook("PostToolUse", { agent_id: "sub-2" })?.hookSpecificOutput?.additionalContext.includes("for the main session"));
ok("the note stays for the main session", left().length === 1 && !left()[0].seen);

// 7: another session leaves it alone.
ok("another session does not take the note", hook("PostToolUse", { session_id: "someone-else" }) === null && left().length === 1);

// 8: the session moved to another folder since the note was sent.
o = hook("PostToolUse", { cwd: path.join(home, "elsewhere") });
ok("a session that changed folder still gets the note", o?.hookSpecificOutput?.additionalContext.includes("for the main session"));

// 9: old notes are dropped silently.
put([note("waited long", { ts: Date.now() - 90 * 60e3 })]);
ok("a note an hour and a half old still arrives (long tool calls, background jobs)", hook("PostToolUse")?.hookSpecificOutput?.additionalContext.includes("waited long"));
put([note("stale", { ts: Date.now() - 121 * 60e3 })]);
ok("a note older than 2 hours is dropped", hook("PreToolUse") === null && left().length === 0);

// 10: no inbox folder at all.
fs.rmSync(inboxDir, { recursive: true, force: true });
ok("no notes folder: nothing happens", hook("PreToolUse") === null);

// 11-13: who it is sent to.
transcript("aaaaaaaa-self", "tool_use");
transcript("bbbbbbbb-busy", "tool_use");
let r = run(["send", "hello"], { env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" } });
ok("the sending session is not offered as a target; an unnamed target is called by its last request",
  r.code === 0 && r.out.startsWith('Queued for the session last asked "request of bbbbbbbb-busy", not delivered yet.'));
ok("the note is queued for the busy session", left().length === 1 && left()[0].to === "bbbbbbbb-busy");
transcript("bbbbbbbb-busy", "end_turn");
r = run(["send", "hello again"], { env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" } });
ok("a finished session: the note is left, with the 20 minute limit",
  r.code === 0 && r.out.startsWith("Left for ") && r.out.includes("idle") && r.out.includes("within 2 hours"));
transcript("cccccccc-busy", "tool_use");
r = run(["send", "which one"], { env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" } });
ok("several targets, none named: the busy one gets the note, not the finished one",
  r.code === 0 && r.out.startsWith('Queued for the session last asked "request of cccccccc-busy", ') && left().at(-1).to === "cccccccc-busy");

// 14-17: the target is called by the name on its tab, so the user can tell where the note went.
const self = { env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" } };
transcript("bbbbbbbb-busy", "tool_use", [
  { type: "assistant", message: { content: [{ type: "tool_use", id: "tu-meta-1", name: "mcp__nimbalyst__update_session_meta", input: { phase: "implementing" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu-meta-1", content: [{ type: "text", text: JSON.stringify({ after: { name: "Juicer hunt" } }) }] }] } },
]);
r = run(["send", "--to", "bbbbbbbb", "hi"], self);
ok("a session is called by its Nimbalyst tab name", r.code === 0 && r.out.startsWith('Queued for "Juicer hunt", not delivered yet.'));
transcript("cccccccc-busy", "tool_use", [{ type: "ai-title", aiTitle: "Title from Claude Code" }]);
r = run(["send", "--to", "cccccccc", "hi"], self);
ok("without a tab name, Claude Code's own title is used", r.code === 0 && r.out.startsWith('Queued for "Title from Claude Code", '));
r = run(["send", "which one"], self);
ok("several busy targets: the most recently active one gets the note", r.code === 0 && r.out.startsWith('Queued for "Title from Claude Code", '));
r = run(["send", "--to", "zzzzzzzz", "hi"], self);
ok("an unknown id sends nothing and lists the sessions by name", r.code === 2 && r.out.includes("NOT SENT") && r.out.includes('bbbbbbbb  "Juicer hunt"  busy') && r.out.includes('cccccccc  "Title from Claude Code"  busy'));
transcript("cccccccc-busy", "tool_use", Array.from({ length: 40 }, () => ({ type: "assistant", message: { content: [{ type: "text", text: "x".repeat(100000) }] } })));
r = run(["send", "--to", "cccccccc", "hi"], self);
ok("a long session whose only request is at the start is still called by it", r.code === 0 && r.out.startsWith('Queued for the session last asked "request of cccccccc-busy", '));

// 18-23: --to with a Nimbalyst session id (a lead's child, in another folder) finds its transcript,
// and Nimbalyst's status decides how the note goes, not the transcript's last line.
const { DatabaseSync } = await import("node:sqlite");
const dbPath = path.join(home, "nimbalyst.sqlite");
const db = new DatabaseSync(dbPath);
const childWs = path.join(home, "child-folder");
db.exec("CREATE TABLE ai_sessions (id TEXT, title TEXT, status TEXT, provider_session_id TEXT, workspace_id TEXT, updated_at TEXT)");
db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)").run("e13360ea-nimb", "job 3b: base design", "running", "dddddddd-child", childWs, "2026-10-29");
const status = (s) => db.prepare("UPDATE ai_sessions SET status = ? WHERE id = 'e13360ea-nimb'").run(s);
const childDir = path.join(home, ".claude", "projects", key(childWs));
fs.mkdirSync(childDir, { recursive: true });
const childT = (stop) => fs.writeFileSync(path.join(childDir, "dddddddd-child.jsonl"), JSON.stringify({ type: "assistant", message: { stop_reason: stop, content: [{ type: "tool_use", name: "Bash", input: {} }] } }) + "\n");
const nimb = { env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self", STEER_NIMBALYST_DB: dbPath } };
childT("tool_use");
r = run(["send", "--to", "e13360ea", "wine ages faster"], nimb);
ok("a Nimbalyst id reaches the busy child in another folder, named by its title",
  r.code === 0 && r.out.startsWith('Queued for "job 3b: base design", not delivered yet.') && left().at(-1).to === "dddddddd-child");
childT("end_turn");
let before = left().length;
r = run(["send", "--to", "e13360ea", "wine ages faster"], nimb);
ok("reply ended but Nimbalyst says running (a background job): the note is queued, not refused",
  r.code === 0 && r.out.startsWith("Queued for ") && left().length === before + 1);
status("waiting_for_input");
r = run(["send", "--to", "e13360ea", "pick blue"], nimb);
ok("waiting for the user's answer: queued, and it says the note comes after that answer", r.code === 0 && r.out.includes("waiting for an answer"));
status("idle"); childT("tool_use");
before = left().length;
r = run(["send", "--to", "e13360ea", "wine ages faster"], nimb);
ok("idle in Nimbalyst (transcript cut off mid tool call): nothing queued, told to send_prompt to the Nimbalyst id",
  r.code === 3 && r.out.includes("send_prompt to session e13360ea-nimb") && left().length === before);
r = run(["send", "--to", "dddddddd", "hi"], nimb);
ok("the Claude session id finds the same Nimbalyst row", r.code === 3 && r.out.includes("is idle"));
r = run(["send", "--to", "ffffffff", "hi"], nimb);
ok("an id in neither place sends nothing", r.code === 2 && r.out.startsWith("NOT SENT"));
// A new tab: Nimbalyst has its row, Claude has no session yet
db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)").run("56b89c3d-new", "New Session", "idle", null, childWs, "2026-10-30");
before = left().length;
r = run(["send", "--to", "56b89c3d-new", "first words"], nimb);
ok("a session that has never run: nothing queued, told to send_prompt so the first message starts it",
  r.code === 3 && r.out.includes("send_prompt to it") && r.out.includes("56b89c3d-new") && left().length === before);
// A session in a git worktree: Nimbalyst records the main folder, the transcript is under the worktree's
db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)").run("5a051ea1-nimb", "lane: bugs", "running", "eeeeeeee-lane", childWs, "2026-10-29");
const laneDir = path.join(home, ".claude", "projects", key(childWs + "_worktrees/moving-comet"));
fs.mkdirSync(laneDir, { recursive: true });
fs.writeFileSync(path.join(laneDir, "eeeeeeee-lane.jsonl"), JSON.stringify({ type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "Bash", input: {} }] } }) + "\n");
r = run(["send", "--to", "5a051ea1", "hi"], nimb);
ok("a session in a git worktree is found by its transcript in the worktree's folder",
  r.code === 0 && r.out.startsWith('Queued for "lane: bugs", not delivered yet.') && left().at(-1).to === "eeeeeeee-lane");

// 24-30: send_prompt to a session Nimbalyst says is busy is held and turned into a steer note; to an
// idle one it goes through. A session not in Nimbalyst keeps the /btw check (held until steer was tried).
const tp = path.join(home, "lead.jsonl");
const lead = (said, steered) => fs.writeFileSync(tp, [
  { type: "user", message: { content: "earlier request" } },
  { type: "user", message: { content: said } },
  { type: "user", message: { content: "<system-reminder>x</system-reminder>" } },
  ...(steered ? [{ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "node ~/.claude/skills/steer/steer.mjs send --to e13360ea - <<'EOF'" } }] } }] : []),
].map((e) => JSON.stringify(e)).join("\n") + "\n");
const sp = (prompt, extra = {}, id = "e13360ea") => hook("PreToolUse", { transcript_path: tp, tool_name: "mcp__nimbalyst-host__send_prompt", tool_input: { sessionId: id, prompt, ...extra } }, nimb.env);
status("running");
lead("tell job 3b to use the new brief", false);
o = sp("Use the new brief");
ok("send_prompt to a running session is held, whatever it says, and names the steer command",
  o?.hookSpecificOutput?.permissionDecision === "deny" && o.hookSpecificOutput.permissionDecisionReason.includes("steer.mjs send --to e13360ea"));
lead("send it as btw", true);
ok("held even after a steer try, while it is running", sp("/btw wine")?.hookSpecificOutput?.permissionDecision === "deny");
status("idle");
lead("e13360ea send to this session /btw wine ages faster", false);
ok("send_prompt to an idle session goes through, /btw or not", sp("/btw From the user: wine ages faster") === null);
status("running");
lead("btw stop it now", false);
ok("an interrupt the lead chose goes through", sp("Stop", { interrupt: true }) === null);
lead("e13360ea send to this session /btw wine ages faster", false);
o = sp("/btw From the user: wine ages faster", {}, "99999999");
ok("not in Nimbalyst: a /btw note is held", o?.hookSpecificOutput?.permissionDecision === "deny");
lead("send it as btw", true);
ok("not in Nimbalyst: after steer.mjs send was tried, it goes through", sp("/btw wine", {}, "99999999") === null);
lead("tell job 3b to use the new brief", false);
ok("not in Nimbalyst: an ordinary relay goes through", sp("Use the new brief", {}, "99999999") === null);

// 31-40: after a handoff, a child report reaching the old lead is forwarded to whoever leads now.
const moved = path.join(inboxDir, "moved.json"), outbox = path.join(inboxDir, "outbox.jsonl");
const ups = (sid, prompt) => {
  const r = run(["--hook"], { env: nimb.env, input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: sid, cwd: work, prompt }) });
  return r.out ? JSON.parse(r.out) : null;
};
const REP = '[Child Session Update]\nSession: "lane 2" (abc)\nDone: the deploy script works.';
r = run(["moved", "--to", "e13360ea"], { env: { ...nimb.env, CLAUDE_CODE_SESSION_ID: "old-lead" } });
ok("moved records where the lead went", r.code === 0 && JSON.parse(fs.readFileSync(moved, "utf8"))["old-lead"]?.to === "e13360ea");
ok("a session that never handed off runs its child reports itself", ups("some-lead", REP) === null);
ok("a slash command typed in the old lead still runs there", ups("old-lead", "/compact") === null);
ok("a system injection in the old lead still runs there", ups("old-lead", "<task-notification>x</task-notification>") === null && ups("old-lead", "[SYSTEM NOTIFICATION] x") === null);
ok("a message typed in a session that never handed off runs there", ups("some-lead", "what did lane 2 say?") === null);
status("running");
fs.rmSync(inbox, { force: true });
o = ups("old-lead", REP);
ok("a report to the old lead is not run there and says where it went",
  o?.decision === "block" && o.reason.includes('"job 3b: base design"') && o.reason.includes("before its next step"));
ok("it waits as a report note for the current lead's Claude session", left().at(-1)?.to === "dddddddd-child" && left().at(-1)?.kind === "report");
ok("a busy lead is not woken", !fs.existsSync(outbox));
status("idle");
o = ups("old-lead", REP);
const ob = left(outbox);
ok("an idle lead is woken through the outbox with its Nimbalyst id", o?.reason.includes("being woken") && ob.length === 1 && ob[0].session === "e13360ea-nimb" && ob[0].id);
db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)").run("f2f2f2f2-nimb", "lead (cont.) (cont.)", "running", "eeeeeeee-new", childWs, "2026-10-29");
run(["moved", "--from", "dddddddd-child", "--to", "f2f2f2f2"], nimb);
fs.rmSync(inbox, { force: true });
ups("old-lead", REP);
ok("a chain of handoffs is followed to the newest lead", left().at(-1)?.to === "eeeeeeee-new");
r = run(["--hook"], { input: JSON.stringify({ hook_event_name: "PostToolUse", session_id: "eeeeeeee-new", cwd: work }) });
o = r.out ? JSON.parse(r.out) : null;
const ctx = o?.hookSpecificOutput?.additionalContext || "";
ok("the new lead gets it as a child report, not as a note from the user", ctx.includes("[report]") && ctx.includes("deploy script works") && !ctx.includes("The user sent"));
run(["moved", "--from", "lost-lead", "--to", "77777777"], nimb);
o = ups("lost-lead", REP);
ok("a lead that moved to an unknown session keeps the report and says so", !o?.decision && o?.hookSpecificOutput?.additionalContext.includes("not found"));

// 41-48: a message the user types in the old lead goes the same way, as a request from the user.
const TYPED = "what did lane 2 say?";
const status2 = (s) => db.prepare("UPDATE ai_sessions SET status = ? WHERE id = 'f2f2f2f2-nimb'").run(s);
status2("running");
fs.rmSync(inbox, { force: true });
fs.rmSync(outbox, { force: true });
o = ups("old-lead", TYPED);
ok("a typed message to the old lead (busy new lead) is not run there and says where it went",
  o?.decision === "block" && o.reason.startsWith("Your message went to") && o.reason.includes("before its next step"));
ok("it waits as a user-kind note for the current lead's session, unchanged", left().at(-1)?.kind === "user" && left().at(-1)?.msg === TYPED && left().at(-1)?.to === "eeeeeeee-new");
ok("a busy lead is not woken for it", !fs.existsSync(outbox));
r = run(["--hook"], { input: JSON.stringify({ hook_event_name: "PostToolUse", session_id: "eeeeeeee-new", cwd: work }) });
const tctx = (r.out ? JSON.parse(r.out) : null)?.hookSpecificOutput?.additionalContext || "";
ok("the new lead is told it is the user's own message typed in the old session, a request", tctx.includes("[user]") && tctx.includes("reached the session you took over from") && tctx.includes("most likely typed there by the user") && tctx.includes("reads like one session writing to another") &&tctx.includes(TYPED) && !tctx.includes("[report]"));
status2("idle");
fs.rmSync(inbox, { force: true });
o = ups("old-lead", TYPED);
const ob2 = left(outbox);
ok("an idle new lead is woken through the outbox for it", o?.reason.includes("being woken") && ob2.length === 1 && ob2[0].session === "f2f2f2f2-nimb" && ob2[0].prompt.startsWith("A message that reached the session you took over from was forwarded to you") && ob2[0].prompt.includes("one session writing to another"));
const rec = JSON.parse(fs.readFileSync(moved, "utf8"));
rec["old-lead"].ts = Date.now() - 25 * 3600e3;
fs.writeFileSync(moved, JSON.stringify(rec));
fs.rmSync(inbox, { force: true });
ok("a handoff over 24 hours old keeps typed messages in the old session", ups("old-lead", TYPED) === null && left().length === 0);
o = ups("old-lead", REP);
ok("but an old record still forwards child reports", o?.decision === "block" && o.reason.startsWith("Forwarded to"));

// 49-53: review fixes. Whitespace before a report, a bad outbox line, the off switch, no temp files left.
rec["old-lead"].ts = Date.now();
fs.writeFileSync(moved, JSON.stringify(rec));
fs.rmSync(inbox, { force: true });
o = ups("old-lead", "\n  " + REP);
ok("a report with leading whitespace is forwarded as a report, not as a user message", o?.reason.startsWith("Forwarded to") && left().at(-1)?.kind === "report");
fs.rmSync(inbox, { force: true });
fs.writeFileSync(outbox, JSON.stringify({ id: "keep-me", ts: Date.now(), session: "x", prompt: "queued earlier" }) + "\n{this is not json\n");
o = ups("old-lead", REP);
ok("a bad line in the outbox does not wipe the queued entries", left(outbox).some((e) => e.id === "keep-me") && left(outbox).length === 2);
fs.rmSync(inbox, { force: true });
o = run(["--hook"], { env: { ...nimb.env, STEER_FORWARD: "off" }, input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "old-lead", cwd: work, prompt: TYPED }) });
ok("STEER_FORWARD=off keeps a typed message in the old session", o.out === "" && left().length === 0);
o = run(["--hook"], { env: { ...nimb.env, STEER_FORWARD: "off" }, input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "old-lead", cwd: work, prompt: REP }) });
ok("STEER_FORWARD=off still forwards child reports", JSON.parse(o.out || "{}").decision === "block" && left().at(-1)?.kind === "report");
ok("no temp files are left in the steer folder", !fs.readdirSync(inboxDir).some((n) => n.endsWith(".tmp")));
db.close();

// Delivery receipts: a note stays until its marker is in the session's transcript (2026-10-30).
{
  const inbox = path.join(home, ".claude", "steer");
  const tp2 = path.join(home, "receipt-transcript.jsonl");
  const box = path.join(inbox, "receipt-test.jsonl");
  const rc = () => { try { return JSON.parse(fs.readFileSync(path.join(inbox, "receipts.json"), "utf8")); } catch { return []; } };
  const sid = { session_id: "rcpt-1", transcript_path: tp2 };
  const put = (e) => { fs.mkdirSync(inbox, { recursive: true }); fs.writeFileSync(box, JSON.stringify(e) + "\n"); };
  const inBox = () => fs.existsSync(box) ? fs.readFileSync(box, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1700);
  fs.writeFileSync(tp2, "");
  put({ ts: Date.now(), id: "n1", to: "rcpt-1", from: "lead-1", msg: "keep the clouds" });
  const result = (call) => JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: call }] } }) + "\n";
  let x = hook("PreToolUse", { ...sid, tool_use_id: "call-1" });
  ok("the held call carries the note with its marker", x?.hookSpecificOutput?.permissionDecisionReason.includes("[note n1] keep the clouds"));
  ok("handing it over does not count as delivered", inBox().length === 1 && inBox()[0].tries === 1 && !rc().some((r) => r.id === "n1"));
  pause();
  // The call was cancelled: its result landed without the note.
  fs.appendFileSync(tp2, result("call-1"));
  ok("a lost hold does not hold the next call", hook("PreToolUse", sid) === null);
  x = hook("PostToolUse", sid);
  ok("a lost note rides with the next tool result", x?.hookSpecificOutput?.additionalContext.includes("[note n1] keep the clouds") && inBox()[0].tries === 2);
  fs.writeFileSync(tp2, JSON.stringify({ text: "[note n1] keep the clouds" }) + "\n");
  pause();
  x = hook("PreToolUse", sid);
  ok("once the marker is in the transcript the note is done", x === null && inBox().length === 0 && rc().find((r) => r.id === "n1")?.state === "delivered");
  // Tool calls run while their reply is still coming and their results land later (2026-10-31: a note was
  // handed over four times in 11 s of one reply and marked failed, yet it had arrived). Other lines land meanwhile.
  fs.writeFileSync(tp2, "");
  put({ ts: Date.now(), id: "n4", to: "rcpt-1", from: "lead-1", msg: "mid reply" });
  hook("PreToolUse", { ...sid, tool_use_id: "call-4" });
  pause();
  const later = Array.from({ length: 6 }, (_, i) => {
    fs.appendFileSync(tp2, JSON.stringify({ type: "last-prompt" }) + "\n" + result(`other-${i}`));
    return hook("PostToolUse", sid);
  });
  ok("before its call has a result: no repeat of the note, whatever else lands", later.every((v) => v === null) && inBox()[0].tries === 1);
  ok("and no failed receipt", !rc().some((r) => r.id === "n4"));
  fs.appendFileSync(tp2, JSON.stringify({ text: "[note n4] mid reply" }) + "\n");
  ok("the reply ends with the note in it: delivered", hook("PostToolUse", sid) === null && rc().find((r) => r.id === "n4")?.state === "delivered");
  // A Stop is the last chance: the reply is over, so a note still missing is carried again.
  fs.writeFileSync(tp2, "");
  put({ ts: Date.now(), id: "n5", to: "rcpt-1", from: "lead-1", msg: "at the end" });
  hook("PreToolUse", { ...sid, tool_use_id: "call-5" });
  pause();
  x = hook("Stop", sid);
  ok("a note still missing at Stop is carried again", x?.decision === "block" && x.reason.includes("[note n5] at the end") && inBox()[0].tries === 2);
  // The 2 hour limit is reached from any session's hook, so it looks in the receiver's transcript.
  fs.writeFileSync(tp2, JSON.stringify({ text: "[note n6] read long ago" }) + "\n");
  put({ ts: Date.now() - 3 * 3600e3, id: "n6", to: "rcpt-1", msg: "read long ago", seen: Date.now() - 3 * 3600e3, transcript: tp2, tries: 1 });
  hook("PostToolUse", { session_id: "someone-else" });
  ok("past the limit, a note in its transcript counts as delivered", rc().find((r) => r.id === "n6")?.state === "delivered");
  put({ ts: Date.now() - 3 * 3600e3, id: "n7", to: "rcpt-1", msg: "never read", seen: Date.now() - 3 * 3600e3, transcript: tp2, tries: 1 });
  hook("PostToolUse", { session_id: "someone-else" });
  ok("past the limit, a note not in it has failed", rc().find((r) => r.id === "n7")?.state === "failed");
  fs.writeFileSync(tp2, "");
  put({ ts: Date.now(), id: "n2", to: "rcpt-1", from: "lead-1", msg: "never lands", seen: Date.now() - 5000, tries: 4 });
  ok("after the last try it is marked failed", hook("PostToolUse", sid) === null && rc().find((r) => r.id === "n2")?.state === "failed");
  x = hook("PostToolUse", { session_id: "lead-1" });
  ok("the sender is told once a note failed", x?.hookSpecificOutput?.additionalContext.includes("NOT been confirmed") && x.hookSpecificOutput.additionalContext.includes("never lands"));
  ok("and only once", hook("PostToolUse", { session_id: "lead-1" }) === null);
  put({ ts: Date.now() - 11 * 60e3, id: "n3", to: "rcpt-9", from: "lead-1", msg: "slow one" });
  x = hook("PostToolUse", { session_id: "lead-1" });
  ok("the sender is warned about a note still waiting after 10 minutes", x?.hookSpecificOutput?.additionalContext.includes("slow one"));
  ok("that warning comes once too", hook("PostToolUse", { session_id: "lead-1" }) === null && inBox().length === 1);
  r = run(["status"], { env: { CLAUDE_CODE_SESSION_ID: "lead-1" } });
  ok("status lists what is waiting and what failed", r.out.includes("slow one") && r.out.includes("FAILED") && r.out.includes("never lands"));
  fs.rmSync(box, { force: true });
}

// A session over 300k takes no new work from another session; finishing notes and the user's own pass
const huge = (n) => ({ type: "assistant", message: { model: "claude-opus-5-5", usage: { input_tokens: 0, cache_read_input_tokens: n, cache_creation_input_tokens: 0 }, content: [{ type: "text", text: "working" }] } });
transcript("dddddddd-busy", "tool_use", [huge(598000)]);
r = run(["send", "--to", "dddddddd", "one more job"], self);
ok("a note from another session to a huge session is refused", r.code === 4 && r.out.includes("NOT SENT") && r.out.includes("~598k") && r.out.includes("--last"));
r = run(["send", "--to", "dddddddd", "--last", "finish and stop"], self);
ok("--last passes the size check", r.code === 0 && r.out.startsWith("Queued for"));
r = run(["send", "--to", "dddddddd", "--user", "the note the user wrote"], self);
ok("--user passes the size check", r.code === 0 && r.out.startsWith("Queued for"));
r = run(["send", "--to", "dddddddd", "from the Note button"]);
ok("the Note button, outside a session, is never refused", r.code === 0 && r.out.startsWith("Queued for"));
const started = Date.now();
r = run(["send", "--to", "dddddddd", "--nowait", "do not wait"], { env: { STEER_WAIT: "5" } });
ok("--nowait answers at once with the note's id", r.code === 0 && Date.now() - started < 4000 && /^Note id: \w+$/m.test(r.out));
r = run(["send", "--to", "dddddddd", "-", "--nowait"], { input: "from stdin" });
ok("--nowait works after the - the button sends", r.code === 0 && /^Note id: \w+$/m.test(r.out));
r = run(["send", "--to", "dddddddd", "why", "--nowait", "fails"]);
ok("a note that mentions --nowait keeps the word and waits as usual", r.code === 0 && !/Note id/.test(r.out));
fs.readdirSync(path.join(home, ".claude", "steer")).filter((n) => n.endsWith(".jsonl")).forEach((n) => { const f = path.join(home, ".claude", "steer", n); fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("\n").filter((l) => !l.includes("why --nowait fails")).join("\n")); });
ok("--nowait is not part of the note",!fs.readdirSync(path.join(home, ".claude", "steer")).filter((n) => n.endsWith(".jsonl")).some((n) => fs.readFileSync(path.join(home, ".claude", "steer", n), "utf8").includes("--nowait")));
transcript("dddddddd-busy", "tool_use", [huge(250000)]);
r = run(["send", "--to", "dddddddd", "next step"], self);
ok("a session under the limit takes notes", r.code === 0 && r.out.startsWith("Queued for"));
r = run(["send", "--to", "dddddddd", "next step"], { env: { ...self.env, STEER_MAX_K: "200" } });
ok("STEER_MAX_K lowers the limit", r.code === 4);

// --watch: the background Stop hook that wakes a session waiting on a background job.
{
  const tp = path.join(home, "watch.jsonl");
  const line = (o) => JSON.stringify(o) + "\n";
  const job = line({ type: "user", toolUseResult: { backgroundTaskId: "job1" } }) + line({ type: "assistant", message: { content: "waiting" } });
  fs.writeFileSync(tp, job);
  const env = { ...process.env, USERPROFILE: home, HOME: home, STEER_WATCH_TICK: "0.05", STEER_WATCH_MAX: "1", STEER_WATCH_ARGS: "claude --input-format stream-json --print" };
  const payload = (extra = {}) => JSON.stringify({ hook_event_name: "Stop", session_id: "busy-1", cwd: work, transcript_path: tp, ...extra });
  const watch = (input = payload(), more = {}) => {
    const r = spawnSync(process.execPath, [STEER, "--watch"], { input, cwd: work, encoding: "utf8", env: { ...env, ...more } });
    return { code: r.status, err: r.stderr };
  };
  const later = (ms, fn) => new Promise((done) => {
    const c = spawn(process.execPath, [STEER, "--watch"], { cwd: work, env });
    const t0 = Date.now();
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => done({ code, err, ms: Date.now() - t0 }));
    c.stdin.end(payload());
    setTimeout(fn, ms);
  });
  fs.rmSync(inbox, { force: true });
  let w = watch();
  ok("watch: no note, it ends quietly at its time limit", w.code === 0 && w.err === "");
  put([note("waiting note", { id: "w1" }), note("for someone else", { id: "w2", to: "other" })]);
  w = watch();
  ok("watch: a note wakes the session with exit 2 and its text", w.code === 2 && w.err.includes("waiting note") && w.err.includes("[note w1]"));
  ok("watch: another session's note stays out of it", !w.err.includes("for someone else"));
  const box = left(), w1 = box.find((e) => e.id === "w1");
  ok("watch: the note stays until its marker is in the transcript", w1?.seen > 0 && w1.tries === 1 && w1.transcript === tp);
  ok("watch: the other session's note is untouched", !box.find((e) => e.id === "w2").seen);
  ok("watch: a note already handed over does not wake it twice", watch().code === 0);
  fs.rmSync(inbox, { force: true });
  put([note("off", { id: "w3" })]);
  ok("watch: STEER_WATCH=off does nothing", watch(payload(), { STEER_WATCH: "off" }).code === 0 && !left()[0].seen);
  ok("watch: a plain claude -p ends at once, it would be held up", watch(payload(), { STEER_WATCH_ARGS: "claude -p hello" }).code === 0 && !left()[0].seen);
  ok("watch: an unreadable command line ends at once", watch(payload(), { STEER_WATCH_ARGS: "" }).code === 0 && !left()[0].seen);
  ok("watch: a terminal session is watched", watch(payload(), { STEER_WATCH_ARGS: "claude" }).code === 2);
  put([note("off", { id: "w3" })]);
  ok("watch: a subagent's stop does nothing", watch(payload({ agent_id: "a1" })).code === 0 && !left()[0].seen);
  ok("watch: no transcript, no wake", watch(payload({ transcript_path: undefined })).code === 0 && !left()[0].seen);
  fs.rmSync(inbox, { force: true });
  let g = await later(150, () => fs.appendFileSync(tp, line({ type: "user", message: { content: "next" } })));
  ok("watch: a new turn ends it, since --hook takes over", g.code === 0 && g.ms < 900);
  g = await later(150, () => { fs.appendFileSync(tp, line({ type: "system", subtype: "stop_hook_summary" })); setTimeout(() => put([note("after a system line", { id: "w4" })]), 100); });
  ok("watch: a hook's system line does not end it", g.code === 2 && g.err.includes("after a system line"));
  fs.rmSync(inbox, { force: true });
  put([note("a report", { id: "w5", kind: "report" })]);
  w = watch();
  ok("watch: a forwarded report is left to the outbox wake-up", w.code === 0 && !left()[0].seen);
  fs.rmSync(inbox, { force: true });
  for (const [what, l] of [["a compact summary", { type: "user", isCompactSummary: true }], ["a meta line", { type: "user", isMeta: true }], ["an interrupt", { type: "user", message: { content: "[Request interrupted by user]" } }], ["a local command", { type: "user", message: { content: "<local-command-stdout>x</local-command-stdout>" } }]]) {
    g = await later(150, () => { fs.appendFileSync(tp, line(l)); setTimeout(() => put([note("still watching", { id: "w6" })]), 100); });
    ok(`watch: ${what} does not end it`, g.code === 2);
    fs.rmSync(inbox, { force: true });
  }
  put([note("no job", { id: "w7" })]);
  const done = job + line({ type: "user", message: { content: "<task-notification><task-id>job1</task-id></task-notification>" } });
  fs.writeFileSync(tp, done);
  ok("watch: every job finished, no watcher", watch().code === 0 && !left()[0].seen);
  fs.writeFileSync(tp, line({ type: "assistant", message: { content: "plain reply" } }));
  ok("watch: no job at all, no watcher", watch().code === 0 && !left()[0].seen);
  fs.writeFileSync(tp, line({ type: "user", toolUseResult: { isAsync: true, status: "async_launched", agentId: "ag1" } }));
  ok("watch: a background agent counts as a job", watch().code === 2);
  fs.rmSync(inbox, { force: true });
  fs.writeFileSync(tp, job);
  put([note("gone", { id: "w8" })]);
  const dead = spawnSync(process.execPath, ["-p", "process.pid"], { encoding: "utf8" }).stdout.trim();
  ok("watch: its Claude is gone, it ends and leaves the note", watch(payload(), { CLAUDE_PID: dead }).code === 0 && !left()[0].seen);
  ok("watch: quoted prompt text is not a flag", watch(payload(), { STEER_WATCH_ARGS: 'claude "why does -p fail"' }).code === 2);
  put([note("q", { id: "w9" })]);
  ok("watch: a -p prompt that names stream-json still ends at once", watch(payload(), { STEER_WATCH_ARGS: 'claude -p "explain --input-format stream-json"' }).code === 0 && !left()[0].seen);
  fs.rmSync(inbox, { force: true });
  // After a wake-up: --hook must not repeat the note or hold a tool call with a false message.
  const hookT = path.join(home, "hook.jsonl");
  fs.writeFileSync(hookT, line({ type: "assistant", message: { content: "x" } }));
  const sid = { transcript_path: hookT };
  put([note("woken", { id: "w10", seen: Date.now(), via: "watch", tries: 1, transcript: hookT })]);
  ok("after a wake-up: a tool call is not held", hook("PreToolUse", sid) === null);
  sleep(1700);
  ok("after a wake-up: a tool result does not repeat the note", hook("PostToolUse", sid) === null && left().length === 1);
  fs.appendFileSync(hookT, line({ type: "user", message: { content: "[note w10] woken" } }));
  ok("after a wake-up: the marker confirms it", hook("PostToolUse", sid) === null && left().length === 0);
  put([note("lost", { id: "w11", seen: Date.now() - 11 * 60e3, via: "watch", tries: 1, transcript: hookT })]);
  o = hook("PostToolUse", sid);
  ok("after a wake-up: one that never showed is carried again", o?.hookSpecificOutput?.additionalContext?.includes("lost"));
  fs.rmSync(inbox, { force: true });
}

fs.rmSync(home, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
