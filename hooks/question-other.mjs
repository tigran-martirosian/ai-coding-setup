#!/usr/bin/env node
// question-other: a PreToolUse hook for Nimbalyst's PromptForUserInput. The user wants to type
// their own answer on any choice question (design picks, "this or that"), so every singleSelect
// must set allowOther: true. A plain yes/no (keep it or not) should be a confirm field instead,
// which stays uncluttered. Added 2026-09-30 after a form asked design questions with no free-text box.
// It fails open, so any error or odd input lets the call through. QUESTION_OTHER=off disables it.
import { readFileSync } from "node:fs";

try {
  if ((process.env.QUESTION_OTHER || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(readFileSync(0, "utf8"));
  if (!String(event.tool_name || "").endsWith("PromptForUserInput")) process.exit(0);
  const fields = (event.tool_input || {}).fields;
  if (!Array.isArray(fields)) process.exit(0);
  const missing = fields.filter((f) => f && f.type === "singleSelect" && f.allowOther !== true);
  if (!missing.length) process.exit(0);
  const labels = missing.map((f) => `"${f.label || f.id}"`).join(", ");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `question-other: ${labels} has no free-text option. The user wants to write their own answer on every choice question. ` +
        `Add allowOther: true to each singleSelect. If a question is a plain yes/no (keep it or not, an obvious no-brainer), use a confirm field instead. Then call PromptForUserInput again.`,
    },
  }));
} catch {
  process.exit(0);
}
