---
name: systems-map
description: Systems map, the dictionary of a project's parts and what connects to what (.claude/systems-map.json). Use to build one for a project with 100+ code files (map-nudge asks for it), refresh one that went stale, add a part or link a change found missing, or look up the files a change touches.
---

# Systems map

A **thing** is a part a person would name out loud: a feature, service, screen, data store or background job; a folder or a class is not one. A **link** is a pair of things where, if a session changed one, it would have to look at the other. The map is a dictionary: a session reads only the lines of the things its work touches. Two hooks hand those lines out by themselves (section Who is shown what).

One file, `<project>/.claude/systems-map.json`. Paths are from the project root, or `~/` for a file of the setup, with forward slashes, and exist:

```json
{
  "nodes": [
    { "id": "checkout", "name": "Order checkout", "what": "Turns a cart into a paid order.", "files": ["src/checkout/index.ts"], "notes": ["docs/checkout.md"], "group": "shop", "words": ["\\bcheckout\\b", "paid order"] }
  ],
  "links": [
    { "from": "pricing", "to": "checkout", "type": "feeds", "says": "Pricing gives checkout the cart total before it charges.", "evidence": [{ "file": "src/checkout/total.ts", "token": "cartTotal" }, "src/pricing/index.ts"] }
  ]
}
```

`what` and `says` are one plain sentence each. `files` are the files a session opens first for that thing: its own code, test, skill or doc, never one shared index file (a list of everything, an overview page). A file that more than 3 things list names none of them, so a brief that names it gets none of those things. `notes` is optional, and so are the next three.

- `group` (on a thing) is a short word that sets it with the things around it, for a viewer's colour and clustering.
- `words` (on a thing) is a list of regular expressions (case ignored), written as the phrase people use: `"release to the public repo"`, `"\\bweb (search|research)"`. One bare common word (`"\\brelease\\b"`, `"\\btests?\\b"`, `"\\bweb\\b"`; the `COMMON` list in `map.mjs`) matches nearly every text, so the map ignores it and `--check` fails on it. `--near` lists up to 3 lines of `DECISIONS.md` they match under `Decided:`, each cut to 200 characters.
- `type` (on a link) is one of `uses` (the default), `feeds`, `spends`, `opens`, `boosts`, `limits`; the brief shows it in the arrow (`feeds -> Pricing`, `<- limits from Cart`).
- An `evidence` entry is a path, or `{ "file": path, "token": text }`. A token is the name of the function, key or string that does the link, so the map notices when it changes.

## Topics and how-to things

Besides the parts, a map holds two more kinds of thing, so a helper told "rebalance the damage" or "research this on the web" follows links instead of searching blind.

- **A topic** is a subject the user talks about that spans parts: "damage balance", "pricing", "onboarding". Its links go to every part it pulls together (damage balance: gear, monster damage, monster health, buffs), each link with the code that does it. Its id starts with `topic-` and its group is `topic`.
- **A how-to thing** is a job a session in this project gets told to do: research, a web search, browser work, a video, tests, a release, a hand-off, a big job. Its id starts with `do-`; its `files` are the 1 to 3 files to read first: the setup's skill as `~/.claude/skills/<name>/SKILL.md` (always `~/`, never a full home path, so the map works for anyone) and the project's own rule, script or notes; never a `CLAUDE.md` (every session has it loaded). Its `words` match how people ask (`"\\bresearch"`, `"\\bweb (search|research)"`, `"\\breddit\\b"`), never a word every brief holds ("work", "file", "check"). Its group is `how-to`.
- **How-to things form chains.** Each links to the step it hands on to and the things it uses: research -> the project's notes and `DECISIONS.md` -> web research -> the reader for Reddit and X, or the version checker. The evidence of such a link is the file that names the next step, and its token is the command, script or file name that does it (`social.mjs`, `versions.mjs`), never a generic word ("full", "chat", the skill's own name).
- **Which how-to things:** the jobs this project's `CLAUDE.md`, `.claude/skills/`, scripts and `docs/` show it does, plus research and web research (every project does those). Read each setup skill before writing its thing; its `what` says when to reach for it in this project.

**Generated files.** A file a script writes (text, data, a docs page) is listed at the top level, so there is one source and nobody edits the copy:

```json
"generated": [{ "files": ["data/road.json", "docs/steps.md"], "by": "tools/road.py", "run": "python tools/road.py", "inputs": ["data/ladder.json"] }]
```

`inputs` (optional) are files the script reads: a commit that changes one and reruns the script counts as a run. The `map-generated` hook refuses an Edit or Write of a listed file and names the script and its `run`; `--check` prints `HAND <file>` for a listed file changed by a commit after the last commit of its script or inputs (a hand edit its next run would undo); `--near` shows `Generated:` under a thing that lists such a file. A generator that is retired is not listed: its outputs are the source, and the script refuses to write them.

## Commands

Run in the project folder: `node ~/.claude/skills/systems-map/map.mjs <command>` (`$HOME` instead of `~` in PowerShell).

- `--scan` prints what a builder needs to start: code files by folder, biggest files, entry points.
- `--near` lists every thing; `--near <word>...` prints those things with their links, the code behind each link, the things one step further and up to 3 short `Decided:` lines. A word is a thing's id or name, a word of its description, or a file path.
- `--check` lists listed paths that no longer exist, evidence that lost its token (`DRIFT`), generated files edited by hand (`HAND`), `words` entries that are one bare common word (`WORD`) and mistakes in the JSON; exit 1 when anything is wrong.
- `--brief` reads a brief on stdin and prints the lines a helper gets (section Who is shown what); the `map-brief` hook uses it.

## Who is shown what

A thing is **matched by file** when the text names a file it lists: a full path, a path with its folder, or a bare file name only one listed file has. It is **matched by name** through its id or name, **by folder** through a written folder that holds its files, and **by words** through a `words` entry alone.

- **A helper** (worker, worker-full, worker-code, worker-refactor, reviewer, plan-reviewer, planner) gets `SYSTEMS MAP:` lines appended to its brief by the `map-brief` hook, at most 2,000 characters, cut at whole lines. The top 3 things matched by file, name or folder come in full (what it is, start files, the 12 links nearest the brief's files); each further one gets one line with its start files. A how-to thing or topic matched by words alone gets one line ending `(by words)`, 2 at most, last; a code part matched by words alone is left out. When nothing matches, one short line says so.
- **The main chat** gets a `[map-prompt]` note on the person's message from the `map-prompt` hook: the things the message names, each with up to 3 first files, at most 3 things and 600 characters, each once a session. A code part counts by its id or name only; a how-to thing or topic also by its `words`. A thing whose first file the session already holds from its start (a skill, a rules file, a `CLAUDE.md`, an agent, the memory index) is left out, since the note would only repeat it.

## Build a map

Budget: about 50 tool calls. Each step ends on its check.

1. Run `--scan`. Done when you can name the project's areas and its entry points.
2. Read the entry points and the main file of each area, a part of each rather than everything. Done when every area has been opened through its main file.
3. Write the things: 15 to 60. `id` is short, lowercase and hyphenated. `name` is specific: "Order checkout", not "Orders" (a one-word name that is ordinary English only matches through a file). `files` are the 1 to 6 files to start in. Done when every area of step 1 has a thing and no thing is a folder or a class. Then the topics the project's docs and `DECISIONS.md` talk about, and its how-to things (section above, at least research and web research); done when each how-to thing's files were opened.
4. Write the links, each with the test "if a session changed A, would it have to look at B?". Every link names the code that does it in `evidence`; a link with no code to name is left out. Give each evidence a `token` where one exists (the function, key or string that does the link). Done when each thing has at least one link, and the busiest has no more than about 12.
5. Write the file, then run `--check`. Done when it exits 0.
6. Report the numbers of things and links, in one line.

## Refresh a stale map

1. Run `--check`. Each `GONE` path moved or was deleted: find the new path with `git log --diff-filter=R --name-status` or a search for the file name, and correct every place that lists it.
2. Drop a thing or link whose code is gone; add a thing for each area in `--scan` that no thing covers, and the topics and how-to things the map lacks (section Topics and how-to things).
3. Run `--check`. Done when it exits 0.

## Drift

A link drifts when its evidence file still exists but no longer holds the token: the code that did the link was renamed, rewritten or moved out.

- `--check` prints `DRIFT <file>  (link <from> -> <to>): no longer has: <token>`, counts them in its last line (`, N drifted`) and exits 1. `--near` marks such a link `[CODE GONE]`.
- The `map-drift` hook speaks right after an edit of a file that backs a tokened link whose token is now gone: `[map-drift] <file> backs the link <From> -> <To> ("<says>") and no longer has "<token>"`. Once an hour for each project, file and link; `MAP_DRIFT=off` silences it.
- To settle one: check that the far end of the link (the thing it points to) still holds. If it does, fix the evidence (the new token, or the new file) in the map. If the link is no longer true, drop it. Then run `--check`.

## Keep it fresh

A session that adds a system, or finds a link missing while it works, adds that thing or link to the file and runs `--check`.
