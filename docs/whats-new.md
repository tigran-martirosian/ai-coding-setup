# How Stratus works now (26.6)

## What changed

Texts and research now start from what the reader needs, and security and design tools come built in. There is nothing to do beyond the update itself, with one exception: the always-on security review needs Python 3.10 or newer, so if the update said it left that plugin off, install Python and run `/update-setup` again.

- **Texts for other people start from the reader.** When Claude writes something another person reads (a README, a guide, release notes, a description of work done), it first names that reader, the one thing they should take away and the few points they came for. How the work was built stays out.
- **Research says how solid each finding is.** A research report opens with the answer, and each finding carries one tag: Solid (three or more independent current sources agree), Thin (one or two independent sources), Ours (Claude's own reasoning or test) or Old (only evidence from before 2025, or from older Claude models). A recommendation never rests on an Old finding.
- **Security in three levels.** Always on: Anthropic's security-guidance plugin warns on risky code as Claude edits it and reviews each change; it needs Python 3.10 or newer, and without it the plugin stays off and the update says so. `/security` runs a quick check of a change before a commit or a release. `/security deep` scans a whole project in one pass.
- **Design tools.** Two plugins are turned on: Anthropic's frontend-design and impeccable (Paul Bakaus's design commands and checks); Claude uses them when it builds an interface. `/gridlines` draws guide lines down an interface and fixes paddings so the edges line up.
- **Big jobs look for what already exists first,** in your own code, your packages, then a maintained package or template, so less is built from scratch. In Nimbalyst, the Job Tracker page lists a job's steps in the order they run, under numbered stages.

## How a job runs

Claude says the size of each ask in one line first. To change it, answer with one word: "small", "medium" or "big".

- **Small** (one change): made now and shown working.
- **Medium** (one session, a few parts): one to three questions, each with a recommended answer, then a few "done when" lines in the chat for your OK, then built in the same chat.
- **Big** (a new project, more than one session, or several parts that must fit): the steps below.

A big job runs in this order:

1. `grilling` first looks for what already exists (your project's code, its packages, a tool that already does the job). Then it asks its questions in rounds. Facts are Claude's job: it looks them up instead of asking you.
2. It writes a spec, a file that lists what done means, each line with the check that proves it, and keeps your exact words for numbers, names and limits.
3. `lead` writes the plan beside the spec as slices, the pieces one helper builds at a time.
4. A `plan-reviewer`, a helper that only reads, checks the plan once.
5. You get links to both files and a short summary. Nothing is built before your OK.
6. Helpers build the slices side by side, each in its own git worktree (a separate copy of the project on its own branch).
7. One `reviewer` checks the finished result against each done-when line.
8. You try it. A problem you find becomes a fix slice in the same run.

Claude stops and asks you when the spec turns out wrong, when a done-when line would change, or after three failed fixes of one check.

## Proof before "done"

Claude does not call a change done without the command and the output lines that prove it. Three kinds of check stand behind that.

**Scripts that run.** The checks in the spec's done-when lines, each slice's own checks with the lint, the project's **verify** skill and the tests GitHub runs. The **verify** skill (`.claude/skills/verify/SKILL.md`) starts your app with no window on screen, uses it the way a person would and prints one `PROOF` line per check: what was checked, what was expected and what came out. `/new-project` writes it; `/update-project` offers it to a project that has none. In Nimbalyst, the **Try it** button in the chat box runs it on the last change.

**One fresh reader, at four points.** A helper that has not seen the work reads it: the `plan-reviewer` reads the plan, `/code-review` reads a risky slice (one that touches a safety check, a delete path or secrets), the `reviewer` reads the finished job, and the `blind-reviewer` looks at what a person will see or read, the way a newcomer would.

**One gate.** When Claude edits code and then tries to end its reply with no build or test run after the edit, the **verify-gate** hook holds the reply back once and Claude runs one first. The environment variable `VERIFY_GATE=off` turns it off, for a project with a slow test suite; it is also read from the "env" section of a project's `.claude/settings.json`, so it can be off for one project only.

## How updates reach you

Every 12 hours Stratus asks GitHub for a newer release. A release that needs no answer from you installs itself in the background, and a grey line in the chat says so. A release that needs you waits until you type `/update-setup`. `AUTO_UPDATE=off` makes every release wait. [Updates](using/install-and-update.md#updates) has the details.

## Say or type → what happens

The quoted words are examples. Every row not marked "typed" also works when you say what you want in your own words; a row marked "typed" starts only when you type its command.

| Say or type | What happens | Skill |
|---|---|---|
| "grill me", "задай мне вопросы", "погоняй меня по плану" (Russian works too) | Questions in rounds, then what done looks like | `grilling` |
| "lead this", "orchestrate", "веди эту работу", "раздай по агентам" (Russian works too), `/lead` | A big job run from its spec to the end review | `lead` |
| "wait what", "huh?", "не понял", "в смысле?" (Russian works too), `/wait-what` | The last reply again, in plain words | `wait-what` |
| "where are we", "how much is left", `/where-are-we` | What is left of a job, from Nimbalyst's tracker | `where-are-we` |
| "handoff", "new session", `/handoff` | A short brief and a fresh chat that goes on from it | `handoff` |
| `/btw <note>` (typed) | A note to a busy chat in the same folder, without stopping it | `btw` |
| `/next-move` (typed) | The one most useful thing to do next | `next-move` |
| "set this project up", `/new-project` | A new project folder with its notes, git and verify check | `new-project` |
| "update this project", `/update-project` | An older project folder brought up to date with Stratus | `update-project` |
| "update the setup", "install the update", `/update-setup` | The newest release installed | `update-setup` |
| "what's new", "что нового" (Russian works too) | A short tour of this page, with its path | `update-setup` |
| "security check", `/security` | A quick check of a change; `/security deep` scans a whole project | `security` |
| "edges don't line up", "padding is off", `/gridlines` | Guide lines down an interface, and the paddings fixed so edges line up | `gridlines` |
| "audit my setup", "where did my tokens go", "chat review", `/setup-audit` | A report on Stratus, usage or chats | `setup-audit` |
| any web question, or a page to read word for word | Facts from the page that knows them, each tagged by how solid it is | `web-research` |
| a video link and a question, `/watch` | The video's words and stills, read for you | `watch` |
| "update the README", "describe this PR" | Text other people read, written for its reader | `writing` |
| "tidy the PC", `/pc-tidy` | What holds memory; what old sessions left running is stopped (Windows only) | `pc-tidy` |
| "what takes space", `/disk-tidy` | What fills the disk, cleared item by item with your yes | `disk-tidy` |
| asking to tidy or rename a project's files, `/file-upkeep` | File names and places put to the common standard | `file-upkeep` |
| "back up", `/backup` | An encrypted backup to your own cloud storage | `backup` |
| "pair my phone", `/phone-bot` | The phone app joined to this computer (an add-on for Windows: `node install.mjs --with phone-bot`) | `phone-bot` |

Claude Code's own `/code-review` reviews the current change when you type it; Claude also runs it by itself on a risky change. Every skill Stratus installs, those not in this table included, is in [the skills list](reference/skills.md). What to type for each area, kept up to date after this release: [Using Stratus](HOW-TO.md).

Everything else that changed in 26.6, the fixes included, is in the 26.6 section of [CHANGELOG.md](../CHANGELOG.md).
