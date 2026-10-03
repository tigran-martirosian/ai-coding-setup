// Tests for hooks/board-nudge.mjs. Run: node tests/test-board-nudge.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/board-nudge.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-nudge-test-"));
const HOUR = 60 * 60 * 1000;
// A project folder with n transcripts created just now, plus its own state folder
const project = (name, n) => {
  const p = path.join(dir, name);
  fs.mkdirSync(p, { recursive: true });
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(p, `s${i}.jsonl`), "{}\n");
  fs.writeFileSync(path.join(p, "notes.txt"), "not a transcript");
  return { transcript: path.join(p, "s0.jsonl"), stateDir: path.join(dir, `${name}-state`), stateFile: path.join(dir, `${name}-state`, `${name}.json`) };
};
const NIMBALYST = { CLAUDE_CODE_ENTRYPOINT: "sdk-cli", BOARD_NUDGE: "", BOARD_NUDGE_N: "" };
const run = (p, prompt, env = {}) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ prompt, transcript_path: p.transcript }), encoding: "utf8", env: { ...process.env, ...NIMBALYST, BOARD_NUDGE_DIR: p.stateDir, ...env } }).stdout;
const setState = (p, s) => { fs.mkdirSync(p.stateDir, { recursive: true }); fs.writeFileSync(p.stateFile, JSON.stringify(s)); };
const getState = (p) => { try { return JSON.parse(fs.readFileSync(p.stateFile, "utf8")); } catch { return {}; } };
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };

const few = project("few", 5);
check("few sessions: silent", run(few, "change the font") === "");

const many = project("many", 22);
const out = run(many, "change the font");
let j = {};
try { j = JSON.parse(out); } catch {}
check("many sessions: tells the user", /about 22 new sessions/.test(j.systemMessage ?? ""));
check("many sessions: has Claude offer /board-cleanup", /\[board-nudge\].*22 sessions/s.test(j.hookSpecificOutput?.additionalContext ?? "") && /\/board-cleanup/.test(j.hookSpecificOutput.additionalContext));
check("tells Claude to open its own session", /isolated: true/.test(j.hookSpecificOutput?.additionalContext ?? ""));
check("event name set", j.hookSpecificOutput?.hookEventName === "UserPromptSubmit");
check("only .jsonl files count", !/23/.test(j.systemMessage ?? ""));
check("second prompt the same day: silent", run(many, "and the colour") === "");
setState(many, { nudgedAt: Date.now() - 25 * HOUR });
check("a day later: nudges again", run(many, "x") !== "");

const cleaned = project("cleaned", 22);
setState(cleaned, { cleanedAt: Date.now() + HOUR });
check("sessions from before the last cleanup don't count", run(cleaned, "x") === "");
setState(cleaned, { cleanedAt: Date.now() - HOUR });
check("sessions since the last cleanup count", /cleanup on \d{4}-\d\d-\d\d/.test(run(cleaned, "x")));

const reset = project("reset", 22);
check("/board-cleanup: silent", run(reset, "/board-cleanup") === "");
check("/board-cleanup records the cleanup", getState(reset).cleanedAt > Date.now() - HOUR && !getState(reset).nudgedAt);
setState(reset, { nudgedAt: Date.now() });
run(reset, "/planning:session-cleanup");
check("/planning:session-cleanup resets too", getState(reset).cleanedAt > 0 && !getState(reset).nudgedAt);

const other = project("other", 22);
check("other /commands: silent, no state", run(other, "/compact") === "" && !fs.existsSync(other.stateFile));
check("outside Nimbalyst: silent", run(other, "x", { CLAUDE_CODE_ENTRYPOINT: "cli" }) === "");
check("BOARD_NUDGE=off", run(other, "x", { BOARD_NUDGE: "off" }) === "");
check("BOARD_NUDGE_N raises the limit", run(other, "x", { BOARD_NUDGE_N: "50" }) === "");
check("BOARD_NUDGE_N lowers the limit", run(few, "x", { BOARD_NUDGE_N: "3" }) !== "");
check("bad input: silent", spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8", env: { ...process.env, ...NIMBALYST } }).stdout === "");
check("missing project folder: silent", spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ prompt: "x", transcript_path: path.join(dir, "nope", "a.jsonl") }), encoding: "utf8", env: { ...process.env, ...NIMBALYST, BOARD_NUDGE_DIR: path.join(dir, "nope-state") } }).stdout === "");

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
