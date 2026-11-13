#!/usr/bin/env node
// code-review-gate: Stop hook. Asks for one reviewer on a bigger change, by itself, in the projects that want it.
// In real sessions a code-review skill ran on only about one in five of the turns that changed 3 or more code files; the gate now asks at 10 or more files over a session (below).
// It reads the transcript, not the prompt, so it works for someone who forgets to ask and for a badly worded request.
// Most edits are made by helpers, so it counts theirs too (their transcripts are in <transcript>/subagents),
// and asks for the `reviewer` agent, one and only one, not a skill that starts several.
// Due in three cases, each from 30 days of real sessions (2026-11-02). Rework = the change drew a fix request.
// - 2 or more helpers edited code (a job of several steps): 58% rework, about 1.03M tokens each time.
// - 10 or more different code files since the last review, over any number of turns: rework 32% reviewed,
//   59% not. At 5 to 9 files there was no gap (47% and 44%), so the bar moved up from 5. Small turns add up: a big
//   change made in pieces is still a big change. A block nobody acted on leaves them counted.
// - Hooks, rules, agents, skills, settings or CI files, unless a review ran this turn: 66% rework at about 1.09M tokens (46 changes). The 10 that
//   were reviewed are too few to show a gain, so this one is judgment: a broken hook costs every later session.
// A review costs about 295k tokens, so outside these three it does not pay for itself in tokens alone.
// One reviewer at most: a review this turn, after the work, ends the gate for the turn, and after a review earlier
// in the session it takes 10 or more files, or 2 helpers on 5 or more: fewer than that are mostly fixing its findings.
// A setup file the last review's brief named is a fix of what it found; one it didn't name still asks.
// This turn's helpers count by each entry's time: since the last review or the last block, or else from 30 minutes
// before the user's last message, so a note typed while a job finishes doesn't hide the job.
// A review is a `reviewer` agent that came back with a report, the code-review or blind-review skill, or /code-review
// typed by the user. A reviewer cut at its limit or empty reviewed nothing. A reply ending in a question passes, and what was
// due stays due after the answer (in a file beside the marker) until a review. A crash fails open and leaves a line in hooks/state/hook-errors.log.
// CODE_REVIEW_GATE=led (env, or env in the project's .claude/settings.json): only a job of several helper
// steps, for a project that rules out other reviews. =off disables it. CODE_REVIEW_MIN_FILES changes the 10.
// The turn starts at the user's last typed message. Only calls that went through count.
// Blocks at most once per turn, remembered in a temp file per session: stop_hook_active alone is not
// enough, since a block by any other Stop hook sets it too. Subagents fire SubagentStop, not Stop, and an
// input with agent_id is skipped too. A headless -p run can't be told apart from a Nimbalyst session
// (both are "sdk-cli" with the same input and transcript fields, checked 2026-10-26), so a script that
// runs claude -p on code sets CODE_REVIEW_GATE=off. Fails open.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MIN_FILES = Number(process.env.CODE_REVIEW_MIN_FILES) || 10;
const MIN_STEPS = 2;
const NEW_JOB_FILES = 5; // after a review, what 2 helpers must have changed to be a new job and not its fixes
const NOTE_WINDOW = 30 * 60000;
// The file types that count as code
const CODE_EXT = new Set([".java", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".gd", ".cs", ".go", ".rs", ".kt", ".kts", ".gradle", ".vue", ".svelte", ".php", ".rb", ".swift", ".c", ".cpp", ".h", ".sh", ".ps1", ".sql", ".html", ".css"]);
const EDIT_TOOLS = /^(Edit|Write|NotebookEdit)$/;
const isCode = (p) => {
  if (/\/(temp|tmp|scratch)\//i.test(String(p).replace(/\\/g, "/"))) return false; // a throwaway script is not the project's code
  const ext = path.extname(String(p)).toLowerCase();
  if (CODE_EXT.has(ext)) return true;
  return ext === ".json" && /(^|\/)src\//.test(String(p).replace(/\\/g, "/"));
};
// Hooks, rules, agents, skills, settings and CI, by their usual places. A web project's src/hooks/useThing.js is not one of them
const isSetup = (p) => {
  const f = String(p).replace(/\\/g, "/");
  return !/\/(temp|tmp|scratch)\//i.test(f) && /(^|\/)(\.claude\/(hooks\/|agents\/|rules\/|skills\/|settings[^/]*\.json$)|CLAUDE\.md$|\.github\/workflows\/|\.gitlab-ci\.ya?ml$|\.circleci\/|\.husky\/|settings\.example\.json$)/i.test(f);
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
export function editsSinceReview(entries, notRun = []) {
  const refused = new Set(notRun);
  for (const e of entries) {
    if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) if (b.type === "tool_result" && b.is_error) refused.add(b.tool_use_id);
  }
  let files = new Map(), reviewedAt = 0, reviewedWork = false, reviewBrief = "";
  for (const e of entries) {
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      if (b.type !== "tool_use" || refused.has(b.id)) continue;
      if (isReview(b)) { reviewedWork ||= files.size > 0; files = new Map(); reviewedAt = Date.parse(e.timestamp) || reviewedAt; reviewBrief = JSON.stringify(b.input); }
      const p = b.input?.file_path || b.input?.notebook_path;
      if (EDIT_TOOLS.test(b.name) && p && (isCode(p) || isSetup(p))) files.set(fileKey(p), path.basename(String(p)));
    }
  }
  return { files, reviewedAt, reviewedWork, reviewBrief };
}

const entriesOf = (text) => text.split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });

// Only the lines that can matter are parsed: a long session's transcript is big
const EDIT_LINE = /"is_error":true|review|"name":"(Edit|Write|NotebookEdit)"/;
const editEntries = (lines) => entriesOf(lines.filter((l) => EDIT_LINE.test(l)).join("\n"));
const inWindow = (entries, sinceMs, untilMs = Infinity) => entries.filter((e) => { const t = Date.parse(e.timestamp); return !t || (t >= sinceMs && t < untilMs); });

// When the session's last review was, and its brief; a /code-review the user typed counts
const lastReview = (lines, notRun) => {
  const entries = editEntries(lines), { reviewedAt, reviewBrief } = editsSinceReview(entries, notRun);
  return { at: Math.max(reviewedAt, ...entries.filter((e) => typedByUser(e) && typedReview(e)).map((e) => Date.parse(e.timestamp) || 0)), brief: reviewBrief };
};

const helperFolder = (transcript) => path.join(transcript.replace(/\.jsonl$/, ""), "subagents");

// The reviewers that came back with no report, by the id of the call that started them. One cut at its limit ends
// on a tool result; its report comes last, so it lost its only product. An Agent call going through proves nothing.
export function unfinishedReviews(transcript) {
  const folder = helperFolder(transcript), notRun = new Set();
  let names = [];
  try { names = fs.readdirSync(folder); } catch { return notRun; }
  for (const name of names) {
    if (!name.endsWith(".meta.json")) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(folder, name), "utf8"));
      if (meta.agentType !== "reviewer" || !meta.toolUseId) continue;
      const last = JSON.parse(fs.readFileSync(path.join(folder, name.replace(/\.meta\.json$/, ".jsonl")), "utf8").trim().split("\n").pop());
      const said = Array.isArray(last.message?.content) ? last.message.content.filter((b) => b.type === "text").map((b) => b.text || "").join("\n") : "";
      if (last.type !== "assistant" || !(said.includes("Against the request") || said.length >= 300)) notRun.add(meta.toolUseId);
    } catch {
      // a file being written is judged on the next stop
    }
  }
  return notRun;
}

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
    // A worker reused for the next step keeps one file: each brief in it is a step. Its own wake-ups and compactions are not briefs
    const briefs = [[]];
    for (const l of fs.readFileSync(p, "utf8").split("\n")) {
      if (/"type":"user"/.test(l) && !/"tool_result"|<task-notification>|"isCompactSummary":true/.test(l)) briefs.push([]);
      briefs.at(-1).push(l);
    }
    for (const brief of briefs) {
      const edited = editsSinceReview(inWindow(editEntries(brief), sinceMs, untilMs)).files;
      if (edited.size) steps++;
      for (const [k, v] of edited) files.set(k, v);
    }
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
    const tmp = os.tmpdir();
    const marker = path.join(tmp, `code-review-gate-${String(input.session_id).replace(/[^\w-]/g, "_")}.txt`);
    const held = marker.replace(/\.txt$/, ".held.json");
    // A typed review is this turn, with its fixes: the marker starts the count again after it
    if (start && typedReview(start)) { fs.writeFileSync(marker, `typed ${start.uuid || start.timestamp}`); process.exit(0); }
    if (helperRunning(text, input.transcript_path)) process.exit(0);
    let asked = 0, typedEnd = 0; // helpers from before the last block were asked about then; only a review starts the file count again
    try { asked = fs.statSync(marker).mtimeMs; if (fs.readFileSync(marker, "utf8").startsWith("typed ")) typedEnd = asked; } catch {}
    const notRun = unfinishedReviews(input.transcript_path);
    const from = Math.max((Date.parse(start?.timestamp) || Date.now()) - NOTE_WINDOW, asked);
    const main = editsSinceReview(entries, notRun);
    if (main.reviewedWork || (main.reviewedAt && helperEdits(input.transcript_path, from, main.reviewedAt).files.size)) process.exit(0);
    const { at: reviewedAt, brief } = lastReview(lines, notRun);
    const since = Math.max(reviewedAt, typedEnd);
    // What was due when a reply ended in a question stays due after the answer, until a review
    let heldWork = null;
    try { heldWork = JSON.parse(fs.readFileSync(held, "utf8")); } catch {}
    if (heldWork && since >= heldWork.at) { fs.rmSync(held, { force: true }); heldWork = null; }
    const helpers = helperEdits(input.transcript_path, Math.max(from, reviewedAt));
    if (!main.files.size && !helpers.files.size && !heldWork) process.exit(0); // nothing changed in this turn or by the helpers of its window
    // Small turns add up, in the main session and in helpers, since the last review. Led mode counts jobs only
    const earlier = mode === "led" ? [] : [...editsSinceReview(inWindow(editEntries(lines), since), notRun).files, ...helperEdits(input.transcript_path, since).files];
    // After a review, a setup file its brief named is a fix of what it found. One it didn't name is new work
    const said = brief.replace(/\\+/g, "/").toLowerCase();
    const newSetup = [...main.files, ...helpers.files].filter(([k]) => isSetup(k) && !said.includes(k.toLowerCase().split("/").slice(-2).join("/"))).map(([, name]) => name);
    const setupFiles = [...new Set([...(heldWork?.setup || []), ...newSetup])];
    const files = [...new Set([...(heldWork?.files || []), ...new Map([...main.files, ...helpers.files, ...earlier]).values()])];
    const big = files.length >= MIN_FILES, several = helpers.steps >= MIN_STEPS, setup = setupFiles.length > 0;
    const job = several && files.length >= NEW_JOB_FILES;
    // Setup files after a review earlier in the session still count: a broken hook costs every later session. Fixes in the review's own turn don't
    const due = heldWork || (reviewedAt ? job : several) || (mode !== "led" && (big || (setup && !main.reviewedAt)));
    if (!due) process.exit(0);
    // Once per turn: the temp file holds the turn this hook last blocked; files older than two days go
    const turnKey = start?.uuid || start?.timestamp || "no-typed-message";
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === turnKey) process.exit(0);
    if (/\?\s*$/.test(String(input.last_assistant_message || ""))) { fs.writeFileSync(held, JSON.stringify({ at: heldWork?.at || Date.now(), files, setup: setupFiles })); process.exit(0); }
    fs.writeFileSync(marker, turnKey); // throws when it can't be written, so no block that could repeat
    fs.rmSync(held, { force: true });
    const names = files.length > 6 ? `${files.slice(0, 6).join(", ")} and ${files.length - 6} more` : files.join(", ");
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: `code-review-gate: ${big || several || !setup ? `this work changed ${files.length} code files (${names})${helpers.steps ? ` over ${helpers.steps} helper steps` : ""}` : `${heldWork ? "this work" : "this turn"} changed hooks, rules, settings or CI files (${setupFiles.join(", ")})`} and no reviewer has looked since. ` +
        `Run one reviewer now: Agent tool, subagent_type "reviewer", with the request in the user's own words, every changed file by path and the checks that ran. ` +
        `One is enough; don't start a second. Fix each Important finding or say in the reply why it stays, then finish.` +
        `${notRun.size ? " A reviewer that stopped without a report counts as not run: ask it once with SendMessage for what it has before starting another." : ""}`,
    }));
    try {
      for (const f of fs.readdirSync(tmp).filter((f) => f.startsWith("code-review-gate-") && !f.startsWith(path.basename(marker, ".txt")))) {
        if (Date.now() - fs.statSync(path.join(tmp, f)).mtimeMs > 2 * 86400000) fs.unlinkSync(path.join(tmp, f));
      }
    } catch {
      // a leftover file is harmless
    }
  } catch (err) {
    // fail open, with a trace: a dead gate must not look like a quiet one
    try {
      const log = path.join(os.homedir(), ".claude", "hooks", "state", "hook-errors.log");
      fs.mkdirSync(path.dirname(log), { recursive: true });
      fs.appendFileSync(log, `${new Date().toISOString()} code-review-gate: ${err?.message || err}\n`);
    } catch {
      // nothing more to do
    }
  }
}
