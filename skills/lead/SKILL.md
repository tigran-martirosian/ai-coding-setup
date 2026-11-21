---
name: lead
description: Run a big job from its spec to the retro - the plan written here, one plan review, the user's one OK, workers per slice, checks, merge, end review. Use when `grilling` has written a spec file for a big job, when the user says "lead this", "orchestrate", "веди эту работу", "раздай по агентам" (or the same in any language), or runs /lead. Not for small or medium jobs.
---

# Lead

A big job runs in this session, which plans it, leads it and writes no product code itself unless the whole job is
one coupled unit. Input: the spec file (`docs/<date>-<job>-spec.md`, written by `grilling`). No spec yet: run
`grilling` first. The plan file's format, briefs, worktrees, the blind look and review findings:
[reference.md](reference.md). A big job does not run under `/goal`: section 4's end check is its stop, and `/goal`
skips its check while a helper still runs.

## 1. Plan

1. **Write the plan yourself,** in this session, from the spec file and the project folder (reference.md "The plan
   file"). No DECISIONS read, no purpose quotes. Save it as `docs/<date>-<job>-plan.md` beside the spec.
   - **Split only at a clean interface or for real parallel work.** One session per coherent unit; a feature stays
     with its tests; steps that run one after another on the same files are one slice. Every extra slice is a fresh
     worker that rereads the code. A slice must still fit one worker's turn limit: a sweep across the whole repo is
     split by folder.
   - **Size is a count of slices and worker sessions.** No time estimates, no summed call ceilings. A time limit the
     user names is a scope limit in the spec's "Your words", not a size.
2. Launch the `plan-reviewer` once with the user's ask in their own words, the spec and the plan. Fix what it finds
   in one round; it does not run again.
3. **The one OK.** Show the user in chat: clickable links to the spec and plan files, the five-line "what I took
   from your answers", the spec in about 10 lines, the plan in a few (slices, helpers, models, sessions), and
   each plan-reviewer finding you did not take, with why. A question card, if you use one, comes after that text in the same reply, never alone:
   the user cannot open the folder from a card. Wait for go or changed lines. This is the only stop before the build, unless the spec names a sample for the user to look at.
4. Copy the slices to the Nimbalyst tracker with `where-are-we`, for the board. The plan file stays the record.
   A slice's step is named `<job step> S<N>` (as `P2-8 S3`), so each step is unique.

## 2. Run the slices

- **Slice 0** (new project): `/new-project`, the job branch, the project's `verify` skill with the run and test
  commands, one passing test. Then the probe, then the check slice (the spec's checks written and committed, each
  seen failing). Its commit is the spec's version of every check.
- **Ready slices** (blockers done) start side by side, each in its own worktree; slices the plan marks as coupled
  run in one session. Helper and model come from the slice row; a call that picks a model other than the agent
  file's sets `effort` too, since a helper on another model does not inherit it.
- **When a slice comes back:** read the hand-back; re-run its checks yourself in its worktree; read the diff
  (summaries leave out small changes); if a check file changed, re-run that check from the spec's version. Slice
  marked risky: `/code-review` on its diff; check each finding before acting on it.
- **Merge** one worktree at a time into the job branch, run the changed tests after each merge, one commit per
  slice, then remove the worktree and its branch (reference.md). A conflict goes to `worker-code` with both slices'
  briefs.
- **Step line:** a commit that starts or finishes a slice carries one line `Step: <step> running` or
  `Step: <step> done` (`<step>` the tracker step's name); `done` only after the slice's check passed. Each brief
  that commits says which line its commit ends with.
- **Plan file:** after each slice fill its Progress row (state, commit, worker sessions used, surprises), redraw
  the thin later slices from what it found, and run `where-are-we` so the tracker matches. Each cut or dropped
  slice names the done-when line it touches; it gets no second plan review.
- **A note the user types** that concerns a running worker: pass it on with SendMessage and say so in one line.
- **A limit the user states mid-job** goes into the spec's "Your words", dated, at once, and into every brief from
  then on.

## 3. Stop and tell the user

- A slice shows the spec is wrong: stop that branch of the work, build nothing on it, tell the user what and why.
- A change to a done-when line, must-not-change or scope; dropping the only slice that proves a line counts as one.
- Three fix rounds on one failing check without it passing.
- Stop signs in a worker's result: a loop, work nobody asked for, a test switched off, deleted or its expected
  value changed, a slice called done without its check output.

## 4. End

1. Full suite once; CI when there is a push. Every done-when line run as its check says (the real client wherever a
   person uses the thing).
2. The `reviewer` gets the spec, the full diff from the job's base commit, and the end-check outputs; never the chat.
   It reviews once, for correctness against the spec. A fix after its findings is checked by re-running the checks
   it touches and reading the fix's diff, not by the reviewer again.
3. The `blind-reviewer` gets screenshots of every state, or the text a person reads, when the result is something a
   person sees (reference.md).
4. Fixes, three rounds at most.
5. **Sweep the worktrees** in every repository the job made worktrees in, after the last merge. Slice branches are
   `<job>/s<N>` (reference.md "Worktrees"), so `<job>/` is the prefix; pass the job branch as `<base-branch>`:
   `node ~/.claude/skills/lead/scripts/leftover-worktrees.mjs <repo> <base-branch> --remove --prefix <job>/`.
   It removes this job's merged, clean worktrees with their branches and prints one line for every worktree, with
   its state, branch and last commit; a line ending in `removed` is gone. A non-zero exit prints git's reason; it
   goes into the report.
6. Report to the user: each done-when line, pass or fail, with its proof (command output or screenshot), what was
   not checked, and every worktree the sweep left (each line without `removed`, except `base`): `dirty`,
   `unmerged`, `locked`, `(detached)` and `missing` ones, each with its branch and last commit line, for the user
   to look at.
7. **The user tries it.** What they find comes back as fix slices, each with a check that fails on it, through the
   same run. The sweep runs again after the last fix slice merges.

## 5. Retro

A few minutes, after the user's try. Each finding from the reviews, the try and the plan file's surprises becomes
one of: a test, a line in the project's `verify` skill, a fix to a pipeline text (this skill, `grilling`, an agent),
or nothing. Most become nothing or a test; none becomes a new global rule. Also note how many worker sessions were
wasted (redone, thrown away), slice by slice: that judges the plan. Name each of the plan review, `/code-review` on
risky slices and the blind look that caught nothing in this job.

After the retro the job's spec and plan files are deleted once no live file (HANDOFF, CLAUDE.md, an open plan) links
them: one current plan per job, and git keeps the old ones.

Push, release or deploy only when the user says so.
