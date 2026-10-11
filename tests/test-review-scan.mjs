#!/usr/bin/env node
// Test for projects/claude-settings/.claude/skills/full-review/review-scan.mjs: builds a small chats folder and checks the report.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCAN = fileURLToPath(new URL("../projects/claude-settings/.claude/skills/full-review/review-scan.mjs", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-scan-"));
const dir = path.join(root, "C--Projects-demo");
fs.mkdirSync(dir);

const t0 = Date.now() - 3600000;
const at = (s) => new Date(t0 + s * 1000).toISOString();
const usage = { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 400 };
// a folder path in the form of the system the test runs on: the scan names the project by its last part
const cwd = process.platform === "win32" ? "C:\\Projects\\demo" : "/Projects/demo";
const user = (s, text) => ({ type: "user", timestamp: at(s), cwd, message: { content: text } });
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

// Helper rework: its own chats folder, so the counts above stay as they are.
// A clean (f1) | B (f2), touched again by helper C (f2) | D (f3), touched again by the lead | E (f4), the user pushes back
// F changed no file | G has no helper record | H (f5) stopped at its turn limit
const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "review-scan-rework-"));
const dir2 = path.join(root2, "C--Projects-demo");
const sub = path.join(dir2, "cccccccc-3", "subagents");
fs.mkdirSync(sub, { recursive: true });
const helper = (toolId, files) => {
  const rec = files.map((f, i) => ({ type: "assistant", isSidechain: true, timestamp: at(0), message: { id: `${toolId}-${i}`, model: "claude-sonnet-5-5", usage, content: [use(`${toolId}-t${i}`, "Write", { file_path: f })] } }));
  if (!files.length) rec.push({ type: "assistant", isSidechain: true, timestamp: at(0), message: { id: `${toolId}-r`, model: "claude-sonnet-5-5", usage, content: [use(`${toolId}-g`, "Read", { file_path: "x" })] } });
  fs.writeFileSync(path.join(sub, `agent-${toolId}.jsonl`), rec.map((l) => JSON.stringify(l)).join("\n") + "\n");
  fs.writeFileSync(path.join(sub, `agent-${toolId}.meta.json`), JSON.stringify({ agentType: "worker", description: `job ${toolId}`, toolUseId: toolId, model: "sonnet" }));
};
const spawn = (s, id, text = "report") => [reply(s, `m-${id}`, [use(id, "Agent", { description: `job ${id}`, subagent_type: "worker" })]), result(s + 1, id, text)];
helper("hA", ["C:\\p\\f1.txt"]); helper("hB", ["C:\\p\\f2.txt"]); helper("hC", ["c:/p/F2.txt"]); helper("hD", ["C:\\p\\f3.txt"]);
helper("hE", ["C:\\p\\f4.txt"]); helper("hF", []); helper("hH", ["C:\\p\\f5.txt"]); // hG gets no record
const rework = [
  user(0, "do the parts"), ...spawn(1, "hA"), ...spawn(3, "hB"), ...spawn(5, "hC"), ...spawn(7, "hD"),
  reply(9, "m-lead", [use("lead1", "Edit", { file_path: "C:\\p\\f3.txt" })]), result(10, "lead1"),
  reply(11, "m-end1", [{ type: "text", text: "done" }]),
  user(20, "thanks, next"), ...spawn(21, "hE"), reply(23, "m-end2", [{ type: "text", text: "done" }]),
  user(30, "no, wrong"), ...spawn(31, "hF"), ...spawn(33, "hG"),
  ...spawn(35, "hH", "NOTE: this agent stopped at its 25-turn limit before finishing. The text below is PARTIAL output."),
  reply(37, "m-end3", [{ type: "text", text: "ok" }]),
];
fs.writeFileSync(path.join(dir2, "cccccccc-3.jsonl"), rework.map((l) => JSON.stringify(l)).join("\n") + "\n");
const out2 = spawnSync(process.execPath, [SCAN, "--root", root2], { encoding: "utf8" }).stdout;
check("helper rework: 8 runs, 1 files unknown, 0 unparsable", /Helper runs \(Agent calls\) in the window: 8\. Files unknown [^:]+: 1, [^.]+\. Records that could not be parsed: 0\./.test(out2));
check("helper rework row: runs, unknown, no file, changed, clean, by helper, by lead, capped, pushed, tokens", /\| worker \/ Sonnet \| 7 \| 0 \| 1 \| 6 \| 2 \| 1 \| 1 \| 1 \| 1 \| 1k \| 4k \|/.test(out2));
check("a run with no helper record is its own row: model unknown, files unknown, left out of the rates", /\| worker \/ unknown \| 1 \| 1 \| 0 \| 0 \| 0 \|/.test(out2));
check("touched by the lead is listed with job and file", /\| demo \| \d{4}-\d\d-\d\d \| worker \/ Sonnet \| job hD \| c:\/p\/f3\.txt \|/.test(out2));
check("touched by a helper is listed (paths compare across slash and case)", /\| job hB \| c:\/p\/f2\.txt \|/.test(out2));
check("upper-bound line is printed", /Touched again is an upper bound: a planned second step on the same file counts too\./.test(out2));
// an unparsable helper record is counted and named
fs.appendFileSync(path.join(sub, "agent-hA.jsonl"), "{not json\n");
const out3 = spawnSync(process.execPath, [SCAN, "--root", root2], { encoding: "utf8" }).stdout;
check("unparsable helper record is counted and named", /could not be parsed: 1 \(agent-hA\.jsonl\)/.test(out3));

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(root2, { recursive: true, force: true });
console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
