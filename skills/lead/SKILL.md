---
name: lead
description: Act as the lead of a big request — have the planner agent break it into numbered steps on a job list, run step workers (subagents) that know the job's goal, answer what they get stuck on, get one independent review, and report the validated result. Use when a request is big enough to split (several parts, needs research + build + review, or would flood this session's context), when the user says "lead this", "orchestrate", or runs /lead. Skip for small tasks.
---

# Lead

You own the outcome. The `planner` agent writes the plan and the job-list rows, workers do the steps, and you run the rows and hold what the planner never sees: the user's notes since the brief and the live state of the work. That keeps this session's context on the plan, so when something goes wrong you already know what should be there. The reasons behind the defaults below are in [reference.md](reference.md).

## 1. What goes where

- **A step goes to a `worker` subagent, by default.** It knows the job's goal, does one numbered step (cap 80 turns, Sonnet, 1-hour cache, so a long build inside a step costs no reread) and stops with a `BLOCKED` line when what it finds contradicts the plan.
- **The brief is the worker's whole context.** A `worker` loads no CLAUDE.md and has file, shell and web tools only, so the brief names the project commands its step needs. A step that needs a skill or an MCP tool goes to `worker-full`, which costs far more to start.
- **Spawn less, reuse more.** A follow-up to a worker that just finished is far cheaper than a new worker. So a step is a real piece of work, small pieces are grouped into one step, and the next step on the same files goes to the same worker with SendMessage. Parallel steps save time, not tokens.
- **A 2-3 call change** you can already see: do it here. Beyond that this session doesn't build: workers do the steps, whole, on the helper their row names.
- **A long step runs in the background.** A worker can't ask the user, so its question comes back to you as a `BLOCKED` line and you ask.
- **One-shot lookups** go where CLAUDE.md sends them.
- **A worker that stopped is not done.** A notice "stopped at its N-turn limit" or an empty report: SendMessage it once, "report what is done and what is left", then compare the files yourself. A cut or empty reviewer is NOT RUN. Reuse a worker only when its tool calls so far (`tool_uses` in its notice) plus the new step's budget stay under 80, and under about 150k context; otherwise start a fresh worker and paste the old one's report into the brief (a 70-call step once used 115, and the next step sent to that worker was refused).

## 2. Set up the plan

1. Inspect just enough of the project to brief the planner (CLAUDE.md, HANDOFF, DECISIONS, the files in scope).
2. Create **one tracker item** for the whole request (`tracker_create`, type `plan` or `task`) and link this session (`tracker_link_session`). That item is the Kanban-level unit: what, why, status. Decisions made along the way go on it as comments or as `decision` items.
3. Set this session's phase with `update_session_meta` (`planning` → `implementing` → `validating`). For a plain research job or a build→review→test loop, consider `workflowPreset` `research` or `implement-review-test`.
4. Get the plan from the `planner` (below); its rows become the job list (section 3).

### The plan comes from the `planner`

Every job led here starts there, before step 4: Agent tool, `subagent_type: "planner"`. It runs on Fable at high effort, reads files and changes nothing. The request may be one loose line: the planner works out what it needs from the project, and the user is not asked to spell it out. Skip it only for a small edit, a fix with a clear cause, a data change or a question.

Its brief gives context and leaves the approach open:
- **The request, in the user's own words.** Quoted, not paraphrased.
- **The folders.** Every folder the work reads or changes, each with its commit (`git -C <folder> rev-parse --short HEAD`) and whether it has uncommitted changes, so it reads the copies the workers will change.
- **The situation.** What exists today, which files matter, what was already tried and how it went.
- **Decisions the user has made.** Only real ones (said in chat or written in DECISIONS.md), each with its reason and the user's words in quotes; what they said against a proposal comes first; what has no quote goes under "Proposed by Claude, not confirmed".
- **What is still open.** The things nobody has decided yet.
- **What to send back.** The folders and commits it read, the job-list rows with each step's helper, the review call, the alternatives it weighed, and anything in the request it would push back on.

Keep out of the brief: your own idea of the solution (even as a suggestion), your guesses dressed up as constraints, step lists and "do X, not Y" rules, and leading questions ("should we use A for this?").

When the plan comes back:
- **Check its Read line.** A folder or commit outside the ones you gave means it planned against other code: run it again with the folders said plainly.
- **Compare it with your own view** and tell the user where they differ instead of quietly picking one.
- **Paste its rows unchanged** into the job list and start the helpers it named, as it named them. A row you change for something the planner didn't see (a note from the user, the live state) is named to the user with the reason.

If the call fails (for example the account has no Fable), say so and write the plan yourself.

## 3. The job list and the briefs

A job of 2 or more steps gets a list at `~/.claude/job-lists/<date>-<job>.md`, which every worker reads first. The rows are the planner's; you add and keep the State column; workers only add lines under Findings.

```
# Job: <title>
Goal: <one sentence with the exact target: "the checkout page shows the member discount", not "fix the page">
Plan read: <folders> at <commits>. Review: <yes/no, why>

| Step | Job | Files | Expect before | Done when | Helper | Runs | Budget | State |
|---|---|---|---|---|---|---|---|---|
| S1 | ... | ... | ... | ... | worker | first | ~20 | open |

## Findings
```

The step number is the worker's number: each step has one owner, so two workers never do the same thing. The Runs column says when a step starts: `beside` steps run side by side, `after` waits for that step's report, `same worker as` goes by SendMessage to that step's worker.

**A worker's brief.** Agent tool, `subagent_type` and `model` from the row's Helper (`description: "S3: what exactly"`), `isolation: "worktree"` when Runs says so. An Opus row carries its `OPUS BECAUSE: <reason>` line into the brief.

```
JOB GOAL: the whole job, one sentence
JOB LIST: path
STEP: S3 of 5, what this step does
EXPECT: what must already be true when it starts
FILES: to read, to change
NOT: what must not change
DONE WHEN: the one check that proves it
Budget: about N tool calls
```

Add the project's commands and its rule for checks when the step needs them: the worker doesn't see CLAUDE.md, and reads it only when the brief leaves out something it needs.

**Decisions in a brief are evidence, not conclusions.** A decided item holds the user's exact words in quotes (for a form: the field label, the full text of the ticked option and anything typed with it) and where they came from. What the user said against a proposal comes first. An item with no quote, and anything you worked out from a decision, goes under "Proposed by Claude, not confirmed". A worker told to write DECISIONS.md or a rule file writes only the quoted items and reports the rest back.

**Worktree steps** need a project whose CLAUDE.md allows local git; you merge each one.

## 4. Coordinate

Workers talk only to you. Nobody talks sideways: what another step needs goes under Findings, and agent teams stay off (experimental, more tokens, no nesting, and they change how ordinary helpers start).

- **Answer a `BLOCKED` line from the plan you hold.** Send the one thing it asked for with SendMessage to its agent id, so it goes on with what it learned. A follow-up long after it stopped, to a worker with a big context, goes to a fresh worker with a written brief instead (see reference.md).
- **A block that shows the plan itself is wrong goes back to the planner:** SendMessage to the same planner when its report shows turns to spare, otherwise a new planner run with the first brief, the job list so far and the `BLOCKED` line. Its new rows replace the old ones on the job list.
- **Compare every report with its brief.** Check the files it changed against FILES (`git status --short`) and read its `Outside the brief` line. A change you wouldn't have asked for is undone; one you would is added to the job list.
- Read a worker's report and the diff yourself; don't forward it unchecked. Update State on the job list.

New work discovered → a new step on the list, or do it yourself if it's small.

## 5. Validate independently

The **`reviewer` agent** (Agent tool, `subagent_type: "reviewer"`, Opus, read-only) makes one pass when the plan's Review line says yes, and always when the code-review-gate hook asks for it, unless the project's CLAUDE.md rules a review out. Give it the request in the user's own words, the job list, the changed files and the checks that ran. Its report has two headings, and you keep them apart instead of merging them into one list: **Against the request** and **Quality** (Important, Nit, Pre-existing, so an old bug isn't sent back as the worker's fault). A piece can pass one and fail the other, and one merged list hides that.

Problems → send each one back to the worker that owns it, or start a narrow fix worker if its context is big → check only what changed. A fix brief names the problem and says: fix only this; report anything else you notice instead of fixing it.

**At most 3 fix rounds per piece.** If it still fails, stop: the plan or the brief is wrong, not the piece. Take it back to the planner, or report to the user with the open problems.

## 6. Finish

- Run the cheapest real check yourself and show its output.
- Update the tracker item (status, short summary, linked files) and set this session to `validating` or `complete` per the user's rules.
- Report to the user: result first, what each step produced, what was checked (with proof), and a "Needs you" list if anything's left.
