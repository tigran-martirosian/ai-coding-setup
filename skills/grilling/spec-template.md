# <Job> spec (<date>)

Goal: one sentence, from the user's side.

Your words: the user's exact answers that set numbers, orders, names or limits, quoted. A time limit the user names is a
scope limit and goes here too. A limit the user states later in the job is added here, dated, the moment it is said.

Decided: choices settled in the questions, each with the file or source that settled a fact, so no one re-opens
them.

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
