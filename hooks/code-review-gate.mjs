#!/usr/bin/env node
// code-review-gate: Stop hook. Asks for one reviewer on a bigger change, by itself, in the projects that want it.
// In real sessions a code-review skill ran on only about one in five of the turns that changed 3 or more code files.
// Since 2026-11-02 most edits are made by helpers, and this hook used to count only the main session's, so
// a job built by workers never asked for a review. It now counts helpers' edits too (their transcripts are
// in <transcript>/subagents), and asks for the `reviewer` agent, one and only one, not a skill that starts several.
// Due when 5 or more different code files changed, or 2 or more helpers edited code (a job of several steps).
// One reviewer at most: a review this turn, after the work, ends the gate for the turn, and after a review earlier
// in the session helpers alone are no job (they are mostly fixing its findings), only 5 or more files are.
// A helper's edits count by each entry's time: since the last review or the last block, or else from 30 minutes
// before the user's last message, so a note typed while a job finishes doesn't hide the job.
// A review is a `reviewer` agent, or the code-review or blind-review skill.
// CODE_REVIEW_GATE=led (env, or env in the project's .claude/settings.json): only a job of several helper
// steps, for a project that rules out other reviews. =off disables it. CODE_REVIEW_MIN_FILES changes the 5.
// The turn starts at the user's last typed message. Only calls that went through count.
// Blocks at most once per turn, remembered in a temp file per session: stop_hook_active alone is not
// enough, since a block by any other Stop hook sets it too. Subagents fire SubagentStop, not Stop, and an
// input with agent_id is skipped too. A headless -p run can't be told apart from a Nimbalyst session
// (both are "sdk-cli" with the same input and transcript fields, checked 2026-10-26), so a script that
// runs claude -p on code sets CODE_REVIEW_GATE=off. Fails open.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MIN_FILES = Number(process.env.CODE_REVIEW_MIN_FILES) || 5;
const MIN_STEPS = 2;
const NOTE_WINDOW = 30 * 60000;
// The file types that count as code
const CODE_EXT = new Set([".java", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".gd", ".cs", ".go", ".rs", ".kt", ".gradle"]);
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const isCode = (p) => {
  if (/\/(temp|tmp|scratch)\//i.test(String(p).replace(/\\/g, "/"))) return false; // a throwaway script is not the project's code
  const ext = path.extname(String(p)).toLowerCase();
  if (CODE_EXT.has(ext)) return true;
  return ext === ".json" && /(^|\/)src\//.test(String(p).replace(/\\/g, "/"));
};
const isReview = (b) => (b.name === "Skill" && /(^|:)(code-review|blind-review)$/.test(String(b.input?.skill || "").trim().replace(/^\//, "")))
  || (/^(Agent|Task)$/.test(b.name) && b.input?.subagent_type === "reviewer");
const fileKey = (p) => {
  const k = path.resolve(String(p)).replace(/\\/g, "/");
  return process.platform === "win32" ? k.toLowerCase() : k;
};

const userText = (e) => {
  const c = e.message?.content;
  return typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text || "").join("\n") : "";
};
// A message the user typed: not a tool result, and not text Claude Code or Nimbalyst adds on its own
// (skill text, a background task's notice, "[Request interrupted by user]", Nimbalyst's "[System: ...]"
// and "[Child Session Update]" prompts, which come with promptSource "sdk" like typed ones)
const INJECTED = /^\[(Request interrupted|System:|Child Session Update\])/;
const typedByUser = (e) => {
  if (e.type !== "user" || e.isMeta || e.isCompactSummary || e.promptSource === "system" || e.origin?.kind === "task-notification") return false;
  const t = userText(e).trim();
  return !!t && !INJECTED.test(t);
};
// The user typed /code-review: the turn is the review and its fixes
const typedReview = (e) => /<command-name>\/?([\w-]+:)?code-review<\/command-name>|^\/code-review(?=\s|$)/.test(userText(e).trim());

// The current turn: the user's last typed message and what came after it, read from the end of the file
export function currentTurn(lines) {
  const turn = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (typedByUser(e)) return { start: e, entries: turn.reverse() };
    turn.push(e);
  }
  return { start: null, entries: turn.reverse() };
}

// The code files changed since the last review in these entries, and when that review was
export function editsSinceReview(entries) {
  const refused = new Set();
  for (const e of entries) {
    if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) if (b.type === "tool_result" && b.is_error) refused.add(b.tool_use_id);
  }
  let files = new Map(), reviewedAt = 0, reviewedWork = false;
  for (const e of entries) {
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      if (b.type !== "tool_use" || refused.has(b.id)) continue;
      if (isReview(b)) { reviewedWork ||= files.size > 0; files = new Map(); reviewedAt = Date.parse(e.timestamp) || reviewedAt; }
      const p = b.input?.file_path || b.input?.notebook_path;
      if (EDIT_TOOLS.test(b.name) && p && isCode(p)) files.set(fileKey(p), path.basename(String(p)));
    }
  }
  return { files, reviewedAt, reviewedWork };
}

const entriesOf = (text) => text.split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });

// When the session's last review was. Only the lines that can matter are parsed: a long session's transcript is big
const lastReview = (lines) => editsSinceReview(entriesOf(lines.filter((l) => /"is_error":true|review/.test(l)).join("\n"))).reviewedAt;

const helperFolder = (transcript) => path.join(transcript.replace(/\.jsonl$/, ""), "subagents");

// A background helper still at work: the job isn't finished, and its notice brings another stop.
// One with no notice and no write for 10 minutes is a leftover of a restart.
export function helperRunning(text, transcript) {
  return [...text.matchAll(/"status":"async_launched","agentId":"([^"]+)"/g)].some(([, id]) => {
    if (text.includes(`<task-id>${id}</task-id>`)) return false;
    try { return Date.now() - fs.statSync(path.join(helperFolder(transcript), `agent-${id}.jsonl`)).mtimeMs < 600000; } catch { return false; }
  });
}

// What helpers changed between two times: each keeps its transcript in <transcript>/subagents, and one resumed for a fix
// keeps its whole history in the same file, so the time of each entry decides. One last written before sinceMs is older work.
export function helperEdits(transcript, sinceMs, untilMs = Infinity) {
  const folder = helperFolder(transcript);
  const files = new Map();
  let steps = 0, names = [];
  try { names = fs.readdirSync(folder); } catch { return { files, steps }; }
  for (const name of names) {
    if (!/^agent-.*\.jsonl$/.test(name)) continue;
    const p = path.join(folder, name);
    if (fs.statSync(p).mtimeMs < sinceMs) continue;
    const inTime = entriesOf(fs.readFileSync(p, "utf8")).filter((e) => { const t = Date.parse(e.timestamp); return !t || (t >= sinceMs && t < untilMs); });
    const edited = editsSinceReview(inTime).files;
    if (edited.size) steps++;
    for (const [k, v] of edited) files.set(k, v);
  }
  return { files, steps };
}

// The switch can sit in the project's settings: settings env may not reach a hook process
function gateMode() {
  if (process.env.CODE_REVIEW_GATE) return process.env.CODE_REVIEW_GATE.toLowerCase();
  try {
    const file = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), ".claude", "settings.json");
    return String(JSON.parse(fs.readFileSync(file, "utf8")).env?.CODE_REVIEW_GATE || "").toLowerCase();
  } catch { return ""; }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  try {
    const mode = gateMode();
    if (mode === "off") process.exit(0);
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    if (input.agent_id || !input.transcript_path || !input.session_id) process.exit(0);
    const text = fs.readFileSync(input.transcript_path, "utf8");
    const lines = text.split("\n");
    const { start, entries } = currentTurn(lines);
    if (start && typedReview(start)) process.exit(0);
    if (helperRunning(text, input.transcript_path)) process.exit(0);
    const tmp = os.tmpdir();
    const marker = path.join(tmp, `code-review-gate-${String(input.session_id).replace(/[^\w-]/g, "_")}.txt`);
    let asked = 0; // helpers from before the last block were asked about then
    try { asked = fs.statSync(marker).mtimeMs; } catch {}
    const from = Math.max((Date.parse(start?.timestamp) || Date.now()) - NOTE_WINDOW, asked);
    const main = editsSinceReview(entries);
    if (main.reviewedWork || (main.reviewedAt && helperEdits(input.transcript_path, from, main.reviewedAt).files.size)) process.exit(0);
    const reviewedAt = lastReview(lines);
    const helpers = helperEdits(input.transcript_path, Math.max(from, reviewedAt));
    const files = [...new Map([...main.files, ...helpers.files]).values()];
    const big = files.length >= MIN_FILES, several = helpers.steps >= MIN_STEPS;
    const due = reviewedAt ? big && (mode !== "led" || several) : several || (mode !== "led" && big);
    if (!due) process.exit(0);
    // Once per turn: the temp file holds the turn this hook last blocked; files older than two days go
    const turnKey = start?.uuid || start?.timestamp || "no-typed-message";
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === turnKey) process.exit(0);
    fs.writeFileSync(marker, turnKey); // throws when it can't be written, so no block that could repeat
    const names = files.length > 6 ? `${files.slice(0, 6).join(", ")} and ${files.length - 6} more` : files.join(", ");
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: `code-review-gate: this turn changed ${files.length} code files (${names})${helpers.steps ? ` over ${helpers.steps} helper steps` : ""} and no reviewer has looked since. ` +
        `Run one reviewer now: Agent tool, subagent_type "reviewer", with the request in the user's own words, the changed files and the checks that ran. ` +
        `One is enough; don't start a second. Fix each Important finding or say in the reply why it stays, then finish.`,
    }));
    try {
      for (const f of fs.readdirSync(tmp).filter((f) => f.startsWith("code-review-gate-") && f !== path.basename(marker))) {
        if (Date.now() - fs.statSync(path.join(tmp, f)).mtimeMs > 2 * 86400000) fs.unlinkSync(path.join(tmp, f));
      }
    } catch {
      // a leftover file is harmless
    }
  } catch {
    // fail open
  }
}
