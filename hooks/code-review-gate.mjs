#!/usr/bin/env node
// code-review-gate: asks for one `reviewer` agent when a session's change is big enough to need one. Three arms:
// - Stop (no argument): blocks once per turn while a review is due: 2+ helper steps edited code, 10+ code files since the
//   last review, or a change to hooks, rules, agents, skills, settings or CI. A reply ending in a question passes.
// - --pre (PreToolUse, Bash/PowerShell): denies a git push, gh release, npm publish or REVIEW_PUSH_PATTERN while one is due.
// - --start (SessionStart): stores git's HEAD and dirty files, so files changed by sed or a script count too.
// CODE_REVIEW_GATE=off disables it, =led asks only for a job of several helper steps (env, or the project's settings env);
// CODE_REVIEW_MIN_FILES changes the 10. Evidence: lib/review-evidence.mjs; decision: lib/review-decide.mjs. Fails open.
import { emit, isMain, runHook } from "./lib/hook-io.mjs";
import { sessionKey } from "./lib/paths.mjs";
import { assess } from "./lib/review-decide.mjs";
import { baseline, gatePaths, gather } from "./lib/review-evidence.mjs";
import { setting } from "./lib/settings-env.mjs";
import { readJson, writeJson } from "./lib/state.mjs";
import fs from "node:fs";
import path from "node:path";

const nameList = (names) => names.length > 6 ? `${names.slice(0, 6).join(", ")} and ${names.length - 6} more` : names.join(", ");
const countOf = (n, what = "") => `${n} ${what}file${n === 1 ? "" : "s"}`;

// A command that publishes work: a push, a release or a package publish, in a longer command too (GH_TOKEN=x git push ...).
// Quoted text is not looked at, so a commit message that says "git push" passes; a shell started with -c is looked at whole
const LEAD = "(?:^|[\\s;&|(`\"'/\\\\])"; // a slash for /usr/bin/git
const PUBLISH = [new RegExp(`${LEAD}git(?:\\.exe)?(?:\\s+-\\S+(?:\\s+[^\\s-]\\S*)?)*\\s+push\\b`), new RegExp(`${LEAD}gh(?:\\.exe)?\\s+release\\s+(?:create|upload|edit)\\b`), new RegExp(`${LEAD}npm(?:\\.cmd)?\\s+publish\\b`)];
export function isPush(text) {
  const command = text.replace(/^\s*#.*$/gm, ""); // a comment line, such as the one that explains the command, is not a command
  const wrapped = /\b(?:bash|sh|zsh|pwsh|powershell|cmd)(?:\.exe)?\s+(?:-\w*c\b|\/c\b)/i.test(command);
  const bare = wrapped ? command : command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  if (PUBLISH.some((re) => re.test(bare))) return true;
  const own = setting("REVIEW_PUSH_PATTERN");
  if (!own) return false;
  // Quoted text is skipped here too: a grep for 'deploy.py send' is a search, not a deploy
  try { return new RegExp(own, "i").test(bare); } catch { return false; } // a pattern that doesn't parse is no pattern
}

// The deny reason offers CODE_REVIEW_GATE=off "for this run": a prefix on the command itself never reaches this hook's
// own environment, so it is read from the command (a deploy after its one review was blocked twice without this).
// A comment line or quoted text (a commit message) is not an assignment; a quoted value right after = is.
export function offInCommand(command) {
  const bare = command.replace(/^\s*#.*$/gm, "").replace(/(=\s*)?("(?:[^"\\]|\\.)*"|'[^']*')/g, (m, eq) => (eq ? m : '""'));
  return /(?:^|[\s;&|])(?:\$env:)?CODE_REVIEW_GATE\s*=\s*["']?off\b/im.test(bare);
}

// The state assess asks for: a hold a review has ended, and the git baseline (a new one, or what this stop has seen)
const keep = (r, files) => {
  if (r.dropHeld) fs.rmSync(files.held, { force: true });
  if (r.writeBase) writeJson(files.base, r.writeBase);
};

// SessionStart: the baseline. A resumed or compacted session keeps the one it has
function startArm(input) {
  const file = gatePaths(input.session_id).base;
  if (fs.existsSync(file)) return;
  const base = baseline(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd(), input.transcript_path);
  if (base) writeJson(file, base);
}

// PreToolUse (Bash, PowerShell): no push, release or publish while a review is due and none ran since, by a helper either.
// It counts the whole session since the last review, and the once-per-turn marker doesn't apply
function pushCheck(input, mode) {
  const command = String(input.tool_input?.command || "");
  if (!/^(Bash|PowerShell)$/.test(input.tool_name) || !isPush(command)) return;
  if (offInCommand(command)) return;
  const r = assess(gather(input, mode, true));
  if (r.typed) return;
  keep(r, gatePaths(input.session_id));
  if (!r.due) return;
  const names = r.files.length ? r.files : r.setupFiles;
  emit.deny(`code-review-gate: a review is due before this push: ${countOf(names.length)} changed (${nameList(names)}) and no reviewer has looked since. ` +
    `Run one reviewer agent first (Agent tool, subagent_type "reviewer", with the request in the user's own words, every changed file by path and the checks that ran), fix what it finds, then push again. ` +
    `To turn this check off for this run: CODE_REVIEW_GATE=off in front of the command (or env, or env in the project's .claude/settings.json).`);
}

// Stop: one block per turn when a review is due. stop_hook_active alone is not enough to tell, since a block by any
// other Stop hook sets it too, so the marker file holds the turn this hook last blocked
function stopArm(input, mode) {
  const ev = gather(input, mode, false), r = assess(ev), files = gatePaths(input.session_id);
  const turnKey = ev.start?.uuid || ev.start?.timestamp || "no-typed-message";
  // A typed review is this turn, with its fixes: the marker starts the count again after it
  if (r.typed) { writeJson(files.marker, { typed: turnKey }); return; }
  keep(r, files);
  if (!r.due) return;
  const { setupFiles, held, big, several, setup } = r, codeFiles = r.files;
  if (readJson(files.marker)?.turn === turnKey) return;
  // What is due stays due after the answer, in the held file, until a review
  if (/\?\s*$/.test(String(input.last_assistant_message || ""))) { writeJson(files.held, { at: held?.at || Date.now(), files: codeFiles, setup: setupFiles }); return; }
  writeJson(files.marker, { turn: turnKey }); // throws when it can't be written, so no block that could repeat
  fs.rmSync(files.held, { force: true });
  const codeText = big || several || !setup;
  const total = codeText ? codeFiles.length : setupFiles.length;
  emit.block(`code-review-gate: ${codeText ? `this work changed ${countOf(codeFiles.length, "code ")} (${nameList(codeFiles)})${r.steps ? ` over ${r.steps} helper steps` : ""}` : `${held ? "this work" : "this turn"} changed ${countOf(setupFiles.length)}: hooks, rules, settings or CI files (${setupFiles.join(", ")})`} and no reviewer has looked since. ` +
    `Run one reviewer now: Agent tool, subagent_type "reviewer", with the request in the user's own words, every changed file by path (${countOf(total)}) and the checks that ran. ` +
    `One is enough; don't start a second. Fix each Important finding or say in the reply why it stays, then finish.` +
    `${r.notRun ? " A reviewer that stopped without a report counts as not run: ask it once with SendMessage for what it has before starting another." : ""}`);
  // Other sessions' files untouched for two days go. Not state.mjs's sweep: this session's baseline may be older than that
  const dir = path.dirname(files.marker), own = `${sessionKey(input.session_id)}.`;
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith(own) && Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 2 * 86400000) fs.rmSync(path.join(dir, f), { force: true });
  }
}

// Subagents fire SubagentStop, not Stop, and an input with agent_id is skipped too. A headless `claude -p` run looks the
// same as a Nimbalyst session to a hook, so a script that runs claude -p on code sets CODE_REVIEW_GATE=off
if (isMain(import.meta.url)) {
  runHook("code-review-gate", (input) => {
    const mode = setting("CODE_REVIEW_GATE").toLowerCase();
    if (process.argv.includes("--start")) { if (input.session_id) startArm(input); return; }
    if (!input.transcript_path || !input.session_id || !fs.existsSync(input.transcript_path)) return;
    if (process.argv.includes("--pre")) pushCheck(input, mode);
    else if (!input.agent_id) stopArm(input, mode);
  }, { projectSettings: true });
}
