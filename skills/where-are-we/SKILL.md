---
name: where-are-we
description: How much is left of a release, read from this project's Nimbalyst tracker, and the tracker brought up to date - plan rows copied in as steps, steps a commit proves finished closed, stranded and not-ready steps and what waits for the user listed. Use when the user asks how much is left, where are we, to groom the tracker, or runs /where-are-we; and from lead after the user OKs a plan (to copy its rows in) and at the end of a release.
---

# Where are we

The tracker is the record of a release: one `release` item, one `task` item per plan row (a **step**), linked to the release by `collection`. This skill reads it, writes only what a fact proves, and answers with the reading: how many steps are left, what runs, what waits for the user.

It runs when the user asks or `lead` calls it; nothing starts it on its own. Load the tracker tools first (ToolSearch `tracker_`). Trackers belong to one project, so this covers the open project only. Every `tracker_list` of steps passes `includeClosed: true`: by default it returns open items only, and a done step left out would be copied in again and drop out of the count.

**Words.** Statuses go to the user in plain words: to-do "To do", in-progress "Running", in-review "Checking", waits-for-you "Needs you", done "Done", wont-do and duplicate "Dropped". A step's added fields: `step` (its short name from the plan), `stage`, `waitsOn`, `proof` (commit and session), `budget` (tool calls). When `tracker_list_types` shows the task type without these fields or the waits-for-you status, the project lacks the task-type patch: give the reading from what exists, write nothing, and say `/update-project` adds the patch.

**What it writes, and what it leaves to the user.** A status moves only on a fact (a commit on the plan's branch, a check that passed). A step whose result the user must see (a design, a screen, a text he reads, a look) goes to in-review at most: the user closes it, never this skill. It never deletes or archives an item, and never restarts or redoes a step, without the user's yes. Everything else it lists.

## Steps

1. **Find the release.** `tracker_list` with type `release`, the open ones (planned, in-progress). One open: take it. More than one: the one the user named, else the newest. None: offer, on one card, to make one from the newest plan file the user OK'd (a plan with job-list rows in `docs/`); make nothing without his yes. The release's description names its plan files (one release can have several, e.g. a design plan and a build plan); when it names none, ask for them once and write the answer into the description.
   Done when one release is chosen, or the user said no to a new one (then stop with that line).

2. **Copy new plan rows in.** For each row of each plan's job list with no step yet (when two plans use the same row name, the `step` carries the plan's short name, as `build T1`): match on `step` first, then `tracker_list` with `search` on the row's title as the duplicate check. Create the missing ones as `task` items: `collection` the release, `step`, `stage`, `budget`, status to-do; the body holds the row's Serves quote and its Done when; `dependsOn` follows the plan's order. A row only the user can do (an OK, a look, a restart time) is a step too, owned by the user, status waits-for-you, `waitsOn` the step it waits for. A row whose Serves, Done when or budget changed in the plan gets its body and budget updated; its status, proof and comments stay.
   Done when every plan row has exactly one step.

3. **Since last time.** Read the last grooming time from the release's newest comment starting `where-are-we: groomed` (no such comment: since the release was created). From each step's activity (`tracker_list` with `full: true`): what got done, started or parked (moved to waits-for-you) since then.

4. **Settle what facts prove.** A step in in-progress whose `proof` commit is on the branch the plan names (`git merge-base --is-ancestor <commit> <branch>`) and whose row's State cell reads `done <hash>` (written only after the row's Done when check passed): move it to done, or to in-review when its result is something the user must see. A commit alone proves nothing: without the `done` mark the step stays in progress. Add one comment with the commit. A step whose linked session finished without a commit: leave it as it is, list it.
   Done when every in-progress step is either moved on a fact or left with its reason.

5. **Stranded steps.** A step in progress for over a day (its last status change in activity) with no live session (its session from `proof` or the item's linked sessions, checked with the session tools): list it with its age and its last comment. Restart or redo none of them: the user decides.

6. **Ready gate.** A to-do step with no Done when in its body, or with an open question in its comments: list it as "not ready" with what it lacks. A not-ready step is not claimed until that is fixed.

7. **What waits for the user.** Every waits-for-you step that can be done now, and every user step whose `waitsOn` step is done: one line each, the question in the user's words. A user step still waiting on other steps is named once as "later: after <step>".

8. **The reading.** Count the release's steps: dropped ones leave the total; left = total minus done; running = in-progress and in-review; waits for you = step 7's lines; calls left = the sum of `budget` over the steps not done ("up to"). Answer in one line first, as in "11 steps left of 27, 4 running, nothing waits for you, up to 210 calls left", then the lists of steps 3, 5, 6 and 7, each left out when empty, and step 4's moves. Then add the comment `where-are-we: groomed <date and time>` to the release.

9. **End of a release.** When the release's git tag exists (`git tag --list`) and every step is done or dropped: set the release to released with `gitTag` and `releasedAt`. When the tag exists but steps are still open: ask on one card which of them the user keeps; the kept ones move to the next release (`collection` the next release), the others become wont-do on that same answer, then the release is set to released.
