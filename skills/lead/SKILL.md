---
name: lead
description: Act as the lead/parent session in Nimbalyst — break a substantial request into workstreams, run child sessions (in parallel where safe), route results between them, get an independent review, send fixes back, and report the validated result. Use when a request is big enough to split (several independent parts, needs research + build + review, or would flood this session's context), when the user says "lead this", "orchestrate", "use child sessions", or runs /lead. Skip for small tasks.
---

# Lead

You own the outcome. Children do pieces; you plan, route, judge and verify. Needs Nimbalyst's `spawn_session` tool — if it's missing (plain terminal), do the work yourself or with Agent subagents instead.

## 1. Decide whether to split (default: don't)

Split only if at least one is true:
- two or more parts can run **at the same time** without touching the same files;
- a part needs a lot of its own reading (research, asset hunting, a big audit) that would bloat this session;
- the work needs an **independent reviewer** (meaningful code/design changes).

Don't split if you could finish in a few minutes, or if explaining the job costs more than doing it. A child is a full session that starts cold (~30–60k tokens of base context), so each one must earn that. One-shot lookups go to a cheap outside worker such as the Codex command-line tool, not a child.

## 2. Set up the parent

1. Inspect just enough of the project to plan (CLAUDE.md, HANDOFF, DECISIONS, the files in scope).
2. Create **one tracker item** for the whole request (`tracker_create`, type `plan` or `task`) and link this session (`tracker_link_session`). That item is the Kanban-level unit: what, why, status. Decisions made along the way go on it as comments or as `decision` items.
3. Set this session's phase with `update_session_meta` (`planning` → `implementing` → `validating`). For a plain research job or a build→review→test loop, consider `workflowPreset` `research` or `implement-review-test`.
4. Write the plan as a short list of workstreams with dependencies: which run now in parallel, which wait.

## 3. Brief each child

Use `spawn_session` with `notifyOnComplete: true` and a short `title`. The brief is all the child knows — include:
- **Goal:** one objective.
- **Context:** only the facts it needs (decisions already made, findings from other children). Never paste this conversation.
- **Files:** exact paths to read and the ones it may change.
- **Don't touch:** files/areas owned by other children or out of scope.
- **Deliverable:** what to return (a short report, a file path, a list) and roughly how long.
- **Done when:** a concrete check.
- **Board:** "Don't set your own board phase or tags; the parent manages the board."
- **Budget:** keep tool calls lean; stop and report if blocked instead of guessing.

Rules:
- Model: `claude-code:sonnet` for routine work that follows a clear plan; `claude-code:opus` for design, diagnosis and review (a child with no `model` gets this session's model, so always name it). Use `effortLevel` `low` for mechanical jobs.
- Unrelated side jobs: `isolated: true`, so they don't join this workstream.
- Two children never edit the same file at the same time. If they must, run them one after the other.
- Independent children start in the same turn.

## 4. Coordinate

- When a child reports back, read its result (`get_session_result`, compact) and judge it — don't forward it unchecked.
- Pass useful findings to the children that need them (`send_prompt`, `messageKind: "report"` for information, `instruction` for changed work). No acknowledgements or chatter.
- Conflicts between children: you decide, record the decision on the tracker item, and tell the affected children.
- New work discovered → new narrow child, or do it yourself if it's small.
- `list_spawned_sessions` / `get_workstream_overview` show status; `get_workstream_edited_files` shows what changed.
- When a child's piece is accepted, set it to `complete` with `update_session_board` (children never stay in Planning).
- **Watch each child's context size.** Before sending any follow-up to a child, and whenever you check on a running one, run `node ~/.claude/skills/lead/context-size.cjs "<a short phrase from the start of that child's brief, for example its Goal line>" ...` (Nimbalyst session ids don't match transcripts, so the child is found by its first prompt). A child at or above 150k tokens gets no more work: start a fresh child with a short brief (goal, current state you verified yourself, exact remaining steps, files) and close the old one. Do this without asking. A long-running child that passes 150k mid-job is left to finish its current step, then replaced the same way.

## 5. Validate independently

For meaningful changes, a **separate reviewer child** checks the result against the original request — it doesn't redo the work and changes no files. Give it the request, the changed files, and what to check (build/tests/type errors, runtime errors, desktop + mobile layout, broken images/assets, content accuracy, regressions). It returns a list of problems with file:line, or "pass".

Problems → send each one back to the child that owns it if its context is still under 150k (check first, see section 4), otherwise start a narrow fix child → review again, checking only what changed. A fix brief names the problem and says: fix only this; report anything else you notice instead of fixing it.

**At most 3 fix rounds per piece.** If it still fails, stop: the plan or the brief is wrong, not the piece. Rework that, or report to the user with the open problems.

## 6. Finish

- Run the cheapest real check yourself and show its output.
- Update the tracker item (status, short summary, linked files) and set this session to `validating` or `complete` per the user's rules.
- Report to the user: result first, what each workstream produced, what was checked (with proof), and a "Needs you" list if anything's left.
