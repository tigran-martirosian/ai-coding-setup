#!/usr/bin/env node
// Test for projects/claude-settings/.claude/skills/full-review/review-scan.mjs: builds a small chats folder and checks the report.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCAN = fileURLToPath(new URL("../projects/claude-settings/.claude/skills/full-review/review-scan.mjs", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-scan-"));
const dir = path.join(root, "C--Projects-demo");
fs.mkdirSync(dir);

const t0 = Date.now() - 3600000;
const at = (s) => new Date(t0 + s * 1000).toISOString();
const usage = { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 400 };
const user = (s, text) => ({ type: "user", timestamp: at(s), cwd: "C:\\Projects\\demo", message: { content: text } });
const result = (s, id, text = "ok", bad = false) => ({ type: "user", timestamp: at(s), message: { content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: bad }] } });
const reply = (s, id, content) => ({ type: "assistant", timestamp: at(s), message: { id, model: "claude-opus-5-5", usage, content } });
const use = (id, name, input = {}) => ({ type: "tool_use", id, name, input });
const lines = [
  user(0, "build the thing"),
  reply(5, "m1", [{ type: "thinking", thinking: "", signature: "x" }, use("u1", "Read", { file_path: "a" })]),
  result(6, "u1"),
  reply(8, "m2", [use("u2", "Grep", { pattern: "x" })]),
  result(9, "u2"),
  reply(10, "m3", [use("u3", "Bash", { command: "ls -la && cat a.txt\n\n# WHAT THIS DOES: lists; nothing changes" })]),
  result(11, "u3"),
  reply(12, "m4", [use("u4", "Bash", { command: "node build.mjs" })]),
  result(72, "u4", "Exit code 1 boom", true),
  reply(73, "m5", [use("u5", "mcp__nimbalyst__AskUserQuestion", { questions: [] })]),
  result(373, "u5"),
  reply(375, "m6", [{ type: "text", text: "done" }]),
  user(400, "no, that is wrong"),
  reply(402, "m7", [{ type: "text", text: "sorry" }]),
  user(403, "[Request interrupted by user]"),
  user(410, "Okay, still wrong, fix it"),
  reply(412, "m8", [{ type: "text", text: "fixed" }]),
  user(420, "<task-notification>a background job ended</task-notification>"),
  reply(421, "m9", [{ type: "text", text: "noted" }]),
];
const write = (name, list) => fs.writeFileSync(path.join(dir, name), list.map((l) => JSON.stringify(l)).join("\n") + "\n");
write("aaaaaaaa-1.jsonl", lines);
write("bbbbbbbb-2.jsonl", lines.slice(0, 3)); // a resumed chat repeats the start of the first one

const run = (...extra) => spawnSync(process.execPath, [SCAN, "--root", root, ...extra], { encoding: "utf8" });
const out = run().stdout;
let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; console.log(`FAIL: ${name}`); } };

check("counts one chat, three turns, nine requests (the repeated chat is not counted twice)", /1 main chats, 3 turns, 9 requests/.test(out));
check("read-only shell counts as looking", /\| look \| [^|]+\| 3 \|/.test(out));
check("a command that runs something is 'run'", /\| run \| [^|]+\| 1 \|/.test(out));
check("form request is 'ask'", /\| ask \| [^|]+\| 1 \|/.test(out));
check("text-only requests are 'talk', also after a machine-made message", /\| talk \| [^|]+\| 4 \|/.test(out));
check("one looking stretch of three", /Looking stretches\*\* [^:]+: 1 stretches, 3 requests/.test(out));
check("Sonnet for everything is 40% less for an all-Opus week", /\| Sonnet runs everything \| \d+ \| −40% \|/.test(out));
check("context size per request", /an average request sent 1k tokens of context\. Requests sent with over 150k: 0, 0%/.test(out));
check("time waiting on a form goes to the user", /5\.0 min waiting for the user/.test(out));
check("shell time is counted", /shell commands \d+%/.test(out) && !/shell commands 0%/.test(out));
check("quick answer followed by a correction", /pushed back on: 1\./.test(out));
check("filler before the correction is skipped", /still wrong, fix it/.test(out));
check("interrupted reply", /Replies the user interrupted:\*\* 1;/.test(out));
check("thinking requests", /Requests with a thinking step: 1 of 9/.test(out));
check("failed calls per tool", /\| Bash \| 2 \| 1 \| 50% \|/.test(out));
check("error text with numbers folded", /1 times \(demo\): Bash: Exit code N boom/.test(out));
check("--project that matches nothing", /No turns in the last 7 days for "nothing"/.test(run("--project", "nothing").stdout));
check("missing folder fails with an error", spawnSync(process.execPath, [SCAN, "--root", path.join(root, "none")]).status === 1);

fs.rmSync(root, { recursive: true, force: true });
console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
