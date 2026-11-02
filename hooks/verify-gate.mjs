#!/usr/bin/env node
// verify-gate: Stop hook. Catches "code was edited and nothing was built or tested after it".
// If the main session edited a code file this turn and no Bash call after the last such edit ran a build or test,
// it blocks once with one line: run the project's build or test, then finish. It never runs a command itself.
// - A Bash result marked as an error (a failed build, a refused call) is not a run; a background run is.
// - Only the main session's edits count: a helper's brief carries its own check. Subagents (input with agent_id) skip.
// - Docs, notebooks, JSON outside src/ and files in a temp or scratch folder are not code. A reply ending in a question
//   passes (nothing is remembered: the next stop is judged again).
// - VERIFY_PATTERN (a regex, matched case-insensitively against the whole Bash command) replaces the default list of build
//   and test commands. VERIFY_GATE=off disables the gate: the opt-out for a project whose suite is slow. Both are read from the
//   environment, then from "env" in the project's .claude/settings.json (settings env may not reach a hook process).
// Blocks at most once per turn, remembered in a temp file per session: stop_hook_active alone is not enough,
// since a block by any other Stop hook sets it too. The turn starts at the user's last typed message.
// Fails open; a crash leaves a line in hooks/state/hook-errors.log.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// code-review-gate's list, without the markup files (html, css, sql): a project that has only those has nothing to build
const CODE_EXT = new Set([".java", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".gd", ".cs", ".go", ".rs", ".kt", ".kts", ".gradle", ".vue", ".svelte", ".php", ".rb", ".swift", ".c", ".cpp", ".h", ".sh", ".ps1"]);
const EDIT_TOOLS = /^(Edit|Write|MultiEdit)$/;
const SHELL_TOOLS = /^(Bash|PowerShell)$/;
const isCode = (p) => {
  const f = String(p).replace(/\\/g, "/");
  if (/\/(temp|tmp|scratch)\//i.test(f)) return false; // a throwaway script is not the project's code
  const ext = path.extname(f).toLowerCase();
  return CODE_EXT.has(ext) || (ext === ".json" && /(^|\/)src\//.test(f));
};

// One command at a time (split on && || ; | and newlines), each anchored at its start, after env assignments and a shell wrapper
const BUILD = new RegExp(
  "^(?:\\w+=(?:\"[^\"]*\"|'[^']*'|\\S*)\\s+)*(?:(?:bash|sh|call|cmd\\s+/c)\\s+)?(?:\\S*[\\\\/])?(?:" + [
    "gradlew(?:\\.bat)?", "mvnw?", "qbuild(?:\\.\\w+)?", "run_all\\.\\w+", "run-all\\.\\w+", "run-tests?\\.\\w+",
    "make", "pytest", "tox", "tsc", "vitest", "jest",
    "(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:test|build)\\b", "npx\\s+(?:tsc|vitest|jest|playwright)\\b",
    "cargo\\s+(?:build|test|check|clippy)\\b", "go\\s+(?:build|test|vet)\\b", "dotnet\\s+(?:build|test)\\b",
    "cmake\\s+--build\\b", "(?:python3?|py)\\s+(?:-3\\s+)?-m\\s+(?:pytest|unittest)\\b",
    "node\\s+(?:--test\\b|(?:\"[^\"]*[\\\\/]|'[^']*[\\\\/]|[\"']|\\S*[\\\\/])?(?:test-[\\w.-]*|[\\w.-]*-tests?|run-tests?[\\w.-]*|run-all)\\.[cm]?js\\b)",
  ].join("|") + ")[\"']?(?:\\s|$)", "i");
const isBuild = (command, pattern) => pattern ? pattern.test(command) : command.split(/&&|\|\||;|\||\r?\n/).some((s) => BUILD.test(s.trim()));

const userText = (e) => {
  const c = e.message?.content;
  return typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text || "").join("\n") : "";
};
// A message the user typed: not a tool result, and not text Claude Code or Nimbalyst adds on its own
const INJECTED = /^\[(Request interrupted|System:|Child Session Update\])/;
const typedByUser = (e) => {
  if (e.type !== "user" || e.isMeta || e.isCompactSummary || e.promptSource === "system" || e.origin?.kind === "task-notification") return false;
  const t = userText(e).trim();
  return !!t && !INJECTED.test(t);
};

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

// The code files edited in the turn, and whether a build or test ran after the last of those edits
export function unverified(entries, pattern) {
  const failed = new Set();
  for (const e of entries) {
    if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) if (b.type === "tool_result" && b.is_error) failed.add(b.tool_use_id);
  }
  const files = new Map();
  let step = 0, lastEdit = -1, lastRun = -1;
  for (const e of entries) {
    if (e.type !== "assistant" || e.isSidechain || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      if (b.type !== "tool_use" || failed.has(b.id)) continue;
      step++;
      const p = b.input?.file_path;
      if (EDIT_TOOLS.test(b.name) && p && isCode(p)) { files.set(path.resolve(String(p)).toLowerCase(), path.basename(String(p))); lastEdit = step; }
      else if (SHELL_TOOLS.test(b.name) && isBuild(String(b.input?.command || ""), pattern)) lastRun = step;
    }
  }
  return { files: [...files.values()], due: lastEdit > lastRun && lastEdit > -1 };
}

// The switches can sit in the project's settings env
function setting(name) {
  if (process.env[name]) return process.env[name];
  try {
    const file = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), ".claude", "settings.json");
    return String(JSON.parse(fs.readFileSync(file, "utf8")).env?.[name] || "");
  } catch { return ""; }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  try {
    if (setting("VERIFY_GATE").toLowerCase() === "off") process.exit(0);
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    if (input.agent_id || !input.transcript_path || !input.session_id) process.exit(0);
    const { start, entries } = currentTurn(fs.readFileSync(input.transcript_path, "utf8").split("\n"));
    const custom = setting("VERIFY_PATTERN");
    const { files, due } = unverified(entries, custom ? new RegExp(custom, "i") : null); // a bad pattern throws: logged, fails open
    if (!due) process.exit(0);
    if (/\?\s*$/.test(String(input.last_assistant_message || ""))) process.exit(0);
    // Once per turn: the temp file holds the turn this hook last blocked; files older than two days go
    const tmp = os.tmpdir();
    const marker = path.join(tmp, `verify-gate-${String(input.session_id).replace(/[^\w-]/g, "_")}.txt`);
    const turnKey = start?.uuid || start?.timestamp || "no-typed-message";
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === turnKey) process.exit(0);
    fs.writeFileSync(marker, turnKey); // throws when it can't be written, so no block that could repeat
    const names = files.length > 6 ? `${files.slice(0, 6).join(", ")} and ${files.length - 6} more` : files.join(", ");
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: `verify-gate: code was edited this turn (${names}) and no build or test ran after the last edit. Run the project's build or test now, then finish; if it has none, say so in the reply.`,
    }));
    try {
      for (const f of fs.readdirSync(tmp).filter((f) => f.startsWith("verify-gate-") && f !== path.basename(marker))) {
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
      fs.appendFileSync(log, `${new Date().toISOString()} verify-gate: ${err?.message || err}\n`);
    } catch {
      // nothing more to do
    }
  }
}
