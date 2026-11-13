#!/usr/bin/env node
// code-review-gate: Stop hook. Backs the CLAUDE.md rule "a bigger code change (a new feature, or several
// files) also gets /code-review before done": in real sessions the skill ran on only about one in five turns
// that changed 3 or more code files. When this turn edited 3 or more different code files since the
// code-review skill last ran (or since the turn began), the stop is blocked once with a reason that says
// to run it; fixing a review's findings in a file or two afterwards passes. The turn starts at the user's
// last typed message. Only calls that went through count (a refused edit changed nothing, a refused
// review reviewed nothing); a subagent's edits are in its own transcript and don't count.
// Blocks at most once per turn, remembered in a temp file per session: stop_hook_active alone is not
// enough, since a block by any other Stop hook sets it too. Subagents fire SubagentStop, not Stop, and an
// input with agent_id is skipped too. A headless -p run can't be told apart from a Nimbalyst session
// (both are "sdk-cli" with the same input and transcript fields, checked 2026-10-26), so a script that
// runs claude -p on code sets CODE_REVIEW_GATE=off. Fails open. CODE_REVIEW_GATE=off disables it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MIN_FILES = 3;
// The file types that count as code
const CODE_EXT = new Set([".java", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".gd", ".cs", ".go", ".rs", ".kt", ".gradle"]);
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const isCode = (p) => {
  const ext = path.extname(String(p)).toLowerCase();
  if (CODE_EXT.has(ext)) return true;
  return ext === ".json" && /(^|\/)src\//.test(String(p).replace(/\\/g, "/"));
};
const isReview = (b) => b.name === "Skill" && /(^|:)code-review$/.test(String(b.input?.skill || "").trim().replace(/^\//, ""));
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

// The code files changed since the code-review skill last ran in this turn, when there are 3 or more, else []
export function unreviewedFiles(entries) {
  const refused = new Set();
  for (const e of entries) {
    if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) if (b.type === "tool_result" && b.is_error) refused.add(b.tool_use_id);
  }
  let files = new Map();
  for (const e of entries) {
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      if (b.type !== "tool_use" || refused.has(b.id)) continue;
      if (isReview(b)) files = new Map();
      const p = b.input?.file_path || b.input?.notebook_path;
      if (EDIT_TOOLS.test(b.name) && p && isCode(p)) files.set(fileKey(p), path.basename(String(p)));
    }
  }
  return files.size >= MIN_FILES ? [...files.values()] : [];
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  try {
    if ((process.env.CODE_REVIEW_GATE || "").toLowerCase() === "off") process.exit(0);
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    if (input.agent_id || !input.transcript_path || !input.session_id) process.exit(0);
    const { start, entries } = currentTurn(fs.readFileSync(input.transcript_path, "utf8").split("\n"));
    if (start && typedReview(start)) process.exit(0);
    const files = unreviewedFiles(entries);
    if (!files.length) process.exit(0);
    // Once per turn: the temp file holds the turn this hook last blocked; files older than two days go
    const tmp = os.tmpdir();
    const marker = path.join(tmp, `code-review-gate-${String(input.session_id).replace(/[^\w-]/g, "_")}.txt`);
    const turnKey = start?.uuid || start?.timestamp || "no-typed-message";
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === turnKey) process.exit(0);
    fs.writeFileSync(marker, turnKey); // throws when it can't be written, so no block that could repeat
    const names = files.length > 6 ? `${files.slice(0, 6).join(", ")} and ${files.length - 6} more` : files.join(", ");
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: `code-review-gate: this turn changed ${files.length} code files (${names}) since /code-review last ran, or it has not run. ` +
        `The rule for a bigger code change: run the code-review skill now (Skill tool, skill "code-review"), fix each Important finding or say in the reply why it stays, then finish.`,
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
