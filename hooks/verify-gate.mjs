#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { isBuildCode as isCode } from "./lib/code-files.mjs";
// verify-gate: Stop hook. Catches "code was edited and nothing was built or tested after it".
// If the main session edited a code file this turn and no Bash call after the last such edit ran a build or test,
// it blocks once with one line: run the project's build or test, then finish. It never runs a command itself.
// - Running an edited script (python/node/sh ... <its file name>) after its last edit is that file's check; a build checks all.
//   This holds with VERIFY_PATTERN set too: the pattern replaces only the build list.
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
// Fails open; a crash leaves a line in hooks/state/hook-errors.log.
import { emit, isMain, runHook } from "./lib/hook-io.mjs";
import { fileKey, sessionKey } from "./lib/paths.mjs";
import { setting } from "./lib/settings-env.mjs";
import { readJson, stateFile, sweep, writeJson } from "./lib/state.mjs";
import { VERIFY_GATE } from "./lib/texts.mjs";
import { currentTurn, entries as readEntries } from "./lib/transcript.mjs";

const EDIT_TOOLS = /^(Edit|Write|MultiEdit)$/;
const SHELL_TOOLS = /^(Bash|PowerShell)$/;

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

// The code files edited in the turn, and whether a build or test ran after the last of those edits
export function unverified(entries, pattern) {
  const failed = new Set();
  for (const e of entries) {
    if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content)
      if (b.type === "tool_result" && b.is_error) failed.add(b.tool_use_id);
  }
  // per file: its last edit and its last own run; a build clears every file, running a script clears only that script
  const files = new Map();
  let step = 0,
    lastBuild = -1;
  for (const e of entries) {
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
      if (EDIT_TOOLS.test(b.name) && p && isCode(p)) {
        const k = fileKey(p);
        files.set(k, {
          name: path.win32.basename(String(p)),
          edit: step,
          run: files.get(k)?.run ?? -1,
        });
      } else if (SHELL_TOOLS.test(b.name)) {
        const c = String(b.input?.command || "");
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

// VERIFY_GATE and VERIFY_PATTERN can sit in the project's settings env (setting() looks in settings.local.json too,
// and in the folders above the project)
if (isMain(import.meta.url)) {
  runHook(
    "verify-gate",
    (input) => {
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
      if (readJson(marker)?.turn === turnKey) return;
      writeJson(marker, { turn: turnKey }); // throws when it can't be written, so no block that could repeat
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
