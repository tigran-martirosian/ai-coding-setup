// Tests for workers/agy-gate.mjs, the Antigravity hook behind ask.mjs. Run: node tests/test-agy-gate.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../workers/agy-gate.mjs", import.meta.url));
const ask = (toolCall, env = {}) => JSON.parse(spawnSync(process.execPath, [HOOK], { input: typeof toolCall === "string" ? toolCall : JSON.stringify({ toolCall }), env: { ...process.env, ASK_AGY_GATE: "1", ASK_AGY_ENV_OK: "", ...env }, encoding: "utf8" }).stdout).decision;
let fail = 0, total = 0;
const report = (ok, name) => { total++; if (!ok) fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
const read = (path) => ({ name: "read_file", args: { path } });
const run = (command) => ({ name: "run_command", args: { command } });

for (const p of ["C:/x/.env", "C:\\x\\.env", ".env", "C:\\x\\.env.local", "/a/b/.env.production", "C:/x/.env/"]) report(ask(read(p)) === "deny", `refused: ${p}`);
for (const c of ["cat .env", "type .env", "type C:\\x\\.env", "cat .env | head", "cat ./.env.local", "Get-Content \".env\"", "sh -c 'cat .env'", "x=$(cat .env)"]) report(ask(run(c)) === "deny", `refused: ${c}`);
for (const p of ["C:/x/note.txt", "C:/x/env.md", "C:/x/.environment", "C:/x/my.env.md", "C:/x/.envrc"]) report(ask(read(p)) === "allow", `allowed: ${p}`);
report(ask(run("node --version")) === "allow", "a plain command is allowed");
report(ask(read("C:\\x\\.env"), { ASK_AGY_ENV_OK: "1" }) === "allow", "a run with --allow-env may read it");
report(ask("{}") === "deny" && ask(JSON.stringify({ tool_call: { name: "search_web" } })) === "deny", "a call with no tool name in the known place is refused");
report(ask({ name: "view_file", input: { AbsolutePath: "C:/x/.env" } }) === "deny", "another tool name and another field still can't reach .env");
report(ask({ name: "read_url_content", args: { Url: "https://x.example" } }) === "deny" && ask({ name: "browser_open", args: {} }) === "deny", "page reading and the browser are refused");
report(ask(run("cat .env*")) === "deny", "refused: a wildcard after .env");
report(ask({ name: "search_web", args: { query: "x" } }, { ASK_AGY_ENV_OK: "1" }) === "deny", "web search is refused either way");
report(ask({ name: "invoke_subagent", args: {} }) === "deny", "a subagent is refused");
report(ask("not json") === "deny", "input it can't read is refused");
report(ask(read("C:/x/.env"), { ASK_AGY_GATE: "" }) === "allow", "agy run outside ask.mjs is not touched");
console.log(fail ? `${fail} of ${total} failed` : `all ${total} passed`);
process.exit(fail ? 1 : 0);
