// Tests for scripts/usage-scan.mjs on a made-up transcripts folder.
// Run: node test-usage-scan.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/usage-scan.mjs", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-scan-test-"));
const proj = path.join(root, "C--Projects-demo");
fs.mkdirSync(path.join(proj, "s1", "subagents"), { recursive: true });

const T0 = Date.parse("2026-09-30T05:00:00Z");
const at = (min) => new Date(T0 + min * 60000).toISOString();
const usage = (inp, cr, out) => ({ input_tokens: inp, cache_creation_input_tokens: 0, cache_read_input_tokens: cr, output_tokens: out });
const asst = (min, id, u, content = [], model = "claude-opus-5-5") =>
  ({ type: "assistant", timestamp: at(min), message: { id, model, usage: u, content } });
const bash = (id, command, extra = {}) => ({ type: "tool_use", id, name: "Bash", input: { command, description: id, ...extra } });
const result = (min, id, text, is_error = false) =>
  ({ type: "user", timestamp: at(min), message: { content: [{ type: "tool_result", tool_use_id: id, content: text, is_error }] } });
const write = (file, lines) => fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

const wrapper = `run() { codex --search exec --skip-git-repo-check "$1" < /dev/null > "$2.txt"; }\nrun "a" x & run "b" y & run "c" z & wait`;
write(path.join(proj, "s1.jsonl"), [
  { type: "ai-title", aiTitle: "Demo session" },
  // same message id on two lines (two content blocks): counted once
  asst(0, "m1", usage(10, 1000, 90), [{ type: "text", text: "hi" }]),
  asst(0, "m1", usage(10, 1000, 90), [bash("b1", "cd x; codex exec --skip-git-repo-check 'q' < /dev/null")]),
  result(1, "b1", "answer"),
  asst(2, "m2", usage(0, 2000, 0), [bash("b2", wrapper)]),
  result(3, "b2", "done"),
  // mentions codex exec only as text inside sed: not a worker run
  asst(4, "m3", usage(0, 3000, 0), [bash("b3", "sed -i 's/codex exec -s/codex exec --skip -s/' f.md")]),
  result(4, "b3", ""),
  asst(5, "m4", usage(0, 4000, 0), [{ type: "tool_use", id: "a1", name: "Agent", input: { subagent_type: "Explore", prompt: "find" } }]),
  result(5, "a1", "PreToolUse:Agent hook error: [worker-nudge] Search/research subagents cost...", true),
  asst(6, "m5", usage(0, 5000, 0), [bash("b4", "agy -p 'read big.ts' --mode plan")]),
  result(7, "b4", "ok"),
  // after minute 30: outside a --minutes 30 window
  asst(45, "m6", usage(0, 100000, 0), []),
]);
write(path.join(proj, "s1", "subagents", "agent-x.jsonl"), [
  asst(10, "s-m1", usage(5, 500, 5), [], "claude-sonnet-5-5"),
  asst(50, "s-m2", usage(0, 700, 0), [], "claude-sonnet-5-5"),
]);
fs.writeFileSync(path.join(proj, "s1", "subagents", "agent-x.meta.json"), JSON.stringify({ agentType: "copy-humanizer" }));

const run = (...a) => JSON.parse(execFileSync("node", [SCRIPT, "--root", root, "--json", ...a], { encoding: "utf8" }));
let pass = 0, fail = 0;
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

const full = run("--session", "s1");
const s = full.sessions[0];
check("main tokens deduped by message id", s.main, 1100 + 2000 + 3000 + 4000 + 5000 + 100000);
check("main calls", s.calls, 6);
check("title", s.title, "Demo session");
check("max context", s.maxContext, 100000);
check("subagent type from meta", s.subagents[0].type, "copy-humanizer");
check("subagent tokens", s.subagents[0].tokens, 510 + 700);
check("total = main + subagents", full.totals.tokens, s.main + 1210);
check("codex processes (1 direct + 3 via wrapper, sed ignored)", full.workers.codexProcesses, 4);
check("agy processes", full.workers.agyProcesses, 1);
check("worker shell calls", full.workers.calls, 3);
check("web flag on wrapper call", full.workers.list.filter((w) => w.web).length, 1);
check("hook block counted", full.hooks["worker-nudge"]?.blocks, 1);
check("next step after block", full.hooks["worker-nudge"]?.next, { worker: 1 });

const win = run("--session", "s1", "--minutes", "30");
check("--minutes cuts main", win.sessions[0].main, 15100);
check("--minutes cuts subagent", win.sessions[0].subagents[0].tokens, 510);

const days = run("--since", "2026-09-30T00:00:00Z", "--until", "2026-09-30T05:20:00Z", "--project", "demo");
check("--since/--until window", days.totals.mainTokens, 15100);
check("--project filter excludes others", run("--project", "nomatch", "--days", "10000").totals.sessions, 0);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
