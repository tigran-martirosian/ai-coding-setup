// Tests that every session the lead, handoff and where-are-we skills start on a release step is told to link itself to
// its tracker step (Nimbalyst shows a chat's Trackers section only when the chat is linked to an item). Each start point
// is the skill text a session runs its step from; each must name the link call. The job-done hook's notes are tested
// in test-job-done.mjs.
// Run: node tests/test-tracker-link.mjs
import fs from "node:fs";
import path from "node:path";

const skill = (name) =>
  fs.readFileSync(
    path.join(import.meta.dirname, "..", "skills", name, "SKILL.md"),
    "utf8",
  );
const lead = skill("lead");
const handoff = skill("handoff");
const where = skill("where-are-we");
const LINK = /`?linkSession: true`?/;

// The line of a text that starts with a marker, up to the end of that line
const lineOf = (text, marker) => {
  const at = text.indexOf(marker);
  return at < 0 ? "" : text.slice(at, text.indexOf("\n", at));
};
// The queued prompt a handoff gives a new session for a tracker step: the backticked text after "names its key and adds:"
const handoffPrompt =
  handoff.match(/tracker step[^\n]*?names its key and adds: `([^`]+)`/)?.[1] ??
  "";

// The next row's session is told to claim its tracker step by a pointer to the Claimed line, which holds the rule
const claimed = lineOf(lead, "**Claimed:**");
const piece = lineOf(lead, "**One piece per session**");
const POINTER = /claims its tracker step \(\*\*Claimed\*\*/;

// Start points: [name, the text the session is told, what it must hold besides the link]
const STARTS = [
  [
    "lead: a session claiming a step",
    claimed,
    [/`tracker_update`/, /"in-progress"/],
  ],
  [
    "lead: the next row's session claims its tracker step too",
    POINTER.test(piece) ? `${piece}\n${claimed}` : piece,
    [POINTER],
  ],
  [
    "lead: the session that takes or creates the release",
    lineOf(lead, "**The tracker is the job's record:**"),
    [/`tracker_create`/, /`tracker_update`/],
  ],
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

// The claim is one call that sets the status and the link together, so a session can't do one and skip the other
const claimOld = /tracker_link_session/.test(claimed);
if (claimOld) fail++;
else pass++;
console.log(
  `${claimOld ? "FAIL" : "PASS"}  lead's claim uses linkSession, not tracker_link_session`,
);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
