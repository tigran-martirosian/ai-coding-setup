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
    /end of a release/.test(front),
);

// The nine steps: number, bold title, and what each one needs to work
const STEPS = [
  ["Find the release", [/tracker_list/, /type `release`/, /newest/, /yes/]],
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
  ["Stranded steps", [/over a day/, /no live session/, /age/, /last comment/]],
  ["Ready gate", [/no Done when/, /open question/, /not ready/]],
  ["What waits for the user", [/waits-for-you/, /`waitsOn`/, /user's words/]],
  [
    "The reading",
    [
      /steps left of/,
      /running/,
      /nothing waits for you/,
      /calls left/,
      /groomed <date/,
    ],
  ],
  [
    "End of a release",
    [/released/, /`gitTag`/, /`releasedAt`/, /next release/, /one card/],
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
  /"Needs you"/.test(body) && /"Checking"/.test(body) && /"Dropped"/.test(body),
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
