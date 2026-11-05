// Tests for hooks/agent-run-log.mjs: one line per Agent call with the helper's model and effort. Run: node tests/test-agent-run-log.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(new URL("../hooks/agent-run-log.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-run-log-test-"));
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : extra ? `\n     ${extra}` : ""}`); };

// Home agents folder with a worker (sonnet/medium) and a planner with only a model.
const agents = path.join(tmp, "agents");
fs.mkdirSync(agents);
fs.writeFileSync(path.join(agents, "worker.md"), "---\nname: worker\nmodel: sonnet\neffort: medium\n---\nbody\n");
fs.writeFileSync(path.join(agents, "planner.md"), "﻿---\r\nname: planner\r\nmodel: fable\r\n---\r\nbody\r\n");
// A project that overrides the worker.
const project = path.join(tmp, "proj");
fs.mkdirSync(path.join(project, ".claude", "agents"), { recursive: true });
fs.writeFileSync(path.join(project, ".claude", "agents", "worker.md"), "---\nmodel: haiku\neffort: low\n---\n");
const bare = path.join(tmp, "bare");
fs.mkdirSync(bare);
// A transcript whose last assistant entry is Opus at high; a cut line first and a later user line.
const transcript = path.join(tmp, "t.jsonl");
fs.writeFileSync(transcript, [
  '{"cut line',
  JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5-5" }, effort: "low" }),
  JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5" }, effort: "high" }),
  JSON.stringify({ type: "user", message: { content: "assistant said" } }),
].join("\n") + "\n");

const run = (event, env = {}, log = path.join(tmp, "log.jsonl")) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof event === "string" ? event : JSON.stringify(event), encoding: "utf8",
    env: { ...process.env, AGENT_RUN_LOG_FILE: log, AGENT_RUN_LOG_AGENTS: agents, CLAUDE_PROJECT_DIR: "", ...env },
  });
  return r;
};
const last = (log = path.join(tmp, "log.jsonl")) => { const l = fs.readFileSync(log, "utf8").trim().split("\n"); return JSON.parse(l[l.length - 1]); };
const ev = (input, extra = {}) => ({ tool_name: "Agent", session_id: "s1", cwd: bare, transcript_path: transcript, tool_input: { description: "Read files: x", prompt: "p", ...input }, ...extra });

let r = run(ev({ subagent_type: "worker" }));
let l = last();
check("worker: home frontmatter model and effort", l.model === "sonnet" && l.effort === "medium", JSON.stringify(l));
check("no stdout (never rewrites the input)", r.stdout === "" && r.status === 0, r.stdout + r.stderr);
check("fields: session, cwd, description, type, ts", l.session === "s1" && l.cwd === bare && l.description === "Read files: x" && l.type === "worker" && !isNaN(Date.parse(l.ts)));

run(ev({ subagent_type: "worker", model: "opus" }));
l = last();
check("override model wins, effort from the file", l.model === "opus" && l.effort === "medium", JSON.stringify(l));

run(ev({ subagent_type: "worker" }), { CLAUDE_PROJECT_DIR: project });
l = last();
check("project agent file wins over home", l.model === "haiku" && l.effort === "low", JSON.stringify(l));

run(ev({ subagent_type: "planner" }));
l = last();
check("BOM + CRLF frontmatter; missing effort from the session", l.model === "fable" && l.effort === "high", JSON.stringify(l));

run(ev({ subagent_type: "Explore" }));
l = last();
check("unknown type: session model and effort from the transcript", l.model === "claude-opus-5-5" && l.effort === "high" && l.type === "Explore", JSON.stringify(l));

run(ev({}));
l = last();
check("no subagent_type counts as general-purpose", l.type === "general-purpose" && l.model === "claude-opus-5-5");

run(ev({ subagent_type: "fork" }, { transcript_path: undefined }), {});
l = last();
check("no transcript: model and effort null", l.model === null && l.effort === null, JSON.stringify(l));

run(ev({ subagent_type: "fork", description: "Gone transcript" }, { transcript_path: path.join(tmp, "gone.jsonl") }), {});
l = last();
check("missing transcript file: line still written, model null", l.description === "Gone transcript" && l.model === null, JSON.stringify(l));

const offLog = path.join(tmp, "off.jsonl");
run(ev({ subagent_type: "worker" }), { AGENT_RUN_LOG: "off" }, offLog);
check("AGENT_RUN_LOG=off writes nothing", !fs.existsSync(offLog));

const bashLog = path.join(tmp, "bash.jsonl");
run({ tool_name: "Bash", tool_input: { command: "ls" } }, {}, bashLog);
check("other tools ignored", !fs.existsSync(bashLog));

const junkLog = path.join(tmp, "junk.jsonl");
r = run("not json", {}, junkLog);
check("junk input fails open (exit 0, stderr line)", r.status === 0 && /agent-run-log hook skipped/.test(r.stderr) && !fs.existsSync(junkLog), r.stderr);

const trimLog = path.join(tmp, "trim.jsonl");
fs.writeFileSync(trimLog, Array.from({ length: 520 }, (_, i) => JSON.stringify({ n: i })).join("\n") + "\n");
run(ev({ subagent_type: "worker" }), {}, trimLog);
const kept = fs.readFileSync(trimLog, "utf8").trim().split("\n");
check("trim to the last 500 lines", kept.length === 500 && JSON.parse(kept[0]).n === 21 && JSON.parse(kept[499]).type === "worker", `${kept.length} ${kept[0]}`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
