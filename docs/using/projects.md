# Projects

Stratus gives each project folder a few notes files that every new session starts from, a rules folder and,
for a project with code, a verify skill that proves a change works. This page covers how to set a folder up, keep
it current, and keep track of a job across sessions.

## Set up a new project: `/new-project`

The first reply of the day in a folder that is not a project yet offers this on a question card (Yes, Not now,
Never here, Never in any folder). You can also type it. A folder that already has a `CLAUDE.md` goes to
`/update-project` instead.

It asks what the project is and what "done" means, then writes:

- `CLAUDE.md`: what the project is and how to work in it;
- `HANDOFF.md`: where the work stands;
- `DECISIONS.md`: each decision you confirm, written there at once;
- `docs/facts.md`: facts about the project and its tools, one per line; a fact that can change ends in
  `(recheck YYYY-MM-DD)`;
- a `.claude/` folder with the project's rules and settings.

Every project folder gets git, for history and undo from day one; the only question is whether it also goes to
GitHub. A project with code also gets a verify skill from one of four templates (web app, Godot game, command-line
or Node tool, data or video pipeline). The verify skill says how to start the app, what to do in it and what proof
to show before each commit that changes code.

New projects also start on the file standard (see `/file-upkeep` on [Housekeeping](housekeeping.md)) and get a
[systems map](systems-map.md) at once; an existing large project gets one after your yes.

## Bring a folder up to date: `/update-project`

When Stratus moves on, a folder you set up earlier falls behind. `/update-project` checks the folder's notes files
(`CLAUDE.md`, `HANDOFF.md`, `DECISIONS.md`), its `.claude/` rules, skills and settings, the file layout, stale
notes and facts past their recheck date (a fact line can end in `(recheck YYYY-MM-DD)`) against the current setup. It shows every proposed change first and makes
only the ones you tick. It also offers a verify skill to a folder that has code and none.

After a Stratus update that changes what a project should have, the first message of the day in a folder that is
behind offers it. The offer comes back at most once a day until you answer it: "Not now" stops it for that folder
until the next such update, and "Never, in any folder" stops it everywhere.

## Work in an existing or team repository

Stratus installs for your whole user account, so it is active in a colleague's or employer's repository too. It is
built for your own projects; in a repository that others share, keep its conventions out of the way:

- **Commits without asking.** A global rule makes Claude run `git init` in a project folder that has no git, and
  commit its finished work there without asking: one commit per piece of work, with only the files that session
  changed, on the branch you are on. It pushes or deploys only when you say so. To stop the commits everywhere, leave
  the rule out: `node ~/.claude/skills/update-setup/update.mjs --leave-out "Git in every project"`.
- **The offers.** In a folder with a `.git` or `CLAUDE.md`, Stratus does not offer `/new-project`, but it can offer
  `/update-project`. Answer "Never here" on the card, or run
  `node ~/.claude/skills/update-project/pass.mjs --skip "<folder>"`. In a folder that is not a repository yet,
  "Never here" stops the `/new-project` offer the same way.
- **Edits and commits.** `VERIFY_GATE=off` stops the reminder to run a build or test before a reply ends, and
  `FILE_NAME_NOTE=off` stops the file-name notes. Set them in the environment, or in the `env` block of the
  project's `.claude/settings.local.json` (keep that file out of the repository). [How to](../HOW-TO.md#turn-a-hook-off)
  shows both.
- **The global rules.** `node ~/.claude/skills/update-setup/update.mjs --leave-out "<lead>"` drops one rule from `~/.claude/CLAUDE.md`
  everywhere; the [install options](install-and-update.md#installer-options) explain the lead. One to consider for a
  team repository is the rule that writes each confirmed decision into the project's `DECISIONS.md`, which would add
  that file: `node ~/.claude/skills/update-setup/update.mjs --leave-out "An explicit go is a decision"`.

## Keep track of a job: `/where-are-we`

A job is any work that runs over more than one session. `/where-are-we` reads the job from the project's Nimbalyst
tracker and brings it up to date: it copies the plan's slices in as steps, closes the steps a commit proves
finished, and lists stranded steps and what waits for you. The [job tracker](nimbalyst.md#job-tracker) shows the
result.

## Decide what to do next: `/next-move`

`/next-move` names the one most useful thing to do next, from your goals and the project's state. It reads your
goals from `~/.claude/goals.md`; the first time you run it, it asks for them and saves that file.

## Clean up a tangled codebase: `/untangle-codebase`

Run it every few weeks on a codebase that has grown tangled: it untangles the whole project in one pass, so later
changes need less reading and break less. It runs only when you type it. It comes from
[caldoai/skills](https://github.com/caldoai/skills) (MIT).

## A project's look: `/design-system`

See [Design](design.md).
