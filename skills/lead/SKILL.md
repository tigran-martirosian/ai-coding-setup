---
name: lead
description: Act as the lead of a big request — have the planner agent break it into numbered steps, get one plan review and its fixes, show the user the plan, run step workers (subagents) that know the job's goal, answer what they get stuck on, get one build review, and report the validated result. Use when a request is big enough to split (several parts, needs research + build + review, or would flood this session's context), when the user says "lead this", "orchestrate", or runs /lead. Skip for small tasks.
---

# Lead

You own the outcome. The `planner` agent writes the plan and the job-list rows, workers do the steps, and you run the rows and hold what the planner never sees: the user's notes since the brief and the live state of the work. That keeps this session's context on the plan, so when something goes wrong you already know what should be there. The reasons behind the defaults below are in [reference.md](reference.md).

**The stages of a big job:** request understood and talked through → research (only when facts are missing) → plan → one plan review → plan fixes → the user reviews the plan → build → one build review → build fixes → the user reviews the build → release and tests. The user sees the work at the research file (when there is one), the plan, design files that need an OK, `BLOCKED` lines the plan cannot answer, and the build. The build review is one `reviewer` with named focus areas; two reviewers side by side, one per focus, is being measured against it and is not used until the user picks it.

## 1. What goes where

- **A step goes to a `worker` subagent, by default.** It knows the job's goal, does one numbered step (cap 80 turns, Opus at medium, or Fable at medium when the row says `model: fable`; a code row goes to `worker-code`, Opus at high; 1-hour cache, so a long build inside a step costs no reread) and stops with a `BLOCKED` line when what it finds contradicts the plan.
- **The brief is the worker's whole context.** A `worker` loads no CLAUDE.md and has file, shell and web tools only, so the brief names the project commands its step needs. A step that needs a skill or an MCP tool goes to `worker-full`, which costs far more to start. A code row goes to `worker-code`, the same start on Opus at high; a long refactor row goes to `worker-high`, the same start on Fable at high.
- **Spawn less, reuse more.** A follow-up to a worker that just finished is far cheaper than a new worker. So a step is a real piece of work, small pieces are grouped into one step, and the next step on the same files goes to the same worker with SendMessage. Parallel steps save time, not tokens.
- **A 2-3 call change** you can already see: do it here. Beyond that this session doesn't build: workers do the steps, whole, on the helper their row names.
- **A step runs in the foreground**: one request, and its report comes back in it. Pass `run_in_background: false` on the Agent call: a launch without it counts as background and is refused. Steps that run side by side go as several Agent calls in one message, each with `run_in_background: false`: they run in parallel and the turn waits for all of them (a background helper dies when the turn ends and the app stops the idle session). A worker can't ask the user, so its question comes back to you as a `BLOCKED` line and you ask.
- **One-shot lookups** go where CLAUDE.md sends them.
- **A worker that stopped is not done:** read reference.md section "A stopped worker" on a turn-limit notice, an empty report, or before reusing a worker.

## 2. Set up the plan

1. **Understand the request and talk it through.** Restate it; ask only what only the user knows. When the facts to plan from are missing (how the code works, run data, how others do it), the next step is a research `worker` that writes them to `docs/research/YYYY-MM-DD-topic.md`: show the user its link and short answer before planning, instead of a guessed pick.
2. Inspect just enough of the project to brief the planner (CLAUDE.md, HANDOFF, DECISIONS, the files in scope).
3. Create **one tracker item** for the whole request (`tracker_create`, type `plan` or `task`) and link this session (`tracker_link_session`). That item is the Kanban-level unit: what, why, status. Decisions made along the way go on it as comments or as `decision` items.
4. Set this session's phase with `update_session_meta` (`planning` → `implementing` → `validating`). For a plain research job or a build→review→test loop, consider `workflowPreset` `research` or `implement-review-test`.
5. Get the plan from the `planner` (below), have it reviewed and fixed, and show it to the user; its rows become the job list (section 3).

**How much of this a job gets.** A question, a small edit, a fix with a clear cause or a data change: none of it, do it here. A plan that comes back as one step, touching no hook, rule, agent, skill, settings or CI file and with nothing costly to undo: no plan review, and a build review only when the gate asks. A job is **big**, and gets every stage, when its plan has 2 or more helper steps, a change to a hook, rule, agent, skill, settings or CI file, a design step for something a person looks at or uses, or a step its Needs-OK list calls costly to undo. Decide from the plan, not the request.

### The plan comes from the `planner`

Every job led here starts there: Agent tool, `subagent_type: "planner"`. It runs on Fable at high effort, reads files and changes nothing. The request may be one loose line: the planner works out what it needs from the project, and the user is not asked to spell it out. Skip it only for a small edit, a fix with a clear cause, a data change or a question.

Its brief: read reference.md section "The planner's brief" when writing it (what goes in, what stays out).

When the plan comes back:
- **Check its Read line.** A folder or commit outside the ones you gave means it planned against other code: run it again with the folders said plainly.
- **Compare it with your own view** and tell the user where they differ instead of quietly picking one.
- **Save it** to the plan file (section 3) with the rows unchanged, before the review.

### One plan review, then one fix round

A big job's plan gets one pass from the **`plan-reviewer`** (Agent tool, `subagent_type: "plan-reviewer"`, read-only): give it the request in the user's own words, the decisions with their quotes and the path of `DECISIONS.md` (as in the planner's brief), the plan file and the folders with their commits. Write its report into the plan file's **Review** section the moment it arrives, each Important as `open`.

1. Send the report to the **same planner** by SendMessage. It rewrites the affected rows in place and answers each finding with one line: `fixed: <row change>` or `kept: <why>`.
2. Check that every Important has one of the two and that each row change it names is in the rows; write the lines into the Review section. No second plan review.
3. A `kept` you disagree with goes to the user as a Needs-OK item with both sides.

The plan stage is one piece: plan, review, fix round and the user's answer stay in one session where they can. When it must hand over before the fix round ends, see section 4.

### Show the user the plan

- **Paste its rows unchanged** into the job list and, after the user's answer below, start the helpers it named, as it named them. A row you change for something the planner didn't see (a note from the user, the live state) is named to the user with the reason.
- **Show the user the plan before any helper starts, and wait** (user, 2026-11-07: "I want to see what planner came up with ... so the user understands what's going on and he can cut the processes"). Save the plan file first, then:
  1. The planner's **For the user** part as it wrote it: how many helpers, on which model and effort, and one line each on what it designs or builds and what it hands on.
  2. **Plan review:** "N Important: X fixed, Y kept", each kept one in a line with why, and "Checks run: K, F failing" when a check failed. The full review stays in the file.
  3. The planner's **Needs the user's OK** list, with any `kept` you disagree with.
  4. A link to the plan file, where each row is the instruction that helper gets.
  5. One `PromptForUserInput` with a `multiSelect` field `steps` (one item per row: title `S<n>: <job>`, subtitle `<helper, model> | decides: <Decides cell>`, `defaultChecked: true`) and an `editText` field `changes` ("Anything to split, merge or change?", may be empty).
  An unticked step is cut. Its later rows are named in the reply when they relied on it. Text in `changes` goes back to the planner (SendMessage while it has turns, else a new run with the first brief and the note), and the new plan is shown the same way. The helpers start only on the answer.
- **Every column stays wherever the plan is saved**: a later session briefs a step from the whole row (Decides, Done when, Budget), never from a one-line summary of it.
- **A step doesn't grow in its brief.** New work for a step (research, a second design question, an estimate) is a new row or goes back to the planner; it is never added to the brief of a row that didn't have it.

If the call fails (for example the agent is missing), say so and write the plan yourself.

## 3. The job list and the briefs

The job list is the plan file, one per job, in the project: `docs/<date>-<job>-plan.md`. It holds the Brief, the whole plan, the rows with your State column, the Review section, the `Changed <date>` lines of re-plans and the Findings; the JOB LIST line of every brief points to it, and every worker reads it first. Only a job with no project folder uses `~/.claude/job-lists/<date>-<job>.md`. The rows are the planner's; you add and keep the State column; workers only add lines under Findings.

```
# Job: <title>
Goal: <one sentence with the exact target: "the checkout page shows the member discount", not "fix the page">
Plan read: <folders> at <commits>. Review: <plan yes/no, build yes/no, why>. Stage: <planned | reviewed | fixed | user OK>

## Brief
## Plan
| Step | Job | Decides | Files | Expect before | Done when | Helper | Runs | Budget | State |
|---|---|---|---|---|---|---|---|---|---|
| S1 | ... | ... | ... | ... | ... | worker | first | ~20 | open |

## Review
## Findings
```

The step number is the worker's number: each step has one owner, so two workers never do the same thing. The Runs column says when a step starts: `beside` steps start together, as foreground Agent calls in one message, `after` waits for that step's report, `after S<n>, user OK` also waits for the user's OK on that step's design, `same worker as` goes by SendMessage to that step's worker.

**A worker's brief:** read reference.md section "A worker's brief" when starting a row, and its parts "Decisions in a brief" and "What no helper sees" before any helper's brief (planner and reviewers too): the Agent call, the brief template, decisions in a brief, what no helper sees, worktree steps (a row in another repository gets one you make with `git -C <repo> worktree add`, no `isolation`; parallel work in this session's folder may use `isolation: "worktree"`; removed with `git branch -D` after the stage commit and the full suites pass).

## 4. Coordinate

Workers talk only to you. Nobody talks sideways: what another step needs goes under Findings, and agent teams stay off (experimental, more tokens, no nesting, and they change how ordinary helpers start).

- **Answer a `BLOCKED` line from the plan you hold.** Send the one thing it asked for with SendMessage to its agent id, so it goes on with what it learned. A follow-up long after it stopped, to a worker with a big context, goes to a fresh worker with a written brief instead (see reference.md).
- **Write every `BLOCKED` line under Findings** with `plan cause: yes/no` and, for yes, which plan-review checklist item would have caught it.
- **A size-line stop (`[worker-size]`) or a block that shows the plan is wrong:** read reference.md section "Re-plans and size-line stops".
- **Compare every report with its brief.** Check the files it changed against FILES (`git status --short`) and read its `Outside the brief` line. A change you wouldn't have asked for is undone; one you would is added to the job list.
- Read a worker's report and the diff yourself; don't forward it unchecked. Update State on the job list with the calls it used (`tool_uses`) next to its budget, so later plans can size from real numbers.
- **One piece per session** (user, 2026-11-08). Once a step is committed and steps are left, bring State up to date and hand the rest of the job to a fresh session (handoff skill; it opens that session with its prompt queued, so a build without check-ins keeps running); that session reads the plan file and runs the next row. The handoff names the plan file and its Stage. A handover before the plan's fix round ends starts a **new planner** with the Brief, the plan file and its `open` findings, told to fix only those; you check them as in section 2, with no second plan review. Compaction is only the safety net inside a step.
- **A design step for something the user looks at or uses** (a build, a page, a screen) ends with the user's OK: show the design file's link and a picture or a short summary of it, and the build steps after it wait for the answer (user, 2026-11-07). A change they ask for goes back to the same worker.

New work discovered → a new step on the list, or do it yourself if it's small.

## 5. Validate independently

**One review per stage of a piece** (plan, build; a screen review is its own kind), whatever a skill says. The plan's is in section 2. The build's is one pass of the **`reviewer` agent** (Agent tool, `subagent_type: "reviewer"`, Fable, read-only) when the plan's Review line says yes, and always when the code-review-gate hook asks for it, unless the project's CLAUDE.md rules a review out. Give it the request in the user's own words, the DECISIONS lines the change touches, quoted, with the path of `DECISIONS.md`, the plan file, the changed files and the checks that ran, and name its two focus areas: **against the request and the plan** (each row's Done when met, with the command and its output; what is missing or nobody asked for; the decisions) and **quality** (each changed file read whole, and its callers; tests; failure paths; unneeded code; every copy and record that must follow). Each Important finding is re-checked before it is reported. Its report keeps those two headings, and you keep them apart instead of merging them into one list: **Against the request** and **Quality** (Important, Nit, Pre-existing, so an old bug isn't sent back as the worker's fault). A piece can pass one and fail the other, and one merged list hides that.

A release over pieces already reviewed: read reference.md section "Release review".

Problems → write them into the plan file's Review section, then send each one back to the worker that owns it, or start a narrow fix worker if its context is big; a long refactor step that failed its check on `worker-code` goes to a fresh `worker-high` instead of back to its owner → check only what changed, yourself. **Fixes get no second reviewer.** A fix brief names the problem and says: fix only this; report anything else you notice instead of fixing it.

**At most 3 fix rounds per piece.** If it still fails, stop: the plan or the brief is wrong, not the piece. Take it back to the planner, or report to the user with the open problems.

## 6. Finish

- Run the cheapest real check yourself and show its output. A failed full test run is followed by a rerun of only the failed tests (`node tests/run-all.mjs --failed` in a setup repo), not a second full run.
- Update the tracker item (status, short summary, linked files) and set this session to `validating` or `complete` per the user's rules.
- Report to the user: result first, what each step produced, what was checked (with proof), each review finding with its fix or answer, and a "Needs you" list if anything's left. Release and tests come after the user's answer, when the job has them.
