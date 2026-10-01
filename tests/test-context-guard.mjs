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

// /handoff offer: once per session, again after +100k
const sid = `test-${process.pid}`;
const bigger = transcript("bigger.jsonl", [asst(530000)]);
const ctx = (t) => { try { return JSON.parse(run({ prompt: "x", transcript_path: t, session_id: sid })).hookSpecificOutput.additionalContext; } catch { return ""; } };
check("first time: offers /handoff", /Offer a fresh session/.test(ctx(big)));
check("second time: doesn't offer again", /already offered at ~420k/.test(ctx(big)));
check("+100k later: offers again", /Offer a fresh session/.test(ctx(bigger)));
fs.rmSync(path.join(os.tmpdir(), "context-guard", `${sid}.json`), { force: true });

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
