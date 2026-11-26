# The systems map

A systems map points a session that starts on a change at the files that matter for it, and tells it what else
that change touches, so it does not have to search the whole project.

## What is in a map

Each project can have a map in `.claude/systems-map.json`. It is a dictionary of the project's parts and of what
connects to what.

- **A part** is something a person would name out loud: a feature, a service, a screen, a data store, a background
  job. It is not a folder. A part lists the few files a session opens first. A shared index file is not one of
  them: a file that more than 3 parts list is ignored for all of them. A part can also have a group, words that a
  search matches, and rules ("never" or "only here" lines) that are passed on to a helper working on it.
  In the map file a part is an entry of `nodes`; `map.mjs` messages call it a "thing".
- **A link** says that changing one part means looking at the other, and names the code that does it. A link can
  name its kind (`uses`, `feeds`, `spends`, `opens`, `boosts`, `limits`) and the token in a file that proves it.
- **A topic** is a subject that spans several parts. In a web shop, "checkout" links the cart, payments, tax and
  the order emails.
- **A how-to entry** is a job sessions in the project are often asked to do (research, a release, the tests), with
  the 1 to 3 files to read first and a link to the step it hands on to.

A map may point at Stratus's own files as `~/.claude/...`, so it works on any computer.

## Getting a map

- `/new-project` starts one, and `/update-project` offers one.
- In a project with 100 or more code files holding 10,000 or more lines and no map, Claude asks you once, on a
  question card, whether to build one. A background helper builds it only on yes. The question never comes back
  for that project.
- A map whose files are mostly gone or changed gets a background refresh, at most once a week, without a question.
- `/systems-map` builds or refreshes the map by hand.

## Looking things up

The `systems-map` skill uses `map.mjs`:

| Command | What it gives |
|---|---|
| `map.mjs --scan` | Starts a build. |
| `map.mjs --near <word>` | The part that matches, with its links and up to 3 short decision lines. With a how-to entry for research, `--near research` points a session at the research skill and the step after it. |
| `map.mjs --check` | Listed paths that no longer exist, links whose code changed, and match words that are one common word (such as "release"), which the map ignores. |

In Nimbalyst, the [systems map extension](nimbalyst.md#systems-map) draws the map as a graph you can pan, zoom and
search.

## How the map stays right

Three hooks keep the map in step with the code:

- `map-nudge` asks once whether to build a map in a large project without one, and starts the weekly refresh.
- `map-drift` notices an edit that removes the token a link rests on, and tells Claude to check that link before
  it is done.
- `map-generated` refuses a hand edit of a file a script writes (listed under `generated` in the map) and names the
  script to change and run again, so each fact has one home and the next run can't undo the edit.

A fourth hook, `map-brief`, is experimental and does nothing in a normal install. It would add the map's lines for
the parts a helper's brief names to that brief; see the [hooks reference](../reference/hooks.md).

Each hook's off switch is in the [hooks reference](../reference/hooks.md).
