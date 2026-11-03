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
// A review is a `reviewer` agent that came back with a report, the code-review or blind-screen-review skill, or /code-review
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
// Three arms, one file. No argument: the Stop hook above. `--pre` (PreToolUse, Bash): the same `due` decision (assess below) when the
// command is a `git push`, `gh release` or `npm publish`, or matches REVIEW_PUSH_PATTERN (env, or env in the project's settings): a Stop hook
// can't stop a push already made. It denies while a review is due and none ran since; it counts helpers and files since the last review,
// not just this turn, and the once-per-turn marker doesn't apply. `--start` (SessionStart): stores git's HEAD and the dirty files.
// Counting from git, in addition to the transcript: sed, a merge, a generator or a script change files with no Edit in the transcript.
// At Stop and `--pre`, the files that changed since the stored baseline count: working-tree files that differ from the baseline's dirty
// set, and the files of the user's own commits since the baseline's HEAD (git log --no-merges --author=<user.email>: a merged helper
// branch counts, a `git pull` of other people's commits doesn't). After a review only files written after it count (the baseline moves to
// the review). A turn that changed nothing asks about git files only when some are new since the last stop. No git, or a git call that
// fails or takes over 3 seconds: the transcript count alone. CODE_REVIEW_GATE=led counts no git files.
import { crashLog } from "./crash-log.mjs";
import { spawnSync } from "node:child_process";
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
const isReview = (b) => (b.name === "Skill" && /(^|:)(code-review|blind-screen-review)$/.test(String(b.input?.skill || "").trim().replace(/^\//, "")))
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

// A switch can sit in the project's settings: settings env may not reach a hook process
function setting(name) {
  if (process.env[name]) return process.env[name];
  try {
    const file = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), ".claude", "settings.json");
    return String(JSON.parse(fs.readFileSync(file, "utf8")).env?.[name] || "");
  } catch { return ""; }
}
const gateMode = () => setting("CODE_REVIEW_GATE").toLowerCase();

// Counting from git. Every call is short and any failure throws, which callers turn into "no git files"
const GIT_TIMEOUT = 3000;
const runGit = (cwd, args) => {
  const opts = { cwd, encoding: "utf8", timeout: GIT_TIMEOUT, windowsHide: true, maxBuffer: 32 * 1024 * 1024 };
  // On Windows git may be a .cmd shim, which only a shell finds
  const r = process.platform === "win32" ? spawnSync(`git ${args.map((a) => `"${a}"`).join(" ")}`, { ...opts, shell: true }) : spawnSync("git", args, opts);
  if (r.error || r.status !== 0) throw new Error(`git ${args[0]} gave no answer`);
  return r.stdout;
};
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const fileSig = (abs) => { try { const s = fs.statSync(abs); return `${s.mtimeMs}:${s.size}`; } catch { return "gone"; } };

// Where the repo is, its HEAD and the files that are dirty now, each with a signature (time and size) to tell a further change from none
function gitNow(cwd) {
  const [top, head] = runGit(cwd, ["rev-parse", "--show-toplevel", "HEAD"]).split("\n").map((s) => s.trim());
  if (!top || !head) throw new Error("git gave no top or HEAD");
  const dirty = {}, parts = runGit(top, ["status", "--porcelain", "-z", "--untracked-files=all"]).split("\0");
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    if (/[RC]/.test(e.slice(0, 2))) i++; // a rename lists the old name after the new one
    dirty[e.slice(3)] = fileSig(path.join(top, e.slice(3)));
  }
  return { top, head, dirty, at: Date.now(), seen: [] };
}
const writeBase = (file, base) => fs.writeFileSync(file, JSON.stringify(base));

// The code and setup files that changed since the baseline, by key, and the ones not seen at an earlier stop.
// With `since` (the last review) only files written after it count. `store`: the Stop arm keeps the baseline and what it has seen
function gitChanges(cwd, baseFile, since, store) {
  const none = { all: new Map(), fresh: new Map(), save() {} };
  try {
    const now = gitNow(cwd), base = readJson(baseFile);
    if (!base || base.top !== now.top) { if (store) writeBase(baseFile, now); return none; } // a session with no baseline starts one now
    const changed = new Set(Object.entries(now.dirty).filter(([rel, sig]) => base.dirty[rel] !== sig).map(([rel]) => rel));
    // A commit of a file that was dirty at the start and hasn't changed since is not new work
    if (now.head !== base.head) {
      const email = runGit(now.top, ["config", "user.email"]).trim();
      if (!email) throw new Error("git has no user.email");
      const log = runGit(now.top, ["-c", "core.quotepath=false", "log", "--no-merges", "--fixed-strings", `--author=<${email}>`, "--name-only", "--pretty=format:", `${base.head}..HEAD`]);
      for (const rel of log.split("\n").map((r) => r.trim())) if (rel && base.dirty[rel] !== fileSig(path.join(now.top, rel))) changed.add(rel);
    }
    const all = new Map();
    for (const rel of changed) {
      if (!isCode(rel) && !isSetup(rel)) continue; // the repo's own path, so a repo inside a temp folder still counts
      const abs = path.join(now.top, rel);
      if (since) { try { if (fs.statSync(abs).mtimeMs <= since) continue; } catch { continue; } }
      all.set(fileKey(abs), path.basename(rel));
    }
    const seen = new Set(base.seen);
    const fresh = new Map([...all].filter(([k]) => !seen.has(k)));
    return { all, fresh, save() { if (store && fresh.size) writeBase(baseFile, { ...base, seen: [...all.keys()] }); } };
  } catch { return none; }
}

// SessionStart: the baseline. A resumed or compacted session keeps the one it has
function startBaseline(input) {
  const file = path.join(os.tmpdir(), `code-review-gate-${String(input.session_id).replace(/[^\w-]/g, "_")}.base.json`);
  if (fs.existsSync(file)) return;
  try { writeBase(file, gitNow(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd())); } catch {
    // no git repo here: the transcript count alone
  }
}

// What the gate knows of a session's work, for the Stop arm and for the push check (`pre`).
// Returns { typed } for a turn the user typed /code-review in, { due: false }, or { due, files, setupFiles, helpers, ... }
function assess(input, mode, pre) {
  const text = fs.readFileSync(input.transcript_path, "utf8");
  const lines = text.split("\n");
  const { start, entries } = currentTurn(lines);
  const tmp = os.tmpdir();
  const marker = path.join(tmp, `code-review-gate-${String(input.session_id).replace(/[^\w-]/g, "_")}.txt`);
  const held = marker.replace(/\.txt$/, ".held.json");
  const baseFile = marker.replace(/\.txt$/, ".base.json");
  const ctx = { start, tmp, marker, held };
  if (start && typedReview(start)) return { ...ctx, typed: true };
  if (!pre && helperRunning(text, input.transcript_path)) return { ...ctx, due: false }; // the push is happening now, a helper or not
  let asked = 0, typedEnd = 0; // helpers from before the last block were asked about then; only a review starts the file count again
  try { asked = fs.statSync(marker).mtimeMs; if (fs.readFileSync(marker, "utf8").startsWith("typed ")) typedEnd = asked; } catch {}
  const notRun = unfinishedReviews(input.transcript_path);
  // The push check asks what is unreviewed in the whole session, not what the last block left over
  const from = pre ? 0 : Math.max((Date.parse(start?.timestamp) || Date.now()) - NOTE_WINDOW, asked);
  const main = editsSinceReview(entries, notRun);
  if (main.reviewedWork || (main.reviewedAt && helperEdits(input.transcript_path, from, main.reviewedAt).files.size)) return { ...ctx, due: false };
  const { at: reviewedAt, brief } = lastReview(lines, notRun);
  const since = Math.max(reviewedAt, typedEnd);
  // What was due when a reply ended in a question stays due after the answer, until a review
  let heldWork = null;
  try { heldWork = JSON.parse(fs.readFileSync(held, "utf8")); } catch {}
  if (heldWork && since >= heldWork.at) { fs.rmSync(held, { force: true }); heldWork = null; }
  const helpers = helperEdits(input.transcript_path, Math.max(from, reviewedAt));
  const git = mode === "led" ? { all: new Map(), fresh: new Map(), save() {} } : gitChanges(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd(), baseFile, since, !pre);
  git.save();
  // A file git shows as changed is this turn's work only if the turn could have changed it: another session, an editor
  // or a generator can dirty the repo while a turn only reads
  const couldChange = entries.some((e) => Array.isArray(e.message?.content) && e.message.content.some((b) => b.type === "tool_use" && /^(Bash|PowerShell|Agent|Task)$/.test(b.name)));
  // nothing changed in this turn, by the helpers of its window or in git since the last stop
  if (!pre && !main.files.size && !helpers.files.size && !heldWork && !(git.fresh.size && couldChange)) return { ...ctx, due: false };
  // Small turns add up, in the main session and in helpers, since the last review. Led mode counts jobs only
  const earlier = mode === "led" ? [] : [...editsSinceReview(inWindow(editEntries(lines), since), notRun).files, ...helperEdits(input.transcript_path, since).files, ...git.all];
  // After a review, a setup file its brief named is a fix of what it found. One it didn't name is new work
  const said = brief.replace(/\\+/g, "/").toLowerCase();
  const newSetup = [...main.files, ...helpers.files, ...git.all].filter(([k]) => isSetup(k) && !said.includes(k.toLowerCase().split("/").slice(-2).join("/"))).map(([, name]) => name);
  const setupFiles = [...new Set([...(heldWork?.setup || []), ...newSetup])];
  const files = [...new Set([...(heldWork?.files || []), ...new Map([...main.files, ...helpers.files, ...earlier]).values()])];
  const big = files.length >= MIN_FILES, several = helpers.steps >= MIN_STEPS, setup = setupFiles.length > 0;
  const job = several && files.length >= NEW_JOB_FILES;
  // Setup files after a review earlier in the session still count: a broken hook costs every later session. Fixes in the review's own turn don't
  const due = !!(heldWork || (reviewedAt ? job : several) || (mode !== "led" && (big || (setup && !main.reviewedAt))));
  return { ...ctx, due, files, setupFiles, helpers, notRun, heldWork, big, several, setup };
}

const nameList = (names) => names.length > 6 ? `${names.slice(0, 6).join(", ")} and ${names.length - 6} more` : names.join(", ");
const countOf = (n, what = "") => `${n} ${what}file${n === 1 ? "" : "s"}`;

// A command that publishes work: a push, a release or a package publish, in a longer command too (GH_TOKEN=x git push ...).
// Quoted text is not looked at, so a commit message that says "git push" passes; a shell started with -c is looked at whole
const LEAD = "(?:^|[\\s;&|(`\"'/\\\\])"; // a slash for /usr/bin/git
const PUBLISH = [new RegExp(`${LEAD}git(?:\\.exe)?(?:\\s+-\\S+(?:\\s+[^\\s-]\\S*)?)*\\s+push\\b`), new RegExp(`${LEAD}gh(?:\\.exe)?\\s+release\\s+(?:create|upload|edit)\\b`), new RegExp(`${LEAD}npm(?:\\.cmd)?\\s+publish\\b`)];
function isPush(text) {
  const command = text.replace(/^\s*#.*$/gm, ""); // a comment line, such as the one that explains the command, is not a command
  const wrapped = /\b(?:bash|sh|zsh|pwsh|powershell|cmd)(?:\.exe)?\s+(?:-\w*c\b|\/c\b)/i.test(command);
  const bare = wrapped ? command : command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  if (PUBLISH.some((re) => re.test(bare))) return true;
  const own = setting("REVIEW_PUSH_PATTERN");
  if (!own) return false;
  try { return new RegExp(own, "i").test(command); } catch { return false; } // a pattern that doesn't parse is no pattern
}

// PreToolUse (Bash, PowerShell): no push, release or publish while a review is due and none ran since, by a helper either
function pushCheck(input, mode) {
  if (!/^(Bash|PowerShell)$/.test(input.tool_name) || !isPush(String(input.tool_input?.command || ""))) return;
  const r = assess(input, mode, true);
  if (r.typed || !r.due) return;
  const names = r.files.length ? r.files : r.setupFiles;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `code-review-gate: a review is due before this push: ${countOf(names.length)} changed (${nameList(names)}) and no reviewer has looked since. ` +
        `Run one reviewer agent first (Agent tool, subagent_type "reviewer", with the request in the user's own words, every changed file by path and the checks that ran), fix what it finds, then push again. ` +
        `To turn this check off for this run: CODE_REVIEW_GATE=off (env, or env in the project's .claude/settings.json).`,
    },
  }));
}

// Stop: one block per turn when a review is due
function stopArm(input, mode) {
  const r = assess(input, mode, false);
  const { start, tmp, marker, held } = r;
  // A typed review is this turn, with its fixes: the marker starts the count again after it
  if (r.typed) { fs.writeFileSync(marker, `typed ${start.uuid || start.timestamp}`); return; }
  if (!r.due) return;
  const { files, setupFiles, helpers, notRun, heldWork, big, several, setup } = r;
  // Once per turn: the temp file holds the turn this hook last blocked; files older than two days go
  const turnKey = start?.uuid || start?.timestamp || "no-typed-message";
  if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === turnKey) return;
  if (/\?\s*$/.test(String(input.last_assistant_message || ""))) { fs.writeFileSync(held, JSON.stringify({ at: heldWork?.at || Date.now(), files, setup: setupFiles })); return; }
  fs.writeFileSync(marker, turnKey); // throws when it can't be written, so no block that could repeat
  fs.rmSync(held, { force: true });
  const codeText = big || several || !setup;
  const total = codeText ? files.length : setupFiles.length;
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `code-review-gate: ${codeText ? `this work changed ${countOf(files.length, "code ")} (${nameList(files)})${helpers.steps ? ` over ${helpers.steps} helper steps` : ""}` : `${heldWork ? "this work" : "this turn"} changed ${countOf(setupFiles.length)}: hooks, rules, settings or CI files (${setupFiles.join(", ")})`} and no reviewer has looked since. ` +
      `Run one reviewer now: Agent tool, subagent_type "reviewer", with the request in the user's own words, every changed file by path (${countOf(total)}) and the checks that ran. ` +
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
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  try {
    const mode = gateMode();
    if (mode === "off") process.exit(0);
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    if (process.argv.includes("--start")) { if (input.session_id) startBaseline(input); }
    else if (!input.transcript_path || !input.session_id || !fs.existsSync(input.transcript_path)) process.exit(0);
    else if (process.argv.includes("--pre")) pushCheck(input, mode);
    else if (!input.agent_id) stopArm(input, mode);
  } catch (err) {
    // fail open, with a trace: a dead gate must not look like a quiet one
    crashLog("code-review-gate", err);
  }
}
