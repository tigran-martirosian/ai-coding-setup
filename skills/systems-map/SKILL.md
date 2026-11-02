---
name: systems-map
description: Systems map, the dictionary of a project's parts and what connects to what (.claude/systems-map.json). Use to build one for a project with 100+ code files (map-nudge asks for it), refresh one that went stale, add a part or link a change found missing, or look up the files a change touches.
---

# Systems map

A **thing** is a part a person would name out loud: a feature, service, screen, data store or background job; a folder or a class is not one. A **link** is a pair of things where, if a session changed one, it would have to look at the other. The map is a dictionary: a session reads only the lines of the things its work touches. The `map-brief` hook appends those lines to the brief of every helper (worker, worker-full, reviewer, planner) by itself.

One file, `<project>/.claude/systems-map.json`. Paths are from the project root, with forward slashes, and exist:

```json
{
  "nodes": [
    { "id": "checkout", "name": "Order checkout", "what": "Turns a cart into a paid order.", "files": ["src/checkout/index.ts"], "notes": ["docs/checkout.md"] }
  ],
  "links": [
    { "from": "checkout", "to": "pricing", "says": "Asks pricing for the cart total before charging.", "evidence": ["src/checkout/total.ts"] }
  ]
}
```

`what` and `says` are one plain sentence each. `notes` is optional.

## Commands

Run in the project folder: `node ~/.claude/skills/systems-map/map.mjs <command>` (`$HOME` instead of `~` in PowerShell).

- `--scan` prints what a builder needs to start: code files by folder, biggest files, entry points.
- `--near` lists every thing; `--near <word>...` prints those things with their links, the code behind each link and the things one step further. A word is a thing's id or name, a word of its description, or a file path.
- `--check` lists listed paths that no longer exist and mistakes in the JSON; exit 1 when anything is wrong.
- `--brief` reads a brief on stdin and prints the lines of the things it is about (the top 3 in full, one line for each further match, at most 7,000 characters); the hook uses it.

## Build a map

Budget: about 60 tool calls. Each step ends on its check.

1. Run `--scan`. Done when you can name the project's areas and its entry points.
2. Read the entry points and the main file of each area, a part of each rather than everything. Done when every area has been opened through its main file.
3. Write the things: 15 to 60. `id` is short, lowercase and hyphenated. `name` is specific: "Order checkout", not "Orders" (a one-word name that is ordinary English only matches through a file). `files` are the 1 to 6 files to start in. Done when every area of step 1 has a thing and no thing is a folder or a class.
4. Write the links, each with the test "if a session changed A, would it have to look at B?". Every link names the code that does it in `evidence`; a link with no code to name is left out. Done when each thing has at least one link, and the busiest has no more than about 12.
5. Write the file, then run `--check`. Done when it exits 0.
6. Report the numbers of things and links, in one line.

## Refresh a stale map

1. Run `--check`. Each `GONE` path moved or was deleted: find the new path with `git log --diff-filter=R --name-status` or a search for the file name, and correct every place that lists it.
2. Drop a thing or link whose code is gone; add a thing for each area in `--scan` that no thing covers.
3. Run `--check`. Done when it exits 0.

## Keep it fresh

A session that adds a system, or finds a link missing while it works, adds that thing or link to the file and runs `--check`.
