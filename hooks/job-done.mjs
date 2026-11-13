// job-done: holds a session to one piece of a job: a note when a piece is committed, a hold on the next piece for a
// session that claimed a plan row, and a nudge when a committed job's session gets an unrelated next ask.
// The way chosen (user decision 2026-11-12): the session claims its row before the work, and the hooks hold it to
// that row, as harnesses that run one feature per fresh session do.
// A piece: a main-session commit call that landed. A Bash `git commit` or `git merge` (the whole subcommand, not
// merge-base or commit-graph; also after -C <dir>, -c k=v, --no-pager; with -q or not; not --amend) or the Nimbalyst
// commit tool, whose repository (the -C of that git call, else a leading `cd <dir> &&`, else the session's cwd) has a
// HEAD made in the last 2 minutes (git log -1 --format=%ct). Not a piece: a commit in a linked worktree (.git is a
// file: a helper's commit), or one that only touches records: plan files, lane state files (docs/*state*.md),
// progress.md or HANDOFF.md (the State update). Only when a job is open: the session's folder or the commit's repository, each taken up to the
// folder holding .git, has a docs/*plan*.md changed in the last OPEN_HOURS (48) hours that holds a row ("| S3 |",
// "| BH1 |", "| 2 |") or an unticked "- [ ]", or a HANDOFF.md with an unticked "- [ ]". A one-piece job gets nothing.
// PostToolUse (Bash, Nimbalyst commit tool): a piece tells Claude that, with steps of the job left, the next one starts
// in a fresh session Claude opens itself (handoff skill, spawn_session with the prompt queued), so nothing waits on the
// user and compaction stays the safety net inside one piece (user decision 2026-11-08). The piece is kept in state.
// The claim: a session running a plan row writes "session <first 8 chars of its id>: S3, ends with commit + handoff"
// into the row's State cell, or a side session into its lane state file docs/*state*.md (lead skill section 4, handoff
// prompt). Keyed by session id, so parallel sessions editing the same plan don't see each other's claims. Once seen,
// the claim (row, file) is kept in the session's state, so marking the row done ("done <hash>, session <id>: S3", or a
// State cell that drops the claim) doesn't end the hold. The holds below act only for a session with a claim in an
// open plan, or a state file beside one, of its folder (or the commit's repository), after its piece landed, and only
// while another row of that plan is still open (State cell not done/merged/dropped/skipped): the claimed row being the
// last open row is silent.
// PreToolUse (Bash, Agent, Nimbalyst commit tool): the next commit in the piece's repository, or an Agent call whose
// description names another row of the plan, is refused once per session; a re-send passes. A commit of records only
// (paths given to git commit, git add paths and staged files) passes, and so does a commit in another repository (a
// stage commits in several).
// Stop: once per piece, a turn ending with no hand-off since the piece (handoff Skill, spawn_session, steer.mjs moved)
// is blocked with a reason to hand off now. stop_hook_active passes.
// UserPromptSubmit: once per main session, while its folder has an open plan and it has no claim yet, tells it the
// first 8 characters of its id (a session can't read its own id anywhere else), so it can write the claim.
// Also: once a session's job is committed, the next ask often rides on a large context, so every call
// costs several times what a fresh ~40k session costs. Adds context (does not block) when the context of the last
// main-chain request is over JOB_DONE_K (100) thousand tokens AND the entries since the previous typed user message
// hold a Bash `git commit`, `git tag`, `git push` or `repo-push.sh` call, or a Skill call of release-setup or deploy.
// One commit nudges once. Silent for prompts starting with "/" and injected prompts (<task-notification>, [System: ...).
// State for all events in ~/.claude/hooks/state/job-done/<session_id>.json (swept after 2 days). Silent for subagents
// (agent_id). Sidechain entries are ignored. Fails open. JOB_DONE=off disables it.
import { runHook, emit } from "./lib/hook-io.mjs";
import { sessionKey, fileKey, gitBashToNative } from "./lib/paths.mjs";
import { stateFile, readJson, writeJson, sweep } from "./lib/state.mjs";
import {
  backEntries,
  lastUsage,
  typedByUser,
  userText,
  INJECTED,
} from "./lib/transcript.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CONTEXT_K = Number(process.env.JOB_DONE_K) || 100;

// A call that ends a job: git commit/tag/push, repo-push.sh, or the release-setup / deploy skill
const GIT_DONE =
  /\bgit(\s+-C\s+("[^"]*"|\S+))?\s+(commit|tag|push)\b|\brepo-push\.sh\b/;
const DONE_SKILL = /^(release-setup|deploy)$/;
const doneCallId = (e) => {
  if (e.type !== "assistant" || !Array.isArray(e.message?.content)) return null;
  for (const b of e.message.content) {
    if (b.type !== "tool_use") continue;
    if (b.name === "Bash" && GIT_DONE.test(String(b.input?.command ?? "")))
      return b.id || "bash";
    if (
      b.name === "Skill" &&
      DONE_SKILL.test(String(b.input?.skill ?? "").replace(/^.*:/, ""))
    )
      return b.id || "skill";
  }
  return null;
};

// Id of the last job-ending call since the previous typed user message, or null. The transcript is read backwards
// until that message, however far back. The prompt being submitted may already be in the transcript as the last
// entry: it is skipped, not taken as the previous message.
function commitSincePrevTyped(file, prompt) {
  let found = null;
  let sawAssistant = false;
  let skippedPrompt = false;
  for (const e of backEntries(file)) {
    if (e.type === "assistant") sawAssistant = true;
    if (typedByUser(e)) {
      if (!sawAssistant && !skippedPrompt && userText(e).trim() === prompt) {
        skippedPrompt = true;
        continue;
      }
      return found;
    }
    if (found === null) found = doneCallId(e);
  }
  return null; // no typed message in the file: cannot tell where the turn began
}

const GIT_PIECE =
  /\bgit(\s+(-C\s+("[^"]*"|'[^']*'|\S+)|-c\s+\S+|--[\w-]+))*\s+(commit|merge)(?![\w-])/;
const COMMIT_TOOL = "mcp__nimbalyst__developer_git_commit_proposal";
const AGENT_TOOL = /^(Agent|Task)$/;
const FRESH_MS = 2 * 60e3; // a HEAD this new was made by the call that just ran
const PIECE_TEXT =
  "[job-done] A piece of work is committed. If steps of this job are left (job list, plan file or HANDOFF): bring the job list or plan up to date, run the handoff skill (it opens the fresh session with its prompt queued), then end this turn; this wins over a context-guard note to compact. If this was the job's last piece or a one-piece job, carry on with the report.";

const OPEN_HOURS = Number(process.env.JOB_DONE_OPEN_HOURS) || 48;
const ROW_LINE = /^\|\s*([A-Za-z]*\d+[a-z]?)\s*\|/; // a job-list row: "| S3 |", "| BH1 |", "| 2 |", "| S4b |"
const UNTICKED = /^\s*[-*]\s+\[ \]\s/m;
const PLAN_NAME = /(^|[-_])plans?([-_.][^/]*)?\.md$/i;
const ROW_DONE = /^(done|merged|dropped|skipped)\b/i;
const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return "";
    throw e;
  }
};
const STATE_NAME = /(^|[-_])state([-_.][^/]*)?\.md$/i;
// Records: what a session writes about the job, not the job's work (claim, State, progress)
const recordsOnly = (files) =>
  files.length > 0 &&
  files.every((f) => {
    const b = path.basename(f);
    return (
      b === "HANDOFF.md" ||
      b === "progress.md" ||
      b === "DECISIONS.md" ||
      b === "decisions-archive.md" ||
      PLAN_NAME.test(b) ||
      STATE_NAME.test(b)
    );
  });

// The folder holding .git (a folder, or a worktree's .git file) at or above dir, or null
function repoRoot(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) return null;
  }
}
const linkedWorktree = (root) => fs.statSync(path.join(root, ".git")).isFile();

// git in a repository: its output, or null when git exits non-zero (no commit yet, not a repository)
function git(root, args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (r.error) throw r.error;
  return r.status === 0 ? r.stdout : null;
}
const freshHead = (root) => {
  const ct = Number(git(root, ["log", "-1", "--format=%ct"]));
  return ct > 0 && Math.abs(Date.now() - ct * 1000) <= FRESH_MS;
};

// The files (not folders, such as a docs/old-plans.md folder) in a project root's docs/ whose names match
const docsFiles = (root, name) => {
  const docs = path.join(root, "docs");
  return fs
    .readdirSync(docs, { withFileTypes: true })
    .filter((e) => e.isFile() && name.test(e.name))
    .map((e) => path.join(docs, e.name));
};

// The fresh docs/*plan*.md files of a project root that hold rows or unticked boxes
function openPlans(root) {
  const docs = path.join(root, "docs");
  if (!fs.existsSync(docs) || !fs.statSync(docs).isDirectory()) return [];
  const since = Date.now() - OPEN_HOURS * 3600e3;
  return docsFiles(root, PLAN_NAME)
    .filter((file) => {
      if (fs.statSync(file).mtimeMs < since) return false;
      const text = readText(file);
      return (
        text.split("\n").some((l) => ROW_LINE.test(l)) || UNTICKED.test(text)
      );
    });
}
const openJob = (root) =>
  UNTICKED.test(readText(path.join(root, "HANDOFF.md"))) ||
  openPlans(root).length > 0;

// A plan's rows: Map(row -> done by its last cell)
function rowsOf(text) {
  const rows = new Map();
  for (const line of text.split("\n")) {
    const r = line.match(ROW_LINE);
    if (!r) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    rows.set(r[1].toUpperCase(), ROW_DONE.test(cells[cells.length - 1]));
  }
  return rows;
}

// The row this session claimed, in an open plan of one of the roots or in a lane state file (docs/*state*.md) beside
// it: { plan, row, rows: Map(row -> done) } with the plan that holds the row, or null. A claim in a state file whose
// row no open plan holds has no rows (nothing is held).
function claimOf(roots, sessionId) {
  const id = String(sessionId ?? "").slice(0, 8);
  if (!/^[\w-]{8}$/.test(id)) return null;
  const mark = new RegExp(
    `\\bsession\\s+${id}\\s*:\\s*([A-Za-z]*\\d+[a-z]?)\\b`,
    "i",
  );
  for (const root of roots) {
    const plans = openPlans(root);
    if (!plans.length) continue;
    const states = docsFiles(root, STATE_NAME);
    for (const file of [...plans, ...states]) {
      const m = readText(file).match(mark);
      if (!m) continue;
      const row = m[1].toUpperCase();
      const tables = plans.map((plan) => ({
        plan,
        rows: rowsOf(readText(plan)),
      }));
      const own =
        tables.find((t) => t.plan === file) ??
        tables.find((t) => t.rows.has(row));
      return own
        ? { plan: own.plan, row, rows: own.rows }
        : { plan: file, row, rows: new Map() };
    }
  }
  return null;
}

// This session's claim: found in the files (and then kept in its state as { row, plan }), else the one kept, with the
// plan's rows read again. Kept, because marking the row done may replace the claim in its State cell.
function claimFor(event, roots, file) {
  const state = readJson(file, { missing: {} });
  const c = claimOf(roots, event.session_id);
  if (c) {
    if (state.claim?.row !== c.row || state.claim?.plan !== c.plan)
      writeJson(file, { ...state, claim: { row: c.row, plan: c.plan } });
    return c;
  }
  if (!state.claim) return null;
  const inPlan = PLAN_NAME.test(path.basename(state.claim.plan));
  return {
    ...state.claim,
    rows: inPlan ? rowsOf(readText(state.claim.plan)) : new Map(),
  };
}

// Once per main session, while an open plan is in its folder and it has no claim yet: its id's first 8 characters,
// so it can write the claim (a session can't read its own id anywhere else)
function idNote(event, file) {
  if (readJson(file, { missing: {} }).idNoted) return null;
  const id = String(event.session_id ?? "").slice(0, 8);
  const root = repoRoot(String(event.cwd || process.cwd()));
  if (!/^[\w-]{8}$/.test(id) || !root) return null;
  const plans = openPlans(root);
  if (!plans.length || claimFor(event, [root], file)) return null;
  const plan = plans.sort(
    (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs,
  )[0];
  writeJson(file, { ...readJson(file, { missing: {} }), idNoted: true });
  return `[job-done] This session's id starts with ${id}. If you run a row of ${path.relative(root, plan).replace(/\\/g, "/")}, first write \`session ${id}: <row>\` in that row's State cell or your lane's state file.`;
}
const rowsLeft = (c) =>
  [...c.rows].some(([row, done]) => row !== c.row && !done);

// The commit or merge git call in a Bash command: its subcommand, where it starts, the -C folders of that call, and the
// words after the subcommand up to the next && ; | or line end
const words = (s) =>
  [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (m) => m[1] ?? m[2] ?? m[3],
  );
function gitCall(command) {
  const m = command.match(GIT_PIECE);
  if (!m) return null;
  const dashC = [...m[0].matchAll(/\s-C\s+("([^"]*)"|'([^']*)'|(\S+))/g)].map(
    (c) => gitBashToNative(c[2] ?? c[3] ?? c[4]),
  );
  return {
    sub: m[4],
    at: m.index,
    dashC,
    args: words(command.slice(m.index + m[0].length).split(/&&|;|\|\|?|\n/)[0]),
  };
}

// The repository folder a commit call works in: the Nimbalyst tool's is the session's; for Bash the -C of the commit's
// own git call, else the last `cd <dir>` before it, else the session's cwd
function commitDir(event) {
  const cwd = String(event.cwd || process.cwd());
  if (event.tool_name === COMMIT_TOOL) return cwd;
  const command = String(event.tool_input?.command ?? "");
  const call = gitCall(command);
  if (call.dashC.length) return path.resolve(cwd, ...call.dashC);
  const cd = [
    ...command
      .slice(0, call.at)
      .matchAll(/(?:^|[;&|]\s*)cd\s+("([^"]*)"|'([^']*)'|([^\s;&|]+))/g),
  ].pop();
  return cd ? path.resolve(cwd, gitBashToNative(cd[2] ?? cd[3] ?? cd[4])) : cwd;
}
const isCommitCall = (event) => {
  if (event.tool_name === COMMIT_TOOL) return true;
  const command = String(event.tool_input?.command ?? "");
  return (
    event.tool_name === "Bash" &&
    GIT_PIECE.test(command) &&
    !/\s--amend\b/.test(command)
  );
};

// Files a commit call is about to commit, or [] when not known: the Nimbalyst tool's list; for Bash the paths given to
// git commit (after its options, or after "--"), else the paths of "git add" in the command plus what is staged
// (unknown with -a or "git add -A/."). A merge has no paths of its own.
const VALUE_OPTION =
  /^(-[a-zA-Z]*[mFCct]|--(message|file|reuse-message|reedit-message|author|date|template|fixup|squash|trailer|cleanup))$/;
function filesToCommit(event, root) {
  if (event.tool_name === COMMIT_TOOL)
    return (event.tool_input?.filesToStage ?? []).map(String);
  const command = String(event.tool_input?.command ?? "");
  const call = gitCall(command);
  if (call.sub !== "commit") return [];
  const paths = [];
  let all = false;
  for (let i = 0; i < call.args.length; i++) {
    const a = call.args[i];
    if (a === "--") {
      paths.push(...call.args.slice(i + 1));
      break;
    }
    if (a.startsWith("-")) {
      if (a === "--all" || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a)) all = true;
      if (VALUE_OPTION.test(a)) i++;
    } else if (!/^[<>$()]/.test(a)) paths.push(a); // not a heredoc or a $(...) message
  }
  if (paths.length) return paths;
  if (all) return [];
  const files = [];
  for (const m of command.matchAll(/\bgit\b[^|;&\n]*?\sadd\s+([^|;&\n]+)/g)) {
    const args = words(m[1]);
    if (args.some((a) => a.startsWith("-") || a === ".")) return [];
    files.push(...args);
  }
  return [
    ...files,
    ...(git(root, ["diff", "--cached", "--name-only"]) ?? "")
      .split("\n")
      .filter(Boolean),
  ];
}

const stateOf = (event) => stateFile("job-done", sessionKey(event.session_id));

function pieceCommitted(event) {
  if (!isCommitCall(event)) return;
  const root = repoRoot(commitDir(event));
  if (!root || linkedWorktree(root) || !freshHead(root)) return;
  if (
    recordsOnly(
      (git(root, ["show", "--name-only", "--format=", "HEAD"]) ?? "")
        .split("\n")
        .filter(Boolean),
    )
  )
    return;
  const roots = [
    ...new Set(
      [repoRoot(String(event.cwd || process.cwd())), root].filter(Boolean),
    ),
  ];
  if (!roots.some(openJob)) return;
  sweep("job-done", 2);
  const file = stateOf(event);
  writeJson(file, {
    ...readJson(file, { missing: {} }),
    piece: { root: fileKey(root), at: Date.now() },
  });
  claimFor(event, roots, file); // kept from here on, whatever the State cell says later
  emit.context("PostToolUse", PIECE_TEXT);
}

// How to mark the claimed row done without losing the claim
const doneText = (event, c) =>
  `Set ${c.row}'s State to \`done <hash>, session ${String(event.session_id).slice(0, 8)}: ${c.row}\` (keep the claim in the cell)`;

function holdNextPiece(event) {
  const file = stateOf(event);
  const state = readJson(file, { missing: {} });
  if (!state.piece || state.refused) return;
  const cwdRoot = repoRoot(String(event.cwd || process.cwd()));
  let root = null;
  let named = [];
  if (AGENT_TOOL.test(String(event.tool_name))) {
    named =
      String(event.tool_input?.description ?? "").match(
        /\b[A-Z]+\d+[a-z]?\b/g,
      ) ?? [];
    if (!named.length) return;
  } else if (isCommitCall(event)) {
    root = repoRoot(commitDir(event));
    if (!root || fileKey(root) !== state.piece.root) return; // another repository, or a linked worktree
    if (recordsOnly(filesToCommit(event, root))) return;
  } else return;
  const c = claimFor(
    event,
    [...new Set([cwdRoot, root].filter(Boolean))],
    file,
  );
  if (!c || !rowsLeft(c)) return;
  const next = named
    .map((r) => r.toUpperCase())
    .find((r) => r !== c.row && c.rows.has(r));
  if (!root && !next) return;
  writeJson(file, { ...readJson(file, { missing: {} }), refused: true });
  const what = next
    ? `Starting ${next} here begins the next row in this session.`
    : "A second commit here begins the next piece in this session.";
  emit.deny(
    `[job-done] Refused once: this session claimed ${c.row} in ${path.basename(c.plan)}, and its commit has landed: ${c.row} is done. ${what} ${doneText(event, c)}, commit the plan or state file, then hand off with the handoff skill (it opens the fresh session for the next row with its prompt queued) and end this turn. If this call really belongs to ${c.row}, send it again: it passes (refused once).`,
  );
}

// Whether the main chain holds a hand-off call made at or after a time: the handoff Skill, spawn_session, steer.mjs moved
function handedOffSince(file, at) {
  for (const e of backEntries(file)) {
    if (e.timestamp && Date.parse(e.timestamp) < at) return false;
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      if (b.type !== "tool_use") continue;
      if (/spawn_session$/.test(b.name)) return true;
      if (
        b.name === "Skill" &&
        String(b.input?.skill ?? "").replace(/^.*:/, "") === "handoff"
      )
        return true;
      if (
        b.name === "Bash" &&
        /steer\.mjs["']?\s+moved\b/.test(String(b.input?.command ?? ""))
      )
        return true;
    }
  }
  return false;
}

function holdAtEnd(event) {
  if (
    event.stop_hook_active ||
    !event.transcript_path ||
    !fs.existsSync(event.transcript_path)
  )
    return;
  const file = stateOf(event);
  const state = readJson(file, { missing: {} });
  if (!state.piece || state.stopBlocked === state.piece.at) return;
  const cwdRoot = repoRoot(String(event.cwd || process.cwd()));
  const c = cwdRoot && claimFor(event, [cwdRoot], file);
  if (
    !c ||
    !rowsLeft(c) ||
    handedOffSince(event.transcript_path, state.piece.at)
  )
    return;
  writeJson(file, {
    ...readJson(file, { missing: {} }),
    stopBlocked: state.piece.at,
  });
  emit.block(
    `[job-done] This session claimed ${c.row} in ${path.basename(c.plan)} and committed it, and rows are left. ${doneText(event, c)}, then run the handoff skill now (it opens the fresh session for the next row with its prompt queued), then end. If ${c.row} still has work, finish it first; this check stops the turn once per commit.`,
  );
}

// The ask note: a committed job's session at a large context gets a next ask (once per commit)
function askNote(event, prompt, file) {
  if (!event.transcript_path || !fs.existsSync(event.transcript_path))
    return null;
  // Context size of the last main-conversation API call, or what a later compact left
  const context =
    lastUsage(backEntries(event.transcript_path), { compact: true })?.tokens ??
    0;
  if (context <= CONTEXT_K * 1000) return null;
  const commitId = commitSincePrevTyped(event.transcript_path, prompt);
  if (!commitId) return null;
  const state = readJson(file, { missing: {} });
  if (state.commitId === commitId) return null;
  writeJson(file, { ...state, commitId });
  const k = Math.round(context / 1000);
  return `[job-done] The job in this session is committed at ~${k}k tokens. If this message starts a new job rather than a question about the finished one, move it to a fresh session first (handoff skill): a fresh session starts at ~40k and every call there costs a third.`;
}

runHook("job-done", (event) => {
  if (event.agent_id) return;
  if (event.hook_event_name === "PostToolUse") return pieceCommitted(event);
  if (event.hook_event_name === "PreToolUse") return holdNextPiece(event);
  if (event.hook_event_name === "Stop") return holdAtEnd(event);
  const prompt = String(event.prompt ?? "").trim();
  if (prompt.startsWith("/") || INJECTED.test(prompt)) return;
  sweep("job-done", 2);
  const file = stateOf(event);
  const notes = [idNote(event, file), askNote(event, prompt, file)].filter(
    Boolean,
  );
  if (notes.length) emit.context("UserPromptSubmit", notes.join("\n"));
});
