---
name: lead
description: Act as the lead/parent session in Nimbalyst — break a substantial request into workstreams, run child sessions (side by side when their files don't overlap), route results between them, get an independent review, send fixes back, and report the validated result. Use when a request is big enough to split (several independent parts, needs research + build + review, or would flood this session's context), when the user says "lead this", "orchestrate", "use child sessions", or runs /lead. Skip for small tasks.
---

# Lead

You own the outcome. Children do pieces; you plan, route, judge and verify. Needs Nimbalyst's `spawn_session` tool — if it's missing (plain terminal), do the work yourself or with Agent subagents instead.

## 1. What goes to a child (a whole separate job)

The session the user talks in builds. A child gets a whole workstream of a big request: one with its own files and its own check (about 20 steps), started fresh, which this session does not have to watch. Pieces of the job in hand stay here. One-shot lookups still go to the free worker (see CLAUDE.md), not a child.

**Weigh the start-up cost first.** A Nimbalyst child loads the whole setup before it does anything (measured 2026-10-29: a Sonnet child that scripted one 2-minute job ended at 72k tokens of context) and its report comes back as an extra turn here. So:
- **Under ~15 tool calls, or done in a few minutes** (a script, a data split, a scan): an Agent `worker` subagent (`model: "sonnet"` or `"haiku"`), run in the background. Its answer returns inside this turn, with no extra notification.
- **A 2-3 call change** you can already see: do it here.
- **A Nimbalyst child** only for a long workstream (20+ calls, its own files and check), work the user may want to open or steer, or work that runs past this turn.
(User, 2026-10-29: "Maybe we don't need to load a session of 60k tokens for a Sonnet change ... gauge how much you're spending to start the session and gauge how much is it gonna save".)

## 2. Set up the parent

1. Inspect just enough of the project to plan (CLAUDE.md, HANDOFF, DECISIONS, the files in scope).
2. Create **one tracker item** for the whole request (`tracker_create`, type `plan` or `task`) and link this session (`tracker_link_session`). That item is the Kanban-level unit: what, why, status. Decisions made along the way go on it as comments or as `decision` items.
3. Set this session's phase with `update_session_meta` (`planning` → `implementing` → `validating`). For a plain research job or a build→review→test loop, consider `workflowPreset` `research` or `implement-review-test`.
4. Write the plan as a short list of workstreams in the order they run, each with what it needs from the ones before it.

### A hard plan goes to the `planner` first

When the plan is the hard part (workstreams that depend on each other, a change that is hard to undo, or several reasonable ways to do it where the choice matters), ask the `planner` agent before step 4: Agent tool, `subagent_type: "planner"`. It runs on Fable, reads files and changes nothing. Don't use it for a plan you can already see: it costs more than any other step here.

Its brief gives context and leaves the approach open:
- **The request, in the user's own words.** Quoted, not paraphrased.
- **The situation.** What exists today, which files matter, what was already tried and how it went.
- **Decisions the user has made.** Only real ones (said in chat or written in DECISIONS.md), each with its reason and the user's words in quotes; what they said against a proposal comes first; what has no quote goes under "Proposed by Claude, not confirmed".
- **What is still open.** The things nobody has decided yet.
- **What to send back.** A plan, the alternatives it weighed, and anything in the request it would push back on.

Keep out of the brief: your own idea of the solution (even as a suggestion), your guesses dressed up as constraints, step lists and "do X, not Y" rules, and leading questions ("should we use A for this?").

When the plan comes back, compare it with your own view and tell the user where they differ instead of quietly picking one. If the call fails (for example the account has no Fable), say so and write the plan yourself.

## 3. Brief each child

Use `spawn_session` with `notifyOnComplete: true` and a short `title`. The brief is all the child knows — include:
- **First line, exactly:** `CHILD JOB: <title>`. The usage reports tell a child from a session the user talks in by this line.
- **Goal:** one objective.
- **Context:** only the facts it needs (decisions already made, findings from other children). Never paste this conversation. Decisions are carried as evidence, not as conclusions:
  - A decided item holds the user's exact words in quotes (for a form: the field label, the full text of the ticked option and anything typed with it) and where they came from (message time or form title). The brief gives the parent transcript path or session id.
  - An item with no quote goes under "Proposed by Claude, not confirmed". What Claude worked out from a decision ("this replaces ...") is a proposal too.
  - What the user said against a proposal is listed first, in their words.
  - A child told to write DECISIONS.md or a rule file writes only the quoted items and reports the rest back.
- **Files:** exact paths to read and the ones it may change.
- **Don't touch:** files/areas owned by other children or out of scope.
- **Deliverable:** what to return (a file path, a list) and roughly how long. The child's **final reply is at most 8 lines** (result, the check and its output, open points); details go in a file it names. Nimbalyst posts that final reply into the parent's chat as a whole new turn, so a long one floods the user's view.
- **Done when:** a concrete check.
- **Checks:** the project's check list (which check runs when, from its CLAUDE.md), so the child runs the same ones.
- **Board:** "Don't set your own board phase or tags; the parent manages the board."
- **Budget:** keep tool calls lean; stop and report if blocked instead of guessing.

Rules:
- Model: the thinking (the plan, the design, the diagnosis, the final review) is done in this session before any child starts; children build. Every child gets `claude-code:sonnet` with `effortLevel` `medium`, or `claude-code:haiku` with `low` for mechanical jobs. A child with no `model` gets the app default, Opus, so always name the model; a child whose job is itself a judgment (how a model or an animation looks) gets Opus with an `OPUS BECAUSE: <reason>` line in its prompt.
- Unrelated side jobs: `isolated: true`, so they don't join this workstream.
- Children whose files don't overlap run side by side; it costs no more tokens, only uses the usage window faster. A child that needs another's result, or edits the same files, starts after that one has reported: two children never edit the same file at the same time.
- Parallel lanes in one folder: when the project's CLAUDE.md allows local git, each lane gets its own git worktree (`spawn_session` with `useWorktree`), heavy builds go through a queue (at most 2 at once), and the lead merges each lane and removes its worktree.

## 4. Coordinate

- When a child reports back, read its result (`get_session_result`, compact) and judge it — don't forward it unchecked.
- A question a child is still settling with the user is the child's: wait for its report instead of asking the user the same thing.
- Before starting a continuation from a child's handoff, check that the old child is idle (`get_session_status`), so two sessions never work the same job.
- Pass useful findings to the children that need them (`send_prompt`, `messageKind: "report"` for information, `instruction` for changed work). No acknowledgements or chatter.
- A note the user wants a busy child to get now (a `/btw`, "tell 3b to also…") goes in mid-turn with `node ~/.claude/skills/steer/steer.mjs send --to <child's Nimbalyst id> - <<'EOF'` … `EOF`: `send_prompt` only queues it until the child's turn ends, and `interrupt` throws away the step it is on. If it prints `NOT SENT` because the child is idle, use `send_prompt`.
- Conflicts between children: you decide, record the decision on the tracker item, and tell the affected children.
- New work discovered → new narrow child, or do it yourself if it's small.
- `list_spawned_sessions` / `get_workstream_overview` show status; `get_workstream_edited_files` shows what changed.
- When a child's piece is accepted, set it to `complete` with `update_session_board` (children never stay in Planning).
- **A lead with running children compacts instead of handing off** (`/compact` with its focus line, as CLAUDE.md says for the context guard): the compacted lead keeps every child's id, and reports keep arriving at the same session. Only a cold cache (idle over an hour) moves it to a fresh session; then the handoff skill records where the lead moved (`steer.mjs moved`); a child's report or a message the user types that still reaches the old session is forwarded to the newest lead as a note (read before its next step; an idle one is woken) and never runs in the old session. In the new session, a message starting `[report]` is such a report: judge it like any other.
- **Watch each child's context size.** Before sending any follow-up to a child, and whenever you check on a running one, run `node ~/.claude/skills/lead/context-size.cjs "<a short phrase from the start of that child's brief, for example its Goal line>" ...` (Nimbalyst session ids don't match transcripts, so the child is found by its first prompt). A child at or above 150k tokens gets no more work: start a fresh child with a short brief (goal, current state you verified yourself, exact remaining steps, files) and close the old one. Do this without asking. A long-running child that passes 150k mid-job is left to finish its current step, then replaced the same way.

## 5. Validate independently

For meaningful changes, a **separate reviewer child** checks the result against the original request — it doesn't redo the work and changes no files. It runs on `claude-code:opus` (`OPUS BECAUSE: review`; a Sonnet reviewer explained a failing check away in the 2026-10-16 review test). Give it the request, the changed files, and what to check (build/tests/type errors, runtime errors, desktop + mobile layout, broken images/assets, content accuracy, regressions); for code it runs `/code-review` (the `code-review` skill) on the changes. It returns a list of problems with file:line, or "pass".

Its report has two headings, and you keep them apart instead of merging them into one list:
- **Against the request:** what was asked for and is missing or only partly there; what was built that nobody asked for; what is there but looks wrong. Each with the words of the request it concerns.
- **Quality:** what the checks above and `/code-review` found, each tagged Important (a bug the change brings in), Nit, or Pre-existing (already wrong before it), so an old bug isn't sent back as the child's fault.

A piece can pass one and fail the other, and one merged list hides that.

Problems → send each one back to the child that owns it if its context is still under 150k (check first, see section 4), otherwise start a narrow fix child → review again, checking only what changed. A fix brief names the problem and says: fix only this; report anything else you notice instead of fixing it.

**At most 3 fix rounds per piece.** If it still fails, stop: the plan or the brief is wrong, not the piece. Rework that, or report to the user with the open problems.

## 6. Finish

- Run the cheapest real check yourself and show its output.
- Update the tracker item (status, short summary, linked files) and set this session to `validating` or `complete` per the user's rules.
- Report to the user: result first, what each workstream produced, what was checked (with proof), and a "Needs you" list if anything's left.
