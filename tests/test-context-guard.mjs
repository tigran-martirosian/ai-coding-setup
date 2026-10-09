// Tests for hooks/context-guard.mjs. Run: node test-context-guard.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/context-guard.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-guard-test-"));
const asst = (ctx, extra = {}) => JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5", usage: { input_tokens: 2, cache_read_input_tokens: ctx - 1002, cache_creation_input_tokens: 1000, output_tokens: 50 } }, ...extra });
const transcript = (name, lines) => { const f = path.join(dir, name); fs.writeFileSync(f, lines.join("\n") + "\n"); return f; };

const small = transcript("small.jsonl", [asst(50000)]);
const big = transcript("big.jsonl", [asst(50000), asst(420000), JSON.stringify({ type: "user", message: { content: "hi" } })]);
// A subagent (sidechain) line after the main one must not count
const side = transcript("side.jsonl", [asst(120000), asst(600000, { isSidechain: true })]);

const run = (input, env = {}) => spawnSync("node", [HOOK], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, ...env } }).stdout;
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };

check("small context: silent", run({ prompt: "change the font", transcript_path: small }) === "");
const out = run({ prompt: "change the font", transcript_path: big });
let j = {};
try { j = JSON.parse(out); } catch {}
check("big context: warns the user", /~420k/.test(j.systemMessage ?? ""));
check("big context: tells Claude to batch", /\[context-guard\].*420k/s.test(j.hookSpecificOutput?.additionalContext ?? "") && /one Edit/.test(j.hookSpecificOutput.additionalContext));
check("event name set", j.hookSpecificOutput?.hookEventName === "UserPromptSubmit");
check("/commands are silent", run({ prompt: "/compact", transcript_path: big }) === "");
check("sidechain lines ignored", run({ prompt: "x", transcript_path: side }) === "");
check("missing transcript: silent", run({ prompt: "x", transcript_path: path.join(dir, "nope.jsonl") }) === "");
check("bad input: silent", spawnSync("node", [HOOK], { input: "not json", encoding: "utf8" }).stdout === "");
check("CONTEXT_GUARD=off", run({ prompt: "x", transcript_path: big }, { CONTEXT_GUARD: "off" }) === "");
check("CONTEXT_GUARD_K raises the limit", run({ prompt: "x", transcript_path: big }, { CONTEXT_GUARD_K: "500" }) === "");
check("CONTEXT_GUARD_K lowers the limit", run({ prompt: "x", transcript_path: small }, { CONTEXT_GUARD_K: "40" }) !== "");

// Automatic handoff at the end of a reply (Stop): once per session, again after +100k
const sid = `test-${process.pid}`;
const user = (text) => JSON.stringify({ type: "user", message: { content: text } }).replace('{"type"', '{"type"');
const mid = transcript("mid.jsonl", [asst(170000)]);
const over = transcript("over.jsonl", [asst(210000)]);
const bigger = transcript("bigger.jsonl", [asst(530000)]);
const stop = (t, extra = {}, env = {}) => run({ hook_event_name: "Stop", transcript_path: t, session_id: sid, ...extra }, env);
const reason = (o) => { try { return JSON.parse(o).reason ?? ""; } catch { return ""; } };
const ctx = (t) => { try { return JSON.parse(run({ prompt: "x", transcript_path: t, session_id: sid })).hookSpecificOutput.additionalContext; } catch { return ""; } };
const clear = () => fs.rmSync(path.join(os.tmpdir(), "context-guard", `${sid}.json`), { force: true });
check("stop under the handoff limit: silent", stop(mid) === "" && stop(small) === "");
check("under the warning limit (140k): silent", run({ prompt: "x", transcript_path: transcript("low.jsonl", [asst(140000)]) }) === "");
check("stop at 210k: holds the reply (the limit is 200k)", /~210k/.test(reason(stop(over))));
clear();
check("prompt between the limits: batches, no handoff line", /one Edit/.test(ctx(mid)) && !/fresh session/.test(ctx(mid)));
check("prompt over the handoff limit: hand off when done", /move the work to a fresh session without asking/.test(ctx(big)));
check("stop while a stop hook is already running: silent", stop(big, { stop_hook_active: true }) === "");
check("CONTEXT_GUARD_AUTO=off: stop is silent", stop(big, {}, { CONTEXT_GUARD_AUTO: "off" }) === "");
check("CONTEXT_GUARD_AUTO_K raises the handoff limit", stop(big, {}, { CONTEXT_GUARD_AUTO_K: "500" }) === "");
const held = stop(big);
check("stop over the limit: holds the reply and asks for the handoff", JSON.parse(held).decision === "block" && /~420k/.test(reason(held)) && /without asking/.test(reason(held)));
check("second stop: silent", stop(big) === "");
check("prompt after a handoff: don't hand off again", /already opened at ~420k/.test(ctx(big)));
check("+100k later: holds again", /~530k/.test(reason(stop(bigger))));
clear();
// A turn that already handed off (the user ran /handoff) is not held
const call = (cmd) => JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5", content: [{ type: "tool_use", name: "Bash", input: { command: cmd } }], usage: { input_tokens: 2, cache_read_input_tokens: 300000, cache_creation_input_tokens: 0 } } });
const handed = transcript("handed.jsonl", [user("/handoff"), call("node ~/.claude/skills/handoff/handoff-brief.mjs"), asst(300000)]);
const earlier = transcript("earlier.jsonl", [user("x"), call("node ~/.claude/skills/handoff/handoff-brief.mjs"), user("go on"), call("ls"), asst(300000)]);
check("this turn already handed off: silent", stop(handed) === "");
clear();
check("a handoff in an earlier turn doesn't count", JSON.parse(stop(earlier) || "{}").decision === "block");
clear();

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
