// Tests for skills/where-are-we/SKILL.md (the tracker grooming skill): it holds the nine steps of its design in
// order, each with the tool or field that makes it work, and the rules on what it may write.
// Run: node tests/test-where-are-we.mjs
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(
  import.meta.dirname,
  "..",
  "skills",
  "where-are-we",
  "SKILL.md",
);
let pass = 0,
  fail = 0;
const check = (name, ok) => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL  ${name}`);
  }
};

const text = fs.readFileSync(FILE, "utf8");
const body = text.replace(/^---[\s\S]*?\n---\r?\n/, "");
const front = text.slice(0, text.length - body.length);

check(
  "frontmatter names the skill where-are-we",
  /\nname: where-are-we\r?\n/.test(front),
);
check(
  "the description carries the user's triggers and lead's two calls",
  /how much is left/.test(front) &&
    /where are we/.test(front) &&
    /groom the tracker/.test(front) &&
    /\/where-are-we/.test(front) &&
    /lead after the user OKs a plan/.test(front) &&
    /end of a job/.test(front),
);

// The nine steps: number, bold title, and what each one needs to work
const STEPS = [
  [
    "Find the job",
    [/tracker_list/, /type `release`/, /newest/, /named after the work/, /yes/],
  ],
  [
    "Copy new plan rows in",
    [
      /`step`/,
      /`search`/,
      /duplicate check/,
      /`collection`/,
      /`stage`/,
      /`budget`/,
      /Done when/,
      /`dependsOn`/,
      /row this session has claimed[^.]*`linkSession: true`/,
      /`file` the path when the row asks the user to read, review or check a file/,
    ],
  ],
  [
    "Since last time",
    [/activity/, /`where-are-we: groomed`/, /done, started or parked/],
  ],
  [
    "Settle what facts prove",
    [
      /`proof` commit/,
      /branch the plan names/,
      /in-review/,
      /finished without a commit/,
    ],
  ],
  [
    "Stranded steps",
    [
      /over a day/,
      /no live session/,
      /age/,
      /last comment/,
      /no linked session[^.]*"not linked"/,
    ],
  ],
  ["Ready gate", [/no Done when/, /open question/, /not ready/]],
  [
    "What waits for the user",
    [
      /Every in-review step/,
      /waits-for-you/,
      /`waitsOn`/,
      /user's words/,
      /its `file`/,
    ],
  ],
  [
    "The reading",
    [
      /steps left of/,
      /running = in-progress steps a session works on now \(a live session, checked as in step 5\)/,
      /an in-progress step with none is to do, "started, no session on it"/,
      /in-review counts here, never as running/,
      /nothing waits for you/,
      /calls left/,
      /groomed <date/,
    ],
  ],
  [
    "End of a job",
    [
      /finished when every step is done or dropped/,
      /a job with no steps yet is not finished and stays open/,
      /`version` field is set[^.]*needs its git tag/,
      /without the tag it stays open/,
      /released/,
      /`gitTag` when it has a version/,
      /`releasedAt`/,
      /next job/,
      /one card/,
    ],
  ],
];
const found = [...body.matchAll(/^(\d)\. \*\*([^*]+?)\.\*\*/gm)];
check("exactly nine numbered steps", found.length === 9);
STEPS.forEach(([title, needs], i) => {
  const at = found.findIndex((m) => m[2] === title);
  check(
    `step ${i + 1} is "${title}"`,
    at === i && found[i][1] === String(i + 1),
  );
  if (at < 0) return;
  const start = found[at].index;
  const end = at + 1 < found.length ? found[at + 1].index : body.length;
  const part = body.slice(start, end);
  for (const n of needs)
    check(`step ${i + 1} (${title}) names ${n}`, n.test(part));
});

// The rules from the design: writes only on a fact, the user closes what he must see, nothing deleted or redone
check(
  "it never closes a step the user must see (in-review at most, the user closes it)",
  /step whose result the user must see[^.]*goes to in-review at most: the user closes it, never this skill/.test(
    body,
  ),
);
// A finished build is not one more "Needs you" line: it is done and named on the job's next user check;
// a user step waits as to-do until its step is done; an act that already happened closes
check(
  "a build the user will try goes to done, named on the next user check, not one Needs-you line per build",
  /A build whose Done when check passed goes to done, also when he will try it: his try belongs to the job's next user check/.test(
    body,
  ) && /one look covers many builds/.test(body),
);
check(
  "a user step is to-do until its waitsOn step is done, then waits-for-you",
  /status to-do while the step it waits for is open and waits-for-you once that step is done/.test(
    body,
  ) &&
    /A user step in to-do whose `waitsOn` step is now done moves to waits-for-you/.test(
      body,
    ),
);
check(
  "a user step whose act already happened (recorded, or a standing go) goes to done",
  /A user step whose act already happened \(a comment, `HANDOFF\.md` or `DECISIONS\.md` records it, or a standing go covers it\) goes to done/.test(
    body,
  ),
);
check(
  "it never deletes, archives, restarts or redoes without the user's yes",
  /never deletes or archives an item, and never restarts or redoes a step, without the user's yes/.test(
    body,
  ),
);
check(
  "a status moves only on a fact",
  /A status moves only on a fact/.test(body),
);
check("it never runs on its own", /nothing starts it on its own/.test(body));
check(
  "every step list reads closed steps too",
  /`includeClosed: true`/.test(body),
);
check(
  "a release can have several plan files",
  /names its plan files/.test(body) && /each plan's job list/.test(body),
);
check(
  "done needs the row's done mark, not a commit alone",
  /State cell reads `done <hash>`/.test(body) &&
    /A commit alone proves nothing/.test(body),
);
check(
  "a missing task-type patch means read only, and names /update-project",
  /write nothing, and say `\/update-project` adds the patch/.test(body),
);
check(
  "statuses go to the user in plain words",
  /"Needs you"/.test(body) && /"Running"/.test(body) && /"Dropped"/.test(body),
);
check(
  "Running only with a session on it now, as on the tracker page; a released job is told as Finished",
  /in-progress "Running" while a session works on it now and "To do, started, no session on it" when none does/.test(
    body,
  ) && /a job set to released is "Finished"/.test(body),
);
check(
  "several open jobs: the one this session is linked to first, then the named one, then the newest activity",
  /More than one: the one this session is linked to, else the one the user named, else the one with the newest activity \(the newest `updated` of the job or any of its steps\)/.test(
    body,
  ),
);
check(
  "a missing `file` field alone still writes, without `file`, and names /update-project",
  /When only `file` is missing, work as usual without setting `file`, and say `\/update-project` adds it/.test(
    body,
  ) && /without the other fields or the waits-for-you status/.test(body),
);

// Jobs, not only releases: any planned work over more than one session, named after the work with no kind word;
// in-review is the user's read, so it waits for the user and never counts as running
check(
  "a job is planned work over more than one session, named after the work with no kind word; a one-session fix gets none",
  /record of a \*\*job\*\*: planned work over more than one session, kept as one `release` item named after the work \(no kind word in the name\)/.test(
    body,
  ) && /A one-session fix gets no job/.test(body),
);
check(
  "in-review is shown as Needs you (waiting for the user), not as Checking or running",
  /in-review and waits-for-you "Needs you"/.test(body) &&
    !/"Checking"/.test(body) &&
    !/running = in-progress and in-review/.test(body),
);
check(
  "a step that asks the user to read, review or check a file carries its path in `file`",
  /`file` \(the path of the file a step asks the user to read, review or check\)/.test(
    body,
  ),
);

// Wording stays general: no project, person or release of anyone's own. The names come from the local
// .privacy-words list (git ignores it), so this file names none of them
const WORDS = path.join(import.meta.dirname, "..", ".privacy-words");
const own = fs.existsSync(WORDS)
  ? fs
      .readFileSync(WORDS, "utf8")
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w && !w.startsWith("#"))
  : [];
if (!own.length)
  console.log(
    "NOTE: no .privacy-words list here, so names are not checked (release numbers and paths still are)",
  );
const lower = text.toLowerCase();
check(
  "no project names, release numbers or home paths in the text",
  !own.some((w) => lower.includes(w)) && !/26\.[0-9]|C:\/|C:\\/i.test(text),
);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
