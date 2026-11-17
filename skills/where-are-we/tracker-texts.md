# Tracker texts: how to write them

Every title, description and comment on a tracker item is for the user. They read it on a phone or in the list, without the plan open. So each text is plain sentences a person would say, one idea per sentence. The machine facts (row codes, commits, session ids, file paths) stay, but in fields and linked files, never in the text.

The where-are-we skill runs the checker `text-check.mjs` (next to this file) when it copies plan rows in and when it tidies the list; see "Marks a script can find" below.

## The form of each text

| Text | Form | Never in it | Where that fact goes |
|---|---|---|---|
| **Title** | A verb and what changes, as a person would say it: about 10 words, 70 characters at most. A step that is the user's starts "Your OK:" (a yes on a design or a text) or "Your word:" (a go, such as a release), then the thing to open and the answer wanted ("Your OK: read the new README, yes or changes"). A user step's title is the exact ask in plain words, what to do and what to answer ("Your OK: click Done on a test row: did it move?"), never a step code. A helper's step, a review the pipeline runs included, is never worded as an ask: it does not wait for the user. | "You:", row codes, the plan's own words for its parts, ids, hashes, paths, tool or command names, "T3:" style prefixes | row code: the `step` field; the plan: a linked file |
| **Job name** (the title of the job's `release` item) | The work itself, as the user calls it: a version number, a working name, a title. Any kind of work gets a job the same way. | a kind word added to the name, such as "release", "project" or "video" | what kind of work it is: the job's goal line |
| **Description of a step** | Two to four short sentences: what it is for; "Done when" as what a person could check; "Waits on" in words. | the user's quotes with their date, commands, file paths, "Helper", "Runs", "Serves", "Plan: <file>, row <code>" | quote: the plan file; command: the plan row's Done when; helper and runs: the plan; budget: the `budget` field; plan file: a linked file; the file a step asks the user to read, review or check: the `file` field; what it waits on: the `dependsOn` link and `waitsOn` |
| **Comment** | One to three sentences. First what happened (past tense), then what is left or next, then what the user must do, if anything. "Not checked yet:" in words when something is unproven. "Found:" in one sentence for work found on the way. | session ids, commit hashes, run or rule numbers, row codes, file paths, test counts such as "14/14", tool-call counts, the setup's own process words ("blind look", "handoff", "drift", "wave"), a closing "Proof:" line | commit and session: the `proof` field, or the commit and session linked to the item; numbers: the plan's Findings and the handoff |
| **The job's goal line** (the first line of its description, shown by the tracker) | One sentence: what the job gives a user. | a date as the only content, "(user, date)", plan file names | dates and plan files: the rest of the description in words, and linked files |
| **Stage name** | "<the plan's short name> · <phase>", with the phase from this list: design, build, review, check live, record, release. A user's OK step takes the stage of the step it unlocks. | a bare "Part 6", one plan's part numbers | the part number stays in the plan |

## From a plan row to a step

One step per plan row. The plan is the design; the step is what the user reads.

| Plan column | Becomes | How |
|---|---|---|
| Job | the title | Say what changes, for a person, in 70 characters or less. Drop file names and codes. |
| Serves | the first sentence of the description ("what it is for") | In plain words. The user's quote stays in the plan. |
| Done when | "Done when …" in the description | Each command becomes what it shows ("both test runs pass", "the release page exists"). |
| Stage | the `stage` field | "<the plan's short name> · <phase>", for example "Shop checkout · build". With several plans in one job, the short name keeps one plan's "Part 6" apart from another's. |
| Step code | the `step` field | As the plan names it, for example "S3", or "checkout S3" when two plans share a code. |
| Helper, Runs, Budget | the `budget` field and `dependsOn` links; "Waits on …" in words | Helper and runs stay in the plan. |
| The plan file | a linked file on the step | Not in the description. |
| A file the row asks the user to read, review or check | the `file` field | Its path, so the user opens it from the step. Not in the title or description. |

## When a new step may be made

A session makes a tracker step only in these three cases:
1. The copy of the rows (and the list of the user's OKs) of a plan the user OK'd, into the job.
2. A row the user OK'd as an addition to the plan: the plan changes first, then the step.
3. A user's OK or word that the plan names.

Work found mid-run is not a new step. It goes into the current step's comment as one sentence ("Found: …") and into the plan's notes or the handoff. If the user wants it done, it becomes a plan row first, then a step by case 2. A session that starts on a row links itself to the step that exists; when none exists and the row is not one of the three cases, it makes none and says so in its reply.

## Before and after

These are made-up items, to show the form.

**A build step.**
Before: title "S4: wire `checkout.mjs` into the cart (shop plan)"; description "Plan: docs/shop-plan.md, row S4. Serves: "the cart should just let me pay" (DECISIONS 2025-03-02). Done when: `npm test` passes; `node scripts/smoke.mjs` → 0 errors. Helper: worker. Runs: after S3."
After: title "Let people pay for their cart at checkout"; description "Lets a shopper pay for what is in the cart without leaving the page. Done when all tests pass and a test purchase goes through with no errors. Waits on the new cart page."

**A comment on a finished step.**
Before: "Session 4f2a9c1d: S4 done, commit 9e8d7c6 (tests 31/31). Not verified: P2 on CI. Worker used 18 calls of 25."
After: "Done. Shoppers can now pay from the cart, and the tests that cover paying pass. Not checked yet: the same tests on the online test runs."

## Marks a script can find

`text-check.mjs` looks for these marks: a commit hash, a session id, a row code, a file path, a command in backticks, a plan label ("Serves:", "Done when:", "Plan:" and the like) and a DECISIONS reference. A text for the tracker holds none of them.

- `node text-check.mjs` reads one text from stdin, or from a file given as its argument. It prints one line per mark and exits 1 when there is one; it prints `no marks` and exits 0 when there is none.
- `node text-check.mjs --json` reads many texts at once: a JSON array of `{"name": "...", "text": "..."}`. Each mark line starts with the name of its text, and the last line counts the texts with marks.
- A row code counts only beside a word that marks it as one ("row R1", "after L4", "look W4", a "T3:" prefix, a list such as "T7, T8"), and links are left out, so most real names pass.
- A real name the checker still flags (a product, a file format, a quarter, such as "Q3:" at the start of a line) may stay, and so may a link the user needs.
- `no marks` does not clear what no pattern finds: test counts, tool-call counts and the setup's own process words. The comment rule above covers those.

## Fields that keep their shape

`step`, `stage`, `waitsOn`, `budget`, `file` and the job description's first line keep their shape: the tracker extension reads them. These rules change only the values a person reads (the title, the description, the comments, the stage's words), never the field names or how the extension reads them.
