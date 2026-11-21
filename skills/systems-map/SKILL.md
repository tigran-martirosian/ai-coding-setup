---
name: systems-map
description: Systems map, the dictionary of a project's parts and what connects to what (.claude/systems-map.json). Use to build one for a project with 100+ code files and 10,000+ lines (map-nudge asks the user once on a card; build only on yes), refresh one that went stale, add a part or link a change found missing, or look up the files a change touches.
---

# Systems map

A **thing** is a part a person would name out loud: a feature, service, screen, data store or background job; a folder or a class is not one. A **link** is a pair of things where, if a session changed one, it would have to look at the other. The map is a dictionary: a session reads only the lines of the things its work touches. Its worth is what a search of the code cannot find: the rules a part must keep and the reasons behind its links. A session finds it through the pointer line in the project's `CLAUDE.md` (Build a map, step 6) and looks a thing up with `--near`.

One file, `<project>/.claude/systems-map.json`. Paths are from the project root, or `~/` for a file of the setup, with forward slashes, and exist:

```json
{
  "nodes": [
    { "id": "checkout", "name": "Order checkout", "what": "Turns a cart into a paid order.", "files": ["src/checkout/index.ts"], "notes": ["docs/checkout.md"], "group": "shop", "words": ["\\bcheckout\\b", "paid order"], "rules": ["Never charge twice for one cart: the payment id is the lock."] }
  ],
  "links": [
    { "from": "pricing", "to": "checkout", "type": "feeds", "says": "Pricing gives checkout the cart total before it charges.", "why": "Checkout never works out a price itself, so a price change lands in one place.", "evidence": [{ "file": "src/checkout/total.ts", "token": "cartTotal" }, "src/pricing/index.ts"] }
  ]
}
```

`what` and `says` are one plain sentence each. `files` are the files a session opens first for that thing: its own code, test, skill or doc, never one shared index file (a list of everything, an overview page). A file that more than 3 things list names none of them, so a brief that names it gets none of those things. `notes` is optional, and so are the next five.

- `rules` (on a thing) is a list of short lines, each a "never" or "only here" that a search of the code cannot find: `"Never charge twice for one cart: the payment id is the lock."`, `"Only the importer writes prices."`. Not a rule: what the code already says plainly, or a general coding habit. `--check` fails on a `rules` that is not a list of strings, or on an empty line.
- `why` (on a link) is one sentence: the reason the link exists or must stay as it is, when `says` does not already give it. `--check` fails on a `why` that is not a string, or is empty.
- `group` (on a thing) is a short word that sets it with the things around it, for a viewer's colour and clustering.
- `words` (on a thing) is a list of regular expressions (case ignored), written as the phrase people use: `"release to the public repo"`, `"\\bweb (search|research)"`. One bare common word (`"\\brelease\\b"`, `"\\btests?\\b"`, `"\\bweb\\b"`; the `COMMON` list in `map.mjs`) matches nearly every text, so the map ignores it and `--check` fails on it. `--near` lists up to 3 lines of the decision files (`DECISIONS.md` and `docs/decisions/`) they match under `Decided:`, each with its file and line, each cut to 200 characters.
- `type` (on a link) is one of `uses` (the default), `feeds`, `spends`, `opens`, `boosts`, `limits`; the brief shows it in the arrow (`feeds -> Pricing`, `<- limits from Cart`).
- An `evidence` entry is a path, or `{ "file": path, "token": text }`. A token is the name of the function, key or string that does the link, so the map notices when it changes.

## Topics and how-to things

Besides the parts, a map holds two more kinds of thing, so a helper told "rebalance the damage" or "research this on the web" follows links instead of searching blind.

- **A topic** is a subject the user talks about that spans parts: "damage balance", "pricing", "onboarding". Its links go to every part it pulls together (damage balance: gear, monster damage, monster health, buffs), each link with the code that does it. Its id starts with `topic-` and its group is `topic`.
- **A how-to thing** is a job a session in this project gets told to do: research, a web search, browser work, a video, tests, a release, a hand-off, a big job. Its id starts with `do-`; its `files` are the 1 to 3 files to read first: the setup's skill as `~/.claude/skills/<name>/SKILL.md` (always `~/`, never a full home path, so the map works for anyone) and the project's own rule, script or notes; never a `CLAUDE.md` (every session has it loaded). Its `words` match how people ask (`"\\bresearch"`, `"\\bweb (search|research)"`, `"\\breddit\\b"`), never a word every brief holds ("work", "file", "check"). Its group is `how-to`.
- **How-to things form chains.** Each links to the step it hands on to and the things it uses: research -> the project's notes and `DECISIONS.md` and `docs/decisions/` -> web research -> the reader for Reddit and X, or the version checker. The evidence of such a link is the file that names the next step, and its token is the command, script or file name that does it (`social.mjs`, `versions.mjs`), never a generic word ("full", "chat", the skill's own name).
- **Which how-to things:** the jobs this project's `CLAUDE.md`, `.claude/skills/`, scripts and `docs/` show it does, plus research and web research (every project does those). Read each setup skill before writing its thing; its `what` says when to reach for it in this project.

**Generated files.** A file a script writes (text, data, a docs page) is listed at the top level, so there is one source and nobody edits the copy:

```json
"generated": [{ "files": ["data/road.json", "docs/steps.md"], "by": "tools/road.py", "run": "python tools/road.py", "inputs": ["data/ladder.json"] }]
```

`inputs` (optional) are files the script reads: a commit that changes one and reruns the script counts as a run. The `map-generated` hook refuses an Edit or Write of a listed file and names the script and its `run`; `--check` prints `HAND <file>` for a listed file changed by a commit after the last commit of its script or inputs (a hand edit its next run would undo); `--near` shows `Generated:` under a thing that lists such a file. A generator that is retired is not listed: its outputs are the source, and the script refuses to write them.

## Commands

Run in the project folder: `node ~/.claude/skills/systems-map/map.mjs <command>` (`$HOME` instead of `~` in PowerShell).

- `--scan` prints what a builder needs to start: code files by folder, biggest files, entry points.
- `--near` lists every thing; `--near <word>...` prints those things with their start files, their `rules`, their links with each link's `why` and the code behind it, the things one step further and up to 3 short `Decided:` lines, each with its file and line. A word is a thing's id or name, a word of its description, or a file path.
- `--check` lists listed paths that no longer exist, evidence that lost its token (`DRIFT`), generated files edited by hand (`HAND`), `words` entries that are one bare common word (`WORD`) and mistakes in the JSON (a bad `rules` or `why` among them); exit 1 when anything is wrong.
- `--brief` reads a brief on stdin and prints the lines a helper gets (section Who is shown what); the `map-brief` hook uses it.

## Who is shown what

A thing is **matched by file** when the text names a file it lists, or the evidence file of one of its links: a full path, a path with its folder, or a bare file name only one listed file has. A name, a written folder or a `words` entry alone does not match a thing for the brief.

- **The main chat** reads the pointer line in the project's `CLAUDE.md` and runs `--near` when its work touches a part.
- **A helper** (worker, worker-full, worker-code, worker-refactor, reviewer, plan-reviewer) gets `SYSTEMS MAP:` lines appended to its brief by the `map-brief` hook, but only during the hook's trial: while `~/.claude/state/map-brief-trial.json` (`{"until":"YYYY-MM-DD"}`) is unexpired. With no trial file, or after its date, the hook does nothing. The lines are `--brief`'s output, at most 2,000 characters, cut at whole lines: for each of the top 3 things matched by file, its name, what it is, its `rules`, and the 12 links nearest the brief's files, each with its `why`. A thing matched by file with no rules and no links is left out, and no thing is shown only with its start files. Further things matched by file are named on one `Also matched by file` line. When nothing matches, one short line says so.

## Build a map

Budget: about 50 tool calls. Each step ends on its check.

1. Run `--scan`. Done when you can name the project's areas and its entry points.
2. Read the entry points and the main file of each area, a part of each rather than everything. Done when every area has been opened through its main file.
3. Write the things: 15 to 60. `id` is short, lowercase and hyphenated. `name` is specific: "Order checkout", not "Orders" (a one-word name that is ordinary English only matches through a file). `files` are the 1 to 6 files to start in. Give a thing `rules` where its code, comments or docs show a "never" or "only here" that a search would not turn up. Done when every area of step 1 has a thing and no thing is a folder or a class. Then the topics the project's docs and `DECISIONS.md` talk about, and its how-to things (section above, at least research and web research); done when each how-to thing's files were opened.
4. Write the links, each with the test "if a session changed A, would it have to look at B?". Every link names the code that does it in `evidence`; a link with no code to name is left out. Give each evidence a `token` where one exists (the function, key or string that does the link), and the link a `why` where the reason is not plain from `says`. Done when each thing has at least one link, and the busiest has no more than about 12.
5. Write the file, then run `--check`. Done when it exits 0.
6. Add this line to the project's `CLAUDE.md`, word for word, unless it is there already: "Systems map: `.claude/systems-map.json` holds this project's parts with their rules and links; look one up with `node ~/.claude/skills/systems-map/map.mjs --near <word>`." Done when the line is in the file once.
7. Report the numbers of things and links, in one line.

## Refresh a stale map

1. Run `--check`. Each `GONE` path moved or was deleted: find the new path with `git log --diff-filter=R --name-status` or a search for the file name, and correct every place that lists it.
2. Drop a thing or link whose code is gone; add a thing for each area in `--scan` that no thing covers, and the topics and how-to things the map lacks (section Topics and how-to things).
3. Add `rules` and `why` where they are missing: a thing whose code shows a "never" or "only here", a link whose reason is not plain from `says`.
4. Thin the plain entries: a thing that holds only its name and files, with no rule and no link a search could not find, is dropped or merged into the thing it is part of.
5. Run `--check`. Done when it exits 0.
6. Add this line to the project's `CLAUDE.md`, word for word, unless it is there already: "Systems map: `.claude/systems-map.json` holds this project's parts with their rules and links; look one up with `node ~/.claude/skills/systems-map/map.mjs --near <word>`." Done when the line is in the file once.

## Drift

A link drifts when its evidence file still exists but no longer holds the token: the code that did the link was renamed, rewritten or moved out.

- `--check` prints `DRIFT <file>  (link <from> -> <to>): no longer has: <token>`, counts them in its last line (`, N drifted`) and exits 1. `--near` marks such a link `[CODE GONE]`.
- The `map-drift` hook speaks right after an edit of a file that backs a tokened link whose token is now gone: `[map-drift] <file> backs the link <From> -> <To> ("<says>") and no longer has "<token>"`. Once an hour for each project, file and link; `MAP_DRIFT=off` silences it.
- To settle one: check that the far end of the link (the thing it points to) still holds. If it does, fix the evidence (the new token, or the new file) in the map. If the link is no longer true, drop it. Then run `--check`.

## Keep it fresh

A session that adds a system, or finds a link missing while it works, adds that thing or link to the file and runs `--check`.
