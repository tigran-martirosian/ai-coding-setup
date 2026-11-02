---
name: lead
description: Act as the planner of a big request — break it into numbered steps on a job list, run step workers (subagents) that know the job's goal, answer what they get stuck on, get one independent review, and report the validated result. Child sessions only for the reasons listed inside. Use when a request is big enough to split (several parts, needs research + build + review, or would flood this session's context), when the user says "lead this", "orchestrate", "use child sessions", or runs /lead. Skip for small tasks.
---

# Lead

You own the outcome. You are the planner: you hold the request, the plan and the judgment, and workers do the steps. That keeps this session's context on the plan, so when something goes wrong you already know what should be there. Child sessions need Nimbalyst's `spawn_session`; in a plain terminal everything goes to Agent subagents.

## 1. What goes where

- **A step goes to a `worker` subagent, by default.** It knows the job's goal, does one numbered step (cap 80 turns, Sonnet, 1-hour cache, so a long build inside a step costs no reread) and stops with a `BLOCKED` line when what it finds contradicts the plan.
- **The brief is the worker's whole context.** A `worker` starts small because it loads no CLAUDE.md and has file, shell and web tools only. So the brief names the project commands its step needs. A step that needs a skill or an MCP tool goes to `worker-full`, which loads every tool and the CLAUDE.md files and costs much more to start.
- **Spawn less, reuse more.** A follow-up to a worker that just finished costs far less than starting a new one. So a step is a real piece of work, small pieces are grouped into one step, and the next step on the same files goes to the same worker with SendMessage. Parallel steps save time, not tokens.
- **A 2-3 call change** you can already see: do it here. Beyond that the planner doesn't build (see the trial below).
- **A child session only for one of these reasons:**
  - it needs the user's input (a subagent can't ask);
  - the user wants to open or steer it;
  - it must run past this turn, or it will pass about 200k;
  - it is a lane in its own worktree, where the project allows them;
  - it is a domain planner: a part so big it needs its own job list. That child runs on Opus (`OPUS BECAUSE: domain planner`), uses this same skill with its own workers and one `reviewer`, and reports to you in at most 8 lines.
- **One-shot lookups** go where CLAUDE.md sends them, not to a child.

Why: a child session loads the whole setup before it starts and posts its report as a new turn here; a worker's report comes back short, inside this turn; and helpers edit files the brief never named more often in child sessions than in worker jobs.

**Trial: the planner doesn't build.** The same rule was tried once before and taken back, because it cost more tokens per commit, with helpers one small job each, often on Opus. So it runs on one real job first, with whole steps on Sonnet, and that job's tokens per commit and the planner's share of them are reported to the user before it becomes the rule. Until then a job the user hasn't put on trial follows "the session the user talks in builds" in CLAUDE.md.

## 2. Set up the planner

1. Inspect just enough of the project to plan (CLAUDE.md, HANDOFF, DECISIONS, the files in scope).
2. Create **one tracker item** for the whole request (`tracker_create`, type `plan` or `task`) and link this session (`tracker_link_session`). That item is the Kanban-level unit: what, why, status. Decisions made along the way go on it as comments or as `decision` items.
3. Set this session's phase with `update_session_meta` (`planning` → `implementing` → `validating`). For a plain research job or a build→review→test loop, consider `workflowPreset` `research` or `implement-review-test`.
4. Write the plan as a job list (section 3): numbered steps in the order they run, each with what it needs from the ones before it.

### A hard plan goes to the `planner` first

When the plan is the hard part (steps that depend on each other, a change that is hard to undo, or several reasonable ways to do it where the choice matters), ask the `planner` agent before step 4: Agent tool, `subagent_type: "planner"`. It runs on Fable, reads files and changes nothing. Don't use it for a plan you can already see: it costs more than any other step here.

Its brief gives context and leaves the approach open:
- **The request, in the user's own words.** Quoted, not paraphrased.
- **The situation.** What exists today, which files matter, what was already tried and how it went.
- **Decisions the user has made.** Only real ones (said in chat or written in DECISIONS.md), each with its reason and the user's words in quotes; what they said against a proposal comes first; what has no quote goes under "Proposed by Claude, not confirmed".
- **What is still open.** The things nobody has decided yet.
- **What to send back.** A plan, the alternatives it weighed, and anything in the request it would push back on.

Keep out of the brief: your own idea of the solution (even as a suggestion), your guesses dressed up as constraints, step lists and "do X, not Y" rules, and leading questions ("should we use A for this?").

When the plan comes back, compare it with your own view and tell the user where they differ instead of quietly picking one. If the call fails (for example the account has no Fable), say so and write the plan yourself.

## 3. The job list and the briefs

A job of 2 or more steps gets a list at `~/.claude/job-lists/<date>-<job>.md`, which every worker reads first. You keep the State column; workers only add lines under Findings.

```
# Job: <title>
Goal: <one sentence with the exact target: "the checkout page shows the member discount", not "fix the page">

| Step | Job | Files | Expect before | Done when | State |
|---|---|---|---|---|---|
| S1 | ... | ... | ... | ... | open |

## Findings
```

The step number is the worker's number: each step has one owner, so two workers never do the same thing. Steps whose files don't overlap run side by side; a step that needs another's result, or edits the same files, starts after that one reported.

**A worker's brief.** Agent tool, `subagent_type: "worker"`, `description: "S3: what exactly"`, `model: "haiku"` for mechanical steps. A worker whose step is itself a judgment gets Opus with an `OPUS BECAUSE: <reason>` line.

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

**A child's brief.** Use `spawn_session` with `notifyOnComplete: true` and a short `title`. The brief is all the child knows — include:
- **First line, exactly:** `CHILD JOB: <title>`. The usage reports tell a child from a session the user talks in by this line.
- **Goal:** one objective.
- **Context:** only the facts it needs (decisions already made, findings from other children). Never paste this conversation. Decisions are carried as evidence, not as conclusions:
  - A decided item holds the user's exact words in quotes (for a form: the field label, the full text of the ticked option and anything typed with it) and where they came from (message time or form title). The brief gives the parent transcript path or session id.
  - An item with no quote goes under "Proposed by Claude, not confirmed". What Claude worked out from a decision ("this replaces ...") is a proposal too.
  - What the user said against a proposal is listed first, in their words.
  - A child told to write DECISIONS.md or a rule file writes only the quoted items and reports the rest back.
- **Files:** exact paths to read and the ones it may change.
- **Don't touch:** files/areas owned by others or out of scope. Anything it touched or noticed outside the brief goes in its report as a last line, `Outside the brief: none` or the list.
- **Deliverable:** what to return (a file path, a list) and roughly how long. The child's **final reply is at most 8 lines** (result, the check and its output, open points); details go in a file it names. Nimbalyst posts that final reply into the parent's chat as a whole new turn, so a long one floods the user's view. A later message from the parent gets a reply about that message alone, in at most 3 lines.
- **Done when:** a concrete check.
- **Checks:** the project's check list (which check runs when, from its CLAUDE.md), so the child runs the same ones.
- **Board:** "Don't set your own board phase or tags; the parent manages the board."
- **Budget:** keep tool calls lean; stop and report if blocked instead of guessing.

Rules for children:
- Model: the thinking (the plan, the design, the diagnosis, the final review) is done in this session before any child starts. Every child gets `claude-code:sonnet` with `effortLevel` `medium`, or `claude-code:haiku` with `low` for mechanical jobs. A child with no `model` gets the app default, Opus, so always name the model; a child whose job is itself a judgment (how a model or an animation looks), or a domain planner, gets Opus with an `OPUS BECAUSE: <reason>` line in its prompt.
- Unrelated side jobs: `isolated: true`, so they don't join this workstream.
- Children whose files don't overlap run side by side; it costs no more tokens, only uses the usage window faster. Two children never edit the same file at the same time.
- Parallel lanes in one folder: when the project's CLAUDE.md allows local git, each lane gets its own git worktree (`spawn_session` with `useWorktree`), heavy builds go through a queue (at most 2 at once), and the lead merges each lane and removes its worktree.

## 4. Coordinate

Workers talk only to you. Nobody talks sideways: what another step needs goes under Findings, and agent teams stay off (experimental, more tokens, no nesting, and they change how ordinary helpers start).

- **Answer a `BLOCKED` line from the plan you hold.** Send the one thing it asked for with SendMessage to its agent id, so it goes on with what it learned, cheaply while its cache is warm. A follow-up long after it stopped, to a worker with a big context, goes to a fresh worker with a written brief instead: once the cache has expired, the whole context is paid for again. If the block shows the plan itself is wrong, fix the plan and the job list first.
- **Compare every report with its brief.** Check the files it changed against FILES (`git status --short`, or `get_workstream_edited_files` for a child) and read its `Outside the brief` line. A change you wouldn't have asked for is undone; one you would is added to the job list.
- Read a worker's report and the diff yourself; don't forward it unchecked. Update State on the job list.

With child sessions:

- When a child reports back, read its result (`get_session_result`, compact) and judge it.
- **Every message to a child brings a report back here.** Nimbalyst posts the child's reply to each message as a new `[Child Session Update]` turn in this chat, also when its piece is long done (seen 2026-10-29: one finished child reported 4 times, once after "Write your full report"). A finished child gets a message only for a fix or changed work; details you still need come from `get_session_result` or the file its report names.
- A question a child is still settling with the user is the child's: wait for its report instead of asking the user the same thing.
- Before starting a continuation from a child's handoff, check that the old child is idle (`get_session_status`), so two sessions never work the same job.
- A note to a running child is for the job it is on; the next job goes to a fresh child. `steer.mjs send` refuses a child past 300k: send only its finishing note, with `--last`, or a note the user wrote, with `--user`.
- Pass useful findings to the children that need them (`send_prompt`, `messageKind: "report"` for information, `instruction` for changed work). No acknowledgements or chatter.
- A note the user wants a busy child to get now (a `/btw`, "tell 3b to also…") goes in mid-turn with `node ~/.claude/skills/steer/steer.mjs send --to <child's Nimbalyst id> - <<'EOF'` … `EOF`: `send_prompt` only queues it until the child's turn ends, and `interrupt` throws away the step it is on. If it prints `NOT SENT` because the child is idle, use `send_prompt`. Only `Delivered to …` means it arrived; `Queued for …` means it is still on its way, so report it as that, not as sent. A note unconfirmed after 10 minutes comes back to you as a warning; `steer.mjs status` lists what is waiting or failed, and a failed note goes again with `send_prompt`.
- Conflicts between children: you decide, record the decision on the tracker item, and tell the affected children.
- `list_spawned_sessions` / `get_workstream_overview` show status; `get_workstream_edited_files` shows what changed.
- When a child's piece is accepted, set it to `complete` with `update_session_board` (children never stay in Planning).
- **A lead with running children compacts instead of handing off** (by itself at about 200k, as CLAUDE.md says): the compacted lead keeps every child's id, and reports keep arriving at the same session. Only a cold cache (idle over an hour, under that size) moves it to a fresh session; then the handoff skill records where the lead moved (`steer.mjs moved`); a child's report or a message the user types that still reaches the old session is forwarded to the newest lead as a note (read before its next step; an idle one is woken) and never runs in the old session. In the new session, a message starting `[report]` is such a report: judge it like any other.
- **A child is not replaced for its size.** It compacts itself at about 200k, mid-job, and carries on, so don't start a "part 2" child for that reason. To see a child's size: `node ~/.claude/skills/lead/context-size.cjs "<a short phrase from the start of that child's brief, for example its Goal line>" ...` (Nimbalyst session ids don't match transcripts, so the child is found by its first prompt).

New work discovered → a new step on the list, or do it yourself if it's small.

## 5. Validate independently

A job of several steps gets **one pass by the `reviewer` agent** (Agent tool, `subagent_type: "reviewer"`, Opus, read-only), unless the project's CLAUDE.md rules a review out. Give it the request in the user's own words, the job list, the changed files and the checks that ran. A domain planner runs its own reviewer. Its report has two headings, and you keep them apart instead of merging them into one list: **Against the request** and **Quality** (Important, Nit, Pre-existing, so an old bug isn't sent back as the worker's fault). A piece can pass one and fail the other, and one merged list hides that.

Problems → send each one back to the worker that owns it, or start a narrow fix worker if its context is big → check only what changed. A fix brief names the problem and says: fix only this; report anything else you notice instead of fixing it.

**At most 3 fix rounds per piece.** If it still fails, stop: the plan or the brief is wrong, not the piece. Rework that, or report to the user with the open problems.

## 6. Finish

- Run the cheapest real check yourself and show its output.
- Update the tracker item (status, short summary, linked files) and set this session to `validating` or `complete` per the user's rules.
- Report to the user: result first, what each step produced, what was checked (with proof), and a "Needs you" list if anything's left.
