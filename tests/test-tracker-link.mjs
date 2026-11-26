// Tests that every session the handoff and where-are-we skills start on a release step is told to link itself to
// its tracker step (Nimbalyst shows a chat's Trackers section only when the chat is linked to an item). Each start point
// is the skill text a session runs its step from; each must name the link call.
// The lead skill's claim lines left with its rewrite (2026-11-19): one session runs a big job and where-are-we
// mirrors its slices, so lead has no start point of its own.
// Run: node tests/test-tracker-link.mjs
import fs from "node:fs";
import path from "node:path";

const skill = (name) =>
  fs.readFileSync(
    path.join(import.meta.dirname, "..", "skills", name, "SKILL.md"),
    "utf8",
  );
const handoff = skill("handoff");
const where = skill("where-are-we");
const LINK = /`?linkSession: true`?/;

// The step of a text that starts with a marker, up to its blank line (a step may carry sub-bullets)
const lineOf = (text, marker) => {
  const at = text.indexOf(marker);
  if (at < 0) return "";
  const end = text.indexOf("\n\n", at);
  return text.slice(at, end < 0 ? undefined : end);
};
// The queued prompt a handoff gives a new session for a tracker step: the backticked text after "names its key and adds:"
const handoffPrompt =
  handoff.match(/tracker step[^\n]*?names its key and adds: `([^`]+)`/)?.[1] ??
  "";

// Start points: [name, the text the session is told, what it must hold besides the link]
const STARTS = [
  [
    "handoff: the new session for a tracker step",
    handoffPrompt,
    [/tracker_update with id <key>/, /"in-progress"/, /Before any work/],
  ],
  [
    "where-are-we: a row this session claimed",
    lineOf(where, "2. **Copy new plan rows in.**"),
    [/row this session has claimed/],
  ],
  [
    "where-are-we: an in-progress step with no linked session",
    lineOf(where, "5. **Stranded steps.**"),
    [/"not linked"/],
  ],
];

let pass = 0,
  fail = 0;
let told = 0;
for (const [name, text, needs] of STARTS) {
  const linked = LINK.test(text);
  if (linked) told++;
  const missing = [LINK, ...needs].filter((n) => !n.test(text));
  if (missing.length) {
    fail++;
    console.log(`FAIL  ${name}: missing ${missing.join(", ")}`);
  } else {
    pass++;
    console.log(`PASS  ${name}`);
  }
}
const all = told === STARTS.length;
if (all) pass++;
else fail++;
console.log(
  `${all ? "PASS" : "FAIL"}  ${told} of ${STARTS.length} start points tell the session to link (${Math.round((100 * told) / STARTS.length)}%)`,
);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
