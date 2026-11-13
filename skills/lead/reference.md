# Lead: reference

Detail for `SKILL.md`, used at one step each; `SKILL.md` says when to read each section.

## The planner's brief

Its brief gives context and leaves the approach open; save it in the plan file's head as **Brief**, so a later planner can start from it:
- **The request, in the user's own words.** Quoted, not paraphrased.
- **The folders.** Every folder the work reads or changes, each with its commit (`git -C <folder> rev-parse --short HEAD`) and whether it has uncommitted changes, so it reads the copies the workers will change.
- **The situation.** What exists today, which files matter, what was already tried and how it went.
- **Decisions the user has made.** Only real ones (an explicit go, as the lead skill defines it), each with its reason and the user's words in quotes; what they said against a proposal comes first; what has no quote goes under "Proposed by Claude, not confirmed". Name the path of `DECISIONS.md` and quote the lines the job touches (its top section plus a grep for the topic).
- **What is still open.** The things nobody has decided yet.
- **What to send back.** The folders and commits it read, the job-list rows with each step's helper, the review call, the alternatives it weighed, and anything in the request it would push back on.

Keep out of the brief: your own idea of the solution (even as a suggestion), your guesses dressed up as constraints, step lists and "do X, not Y" rules, and leading questions ("should we use A for this?").

## A worker's brief

**A worker's brief.** Agent tool, `subagent_type` and `model` from the row's Helper (`description: "S3: what exactly"`), `isolation: "worktree"` when Runs says so. A `worker`, model `fable` row passes `model: "fable"`; a `worker-code` or `worker-high` row passes that `subagent_type` and no model; a Sonnet row carries its `SONNET BECAUSE: <reason>` line into the brief.

```
JOB GOAL: the whole job, one sentence
JOB LIST: the plan file's path
STEP: S3 of 5, what this step does
DECIDES: the row's Decides cell (a build step: "nothing, follow <design file>")
EXPECT: what must already be true when it starts
FILES: to read, to change
NOT: what must not change
DONE WHEN: the one check that proves it
Budget: about N tool calls
```

Add the project's commands and its rule for checks when the step needs them: the worker doesn't see CLAUDE.md, and reads it only when the brief leaves out something it needs.

**Decisions in a brief are evidence, not conclusions.** Only an explicit go is a decision: a tick, "yes", "do it", "decided", or a plain choice between offered options. "I think", "what if", "let's redesign" is talk: it goes under "Talked about, not decided" in a brief, and into the topic's design note (`docs/<date>-<topic>-design.md`) or else HANDOFF.md under the topic, marked "talk, not decided"; when unsure, ask one line. A decided item holds the user's words in quotes, cleaned: only the words that carry the decision, misheard words fixed, fillers cut with "…", meaning unchanged; a form's field label and the full text of its ticked option (and anything typed with it) stay word for word. Each item says where it came from. What the user said against a proposal comes first. An item with no quote, and anything you worked out from a decision, goes under "Proposed by Claude, not confirmed". A worker told to write DECISIONS.md or a rule file writes only the quoted items and reports the rest back.

**What no helper sees.** No helper loads auto-memory, so a memory note that bears on the step is pasted into its brief. The project's systems map reaches every brief by itself as `SYSTEMS MAP:` lines; a planner, plan-reviewer or reviewer brief also names the map, for what the change reaches: `node ~/.claude/skills/systems-map/map.mjs --near <thing> --project <folder>`.

**Worktree steps** need a project whose CLAUDE.md allows local git; you merge each one, then remove it: `git worktree remove <path>` and `git branch -d <branch>`, both without `--force`. When git refuses, the worktree holds uncommitted files or commits not merged: name them to the user and leave it. A worktree left behind costs up to a gigabyte, and Claude Code only clears it after its chat-retention days.

## A stopped worker

- **A worker that stopped is not done.** A notice "stopped at its N-turn limit" or an empty report: SendMessage it once, "report what is done and what is left", then compare the files yourself. A cut or empty reviewer is NOT RUN. Reuse a worker only when its tool calls so far (`tool_uses` in its notice) plus the new step's budget stay under 80, and under about 150k context; otherwise start a fresh worker and paste the old one's report into the brief (a 70-call step once used 115, and the next step sent to that worker was refused).

## Re-plans and size-line stops

- **A helper stopped by the size line (`[worker-size]`, 180k) is followed by a fresh worker** whose brief carries its report, not by SendMessage: SendMessage would re-send its 180k.
- **A block that shows the plan itself is wrong goes back to the planner** with the plan file and the `BLOCKED` line: SendMessage to the same planner when its report shows turns to spare, otherwise a new planner run with the Brief and the plan file. It rewrites the saved rows in place, each changed row with `Changed <date>: <why>`, and the State column kept. A re-plan that changes only the blocked row and the rows that depend on it gets no plan review; one that adds or removes steps, or moves a file to another owner, goes to the `plan-reviewer`, told to check only the changed rows.

## Release review

A release that puts together pieces already reviewed gets one reviewer on what the pieces did not cover (merge points, version, changelog, docs), not a second pass over them.

## The reasons behind the defaults

Reference for `SKILL.md`, read when a default is questioned. Not steps. Sources for the planning and review defaults: the planning-review design and the memory-systems design (§3) of 2026-11-09, approved by the user on the 2026-11-09 form "Wave 1 designs: your review".

- **Worker start cost.** A `worker` starts small because it loads no CLAUDE.md; `worker-full` loads every tool and the CLAUDE.md files and costs much more. `worker-code` starts as small as a `worker` and runs Opus at high for code. `worker-high` starts as small as a `worker` but runs Fable at high, so each step costs far more.
- **Reuse.** A follow-up to a worker that just finished, while its cache is warm, costs a few hundred tokens against several thousand for a new worker.
- **Late follow-up.** Once the cache has expired, the whole context is paid for again, so a follow-up long after a worker stopped goes to a fresh worker with a written brief.
- **The stages.** They are the user's own order (DECISIONS 2026-11-09). The plan review is the new one: the rules had none, and the first single plan review found 6 Important faults. Research comes first when facts are missing, because a form built from guesses sends the user options with nothing behind them.
- **When a job is big.** The triggers (2 or more helper steps; a hook, rule, agent, skill, settings or CI change) are the code-review-gate's own, so the plan review and the build review fire on the same jobs. The decision is made from the plan, because the request is often one loose line and the row count is a fact. A one-step plan skips the plan review: it has no ownership, ordering or sizing conflicts between steps, three of the four kinds of fault plan reviews find ("Reviews can add a lot of value, but they are also a dangerous trap of overhead", Google design-doc practice).
- **Fixes go to the same planner.** Its context holds the reading, which is what makes the fix round cheap; a subagent can be resumed after it stops. `fixed` / `kept` per finding is the rule's "each Important finding is fixed or answered". A `kept` you disagree with goes to the user, as any difference between you and the planner does.
- **What the user sees of the review.** Counts and the kept findings only: the user decides on the plan, and the fixed findings are in the plan file's Review section.
- **One plan file per job, in the project.** Two homes (a job list and a plan file) let rows and their fixes drift apart; only 9 job lists existed in `~/.claude/job-lists/` against 1,349 worker briefs, so most jobs never used that folder. The project is where the user reads, where git keeps history and where the next session looks first.
- **The Review section is written as the report arrives.** So the file, not the session, holds the fix round's state, and a handover mid-round loses nothing; the Stage word in the handoff says where it stopped.
- **Re-plans rewrite rows in place with `Changed <date>`.** When the build proves the plan wrong, "It is strongly recommended to update the design doc" (Google). A re-plan that adds or removes steps or moves a file to another owner can bring in the same ownership and ordering faults as a first plan, so it gets the plan-reviewer on the changed rows.
- **`plan cause` on BLOCKED lines.** It grows a replay set of real plan faults from the runs themselves instead of a one-off transcript scan. Fewer BLOCKED lines is expected from the planner's `git status` and the plan-reviewer's Expect checks, but it is not a target: a BLOCKED line is the worker doing its job.
- **One review per stage.** The old "one reviewer per piece" read as "one per session" and had no words for plan or screen reviews. The second reviewers it meant to stop were the same piece again after fixes, or a whole release over pieces already reviewed (about 8 of 77 sessions). Fixing every finding of a second pass ends in "extra abstraction layers" (Anthropic); the lead checks fixes itself.
- **One reviewer with named focus areas.** Recommended by practice notes ("one reviewer with split, named focus areas plus a validate-before-report step"); the re-check before reporting follows the code-review command ("If you are not certain an issue is real, do not flag it"). Two reviewers side by side, one per focus, is being measured first; the user picks after the numbers ("measure one reviewer with focus areas plus re-check against two side by side first, then the user picks", DECISIONS 2026-11-09).
- **Only an explicit go is a decision.** "I think we should only do it for big updates" was once written as decided and re-edited twice; the user said it was only talk. Quotes carried raw dictation, so they are cleaned to the words that carry the decision; a form's ticked option is not dictation and stays word for word. Talk goes to files that already exist (the design note or HANDOFF.md), so no new file kind.
