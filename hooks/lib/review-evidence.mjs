// What the code-review gate reads before it decides: this session's transcript and its helpers' (<transcript>/subagents),
// other sessions' transcripts, git, and the gate's own files in hooks/state/code-review-gate/. gather() returns it as
// plain data for assess() in review-decide.mjs.
// Git is read too, since sed, a merge, a generator or a script change files with no Edit in the transcript: the files
// changed since the baseline stored at SessionStart (working-tree files that differ from its dirty set, and the user's
// own commits since its HEAD: a merged helper branch counts, a `git pull` of other people's commits doesn't).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileKey, sessionKey } from "./paths.mjs";
import { readJson, stateFile, writeJson } from "./state.mjs";
import {
  entries as readEntries,
  userText,
  typedByUser,
  currentTurn,
  agentLaunches,
} from "./transcript.mjs";
import { EDIT_TOOLS, MIN_FILES, inWindow } from "./review-decide.mjs";
import { isCode, isSetup } from "./code-files.mjs";

// Per session: the once-per-turn marker (its time is the last block's), the work held over a question, the git
// baseline and the cache of what other sessions edited
export const gatePaths = (sessionId) => {
  const key = sessionKey(sessionId),
    file = (end) => stateFile("code-review-gate", key + end);
  return {
    marker: file(""),
    held: file(".held"),
    base: file(".base"),
    others: file(".others"),
  };
};

// The user typed /code-review: the turn is the review and its fixes
const typedReview = (e) =>
  /<command-name>\/?([\w-]+:)?code-review<\/command-name>|^\/code-review(?=\s|$)/.test(
    userText(e).trim(),
  );

const entriesOf = (text) =>
  text.split("\n").flatMap((l) => {
    try {
      return l.trim() ? [JSON.parse(l)] : [];
    } catch {
      return [];
    }
  });
// Only the lines that can matter are parsed: a long session's transcript is big
const EDIT_LINE = /"is_error":true|review|"name":"(Edit|Write|NotebookEdit)"/;
const editEntries = (lines) =>
  entriesOf(lines.filter((l) => EDIT_LINE.test(l)).join("\n"));
const helperFolder = (transcript) =>
  path.join(transcript.replace(/\.jsonl$/, ""), "subagents");
const mtimeOf = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
};
const listDir = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}; // no such folder: nothing in it

// Each reviewer helper's last entry, by the id of the call that started it: whether it came back with a report is
// review-decide's `reported`. An Agent call going through proves nothing
function reviewers(transcript) {
  const folder = helperFolder(transcript),
    out = [];
  for (const name of listDir(folder)) {
    if (!name.endsWith(".meta.json")) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(folder, name), "utf8"));
      if (meta.agentType !== "reviewer" || !meta.toolUseId) continue;
      const last = JSON.parse(
        fs
          .readFileSync(
            path.join(folder, name.replace(/\.meta\.json$/, ".jsonl")),
            "utf8",
          )
          .trim()
          .split("\n")
          .pop(),
      );
      const said = Array.isArray(last.message?.content)
        ? last.message.content
            .filter((b) => b.type === "text")
            .map((b) => b.text || "")
            .join("\n")
        : "";
      out.push({ id: meta.toolUseId, type: last.type, said });
    } catch {
      // a file being written is judged on the next stop
    }
  }
  return out;
}

// Each helper's transcript: its last write and its briefs. A worker reused for the next step keeps one file: each brief
// in it is a step. Its own wake-ups and compactions are not briefs
function helpers(transcript) {
  const folder = helperFolder(transcript),
    out = [];
  for (const name of listDir(folder)) {
    if (!/^agent-.*\.jsonl$/.test(name)) continue;
    const p = path.join(folder, name),
      mtimeMs = fs.statSync(p).mtimeMs;
    const briefs = [[]];
    for (const l of fs.readFileSync(p, "utf8").split("\n")) {
      if (
        /"type":"user"/.test(l) &&
        !/"tool_result"|<task-notification>|"isCompactSummary":true/.test(l)
      )
        briefs.push([]);
      briefs.at(-1).push(l);
    }
    out.push({ mtimeMs, briefs: briefs.map(editEntries) });
  }
  return out;
}

// Every other session's transcript and its helpers', in every project, since a session in one project can edit another's
// files (without this a reviewer was once forced on another session's CLAUDE.md edits). This ties the gate to Claude Code's
// layout, <config>/projects/<project>/<session>.jsonl: none when the transcript isn't there
function otherTranscripts(transcript) {
  if (!transcript) return [];
  const root = path.dirname(path.dirname(transcript)),
    own = path.resolve(transcript.replace(/\.jsonl$/, ""));
  if (path.basename(root).toLowerCase() !== "projects") return [];
  const files = [];
  for (const project of listDir(root)) {
    for (const name of listDir(path.join(root, project))) {
      const p = path.join(root, project, name);
      if (name.endsWith(".jsonl")) {
        if (path.resolve(p) !== path.resolve(transcript)) files.push(p);
        continue;
      }
      if (path.resolve(p) !== own)
        for (const s of listDir(path.join(p, "subagents")))
          if (s.endsWith(".jsonl")) files.push(path.join(p, "subagents", s));
    }
  }
  return files;
}
// A transcript's path and git's can name one file two ways: macOS /var is /private/var, Windows has short 8.3 names
const realKey = (p) => {
  try {
    return fileKey(fs.realpathSync.native(p));
  } catch {
    return fileKey(p);
  }
};
// Their sizes when this session starts: what they held then is older than the session, so it is never read
const transcriptSizes = (transcript) =>
  Object.fromEntries(
    otherTranscripts(transcript).map((f) => {
      try {
        return [f, fs.statSync(f).size];
      } catch {
        return [f, 0];
      }
    }),
  );

// Which of these files another session or its helpers edited since sinceMs: git shows them dirty here, but they are that
// session's work (a sed or script of the other session still counts). Only what was added to each transcript since the
// session started (startSizes) or the last stop (the cache) is read: a busy day's transcripts can be hundreds of MB.
// An edit refused in a later read than its call still counts as made (it only leaves a file out)
function othersEdits(transcript, sinceMs, keys, cacheFile, startSizes = {}) {
  let cache = readJson(cacheFile);
  if (!cache || cache.since !== sinceMs)
    cache = { since: sinceMs, offsets: { ...startSizes }, edited: [] };
  const edited = new Set(cache.edited);
  for (const file of otherTranscripts(transcript)) {
    let size;
    try {
      const st = fs.statSync(file);
      if (st.mtimeMs < sinceMs) continue;
      size = st.size;
    } catch {
      continue;
    }
    let from = cache.offsets[file] || 0;
    if (from > size) from = 0; // the file was written anew
    if (from === size) continue;
    // A transcript removed or cut while it is read, or one too big for a string, is left out, not the whole git count
    let text, end;
    try {
      const buf = Buffer.alloc(size - from),
        fd = fs.openSync(file, "r");
      try {
        fs.readSync(fd, buf, 0, buf.length, from);
      } finally {
        fs.closeSync(fd);
      }
      end = buf.lastIndexOf(10) + 1; // whole lines only; a line being written is read at the next stop
      text = buf.subarray(0, end).toString("utf8");
    } catch {
      continue;
    }
    if (!end) continue;
    cache.offsets[file] = from + end;
    const entries = inWindow(editEntries(text.split("\n")), sinceMs),
      refused = new Set();
    for (const e of entries)
      for (const b of Array.isArray(e.message?.content)
        ? e.message.content
        : [])
        if (b.type === "tool_result" && b.is_error) refused.add(b.tool_use_id);
    for (const e of entries)
      for (const b of Array.isArray(e.message?.content)
        ? e.message.content
        : []) {
        const p =
          b.type === "tool_use" &&
          EDIT_TOOLS.test(b.name) &&
          !refused.has(b.id) &&
          (b.input?.file_path || b.input?.notebook_path);
        if (p) edited.add(realKey(p));
      }
  }
  writeJson(cacheFile, { ...cache, edited: [...edited] });
  return new Set([...keys].filter((k) => edited.has(realKey(k))));
}

// Counting from git. Every call is short and any failure throws, which callers turn into "no git files"
const GIT_TIMEOUT = 3000;
// The first git on the PATH, in PATH order like a shell, but never from the current folder (a repo can't plant one)
let gitPath;
function gitOnPath() {
  if (gitPath !== undefined) return gitPath;
  const win = process.platform === "win32";
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH");
  const names = win ? ["git.exe", "git.cmd"] : ["git"];
  gitPath = null;
  for (const dir of String((key && process.env[key]) || "").split(
    path.delimiter,
  )) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const hit = names
      .map((n) => path.join(dir, n))
      .find((f) => {
        try {
          return fs.statSync(f).isFile();
        } catch {
          return false;
        }
      });
    if (hit) {
      gitPath = hit;
      break;
    }
  }
  return gitPath;
}
const runGit = (cwd, args) => {
  const opts = {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  };
  // git.exe runs directly, with no shell. Only a git.cmd shim (first on the PATH on Windows) goes through the
  // shell, and then never with a value (a repo's user.email, a file name) that cmd would read as its own syntax.
  const git = gitOnPath();
  if (!git) throw new Error("git is not on the PATH");
  let r;
  if (/\.cmd$/i.test(git)) {
    if (args.some((a) => /["%!\r\n]/.test(a)))
      throw new Error(`git ${args[0]}: a value the shell would read`);
    r = spawnSync(`"${git}" ${args.map((a) => `"${a}"`).join(" ")}`, {
      ...opts,
      shell: true,
    });
  } else r = spawnSync(git, args, opts);
  if (r.error || r.status !== 0)
    throw new Error(`git ${args[0]} gave no answer`);
  return r.stdout;
};
const fileSig = (abs) => {
  try {
    const s = fs.statSync(abs);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "gone";
  }
};

// Where the repo is, its HEAD and the files that are dirty now, each with a signature (time and size) to tell a further change from none
function gitNow(cwd) {
  const [top, head] = runGit(cwd, ["rev-parse", "--show-toplevel", "HEAD"])
    .split("\n")
    .map((s) => s.trim());
  if (!top || !head) throw new Error("git gave no top or HEAD");
  const dirty = {},
    parts = runGit(top, [
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
    ]).split("\0");
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    if (/[RC]/.test(e.slice(0, 2))) i++; // a rename lists the old name after the new one
    dirty[e.slice(3)] = fileSig(path.join(top, e.slice(3)));
  }
  return { top, head, dirty, at: Date.now(), seen: [] };
}

// The SessionStart baseline: git now and the other transcripts' sizes. null when git can't say (no repo, no git, or
// slower than GIT_TIMEOUT): the gate then counts from the transcript only
export function baseline(cwd, transcript) {
  try {
    return { ...gitNow(cwd), others: transcriptSizes(transcript) };
  } catch {
    return null;
  }
}

// The code and setup files changed since the stored baseline, each { key, name, mtimeMs } (null for a file deleted since),
// without the ones another session edited. { base: null, newBase } when there is no baseline for this repo yet; null
// when git fails or is slow (the transcript count alone)
function gitChanges(cwd, files, transcript) {
  try {
    const now = gitNow(cwd),
      base = readJson(files.base);
    if (!base || base.top !== now.top)
      return {
        base: null,
        newBase: { ...now, others: transcriptSizes(transcript) },
      };
    const changed = new Set(
      Object.entries(now.dirty)
        .filter(([rel, sig]) => base.dirty[rel] !== sig)
        .map(([rel]) => rel),
    );
    // A commit of a file that was dirty at the start and hasn't changed since is not new work
    if (now.head !== base.head) {
      const email = runGit(now.top, ["config", "user.email"]).trim();
      if (!email) throw new Error("git has no user.email");
      const log = runGit(now.top, [
        "-c",
        "core.quotepath=false",
        "log",
        "--no-merges",
        "--fixed-strings",
        `--author=<${email}>`,
        "--name-only",
        "--pretty=format:",
        `${base.head}..HEAD`,
      ]);
      for (const rel of log.split("\n").map((r) => r.trim()))
        if (rel && base.dirty[rel] !== fileSig(path.join(now.top, rel)))
          changed.add(rel);
    }
    const list = [];
    for (const rel of changed) {
      if (!isCode(rel) && !isSetup(rel)) continue; // the repo's own path, so a repo inside a temp folder still counts
      const abs = path.join(now.top, rel);
      list.push({
        key: fileKey(abs),
        name: path.basename(rel),
        mtimeMs: mtimeOf(abs),
      });
    }
    // A file another session edited is its work, not this one's; one this session edited too counts from its own transcript
    const theirs = list.length
      ? othersEdits(
          transcript,
          base.at,
          new Set(list.map((f) => f.key)),
          files.others,
          base.others,
        )
      : new Set();
    return { base, changed: list.filter((f) => !theirs.has(f.key)) };
  } catch {
    return null;
  }
}

// Everything assess() needs, for the Stop arm (pre false) and the push check (pre true). The turn starts at the user's
// last typed message. Led mode counts no git files
export function gather(input, mode, pre) {
  const transcript = input.transcript_path,
    files = gatePaths(input.session_id);
  const text = fs.readFileSync(transcript, "utf8"),
    lines = text.split("\n");
  const { start, entries: turn } = currentTurn(readEntries(lines), {
    typed: true,
  });
  const session = editEntries(lines);
  const asked = mtimeOf(files.marker) ?? 0;
  return {
    pre,
    mode,
    now: Date.now(),
    minFiles: Number(process.env.CODE_REVIEW_MIN_FILES) || MIN_FILES,
    start,
    startMs: Date.parse(start?.timestamp) || 0,
    typedReview: Boolean(start && typedReview(start)),
    turn,
    session,
    typedReviews: session
      .filter((e) => typedByUser(e) && typedReview(e))
      .map((e) => Date.parse(e.timestamp) || 0),
    shell: entriesOf(
      lines.filter((l) => /"name":"(Bash|PowerShell)"/.test(l)).join("\n"),
    ).flatMap((e) =>
      (Array.isArray(e.message?.content) ? e.message.content : [])
        .filter(
          (b) => b.type === "tool_use" && /^(Bash|PowerShell)$/.test(b.name),
        )
        .map((b) => ({
          at: Date.parse(e.timestamp) || 0,
          command: String(b.input?.command || ""),
        })),
    ),
    launches: agentLaunches(readEntries(text))
      .filter((l) => l.async)
      .map(({ task }) => ({
        id: task,
        noticed: text.includes(`<task-id>${task}</task-id>`),
        mtimeMs: mtimeOf(
          path.join(helperFolder(transcript), `agent-${task}.jsonl`),
        ),
      })),
    reviewers: reviewers(transcript),
    helpers: helpers(transcript),
    // the marker's time is the last block; after a typed review it also starts the file count again
    asked,
    typedEnd: asked && readJson(files.marker)?.typed ? asked : 0,
    held: readJson(files.held),
    git:
      mode === "led"
        ? null
        : gitChanges(
            process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd(),
            files,
            transcript,
          ),
  };
}
