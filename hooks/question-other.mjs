#!/usr/bin/env node
// question-other: a PreToolUse hook for Nimbalyst's PromptForUserInput. The user wants to type
// their own answer on any choice question (design picks, "this or that"), so every singleSelect
// must set allowOther: true. A plain yes/no (keep it or not) should be a confirm field instead,
// which stays uncluttered.
// It also checks recommendations, because the user accepts the recommended option with one click
// most of the time: an option marked "(recommended)" (or with the badge "recommended") must carry its
// reason in its description / subtitle, and a singleSelect may recommend only one option.
// It can check that a reason is there, not that it is a good one.
// The reason has a fixed shape, so the user sees how much a recommendation rests on and the model
// has to write down the case against its own pick: "Checked: ..." (something was looked up)
// or "Judgment: ..." (nothing was), followed by "Other wins if: ...". A "Checked:" claim is compared
// with the session record (transcript_path), so it cannot be written for something never looked up.
// It fails open, so any error or odd input lets the call through. QUESTION_OTHER=off disables it.
import { readFileSync } from "node:fs";

const MIN_REASON = 20; // characters; shorter than this is a label, not a reason
const recommended = (o) =>
  o && (/\(recommended\)/i.test(`${o.label || ""} ${o.title || ""}`) || /^recommended$/i.test(String(o.badge || "").trim()));
const reasonOf = (o) => String(o.description || o.subtitle || "").trim();
const hasReason = (o) => reasonOf(o).length >= MIN_REASON;
const BASIS = /(?:^|[^a-z])(?:checked|judgment)\s*:\s*\S/i;
const COUNTER = /other wins if\s*:\s*\S/i;
const hasShape = (o) => BASIS.test(reasonOf(o)) && COUNTER.test(reasonOf(o));

// "Checked:" is a claim the session record can confirm: a file or site it names must show up in one of
// this session's tool calls or their results; when it names none, something must have been looked up
// since the user's last message. Otherwise the word is "Judgment:". Files that are always loaded (CLAUDE.md, MEMORY.md) need no tool call.
const LOOKUP = /^(Read|Grep|Glob|Bash|PowerShell|WebSearch|WebFetch|LSP|Agent)$|ctx_|browser_|tracker_|memory_|search|fetch/i;
const FORM = /PromptForUserInput|AskUserQuestion/;
const ALWAYS_LOADED = /^(claude|memory)\.md$/;
const checkedClause = (o) => (reasonOf(o).match(/(?:^|[^a-z])checked\s*:\s*([\s\S]*?)(?=other wins if\s*:|$)/i) || [])[1] || "";
const sources = (s) => [...s.matchAll(/[\w~.\-\/\\]*[\w\-]\.[a-z][a-z0-9]{0,5}\b/gi)].map((m) => m[0].split(/[\/\\]/).pop().toLowerCase());
function toolCalls(file) {
  const calls = [], results = [], forms = new Set();
  let turnStart = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || e.isSidechain) continue;
    const content = e.message?.content;
    const blocks = Array.isArray(content) ? content : [];
    if (e.type === "user" && !e.isMeta) {
      const typed = typeof content === "string" || (blocks.some((b) => b?.type === "text") && !blocks.some((b) => b?.type === "tool_result"));
      if (typed) turnStart = calls.length;
    }
    for (const b of blocks) {
      if (e.type === "assistant" && b?.type === "tool_use") {
        if (FORM.test(b.name || "")) forms.add(b.id);
        else calls.push({ name: b.name || "", text: JSON.stringify(b.input || {}).toLowerCase() });
      } else if (e.type === "user" && b?.type === "tool_result" && !forms.has(b.tool_use_id)) {
        results.push(JSON.stringify(b.content ?? "").toLowerCase());
      }
    }
  }
  return { calls, results, thisTurn: calls.slice(turnStart) };
}
const backed = (o, seen) => {
  const clause = checkedClause(o);
  if (!clause) return true; // "Judgment:" claims nothing
  const named = sources(clause);
  if (named.some((s) => ALWAYS_LOADED.test(s))) return true;
  // a named file or site must show up in what a tool was asked or in what it returned
  if (named.length) return named.some((s) => seen.calls.some((c) => c.text.includes(s)) || seen.results.some((r) => r.includes(s)));
  return seen.thisTurn.some((c) => LOOKUP.test(c.name));
};

try {
  if ((process.env.QUESTION_OTHER || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(readFileSync(0, "utf8"));
  if (!String(event.tool_name || "").endsWith("PromptForUserInput")) process.exit(0);
  const fields = (event.tool_input || {}).fields;
  if (!Array.isArray(fields)) process.exit(0);
  const noOther = [], noReason = [], noShape = [], notChecked = [], twoRecommended = [];
  let seen = null; // no session record (or an unreadable one) lets "Checked:" through
  try { if (event.transcript_path) seen = toolCalls(event.transcript_path); } catch {}
  for (const f of fields) {
    if (!f) continue;
    const name = `"${f.label || f.id}"`;
    if (f.type === "singleSelect" && f.allowOther !== true) noOther.push(name);
    const options = f.type === "singleSelect" ? f.options : f.type === "multiSelect" ? f.items : null;
    if (!Array.isArray(options)) continue;
    const picks = options.filter(recommended);
    if (f.type === "singleSelect" && picks.length > 1) twoRecommended.push(name);
    if (picks.some((o) => !hasReason(o))) noReason.push(name);
    else if (picks.some((o) => !hasShape(o))) noShape.push(name);
    else if (seen && picks.some((o) => !backed(o, seen))) notChecked.push(name);
  }
  const parts = [];
  if (noOther.length)
    parts.push(
      `${noOther.join(", ")} has no free-text option. The user wants to write their own answer on every choice question. ` +
      `Add allowOther: true to each singleSelect. If a question is a plain yes/no (keep it or not, an obvious no-brainer), use a confirm field instead.`);
  if (noReason.length)
    parts.push(
      `${noReason.join(", ")} recommends an option without a reason. The user accepts the recommended option with one click, so say in its ` +
      `description (subtitle in a multiSelect) why it is the best choice, as "Checked: <what you looked at and what it showed>" or ` +
      `"Judgment: <why>", followed by "Other wins if: <the case where another option is better>". ` +
      `If you have no basis (a matter of taste, or it depends on something only the user knows), drop the "(recommended)" mark and the pre-selection.`);
  if (noShape.length)
    parts.push(
      `${noShape.join(", ")} recommends an option whose reason is not in the two-part shape. Write it as "Checked: <what you looked at and ` +
      `what it showed>" (or "Judgment: <why>" when nothing was looked up), followed by "Other wins if: <the case where another option is better>". ` +
      `Write "Checked:" only for something really looked up. A hard-to-undo choice that rests on judgment alone gets no "(recommended)" mark.`);
  if (notChecked.length)
    parts.push(
      `${notChecked.join(", ")} says "Checked:" but this session's record shows no tool call that touched the file or site it names (or, when it ` +
      `names none, nothing was looked up since the user's last message). Look it up now (one file, DECISIONS.md or one search) and name it after "Checked:", ` +
      `or write "Judgment:" instead. The user clicks the recommended option on trust, so "Checked:" has to be true.`);
  if (twoRecommended.length)
    parts.push(`${twoRecommended.join(", ")} marks more than one option as recommended. Recommend one, or none.`);
  if (!parts.length) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `question-other: ${parts.join(" ")} Then call PromptForUserInput again.`,
    },
  }));
} catch {
  process.exit(0);
}
