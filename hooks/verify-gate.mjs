#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isBuildCode as isCode } from "./lib/code-files.mjs";
// verify-gate: Stop hook. Catches "code was edited and nothing was built or tested after it".
// If the main session edited a code file this turn and no Bash call after the last such edit ran a build or test,
// it blocks once with one line: run the project's build or test, then finish. It never runs a command itself.
// - Running an edited script (python/node/sh ... <its file name>) after its last edit is that file's check; a build checks all.
//   This holds with VERIFY_PATTERN set too: the pattern replaces only the build list.
// - A verify run is a build too: a load of a verify skill (a Skill call of verify or verify-<name>, a Read of
//   .claude/skills/verify<-name>/SKILL.md, the user typing /verify) and then one successful Bash or PowerShell call.
//   It counts at the load: an edit between the load and that call is not cleared.
// - A Bash result marked as an error (a failed build, a refused call) is not a run; a background run is.
// - Only the main session's edits count: a helper's brief carries its own check. Subagents (input with agent_id) skip.
// - Docs, notebooks, JSON outside src/ and files in a temp or scratch folder are not code. A reply ending in a question
//   passes (nothing is remembered: the next stop is judged again).
// - VERIFY_PATTERN (a regex, matched case-insensitively against the whole Bash command) replaces the default list of build
//   and test commands. VERIFY_GATE=off disables the gate: the opt-out for a project whose suite is slow. Both are read from the
//   environment, then from "env" in .claude/settings.local.json and settings.json of the project and the folders above it
//   (settings env may not reach a hook process).
// Blocks at most once per turn, remembered in ~/.claude/hooks/state/verify-gate/<session>.json: stop_hook_active alone
// is not enough, since a block by any other Stop hook sets it too. The turn starts at the user's last typed message.
// --pre (PreToolUse on Bash, PowerShell and the Nimbalyst commit tool): the commit check. A code commit (a code file
// among the paths given to git commit, the staged files, with -a the changed ones, or the Nimbalyst tool's list) is due
// when the session edited a code file inside the commit's repository and no verify run came after the last such edit.
// It counts the main transcript and its helpers' files (<transcript>/subagents/*.jsonl) by entry time; a helper
// counts its own file alone. After any load, a successful shell call naming a file in .claude/skills/verify*/ (the
// skill's script, run again after a fix) is a run at its own place; files in that folder are not code here. The
// commit's folder reads ~ and $VAR as the shell would; a variable set in an earlier call leaves the folder unknown,
// logged as "folder-unknown". Only a project with a verify skill (.claude/skills/verify*/SKILL.md) is checked: in the
// commit's repository, else in the session's folder (a session in one folder that commits another repository). A
// due commit whose message has the line "Verify: skipped — <reason>" passes. The check is the "commit" arm: it logs
// only by default (VERIFY_GATE_COMMIT=enforce or VERIFY_GATE=enforce turns the refusal on), one line per checked code
// commit with its verdict (workers/observe-log.mjs prints them). In enforce a due commit is refused once: the same
// repository and last code edit (kept in the session's state file) pass the next time. VERIFY_GATE=off disables both.
// Fails open; a crash (a failed git call, an unreadable transcript) leaves a line in hooks/state/hook-errors.log.
import {
  emit,
  hookMode,
  isMain,
  observeLine,
  runHook,
} from "./lib/hook-io.mjs";
import { fileKey, gitBashToNative, sessionKey } from "./lib/paths.mjs";
import { setting } from "./lib/settings-env.mjs";
import { readJson, stateFile, sweep, writeJson } from "./lib/state.mjs";
import {
  VERIFY_GATE,
  VERIFY_SKIPPED_RE,
  verifyGateCommit,
} from "./lib/texts.mjs";
import {
  currentTurn,
  entries as readEntries,
  subagentPath,
} from "./lib/transcript.mjs";

const NAME = "verify-gate";
const COMMIT = { arm: "commit", mode: "observe" };
const COMMIT_TOOL = "mcp__nimbalyst__developer_git_commit_proposal";
const LIST_MAX = 6;

const EDIT_TOOLS = /^(Edit|Write|MultiEdit)$/;
const SHELL_TOOLS = /^(Bash|PowerShell)$/;
// The verify skill's own folder: its script is written and fixed during a verify run, so it is not code the commit
// check asks a run for, and a shell call that names a file there is a run of the skill
const VERIFY_DIR = /^\.claude[\\/]skills[\\/]verify(?:-[\w-]+)?[\\/]/i;
const VERIFY_RUN = /\.claude[\\/]skills[\\/]verify(?:-[\w-]+)?[\\/]\S/i;
const isCommitCode = (rel) => isCode(rel) && !VERIFY_DIR.test(rel);

// One command at a time (split on && || ; | and newlines), each anchored at its start, after env assignments, a shell wrapper
// and a Python runner prefix (uv run, poetry run, pipenv run, hatch run)
const BUILD = new RegExp(
  "^(?:\\w+=(?:\"[^\"]*\"|'[^']*'|\\S*)\\s+)*(?:(?:bash|sh|call|cmd\\s+/c)\\s+)?(?:(?:uv|poetry|pipenv|hatch)\\s+run\\s+(?:(?:--(?:with|with-requirements|group|extra|project|directory|package|python|env-file|index|from)|-[pe])\\s+\\S+\\s+|-(?!-(?:with|with-requirements|group|extra|project|directory|package|python|env-file|index|from)\\s|[pe]\\s)\\S+\\s+)*)?(?:\\S*[\\\\/])?(?:" +
    [
      "gradlew(?:\\.bat)?",
      "mvnw?",
      "qbuild(?:\\.\\w+)?",
      "run_all\\.\\w+",
      "run-all\\.\\w+",
      "run-tests?\\.\\w+",
      "make",
      "pytest",
      "tox",
      "tsc",
      "vitest",
      "jest",
      "(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:test|build)\\b",
      "npx\\s+(?:tsc|vitest|jest|playwright)\\b",
      "cargo\\s+(?:build|test|check|clippy)\\b",
      "go\\s+(?:build|test|vet)\\b",
      "dotnet\\s+(?:build|test)\\b",
      "cmake\\s+--build\\b",
      "(?:python3?|py)\\s+(?:-3\\s+)?-m\\s+(?:pytest|unittest)\\b",
      "node\\s+(?:--test\\b|(?:\"[^\"]*[\\\\/]|'[^']*[\\\\/]|[\"']|\\S*[\\\\/])?(?:test-[\\w.-]*|[\\w.-]*[-.]tests?|run-tests?[\\w.-]*|run-all)\\.[cm]?js\\b)",
    ].join("|") +
    ")[\"']?(?:\\s|$)",
  "i",
);
const isBuild = (command, pattern) =>
  pattern
    ? pattern.test(command)
    : command.split(/&&|\|\||;|\||\r?\n/).some((s) => BUILD.test(s.trim()));
// Running an edited script is its check: a generator or tool whose own asserts are its test (the gate asked
// for a build three times after such a script had run and passed)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const runsEdited = (command, names) =>
  names.some((n) =>
    new RegExp(
      "(?:^|[\\s;&|(])(?:python3?|py|node|bash|sh|pwsh|powershell)(?:\\.exe)?(?:\\s+-\\S+)*\\s+[\"']?(?:\\S*[\\\\/])?" +
        esc(n) +
        "[\"']?(?:\\s|$)",
      "i",
    ).test(command),
  );

// A load of a verify skill: a Skill call of verify, verify-<name> or <plugin>:verify, a Read of its SKILL.md, or the
// user typing /verify (the transcript's slash-command entry)
const VERIFY_NAME = /^(?:[\w-]+:)?verify(?:-[\w-]+)?$/;
const VERIFY_FILE =
  /(?:^|[\\/])\.claude[\\/]skills[\\/]verify(?:-[\w-]+)?[\\/]SKILL\.md$/i;
const VERIFY_TYPED =
  /<command-name>\/(?:[\w-]+:)?verify(?:-[\w-]+)?<\/command-name>/;
export const loadsVerify = (b) =>
  (b.name === "Skill" && VERIFY_NAME.test(String(b.input?.skill ?? ""))) ||
  (b.name === "Read" && VERIFY_FILE.test(String(b.input?.file_path ?? "")));
const typedVerify = (e) =>
  e.type === "user" &&
  typeof e.message?.content === "string" &&
  VERIFY_TYPED.test(e.message.content);

// The tool results of a transcript: the ids marked is_error and each result's text
function resultsOf(entries) {
  const failed = new Set();
  const text = new Map();
  for (const e of entries) {
    if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      if (b.type !== "tool_result") continue;
      if (b.is_error) failed.add(b.tool_use_id);
      text.set(
        b.tool_use_id,
        typeof b.content === "string"
          ? b.content
          : Array.isArray(b.content)
            ? b.content.map((c) => c?.text ?? "").join("\n")
            : "",
      );
    }
  }
  return { failed, text };
}

// The code files edited in the turn, and whether a build or test ran after the last of those edits
export function unverified(entries, pattern) {
  const { failed } = resultsOf(entries);
  // per file: its last edit and its last own run; a build clears every file, running a script clears only that script
  const files = new Map();
  let step = 0,
    lastBuild = -1,
    load = -1; // a verify load not yet followed by a successful shell call
  for (const e of entries) {
    if (typedVerify(e)) load = ++step;
    if (
      e.type !== "assistant" ||
      e.isSidechain ||
      !Array.isArray(e.message?.content)
    )
      continue;
    for (const b of e.message.content) {
      if (b.type !== "tool_use" || failed.has(b.id)) continue;
      step++;
      const p = b.input?.file_path;
      if (loadsVerify(b)) load = step;
      else if (EDIT_TOOLS.test(b.name) && p && isCode(p)) {
        const k = fileKey(p);
        files.set(k, {
          name: path.win32.basename(String(p)),
          edit: step,
          run: files.get(k)?.run ?? -1,
        });
      } else if (SHELL_TOOLS.test(b.name)) {
        const c = String(b.input?.command || "");
        if (load >= 0) {
          lastBuild = Math.max(lastBuild, load); // a verify run counts at its load
          load = -1;
        }
        if (isBuild(c, pattern)) lastBuild = step;
        else
          for (const f of files.values())
            if (runsEdited(c, [f.name])) f.run = step;
      }
    }
  }
  const all = [...files.values()];
  return {
    files: all.map((f) => f.name),
    due: all.some((f) => f.edit > Math.max(lastBuild, f.run)),
  };
}

// From transcripts (each a list of entries), merged by entry time since step numbers do not compare across files:
// the last code edit inside the repository ({id, file, at}) and the last verify run ({at, proof}: its load's time,
// and whether a successful shell result after the load printed a PROOF line). Due: an edit and no run after it.
export function commitState(lists, repo) {
  const inside = `${fileKey(repo).replace(/\/$/, "")}/`;
  const realInside = `${fileKey(realOf(repo)).replace(/\/$/, "")}/`;
  // the path inside the repository, as the tool spelled it or as the file system names it
  const within = (p) => {
    const k = fileKey(p);
    if (k.startsWith(inside)) return k.slice(inside.length);
    const r = fileKey(realOf(p));
    return r.startsWith(realInside) ? r.slice(realInside.length) : null;
  };
  const events = [];
  const add = (e, ev) => {
    const at = Date.parse(e.timestamp);
    if (Number.isNaN(at))
      throw new Error(`a transcript entry has no time (${ev.kind})`);
    events.push({ ...ev, at });
  };
  for (const entries of lists) {
    const { failed, text } = resultsOf(entries);
    for (const e of entries) {
      if (typedVerify(e)) add(e, { kind: "load" });
      if (e.type !== "assistant" || !Array.isArray(e.message?.content))
        continue;
      for (const b of e.message.content) {
        if (b.type !== "tool_use" || failed.has(b.id)) continue;
        const p = b.input?.file_path;
        if (loadsVerify(b)) add(e, { kind: "load" });
        else if (EDIT_TOOLS.test(b.name) && p) {
          // the path inside the repository, so a repository in a temp folder still counts
          const rel = within(p);
          if (rel !== null && isCommitCode(rel))
            add(e, { kind: "edit", id: b.id, file: String(p) });
        } else if (SHELL_TOOLS.test(b.name))
          add(e, {
            kind: "shell",
            proof: /^PROOF /m.test(text.get(b.id) ?? ""),
            driver: VERIFY_RUN.test(String(b.input?.command ?? "")),
          });
      }
    }
  }
  events.sort((a, b) => a.at - b.at); // stable: one file's events keep their order
  let edit = null,
    run = null,
    load = null,
    loaded = false,
    order = 0;
  for (const ev of events) {
    ev.order = order++;
    if (ev.kind === "load") {
      load = ev;
      loaded = true;
    } else if (ev.kind === "edit") edit = ev;
    else {
      // a run of the skill's own script after any load counts where it runs (the fix-and-run-again round)
      if (ev.driver && loaded)
        run = { at: ev.at, order: ev.order, proof: false };
      else if (load) run = { at: load.at, order: load.order, proof: false };
      load = null;
      if (run) run.proof ||= ev.proof;
    }
  }
  return {
    edit: edit && { id: edit.id, file: edit.file, at: edit.at },
    run: run && { at: run.at, proof: run.proof },
    due: Boolean(edit) && !(run && run.order > edit.order),
  };
}

// The git commit call in a Bash or PowerShell command (also after -C <dir>, -c k=v, --no-pager; --amend too; not
// commit-graph): where it starts and ends, its -C folders as written and the words after it (argWords)
const GIT_COMMIT =
  /\bgit(\s+(-C\s+("[^"]*"|'[^']*'|\S+)|-c\s+\S+|--[\w-]+))*\s+commit(?![\w-])/;
// The words of a command up to its first unquoted && || ; | or line end (a quoted message keeps its spaces and line
// breaks); a redirection (2>&1, >/dev/null, > file, <<'EOF') and its target are left out
// [, double-quoted, single-quoted, end of the call, redirection, bare word]
const ARG_TOKEN =
  /"((?:[^"\\]|\\[\s\S])*)"|'([^']*)'|(&&|\|\|?|;|\n)|(\d*(?:&?>>?|<<?<?)(?:&(?:\d+|-))?)|([^\s"';&|<>]+)/g;
function argWords(text) {
  const out = [];
  let target = false;
  for (const m of text.matchAll(ARG_TOKEN)) {
    if (m[3]) break;
    if (m[4] !== undefined) {
      target = !/&(?:\d+|-)$/.test(m[4]); // 2>&1 names no file; > and << take the next word
      continue;
    }
    if (target) {
      target = false;
      continue;
    }
    out.push(
      m[1] !== undefined ? m[1].replace(/\\(["\\$`])/g, "$1") : (m[2] ?? m[5]),
    );
  }
  return out;
}
function gitCommit(command) {
  const m = command.match(GIT_COMMIT);
  if (!m) return null;
  return {
    at: m.index,
    end: m.index + m[0].length,
    dashC: [...m[0].matchAll(/\s-C\s+("([^"]*)"|'([^']*)'|(\S+))/g)].map(
      (c) => c[2] ?? c[3] ?? c[4],
    ),
    args: argWords(command.slice(m.index + m[0].length)),
  };
}

// A folder word as the shell would read it: $VAR and ${VAR} from an assignment before it in the command
// (R=...; or export R=...) or else the hook's environment, then a leading ~ as the home folder. null when a
// variable has no value here (set in an earlier call, say): the folder is unknown.
function shellPath(word, before) {
  let unknown = false;
  const expanded = word.replace(/\$\{?(\w+)\}?/g, (_, name) => {
    const set = [
      ...before.matchAll(
        new RegExp(
          `(?:^|[\\s;&|(])(?:export\\s+)?${name}=("([^"]*)"|'([^']*)'|([^\\s;&|)]*))`,
          "g",
        ),
      ),
    ].pop();
    const value = set ? (set[2] ?? set[3] ?? set[4]) : process.env[name];
    if (value === undefined) unknown = true;
    return value ?? "";
  });
  if (unknown) return null;
  return gitBashToNative(expanded.replace(/^~(?=$|[\\/])/, os.homedir()));
}

// A path as the file system names it (links, /var -> /private/var and short Windows names resolved), so it compares
// with git's --show-toplevel; the part below the nearest existing folder is kept as written
function realOf(p) {
  let head = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(head), ...tail);
    } catch (err) {
      if (err.code !== "ENOENT" && err.code !== "ENOTDIR") throw err;
    }
    const up = path.dirname(head);
    if (up === head) return path.resolve(p);
    tail.unshift(path.basename(head));
    head = up;
  }
}
const commandOf = (input) => String(input.tool_input?.command ?? "");
const isCommitCall = (input) =>
  input.tool_name === COMMIT_TOOL ||
  (SHELL_TOOLS.test(input.tool_name) && GIT_COMMIT.test(commandOf(input)));

// The folder the commit runs in: the Nimbalyst tool's is the session's; for a shell call the -C of the commit's own
// git call, else the last `cd <dir>` before it, else the session's cwd. { dir } or { unknown: <the word> }.
function commitDir(input) {
  const cwd = String(input.cwd || process.cwd());
  if (input.tool_name === COMMIT_TOOL) return { dir: cwd };
  const command = commandOf(input);
  const call = gitCommit(command);
  const before = command.slice(0, call.at);
  const cd = [
    ...before.matchAll(/(?:^|[;&|]\s*)cd\s+("([^"]*)"|'([^']*)'|([^\s;&|]+))/g),
  ].pop();
  const written = call.dashC.length
    ? call.dashC
    : cd
      ? [cd[2] ?? cd[3] ?? cd[4]]
      : [];
  const parts = [];
  for (const w of written) {
    const p = shellPath(w, before);
    if (p === null) return { unknown: w };
    parts.push(p);
  }
  return { dir: path.resolve(cwd, ...parts) };
}

// git in a folder: its output, or null when the folder is in no repository; any other failure throws
function git(dir, args) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (r.error) throw r.error;
  if (r.status === 0) return r.stdout;
  if (/not a git repository/i.test(r.stderr)) return null;
  throw new Error(`git ${args.join(" ")} in ${dir} failed: ${r.stderr.trim()}`);
}
const lines = (out) =>
  out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const topOf = (dir) => {
  const out = git(dir, ["rev-parse", "--show-toplevel"]);
  return out === null ? null : path.resolve(out.trim());
};

// The files a commit call is about to commit: the Nimbalyst tool's list (paths, or {path} entries); for a shell call
// the paths given to git commit, else with -a the staged and changed tracked files, else the staged files plus the
// paths of a `git add` before it in the command (a folder, `.` or an option there: every changed file)
const VALUE_OPTION =
  /^(-[a-zA-Z]*[mFCct]|--(message|file|reuse-message|reedit-message|author|date|template|fixup|squash|trailer|cleanup))$/;
const GIT_ADD =
  /\bgit(?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+\S+|--[\w-]+))*\s+add\s+([^|;&\n]+)/g;
const stagePath = (entry) => {
  if (typeof entry === "string") return entry;
  if (typeof entry?.path === "string") return entry.path;
  throw new Error(
    `verify-gate: a filesToStage entry is neither a path nor {path}: ${JSON.stringify(entry)}`,
  );
};
// Full paths: a path written in the command from the commit's folder, one git lists from the repository's top.
function commitFiles(input, dir, repo) {
  const fromDir = (f) => path.resolve(dir, gitBashToNative(f));
  const fromTop = (f) => path.resolve(repo, f);
  if (input.tool_name === COMMIT_TOOL)
    return (input.tool_input?.filesToStage ?? []).map(stagePath).map(fromDir);
  const command = commandOf(input);
  const call = gitCommit(command);
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
  if (paths.length) return paths.map(fromDir);
  const staged = lines(git(dir, ["diff", "--cached", "--name-only"])).map(
    fromTop,
  );
  const changed = () => lines(git(dir, ["diff", "--name-only"])).map(fromTop);
  if (all) return [...staged, ...changed()];
  const added = [];
  for (const m of command.slice(0, call.at).matchAll(GIT_ADD)) {
    const args = argWords(m[1]);
    const wide = (a) =>
      a.startsWith("-") ||
      a === "." ||
      fs
        .statSync(path.resolve(dir, gitBashToNative(a)), {
          throwIfNoEntry: false,
        })
        ?.isDirectory();
    if (args.some(wide))
      return [
        ...staged,
        ...changed(),
        ...lines(git(dir, ["ls-files", "--others", "--exclude-standard"])).map(
          fromDir,
        ), // ls-files lists from the folder it runs in
      ];
    added.push(...args.map(fromDir));
  }
  return [...added, ...staged];
}

// The message a commit call gives, "" when none is in the call (an editor opens): the Nimbalyst tool's commitMessage;
// for a shell call every -m / --message value (a cat heredoc too) and the text of -F / --file when the file exists
// (-F - with a heredoc: its body)
function messageOf(input, dir) {
  if (input.tool_name === COMMIT_TOOL)
    return String(input.tool_input?.commitMessage ?? "");
  const command = commandOf(input);
  const call = gitCommit(command);
  // [, double-quoted, single-quoted, end of the git call, bare word]
  const TOKEN =
    /"((?:[^"\\]|\\[\s\S])*)"|'([^']*)'|(&&|\|\|?|;|\n)|([^\s"';&|]+)/g;
  // A cat heredoc right after the flag, read from the raw text: a " in its body would end the quoted token early
  // [, <<- dash, opening quote, delimiter word, body]
  const HEREDOC =
    /^\s*"?\$\(cat\s+<<(-?)\s*(['"]?)([^\s'"\\;&|()<>]+)\2[^\n]*\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\n|\)|$)/;
  // A heredoc fed to the call's stdin (for -F -): [, <<- dash, opening quote, delimiter word, body]
  const STDIN_DOC =
    /<<(-?)\s*(['"]?)([^\s'"\\;&|()<>]+)\2[^\n]*\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\n|$)/;
  const raw = command.slice(call.end);
  const tokens = [...raw.matchAll(TOKEN)];
  const parts = [];
  const valueAt = (i) => {
    const v = tokens[i];
    if (!v || v[3]) return null;
    return v[1] !== undefined
      ? v[1].replace(/\\(["\\$`])/g, "$1")
      : (v[2] ?? v[4]);
  };
  let skipTo = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].index < skipTo) continue;
    const [, , , stop, bare] = tokens[i];
    if (stop) break;
    if (bare === undefined) continue;
    let file = null;
    if (/^--message=./.test(bare)) parts.push(bare.slice(10));
    else if (/^-[a-zA-Z]*m$|^--message$/.test(bare)) {
      const after = tokens[i].index + bare.length;
      const doc = raw.slice(after).match(HEREDOC);
      if (doc) {
        parts.push(doc[1] ? doc[4].replace(/^\t+/gm, "") : doc[4]);
        skipTo = after + doc.index + doc[0].length;
        continue;
      }
      const value = valueAt(++i);
      if (value !== null && !value.includes("$(") && !value.includes("`"))
        parts.push(value);
    } else if (/^--file=./.test(bare)) file = bare.slice(7);
    else if (/^-[a-zA-Z]*F$|^--file$/.test(bare)) file = valueAt(++i);
    if (file === "-") {
      // -F - reads the message from stdin: a heredoc after the call
      const doc = raw.match(STDIN_DOC);
      if (doc) parts.push(doc[1] ? doc[4].replace(/^\t+/gm, "") : doc[4]);
    } else if (file) {
      const p = path.resolve(dir, gitBashToNative(file));
      if (fs.existsSync(p)) parts.push(fs.readFileSync(p, "utf8"));
    }
  }
  return parts.join("\n\n");
}

// The verify skill a folder holds: .claude/skills/verify/SKILL.md, else the first verify-<name>/SKILL.md; or null
function skillIn(dir) {
  const skills = path.join(dir, ".claude", "skills");
  let names;
  try {
    names = fs.readdirSync(skills);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
    throw err;
  }
  const found = names
    .filter(
      (n) =>
        /^verify(?:-[\w-]+)?$/.test(n) &&
        fs.existsSync(path.join(skills, n, "SKILL.md")),
    )
    .sort();
  return found.length ? path.join(skills, found[0], "SKILL.md") : null;
}

// The transcripts whose edits and verify runs count: a helper's own file alone; for the main session its file and
// its helpers' (<transcript without .jsonl>/subagents/*.jsonl)
function transcriptsOf(input) {
  if (input.agent_id)
    return [
      subagentPath(input.transcript_path, input.agent_id, input.session_id),
    ];
  const folder = path.join(
    String(input.transcript_path).replace(/\.jsonl$/, ""),
    "subagents",
  );
  let helpers = [];
  try {
    helpers = fs
      .readdirSync(folder)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(folder, f));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  return [input.transcript_path, ...helpers];
}

const slash = (p) => String(p).replace(/\\/g, "/");
const listOf = (names) =>
  names.length > LIST_MAX
    ? `${names.slice(0, LIST_MAX).join(", ")} and ${names.length - LIST_MAX} more`
    : names.join(", ");

// The commit check (--pre). Writes one log line per checked code commit; in enforce refuses a due one once.
function commitCheck(input) {
  if (!isCommitCall(input) || !input.transcript_path || !input.session_id)
    return;
  const mode = hookMode(NAME, COMMIT);
  if (mode === "off") return;
  const { dir, unknown } = commitDir(input);
  if (unknown !== undefined) {
    observeLine(
      "folder-unknown",
      `the commit's folder ${unknown} names a variable set outside this command`,
      { ...COMMIT, fields: { folder: unknown } },
    );
    return;
  }
  const repo = topOf(dir);
  if (!repo) return; // git itself refuses a commit outside a repository
  const code = commitFiles(input, dir, repo)
    .map((f) => path.relative(repo, realOf(f)))
    .filter(isCommitCode);
  if (!code.length) return;
  const home = input.cwd ? (topOf(input.cwd) ?? path.resolve(input.cwd)) : null;
  const skill =
    skillIn(repo) ??
    (home && fileKey(home) !== fileKey(repo) ? skillIn(home) : null);
  if (!skill) return;
  const lists = transcriptsOf(input).map((f, i) =>
    readEntries(fs.readFileSync(f, "utf8"), {
      sidechain: Boolean(input.agent_id) || i > 0,
    }),
  );
  const { edit, run, due } = commitState(lists, repo);
  if (!edit) return; // no code edit of this session in this repository
  const names = code.map((f) => path.basename(gitBashToNative(f)));
  const text = verifyGateCommit(listOf(names), slash(skill));
  const marker = stateFile(NAME, sessionKey(input.session_id));
  const key = `${fileKey(repo)}|${edit.id}`;
  let verdict;
  if (!due) verdict = "verified";
  else if (VERIFY_SKIPPED_RE.test(messageOf(input, dir))) verdict = "reason";
  else if (readJson(marker, { missing: {} }).commit === key)
    verdict = "passed-after-refusal";
  else {
    verdict = mode === "enforce" ? "refused" : "would-refuse";
    writeJson(marker, { ...readJson(marker, { missing: {} }), commit: key }); // as in enforce, so the log counts it
  }
  observeLine(verdict, due ? text : `code files: ${listOf(names)}`, {
    ...COMMIT,
    fields: {
      repo: slash(repo),
      by: input.agent_id ? "helper" : "main",
      files: names.slice(0, LIST_MAX),
      lastEdit: new Date(edit.at).toISOString(),
      lastVerify: run ? new Date(run.at).toISOString() : "none",
      proof: Boolean(run?.proof),
      skill: slash(skill),
    },
  });
  if (verdict === "refused") emit.deny(text, COMMIT);
  sweep(NAME, 2);
}

// VERIFY_GATE and VERIFY_PATTERN can sit in the project's settings env (setting() looks in settings.local.json too,
// and in the folders above the project)
if (isMain(import.meta.url)) {
  runHook(
    NAME,
    process.argv.includes("--pre")
      ? commitCheck
      : (input) => {
          if (
            input.agent_id ||
            !input.transcript_path ||
            !input.session_id ||
            !fs.existsSync(input.transcript_path)
          )
            return;
          // The turn starts at the user's last typed message: a task's notice after it is part of it
          const { start, entries } = currentTurn(
            readEntries(fs.readFileSync(input.transcript_path, "utf8")),
            { typed: true },
          );
          const custom = setting("VERIFY_PATTERN");
          const { files, due } = unverified(
            entries,
            custom ? new RegExp(custom, "i") : null,
          ); // a bad pattern throws: logged, fails open
          if (!due) return;
          if (/\?\s*$/.test(String(input.last_assistant_message || ""))) return;
          // Once per turn: the state file holds the turn this hook last blocked; files untouched for two days go
          const marker = stateFile("verify-gate", sessionKey(input.session_id));
          const turnKey = start?.uuid || start?.timestamp || "no-typed-message";
          const state = readJson(marker, { missing: {} });
          if (state.turn === turnKey) return;
          writeJson(marker, { ...state, turn: turnKey }); // throws when it can't be written, so no block that could repeat
          const names =
            files.length > 6
              ? `${files.slice(0, 6).join(", ")} and ${files.length - 6} more`
              : files.join(", ");
          emit.block(
            `${VERIFY_GATE} code was edited this turn (${names}) and no build or test ran after the last edit. Run the project's build or test now, then finish; if it has none, say so in the reply.`,
          );
          sweep("verify-gate", 2);
        },
    { projectSettings: true },
  );
}
