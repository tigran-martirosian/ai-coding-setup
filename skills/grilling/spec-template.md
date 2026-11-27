# <Job> spec (<date>)

Goal: one sentence, from the user's side.

Your words: the user's exact answers that set numbers, orders, names or limits, quoted. A time limit the user names is a
scope limit and goes here too. A limit the user states later in the job is added here, dated, the moment it is said.

Decided: choices settled in the questions, each with the file or source that settled a fact, so no one re-opens
them.

Built on: what the job uses instead of building, searched in this order: the project's own code, its packages, then a
maintained package, template or repo; each with its path or link. A package new to the project is checked before
install: its name exists on the registry and is the real one, not a lookalike (its source repo, owner and downloads
match). Or "nothing fits", with what was searched.

Step back: the flow end to end, one line a stage, from what starts it to shipped work the user hears about, each
with what moves work across it; the bottleneck and its scarce resource; how others run the same flow, with links.

Done when:
- D1: <what can be seen or measured> | check: <command, test name, or "look: screenshot of X"> | expected from:
  <the user, this spec, real data or a document; never the code under test>
- D2: ...

Must not change: <behaviour or files, each with how it is checked>.

Assumptions: what was assumed without the user saying it; the user can strike one.

Out of scope: ...

Words: the terms used here and what each means.

Test seams: where the checks attach; as few as possible, at the highest level.

## How the checks work

- A check counts once it has been seen failing: run it before the change, keep the failing output.
- The checks are written and committed before any build step; whoever builds may not change a check's expected
  value. A change to a check is reported and re-run from this spec's version.
- Each new test proves a done-when line or a fixed bug. No tests for their own sake.
- Something a person uses is checked in the real thing (the page, the app, the command), not a mock of it.
