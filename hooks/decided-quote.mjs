#!/usr/bin/env node
// decided-quote: a PreToolUse hook. A brief that says the user DECIDED something has to carry the
// user's own words, or a helper writes a tick (or Claude's own inference) into DECISIONS.md as the
// user's decision. Checks the prompt of Agent/Task, spawn_session,
// create_session and send_prompt, and a Write into a `handoffs` folder: a line that claims a user
// decision ("DECIDED", "decided/confirmed by", "<Name> chose/picked/agreed/ticked") must have a quoted
// passage of at least 3 words in its own paragraph (the claim line down to the next blank line, plus the
// next paragraph when the claim line stands alone as a heading). The first try is refused; the identical
// retry goes through. Unreadable input is an error (exit 2), never a silent pass.
// DECIDED_QUOTE=off disables it.
import { readFileSync, writeFileSync, mkdirSync, writeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const NEGATED = /\bnot\s+(?:yet\s+|been\s+)?(?:decided|confirmed|approved|chosen)(?:\s+by)?\b/gi;
const CLAIMS = [
  /\bDECIDED\b/,
  /\b(?:decided|confirmed|approved|chosen|picked|ticked) by\b/i,
  /\b[A-Z][a-z]+ (?:chose|picked|agreed|ticked|decided|confirmed)\b/,
];
const SPAWNERS = /^(?:Agent|Task)$|spawn_session$|create_session$|send_prompt$/;

export function claimLines(lines) {
  const out = [];
  lines.forEach((line, i) => {
    // A phrase inside quotation marks is a mention (a rule describing this hook), not a claim
    const cleaned = line.replace(/"[^"\n]*"|“[^”\n]*”/g, " ").replace(NEGATED, " ");
    if (CLAIMS.some((re) => re.test(cleaned))) out.push(i);
  });
  return out;
}

function blockAround(lines, i) {
  let end = i + 1;
  while (end < lines.length && lines[end].trim() !== "") end++;
  const alone = end === i + 1 && (/^\s*#/.test(lines[i]) || /:\s*$/.test(lines[i]));
  if (alone) {
    end++;
    while (end < lines.length && lines[end].trim() === "") end++;
    while (end < lines.length && lines[end].trim() !== "") end++;
  }
  return lines.slice(i, end).join("\n");
}

export function hasQuote(text) {
  const spans = [];
  for (const m of text.matchAll(/"([^"\n]+)"|“([^”\n]+)”/g)) spans.push(m[1] ?? m[2]);
  for (const m of text.matchAll(/^\s*>\s*(.+)$/gm)) spans.push(m[1]);
  return spans.some((s) => s.trim().split(/\s+/).length >= 3);
}

// Returns the claim lines that have no quote, or []
export function unquotedClaims(text) {
  const lines = text.split(/\r?\n/);
  return claimLines(lines)
    .filter((i) => !hasQuote(blockAround(lines, i)))
    .map((i) => lines[i].trim().slice(0, 120));
}

function textOf(event) {
  const name = String(event.tool_name || "");
  const input = event.tool_input || {};
  if (name === "Write") {
    return /(^|[\\/])handoffs[\\/]/.test(String(input.file_path || "")) ? String(input.content || "") : "";
  }
  if (!SPAWNERS.test(name)) return "";
  return Object.values(input).filter((v) => typeof v === "string").join("\n");
}

function main() {
  if ((process.env.DECIDED_QUOTE || "").toLowerCase() === "off") return 0;
  let event;
  try {
    event = JSON.parse(readFileSync(0, "utf8"));
  } catch (e) {
    process.stderr.write(`[decided-quote] Could not read the hook input as JSON (${e.message}). Set DECIDED_QUOTE=off to bypass.\n`);
    return 2;
  }
  if (!event || typeof event !== "object") {
    process.stderr.write("[decided-quote] Hook input is not an object. Set DECIDED_QUOTE=off to bypass.\n");
    return 2;
  }
  const text = textOf(event);
  if (!text) return 0;
  const bad = unquotedClaims(text);
  if (!bad.length) return 0;

  const dir = join(tmpdir(), "decided-quote");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${String(event.session_id || "none").replace(/[^\w-]/g, "")}.json`);
  const key = createHash("sha1").update(event.tool_name + text).digest("hex");
  let seen = [];
  try { seen = JSON.parse(readFileSync(file, "utf8")); } catch {}
  if (seen.includes(key)) return 0;
  writeFileSync(file, JSON.stringify([...seen, key].slice(-200)));

  const reason = [
    `[decided-quote] This text claims a decision by the user but quotes no words of theirs next to it:`,
    ...bad.map((l) => `- ${l}`),
    `Quote the user's words (or for a form: the field label, the full text of the ticked option and anything typed with it, and where it came from), or move the item under "Proposed, not confirmed". A tick that goes against what the user typed, said last or decided earlier is not a decision yet.`,
    `If the claim is true and quoted elsewhere, retry the identical call and it will go through.`,
  ].join("\n");
  writeSync(1, JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
  return 0;
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
