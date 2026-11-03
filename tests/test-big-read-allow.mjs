// Tests for the prompt allowances in ~/.claude/hooks/big-read-gate.mjs. Run: node tests/test-big-read-allow.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(new URL("../hooks/big-read-gate.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "big-read-allow-test-"));
const ALLOW_FILE = path.join(dir, "allow.json");
const big = path.join(dir, "chunk1.txt");
const other = path.join(dir, "chunk2.txt");
fs.writeFileSync(big, "x".repeat(28000)); // one long line, over the 20 KB limit
fs.writeFileSync(other, "y".repeat(28000));
const fwd = (p) => p.replace(/\\/g, "/");

const run = (input) => {
  const r = spawnSync("node", [HOOK], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, BIG_READ_GATE: "", BIG_READ_ALLOW_FILE: ALLOW_FILE } });
  return r.stdout;
};
const read = (session, file) => run({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: file }, session_id: session, cwd: dir });
const shell = (session, file) => run({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `cat "${fwd(file)}"` }, session_id: session, cwd: dir });
const prompt = (session, text) => run({ hook_event_name: "UserPromptSubmit", prompt: text, session_id: session, cwd: dir });
const denied = (out) => out.includes('"permissionDecision":"deny"');
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };

// Without a prompt naming the file, the big read is still blocked
check("unnamed big file is blocked", denied(read("s1", big)));

// A prompt naming the file lets one read through, then it is blocked again
prompt("s1", `read ${fwd(big)} and tell me the first line`);
check("named big file passes the first read", !denied(read("s1", big)));
check("named big file is blocked again on the second read", denied(read("s1", big)));

// The allowance belongs to the session that named the file
prompt("s1", `read ${fwd(big)}`);
check("another session cannot use the allowance", denied(read("s2", big)));
check("the session that named it still can", !denied(read("s1", big)));

// A shell cat of the named file passes too
prompt("s1", `cat ${fwd(big)}`);
check("named big file passes a shell cat once", !denied(shell("s1", big)));
check("the shell cat is blocked on the next try", denied(shell("s1", big)));

// A file that was not named stays blocked, even after another file was named
prompt("s1", `read ${fwd(big)}`);
check("a file that was not named stays blocked", denied(read("s1", other)));

// A path with spaces is found when the prompt names it
const spaced = path.join(dir, "my notes", "big notes.txt");
fs.mkdirSync(path.dirname(spaced));
fs.writeFileSync(spaced, "z".repeat(28000));
prompt("s1", `read ${fwd(spaced)} and tell me the first line`);
check("a path with spaces passes when named", !denied(read("s1", spaced)));

// Text that is not an existing file is not recorded, and sessions left empty are dropped
prompt("s1", "see https://example.com/x and C:/no/such/file.txt");
const saved = JSON.parse(fs.readFileSync(ALLOW_FILE, "utf8"));
check("names that are not files are not recorded", !JSON.stringify(saved).includes("example") && !JSON.stringify(saved).includes("file.txt"));
check("sessions with no allowances left are dropped", Object.values(saved).every((l) => l.length > 0));

// Claude Code's own saved tool result is read where it tells the session to
const toolOut = path.join(dir, ".claude", "projects", "p", "s", "tool-results", "out.txt");
fs.mkdirSync(path.dirname(toolOut), { recursive: true });
fs.copyFileSync(big, toolOut);
check("a saved tool result is not refused", !denied(read("s9", toolOut)));

// A corrupt allowance file still blocks, says so on stderr, and the next prompt rewrites it
fs.writeFileSync(ALLOW_FILE, '{"s1":[]}garbage');
const corrupt = spawnSync("node", [HOOK], { input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: big }, session_id: "s1", cwd: dir }), encoding: "utf8", env: { ...process.env, BIG_READ_GATE: "", BIG_READ_ALLOW_FILE: ALLOW_FILE } });
check("corrupt allowance file still blocks", denied(corrupt.stdout));
check("corrupt allowance file is reported on stderr", corrupt.stderr.includes("not valid JSON"));
prompt("s1", `read ${fwd(big)}`);
check("a prompt rewrites the corrupt file and the named file passes", !denied(read("s1", big)));

// Small files were never blocked and still are not
fs.writeFileSync(path.join(dir, "small.txt"), "one line\n");
check("small file passes", !denied(read("s1", path.join(dir, "small.txt"))));

// A helper has no Agent tool, so its refusal does not offer one
const helperOut = run({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: other }, session_id: "s9", cwd: dir, agent_id: "sub-1" });
check("a helper's refusal offers no subagent", denied(helperOut) && !helperOut.includes("Agent tool"));
check("the main session's refusal still does", read("s9", other).includes("Agent tool"));

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
