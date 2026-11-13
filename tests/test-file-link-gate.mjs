// Tests for hooks/file-link-gate.mjs. Run: node tests/test-file-link-gate.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/file-link-gate.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-link-gate-test-"));
const CWD = "C:\\Projects\\my project";
const HOME = os.homedir().replace(/\\/g, "/").replace(/ /g, "%20");
const run = (input, env = {}) => {
  const t0 = Date.now();
  const r = spawnSync("node", [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, FILE_LINK_GATE: "", ...env } });
  return { out: r.stdout, ms: Date.now() - t0 };
};
const reasonOf = (out) => { try { const j = JSON.parse(out); return j.decision === "block" ? j.reason : null; } catch { return null; } };
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };

// A transcript: a user prompt, an assistant text + tool call, a tool result, then the final text
let n = 0;
const transcript = (texts, { before = [] } = {}) => {
  const lines = [];
  const add = (e) => lines.push(JSON.stringify(e));
  for (const t of before) add({ type: "assistant", message: { content: [{ type: "text", text: t }] } });
  add({ type: "user", message: { role: "user", content: "please do the thing" }, cwd: CWD });
  texts.forEach((t, i) => {
    add({ type: "assistant", message: { content: [{ type: "text", text: t }, ...(i < texts.length - 1 ? [{ type: "tool_use", id: `t${i}`, name: "Read", input: {} }] : [])] } });
    if (i < texts.length - 1) add({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "file text" }] } });
  });
  const file = path.join(dir, `t${n++}.jsonl`);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
};
const stop = (texts, extra = {}, env = {}) => run({ transcript_path: transcript(texts, extra), cwd: CWD, stop_hook_active: false, ...extra.input }, env);

// Each broken form is blocked, with the fixed form in the reason
const broken = [
  ["relative", "See [the plan](docs/plan.md) for details.", "(/C:/Projects/my%20project/docs/plan.md)"],
  ["relative with ./ and a line", "Fixed in [hook.mjs](./hooks/hook.mjs:42).", "(/C:/Projects/my%20project/hooks/hook.mjs:42)"],
  ["a file name with a line, no folder", "See [readme](README.md:10).", "(/C:/Projects/my%20project/README.md:10)"],
  ["relative with %20","Open [notes](my%20notes/a.md).", "(/C:/Projects/my%20project/my%20notes/a.md)"],
  ["backslash", "Saved to [report](C:\\Users\\you\\Desktop\\report.md).", "(/C:/Users/you/Desktop/report.md)"],
  ["backslash with a space", "See [x](C:\\Projects\\my projects\\a.md).", "(/C:/Projects/my%20projects/a.md)"],
  ["backslash in angle brackets", "See [x](<C:\\a b\\c.md>).", "(/C:/a%20b/c.md)"],
  ["relative with a plain title", "See [plan](docs/plan.md \"the plan\").", "(/C:/Projects/my%20project/docs/plan.md)"],
  ["file:///", "Open [x](file:///C:/Projects/a.md).", "(/C:/Projects/a.md)"],
  ["file:/// with %20", "Open [x](file:///C:/Program%20Files/a.txt).", "(/C:/Program%20Files/a.txt)"],
  ["home ~", "See [settings](~/.claude/settings.json).", `(${HOME.startsWith("/") ? "" : "/"}${HOME}/.claude/settings.json)`],
];
for (const [name, text, fixed] of broken) {
  const r = reasonOf(stop([text]).out);
  check(`blocks ${name}`, !!r && r.includes(fixed));
  if (r && !r.includes(fixed)) console.log("     reason was:", r);
}

// A Mac or Linux session: relative links resolve against its cwd, with no drive letter
const mac = reasonOf(run({ last_assistant_message: "See [x](docs/a.md).", cwd: "/Users/you/my project" }).out) || "";
check("blocks relative in a Mac session, fixed to /Users/...", mac.includes("(/Users/you/my%20project/docs/a.md)"));
// Git Bash paths and a \\server share as the cwd
const fixedFor = (text, cwd) => reasonOf(run({ last_assistant_message: text, cwd }).out) || "";
check("blocks a Git Bash /c/ link, fixed to /C:/", fixedFor("See [x](/c/Users/you/a.md).", CWD).includes("(/C:/Users/you/a.md)"));
check("a Git Bash cwd resolves to /C:/", fixedFor("See [x](docs/a.md).", "/c/Projects/x").includes("(/C:/Projects/x/docs/a.md)"));
check("a \\\\server share cwd stays a share", fixedFor("See [x](docs/a.md).", "\\\\server\\share\\proj").includes("(//server/share/proj/docs/a.md)"));

// Each working form passes
const working = [
  ["Mac /Users/ form", "See [plan](/Users/you/docs/plan.md)."],
  ["web link with a port", "See [local](http://localhost:3000) and [x](https://example.com:8080)."],
  ["/C:/ form", "See [plan](/C:/Projects/my%20project/docs/plan.md)."],
  ["C:/ form", "See [plan](C:/Projects/a.md)."],
  ["raw space", "See [plan](/C:/Projects/my project/a.md)."],
  ["line suffix", "See [plan.md:10](/C:/Projects/a/plan.md:10)."],
  ["plain path in backticks", "Edited `C:\\Projects\\a\\plan.md` and `docs/plan.md`."],
  ["web, mailto, nimbalyst, anchor", "[site](https://example.com/a.md) [m](mailto:a@b.c) [NIM-1](nimbalyst://NIM-1) [up](#top) [h](http://x.y/docs/a.md)"],
  ["an image", "![shot](docs/shot.png)"],
  ["a Nimbalyst embed", "[Mockup](docs/screen.mockup.html \"width=1000 height=650\")"],
  ["no links", "Done, all tests pass."],
];
for (const [name, text] of working) check(`passes ${name}`, stop([text]).out === "");

// Code is ignored
check("ignores a fenced block", stop(["Example:\n```md\n[x](docs/a.md)\n[y](C:\\a\\b.md)\n```\nDone."]).out === "");
check("ignores a ~~~ fence", stop(["~~~\n[x](docs/a.md)\n~~~"]).out === "");
check("ignores an inline code span", stop(["Write it as `[x](docs/a.md)`, not like that."]).out === "");
check("still blocks after a closed fence", !!reasonOf(stop(["```\ncode\n```\nSee [x](docs/a.md)."]).out));

// The whole turn counts, earlier turns do not
check("blocks a bad link in text before a tool call", !!reasonOf(stop(["Reading [x](docs/a.md) now.", "All done."]).out));
check("ignores a bad link from an earlier turn", stop(["All done."], { before: ["Earlier: [x](docs/a.md)"] }).out === "");
check("uses last_assistant_message too", !!reasonOf(stop(["All done."], { input: { last_assistant_message: "See [x](docs/a.md)." } }).out));

// Loop guard, off switch, bad input, speed
check("second stop passes (stop_hook_active)", stop(["See [x](docs/a.md)."], { input: { stop_hook_active: true } }).out === "");
check("FILE_LINK_GATE=off passes", stop(["See [x](docs/a.md)."], {}, { FILE_LINK_GATE: "off" }).out === "");
check("bad input fails open", run("not json").out === "");
check("missing transcript fails open", run({ transcript_path: path.join(dir, "nope.jsonl"), cwd: CWD }).out === "");
check("no cwd: still blocks, says to use the absolute path", /absolute path/.test(reasonOf(run({ last_assistant_message: "See [x](docs/a.md)." }).out) || ""));
const lines = [];
for (let i = 0; i < 4000; i++) lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "x".repeat(1000) }] } }));
lines.push(JSON.stringify({ type: "user", message: { content: "go" } }), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "[x](docs/a.md)" }] } }));
const big = path.join(dir, "big.jsonl");
fs.writeFileSync(big, lines.join("\n") + "\n");
const timed = run({ transcript_path: big, cwd: CWD });
check(`4 MB transcript blocks in ${timed.ms} ms (node start included, under 500)`, !!reasonOf(timed.out) && timed.ms < 500);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
