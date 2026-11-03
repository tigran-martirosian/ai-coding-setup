// Tests for hooks/context-guard.mjs. Run: node tests/test-context-guard.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(new URL("../hooks/context-guard.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-guard-test-"));
const asst = (ctx, extra = {}) => JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5", usage: { input_tokens: 2, cache_read_input_tokens: ctx - 1002, cache_creation_input_tokens: 1000, output_tokens: 50 } }, ...extra });
const transcript = (name, lines) => { const f = path.join(dir, name); fs.writeFileSync(f, lines.join("\n") + "\n"); return f; };

const small = transcript("small.jsonl", [asst(50000)]);
const big = transcript("big.jsonl", [asst(50000), asst(420000), JSON.stringify({ type: "user", message: { content: "hi" } })]);
const near = transcript("near.jsonl", [asst(50000), asst(180000), JSON.stringify({ type: "user", message: { content: "hi" } })]);
// A subagent (sidechain) line after the main one must not count
const side = transcript("side.jsonl", [asst(120000), asst(600000, { isSidechain: true })]);

const run = (input, env = {}) => spawnSync("node", [HOOK], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, ...env } }).stdout;
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };

check("small context: silent", run({ prompt: "change the font", transcript_path: small }) === "");
const out = run({ prompt: "change the font", transcript_path: near });
let j = {};
try { j = JSON.parse(out); } catch {}
check("big context: warns the user", /~180k/.test(j.systemMessage ?? ""));
check("big context: tells Claude to batch", /\[context-guard\].*180k/s.test(j.hookSpecificOutput?.additionalContext ?? "") && /one Edit/.test(j.hookSpecificOutput.additionalContext));
check("event name set", j.hookSpecificOutput?.hookEventName === "UserPromptSubmit");
check("/commands are silent", run({ prompt: "/compact", transcript_path: near }) === "");
check("sidechain lines ignored", run({ prompt: "x", transcript_path: side }) === "");
check("missing transcript: silent", run({ prompt: "x", transcript_path: path.join(dir, "nope.jsonl") }) === "");
check("bad input: silent", spawnSync("node", [HOOK], { input: "not json", encoding: "utf8" }).stdout === "");
check("CONTEXT_GUARD=off", run({ prompt: "x", transcript_path: big }, { CONTEXT_GUARD: "off" }) === "");
check("CONTEXT_GUARD_K raises the limit", run({ prompt: "x", transcript_path: near }, { CONTEXT_GUARD_K: "500" }) === "");
check("CONTEXT_GUARD_K lowers the limit", run({ prompt: "x", transcript_path: small }, { CONTEXT_GUARD_K: "40" }) !== "");

// Automatic handoff at the end of a reply (Stop): once per session, again after +100k
const sid = `test-${process.pid}`;
const user = (text) => JSON.stringify({ type: "user", message: { content: text } }).replace('{"type"', '{"type"');
const mid = transcript("mid.jsonl", [asst(170000)]);
const over = transcript("over.jsonl", [asst(210000)]);
const bigger = transcript("bigger.jsonl", [asst(530000)]);
const stop = (t, extra = {}, env = {}) => run({ hook_event_name: "Stop", transcript_path: t, session_id: sid, ...extra }, env);
const reason = (o) => { try { return JSON.parse(o).reason ?? ""; } catch { return ""; } };
// The Stop hook only warns now (systemMessage, no block)
const warn = (o) => { try { return JSON.parse(o).systemMessage ?? ""; } catch { return ""; } };
const blocked = (o) => { try { return JSON.parse(o).decision === "block"; } catch { return false; } };
const ctx = (t) => { try { return JSON.parse(run({ prompt: "x", transcript_path: t, session_id: sid })).hookSpecificOutput.additionalContext; } catch { return ""; } };
const clear = () => fs.rmSync(path.join(os.tmpdir(), "context-guard", `${sid}.json`), { force: true });
check("stop under the handoff limit: silent", stop(mid) === "" && stop(small) === "");
check("under the warning limit (140k): silent", run({ prompt: "x", transcript_path: transcript("low.jsonl", [asst(140000)]) }) === "");
const w210 = stop(over);
check("stop at 210k: warns, does not hold the reply (the limit is 200k)", /~210k/.test(warn(w210)) && !blocked(w210));
clear();
check("prompt between the limits: batches, no handoff line", /one Edit/.test(ctx(mid)) && !/fresh session/.test(ctx(mid)));
check("prompt over the limit: no turn-cap wording, no automatic handoff", !/turn-cap|CHILD JOB/.test(ctx(mid)) && !/without asking/.test(ctx(mid)));
// Under the compact line: warm -> batching only, Claude queues nothing; cold (idle over 60 min) -> fresh session
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const warmT = transcript("warm.jsonl", [asst(180000, { timestamp: ago(3) })]);
const coldT = transcript("cold.jsonl", [asst(180000, { timestamp: ago(90) })]);
const warmCtx = ctx(warmT);
check("warm cache: batching only, no /compact to queue", /one Edit/.test(warmCtx) && !/compact-self/.test(warmCtx) && !/fresh session/.test(warmCtx));
const coldCtx = ctx(coldT);
check("cold cache: fresh session, no /compact", /fresh session/.test(coldCtx) && /~90 min/.test(coldCtx) && !/compact-self/.test(coldCtx));
check("CONTEXT_GUARD_COLD_MIN moves the cold line", !/fresh session/.test((() => { try { return JSON.parse(run({ prompt: "x", transcript_path: coldT, session_id: sid }, { CONTEXT_GUARD_COLD_MIN: "120" })).hookSpecificOutput.additionalContext; } catch { return ""; } })()));
check("user line says what happens", /compacts itself at about 200k/.test(JSON.parse(run({ prompt: "x", transcript_path: warmT })).systemMessage) && /cache is cold/.test(JSON.parse(run({ prompt: "x", transcript_path: coldT })).systemMessage));
// At the compact line Claude Code compacts before it answers, warm or cold: the hook only says so
const at250 = transcript("at250.jsonl", [asst(250000)]);
const first = JSON.parse(run({ prompt: "x", transcript_path: at250 }));
check("over the compact line: says it compacts first, tells Claude nothing", /~250k/.test(first.systemMessage) && /compacts itself first/.test(first.systemMessage) && !first.hookSpecificOutput);
const coldBig = JSON.parse(run({ prompt: "x", transcript_path: transcript("coldbig.jsonl", [asst(250000, { timestamp: ago(90) })]) }));
check("over the compact line and cold: compacts first, no move to a fresh session", /compacts itself first/.test(coldBig.systemMessage) && !coldBig.hookSpecificOutput);
check("CONTEXT_GUARD_COMPACT_K moves the compact line", /one Edit/.test((() => { try { return JSON.parse(run({ prompt: "x", transcript_path: at250 }, { CONTEXT_GUARD_COMPACT_K: "500" })).hookSpecificOutput.additionalContext; } catch { return ""; } })()));
const failed = JSON.parse(run({ prompt: "x", transcript_path: big }));
check("at the safety net: says the compact has not run, and the batching advice is back", /has not run/.test(failed.systemMessage) && /one Edit/.test(failed.hookSpecificOutput?.additionalContext ?? ""));
// PreCompact: an automatic compact gets the focus line, a /compact by hand keeps its own
const pre = (trigger, env = {}) => run({ hook_event_name: "PreCompact", trigger, transcript_path: big }, env);
check("automatic compact: prints the focus line", /Keep every message the user typed, quoted/.test(pre("auto")) && /unconfirmed/.test(pre("auto")));
check("/compact by hand: nothing added", pre("manual") === "");
check("PreCompact: CONTEXT_GUARD=off", pre("auto", { CONTEXT_GUARD: "off" }) === "");
check("stop while a stop hook is already running: silent", stop(big, { stop_hook_active: true }) === "");
check("CONTEXT_GUARD_AUTO=off: stop is silent", stop(big, {}, { CONTEXT_GUARD_AUTO: "off" }) === "");
check("CONTEXT_GUARD_AUTO_K raises the handoff limit", stop(big, {}, { CONTEXT_GUARD_AUTO_K: "500" }) === "");
const held = stop(big);
check("stop at the safety net: only warns, says the compact has not run, no turn-cap wording", !blocked(held) && /~420k/.test(warn(held)) && /has not run/.test(warn(held)) && !/turn-cap|CHILD JOB/.test(warn(held)));
clear();
check("stop at 210k: says the next message compacts", /compacts itself before the next message/.test(warn(stop(over))));
clear();
check("stop at 195k: over the compact line, so it says so too", /~195k/.test(warn(stop(transcript("at195.jsonl", [asst(195000)])))));
clear();
stop(big);
check("second stop: silent", stop(big) === "");
check("prompt after a warning: still says it compacts first", /compacts itself first/.test(JSON.parse(run({ prompt: "x", transcript_path: at250, session_id: sid })).systemMessage));
check("prompt back under the limit clears the warning, so the next cycle warns again", (run({ prompt: "x", transcript_path: small, session_id: sid }), !fs.existsSync(path.join(os.tmpdir(), "context-guard", `${sid}.json`))) && /~420k/.test(warn(stop(big))));
clear();
check("+100k later: warns again", /~530k/.test(warn(stop(bigger))));
clear();
stop(over);
check("a smaller size after a warning is a new climb: warns again", /~195k/.test(warn(stop(transcript("again195.jsonl", [asst(195000)])))));
clear();
// A turn that already handed off (the user ran /handoff) is not held
const call = (cmd) => JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5", content: [{ type: "tool_use", name: "Bash", input: { command: cmd } }], usage: { input_tokens: 2, cache_read_input_tokens: 300000, cache_creation_input_tokens: 0 } } });
const handed = transcript("handed.jsonl", [user("/handoff"), call("node ~/.claude/skills/handoff/handoff-brief.mjs"), asst(300000)]);
const earlier = transcript("earlier.jsonl", [user("x"), call("node ~/.claude/skills/handoff/handoff-brief.mjs"), user("go on"), call("ls"), asst(300000)]);
check("this turn already handed off: silent", stop(handed) === "");
clear();
check("a handoff in an earlier turn doesn't count", /~300k/.test(warn(stop(earlier))));
clear();

// Mid-run (PostToolUse): the safety net, over 300k when no automatic compact ran; once, again after +100k
const post = (t, id, env = {}) => run({ hook_event_name: "PostToolUse", transcript_path: t, session_id: id }, env);
const runId = `run-test-${process.pid}`;
const runFile = path.join(os.tmpdir(), "context-guard", `run-${runId}.json`);
fs.rmSync(runFile, { force: true });
const below = transcript("below.jsonl", [asst(290000)]);
const at320 = transcript("at320.jsonl", [asst(320000)]);
const at380 = transcript("at380.jsonl", [asst(380000)]);
const at430 = transcript("at430.jsonl", [asst(430000)]);
const midCtx = (o) => { try { return JSON.parse(o).hookSpecificOutput?.additionalContext ?? ""; } catch { return ""; } };
check("mid-run under 300k: silent", post(below, runId) === "");
check("mid-run over 300k: says the compact did not run, tells Claude to finish, stop and queue one", /320k.*has not run.*Finish the step.*Start nothing new.*compact-self\.mjs.*Keep every message/s.test(midCtx(post(at320, runId))));
check("mid-run: not repeated within 100k", post(at380, runId) === "");
check("mid-run: repeated after +100k", /430k/.test(midCtx(post(at430, runId))));
check("mid-run: CONTEXT_GUARD_RUN_K raises the limit", post(transcript("at900.jsonl", [asst(900000)]), "other-" + runId, { CONTEXT_GUARD_RUN_K: "950" }) === "");
check("mid-run: CONTEXT_GUARD=off", post(at430, "off-" + runId, { CONTEXT_GUARD: "off" }) === "");
check("mid-run: a subagent's call is silent", run({ hook_event_name: "PostToolUse", transcript_path: at430, session_id: "agent-" + runId, agent_id: "a1" }) === "");
const noUsage = transcript("nousage.jsonl", [JSON.stringify({ type: "user", message: { content: "hi" } })]);
post(noUsage, runId);
check("mid-run: no usage line keeps the warning state", fs.existsSync(runFile));
fs.rmSync(runFile, { force: true });

// A compact after the last API call: the old usage lines no longer describe the session
const boundary = JSON.stringify({ type: "system", subtype: "compact_boundary", compactMetadata: { preTokens: 332000, postTokens: 11000 } });
const hi = JSON.stringify({ type: "user", message: { content: "hi" } });
const compacted = transcript("compacted.jsonl", [asst(332000), boundary, hi]);
const regrown = transcript("regrown.jsonl", [asst(332000), boundary, hi, asst(260000)]);
const mentioned = transcript("mentioned.jsonl", [asst(332000), JSON.stringify({ type: "assistant", message: { content: '"compact_boundary"' } })]);
const sysMsg = (o) => { try { return JSON.parse(o).systemMessage ?? ""; } catch { return ""; } };
check("just compacted: the old size is not reported", run({ prompt: "x", transcript_path: compacted }) === "");
check("just compacted: stop is silent", run({ hook_event_name: "Stop", transcript_path: compacted, session_id: `c-${sid}` }) === "");
check("after a compact: a new call's size counts", /~260k/.test(sysMsg(run({ prompt: "x", transcript_path: regrown }))));
check("text that only names the marker changes nothing", /~332k/.test(sysMsg(run({ prompt: "x", transcript_path: mentioned }))));
const climb = `climb-${runId}`;
post(at320, climb);
check("mid-run: a compact clears the warning, so the next climb warns again", post(compacted, climb) === "" && /320k/.test(midCtx(post(at320, climb))));
fs.rmSync(path.join(os.tmpdir(), "context-guard", `run-${climb}.json`), { force: true });

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
