// The code-review gate's decision: assess(evidence) takes what review-evidence.mjs gathered and returns the verdict.
// Nothing here reads a file, the clock or the environment, so each rule can be tested on a made-up session.
// The constants were fitted on 30 days of real sessions (the November 2026 tuning study): change them from new numbers only.
import path from "node:path";
import { isCode, isSetup } from "./code-files.mjs";
import { fileKey } from "./paths.mjs";

export const MIN_FILES = 10; // different code files since the last review (CODE_REVIEW_MIN_FILES changes it)
export const MIN_STEPS = 2; // helper steps that edited code: a job of several steps
export const NEW_JOB_FILES = 5; // after a review, what 2 helpers must have changed to be a new job and not its fixes
export const NOTE_WINDOW = 30 * 60000; // this turn's helpers count from this long before the user's last message
export const HELPER_IDLE = 10 * 60000; // a background helper with no notice and no write for this long is a leftover of a restart
export const SMALL_SETUP_LINES = 10; // rule text edited by fewer lines than this in all needs no reviewer
// The reviewer agent's report (agents/reviewer.md) has an "Against the request" line. A last message without it and
// shorter than REPORT_MIN is a reviewer cut at its limit or one that found nothing to look at: it reviewed nothing
export const REPORT_PHRASE = "Against the request";
export const REPORT_MIN = 300;

export const EDIT_TOOLS = /^(Edit|Write|NotebookEdit)$/;
// A review: the code-review skill, or a `reviewer` agent (one that came back with a report: see reported)
const isReview = (b) =>
  (b.name === "Skill" &&
    /(^|:)code-review$/.test(
      String(b.input?.skill || "")
        .trim()
        .replace(/^\//, ""),
    )) ||
  (/^(Agent|Task)$/.test(b.name) && b.input?.subagent_type === "reviewer");
const FRONTMATTER_KEY =
  /^(tools|model|permissionMode|allowed-tools|disallowedTools|hooks|mcpServers|effort|isolation):/im;
// An agent's .md is its permissions as much as its text, so agents/ is never excused
const isProse = (k) =>
  /\.md$/i.test(k) && !/\.claude\/(hooks|agents)\//i.test(k);

export const inWindow = (entries, sinceMs, untilMs = Infinity) =>
  entries.filter((e) => {
    const t = Date.parse(e.timestamp);
    return !t || (t >= sinceMs && t < untilMs);
  });

// The code and setup files changed since the last review in these entries, and when that review was. Only calls that went through count
export function editsSinceReview(entries, notRun = []) {
  const refused = new Set(notRun);
  for (const e of entries) {
    if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content)
      if (b.type === "tool_result" && b.is_error) refused.add(b.tool_use_id);
  }
  let files = new Map(),
    lines = new Map(),
    reviewedAt = 0,
    reviewedWork = false,
    reviewBrief = "";
  const count = (s) => String(s ?? "").split("\n").length;
  for (const e of entries) {
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      if (b.type !== "tool_use" || refused.has(b.id)) continue;
      if (isReview(b)) {
        reviewedWork ||= files.size > 0;
        files = new Map();
        lines = new Map();
        reviewedAt = Date.parse(e.timestamp) || reviewedAt;
        reviewBrief = JSON.stringify(b.input);
      }
      const p = b.input?.file_path || b.input?.notebook_path;
      if (EDIT_TOOLS.test(b.name) && p && (isCode(p) || isSetup(p))) {
        const k = fileKey(p);
        files.set(k, path.basename(String(p)));
        // replace_all changes every match, and a frontmatter key (tools, model, allowed-tools...) changes what a skill may do: both count in full
        const text = `${b.input.old_string ?? ""}\n${b.input.new_string ?? ""}\n${b.input.content ?? ""}`;
        const n =
          b.input.replace_all || FRONTMATTER_KEY.test(text)
            ? Infinity
            : b.name === "Edit"
              ? Math.max(count(b.input.old_string), count(b.input.new_string))
              : b.name === "Write"
                ? count(b.input.content)
                : Infinity;
        lines.set(k, (lines.get(k) || 0) + n);
      }
    }
  }
  return { files, lines, reviewedAt, reviewedWork, reviewBrief };
}

// Rule text (a CLAUDE.md, a skill or rule .md) edited by a few lines in all since the last review needs no reviewer.
// Hooks, settings and code always count, and so does a file a helper changed: its size is not known here
export function smallSetupEdits(lineMap, otherKeys = new Set()) {
  const prose = [...lineMap].filter(([k]) => isSetup(k) && isProse(k));
  const total = prose.reduce((s, [, n]) => s + n, 0);
  return new Set(
    total < SMALL_SETUP_LINES
      ? prose.map(([k]) => k).filter((k) => !otherKeys.has(k))
      : [],
  );
}

// A reviewer's last entry is a report: it ends on text, with the report's line or long enough to be one
export const reported = (r) =>
  r.type === "assistant" &&
  (r.said.includes(REPORT_PHRASE) || r.said.length >= REPORT_MIN);

// What helpers changed between two times. A helper resumed for a fix keeps its whole history in one file, so the
// time of each entry decides; one last written before sinceMs is older work. Each brief that edited is a step
export function helperEdits(helpers, sinceMs, untilMs = Infinity) {
  const files = new Map();
  let steps = 0;
  for (const h of helpers) {
    if (h.mtimeMs < sinceMs) continue;
    for (const brief of h.briefs) {
      const edited = editsSinceReview(inWindow(brief, sinceMs, untilMs)).files;
      if (edited.size) steps++;
      for (const [k, v] of edited) files.set(k, v);
    }
  }
  return { files, steps };
}

// The git files that count: changed since the baseline and, after a review, written after it; fresh = not seen at an
// earlier stop. The Stop arm writes the baseline back (writeBase): a new one, or the old one with what it has now seen
function gitFiles(ev, since) {
  const none = { all: new Map(), fresh: new Map(), writeBase: null };
  if (!ev.git) return none;
  if (!ev.git.base)
    return { ...none, writeBase: ev.pre ? null : ev.git.newBase }; // a session with no baseline starts one now
  const all = new Map(
    ev.git.changed
      .filter((f) => !since || (f.mtimeMs !== null && f.mtimeMs > since))
      .map((f) => [f.key, f.name]),
  );
  const seen = new Set(ev.git.base.seen);
  const fresh = new Map([...all].filter(([k]) => !seen.has(k)));
  return {
    all,
    fresh,
    writeBase:
      !ev.pre && fresh.size ? { ...ev.git.base, seen: [...all.keys()] } : null,
  };
}

// Whether a lowercased shell command names the file of key k. A key keeps its case on macOS and Linux (fileKey), so
// its name is lowercased here too
export const namesFile = (command, k) =>
  command.includes(k.split("/").pop().toLowerCase());

// The verdict on one session, for the Stop arm and the push check (ev.pre). ev is gather()'s result (review-evidence.mjs).
// Returns { typed: true } for a turn the user started with /code-review; else { due, dropHeld, writeBase } and, when it
// got as far as counting, { files, setupFiles, steps, notRun, held, big, several, setup }: names, helper steps, the count
// of reviewers that left no report, the work held over a question, and which of the three reasons applies.
// The gate asks for a review, not a count (the lead skill sets one reviewer, 2 for a change with separate parts one
// reviewer can't read whole, 3 at most, plus a blind-reviewer): a review this turn, after the work, ends the gate for the turn; after a review earlier in the
// session it takes MIN_FILES files, or 2 helpers on NEW_JOB_FILES: fewer than that are mostly fixing its findings
export function assess(ev) {
  if (ev.typedReview) return { typed: true };
  const pass = { due: false, dropHeld: false, writeBase: null };
  // A background helper still at work: the job isn't finished, and its notice brings another stop. The push is happening now
  if (
    !ev.pre &&
    ev.launches.some(
      (l) =>
        !l.noticed && l.mtimeMs !== null && ev.now - l.mtimeMs < HELPER_IDLE,
    )
  )
    return pass;
  const notRun = new Set(
    ev.reviewers.filter((r) => !reported(r)).map((r) => r.id),
  );
  // This turn's helpers: since the last block, or else from NOTE_WINDOW before the user's last message, so a note typed
  // while a job finishes doesn't hide the job. The push check asks about the whole session
  const from = ev.pre
    ? 0
    : Math.max((ev.startMs || ev.now) - NOTE_WINDOW, ev.asked);
  const main = editsSinceReview(ev.turn, notRun);
  if (
    main.reviewedWork ||
    (main.reviewedAt &&
      helperEdits(ev.helpers, from, main.reviewedAt).files.size)
  )
    return pass;
  // The session's last review; a /code-review the user typed counts. Only a review starts the file count again
  const last = editsSinceReview(ev.session, notRun);
  const reviewedAt = Math.max(last.reviewedAt, ...ev.typedReviews);
  const since = Math.max(reviewedAt, ev.typedEnd);
  // What was due when a reply ended in a question stays due after the answer, until a review
  const dropHeld = !!(ev.held && since >= ev.held.at);
  const held = dropHeld ? null : ev.held;
  const helpers = helperEdits(ev.helpers, Math.max(from, reviewedAt));
  const git = gitFiles(ev, since);
  const out = { due: false, dropHeld, writeBase: git.writeBase };
  // A file git shows as changed is this turn's work only if the turn could have changed it: another session, an editor
  // or a generator can dirty the repo while a turn only reads
  const couldChange = ev.turn.some(
    (e) =>
      Array.isArray(e.message?.content) &&
      e.message.content.some(
        (b) =>
          b.type === "tool_use" &&
          /^(Bash|PowerShell|Agent|Task)$/.test(b.name),
      ),
  );
  // nothing changed in this turn, by the helpers of its window or in git since the last stop
  if (
    !ev.pre &&
    !main.files.size &&
    !helpers.files.size &&
    !held &&
    !(git.fresh.size && couldChange)
  )
    return out;
  // Small turns add up, in the main session and in helpers, since the last review. Led mode counts jobs only
  const windowed = editsSinceReview(inWindow(ev.session, since), notRun);
  const earlier =
    ev.mode === "led"
      ? []
      : [
          ...windowed.files,
          ...helperEdits(ev.helpers, since).files,
          ...git.all,
        ];
  // After a review, a setup file its brief named is a fix of what it found. One it didn't name is new work
  const said = last.reviewBrief.replace(/\\+/g, "/").toLowerCase();
  const windowLines = windowed.lines;
  for (const [k, n] of main.lines)
    windowLines.set(k, Math.max(windowLines.get(k) || 0, n));
  // A file a shell command since the review named may have changed past what the Edits counted (sed, a generator).
  // A git commit or a grep that names it is no change
  const shellCommands = ev.shell
    .filter((c) => c.at >= since)
    .map((c) =>
      c.command
        .replace(/^\s*#.*$/gm, "")
        .replace(/\d?>&\d|\d?>\s*\/dev\/null|\d?>\s*\$null/g, "")
        .toLowerCase(),
    )
    .filter((c) =>
      /\b(sed|perl|tee|awk|python3?|node|mv|cp|set-content|out-file|add-content)\b|>/.test(
        c,
      ),
    );
  const shellNamed = (k) => shellCommands.some((c) => namesFile(c, k));
  const small = new Set(
    [...smallSetupEdits(windowLines, new Set(helpers.files.keys()))].filter(
      (k) => !shellNamed(k),
    ),
  );
  const newSetup = [...main.files, ...helpers.files, ...git.all]
    .filter(
      ([k]) =>
        isSetup(k) &&
        !small.has(k) &&
        !said.includes(k.toLowerCase().split("/").slice(-2).join("/")),
    )
    .map(([, name]) => name);
  const setupFiles = [...new Set([...(held?.setup || []), ...newSetup])];
  const files = [
    ...new Set([
      ...(held?.files || []),
      ...new Map([...main.files, ...helpers.files, ...earlier]).values(),
    ]),
  ];
  const big = files.length >= ev.minFiles,
    several = helpers.steps >= MIN_STEPS,
    setup = setupFiles.length > 0;
  const job = several && files.length >= NEW_JOB_FILES;
  // Setup files after a review earlier in the session still count: a broken hook costs every later session. Fixes in the review's own turn don't
  const due = !!(
    held ||
    (reviewedAt ? job : several) ||
    (ev.mode !== "led" && (big || (setup && !main.reviewedAt)))
  );
  return {
    ...out,
    due,
    files,
    setupFiles,
    steps: helpers.steps,
    notRun: notRun.size,
    held,
    big,
    several,
    setup,
  };
}
