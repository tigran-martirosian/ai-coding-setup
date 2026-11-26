# Skills

Stratus has 26 skills. A skill is a set of instructions that Claude loads when your request matches its
description, or when you type its name as a command, such as `/handoff`. The installer copies 25 of them into
`~/.claude/skills/`. The 26th, `phone-bot`, is an add-on: add it with `node install.mjs --with phone-bot`.

Claude picks most skills by itself from what you say. Five skills run only when you type their command: `/btw`,
`/board-cleanup`, `/design-system`, `/next-move` and `/untangle-codebase`. The table marks them as "Typed only".

## Skills in `~/.claude/skills/`

| Skill | What it does | Starts |
|---|---|---|
| `backup` | Sets up an encrypted backup of your Claude setup and chosen project folders to your own Backblaze B2 storage with restic, runs it on request or on a schedule, and restores files. | By itself or `/backup` |
| `board-cleanup` | Moves finished sessions on this project's Nimbalyst Sessions board to Complete, then archives old ones with the Board Tidy extension. | Typed only |
| `btw` | Adds a note to, or asks a question of, another Claude session that is busy in the same folder, without stopping it. | Typed only |
| `design-system` | Shows, writes or refreshes the project's `DESIGN.md` (colours, type, spacing, components) and uses it for the design work at hand. | Typed only |
| `disk-tidy` | Finds what fills the disk, clears it item by item with your yes, turns the chat archive on or off, and brings back an archived chat. | By itself or `/disk-tidy` |
| `file-upkeep` | Renames and moves a project's files to the common file standard and removes old copies. | By itself or `/file-upkeep` |
| `gridlines` | Draws vertical guide lines down an interface, finds items that miss their line, and fixes paddings so panels share a small set of edges. | By itself or `/gridlines` |
| `grilling` | Asks the questions to settle before a medium or big job, then writes down what done looks like. | By itself or `/grilling` |
| `handoff` | Writes a short handoff brief and opens a fresh session that continues the work from it. | By itself or `/handoff` |
| `lead` | Runs a big job from its spec to the end report: a plan, one plan review, your OK, helpers per part, checks and a final review. | By itself or `/lead` |
| `new-project` | Sets up a new project folder: a short `CLAUDE.md`, `HANDOFF.md`, `DECISIONS.md`, the `.claude/` folders, the tools this project uses, and its git or GitHub preset. | By itself or `/new-project` |
| `next-move` | Suggests the one most useful thing to do next, from your goals and the project's state. | Typed only |
| `pc-tidy` | Shows what holds the computer's memory, stops what finished sessions left running, and names ports a closed program still holds. | By itself or `/pc-tidy` |
| `phone-bot` | Joins this Windows PC to the phone app, a Telegram Mini App that shows and drives your Nimbalyst sessions. An add-on. | By itself or `/phone-bot` |
| `security` | Security checks at three levels: always on (the `security-guidance` plugin), quick (one change, before a commit or release) and deep (a whole project, once). | By itself or `/security` |
| `setup-audit` | Checks that Stratus works, and reports on token use, chats, prompts, projects and memory. | By itself or `/setup-audit` |
| `site-login` | Signs you in to a website in one visible browser window, then lets Claude reuse the saved login in a headless browser. | By itself or `/site-login` |
| `systems-map` | Builds and refreshes the project's systems map (`.claude/systems-map.json`): its parts, their files and the links between them. | By itself or `/systems-map` |
| `untangle-codebase` | Reorganises a whole codebase in one pass so that agents read less per change and break less. | Typed only |
| `update-project` | Brings an existing project folder up to the current setup: its notes files, `.claude/` rules and settings, file layout and project tools. | By itself or `/update-project` |
| `update-setup` | Updates Stratus to the newest release and keeps your own files and settings. | By itself or `/update-setup` |
| `wait-what` | Explains the last reply again in plain words when it did not land. | By itself or `/wait-what` |
| `watch` | Turns a YouTube link or a video file into timed text and sheets of timed stills that a cheap model reads. | By itself or `/watch` |
| `web-research` | Finds web facts at the source that knows them, and reads pages. | By itself or `/web-research` |
| `where-are-we` | Says how much of a job is left, from the project's Nimbalyst tracker, and brings the tracker up to date. | By itself or `/where-are-we` |
| `writing` | Shapes any text a person will read: emails, posts, a README, docs, release notes, a profile. | By itself or `/writing` |

## Template skills

A template skill is installed into a project folder, not into `~/.claude/skills/`. There is 1 template skill. The
`quick-tasks` folder also brings two skills of its own, listed below the table.

| Skill | What it does | Where it goes |
|---|---|---|
| `picture` | Makes a picture with Codex of how something looks or works, and shows it only after it passes a short checklist. | The `quick-tasks` folder, and only when Codex is used (`--codex yes`) |

## Skills of the `quick-tasks` folder

These two skills are part of the `quick-tasks` folder and are installed with it every time:

- `finder` searches for a product, deal, listing, shop, service or place, and ends with a table of what it found.
  It searches with Codex (`codex --search`) and needs Codex. Without Codex, Claude searches with the `web-research` skill instead.
- `read-web` reads what a plain fetch can't: a page that comes back blocked or empty, and a site's news feed.
  It also finds YouTube videos on a topic by their titles; what a video says or shows goes to the `watch` skill.
  It needs no login.

[The side-work folders](../using/side-work-folders.md) says what the folder is for.

`skills/steer/` holds no skill. It holds two helper scripts: `steer.mjs` passes notes to a busy session for `/btw`
(in a terminal and in Nimbalyst) and for the Note button (Nimbalyst only), and `compact-self.mjs` lets a Nimbalyst
session compact itself.
