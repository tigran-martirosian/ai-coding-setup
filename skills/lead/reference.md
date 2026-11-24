# Lead: reference

Detail for `SKILL.md`, read at the step that needs it.

## The plan file

Read the spec whole: every **Done when** line gets a slice that proves it, every slice keeps the limits in **Your
words** as the user said them, and the **Decided** lines are settled. **Built on** names what the slices use instead
of building; a slice builds only what it and the project's own code lack. In the project folder, read
`git -C <folder> status --short`, the recent log, its CLAUDE.md, its `verify` skill and the code the slices will
touch: enough to name each slice's files, what they can reuse, and the riskiest unknown. No folder yet means a new
project.

1. **Slice 0, for a new project only,** done by you: `/new-project` (folder, git, CLAUDE.md), the job branch, the
   project's `verify` skill with the run and test commands, one passing test.
2. **Probe first.** Name the riskiest unknown: the fact that, if wrong, changes the rest of the plan. One cheap
   throwaway slice settles it. When quality is judged by eye (clips, a design), the probe makes a real sample and the
   plan names the user's look at it as the one stop after the OK. Later slices stay thin until the probe reports.
3. **Check slice,** right after the probe and before any build slice: it writes and commits every check the done-when
   lines name. That commit is the spec's version of each check. A check of a screen not built yet is written against
   the spec and counts as seen failing then. On a small job the probe and the checks can be one worker's first steps.
4. **Slices** split only at a clean interface or for real parallel work (SKILL.md section 1). Each delivers a working
   piece and proves at least one done-when line. When the whole job is one coupled unit, it is one slice.
5. **Edges.** List the files each slice will touch. Two slices that share a file, or that name the same new thing, get
   a blocking edge. A name a later slice relies on (a function, a field, a route, a file) is fixed in the plan word for
   word.
6. **How it runs.** Slices whose blockers are done run side by side, each in its own worktree. Coupled slices run in
   one session, one after the other; say which and why. Workers go to independent parts or to reading that returns a
   summary; coupled edits stay with one strong model.

The plan holds what a worker can't decide alone, plus the constraints and what must not change; the worker owns the
how. Write no code. Guessed causes and numbers go under Assumptions for the user's OK, not into a slice as facts; a
fix slice states the outcome and its check, starts by reproducing the defect, and leaves the cause to the worker.

**Risky: yes** when a slice touches a guard, a delete path or secrets, or the user named it. Give the reason. A data
migration is handled by order: it goes last.

**The spec looks wrong** (a done-when line no slice can reach inside the user's words, or a spec that contradicts the
code): put it under "Open for the user" with your recommendation, and plan no slice on it.

| Helper | Model | For |
|---|---|---|
| `worker` | Sonnet at medium | reading, gathering, summarising, drafting; edits that need no judgement |
| `worker-code` | Opus at high | code changes |
| `worker-full` | Opus at high | a slice that needs the browser, Nimbalyst, an MCP tool or a skill |
| `worker-refactor` | Fable at high | a big refactor or migration, in expand-contract steps |

```
# <Job> plan (<date>)
Spec: docs/<date>-<job>-spec.md
Open for the user: <each question, with your recommendation> / none
Assumptions: <guessed causes and numbers, for the user's OK> / none
Riskiest unknown: <one line>; settled by S1.
How it runs: <which slices side by side in worktrees, which in one session, and why>.
Size: <N slices, M worker sessions>.

## Slices
### S1: <name>
Goal: <one sentence>.
Proves: D2, D4.
Files: <every file it creates or changes>.
Uses: <what it takes from earlier slices and from Built on>. Gives: <what later slices rely on, names word for word>.
Helper: `worker-code`, Opus at high.
Size: <worker sessions, a count>.
Risky: yes, <reason> / no.
Blocked by: S0; S2 (shares <file>) / none.

## Coverage
D1: S3. D2: S1, S4. <every done-when line; one no slice proves is named here with the reason>

## Progress
The lead fills this in. A new session picks the job up from here.
| Slice | State | Commit | Worker sessions | Surprises |
```

The plan is ready for the plan-reviewer when every done-when line appears under Coverage, every slice has all eight
fields, and every file two slices share has its edge.

## A worker's brief

Agent tool, `subagent_type` and `model` from the slice row, `description: "S3: what exactly"`. Short:

```
JOB GOAL: the whole job, one sentence
PLAN: the plan file's path
SLICE: S3 of 5, what it does
DONE WHEN: the slice's done-when lines, each with its check, and the project's lint (as `biome ci .`)
FILES: to read, to change
NOT: what must not change
YOUR WORDS: the spec's quotes that bear on this slice, word for word
COMMANDS: run, test, and the project's verify skill
WORKTREE: the path, when slices run side by side
```

While the setup rebuild runs, add its three lines. No old decision quotes, no systems-map dump, no approach of
yours. When the project has a verify skill (`.claude/skills/verify/SKILL.md`), every helper's brief for a slice that
changes code names that path: most helpers have no Skill tool, so they read the file and follow it. No helper loads
auto-memory: a memory note that bears on the slice is pasted in.

**The hand-back** has a fixed shape (the worker files say it too): done; what differed from the brief; what it
found; worries; each check's command and output, run after the last edit, with the run before the change that
failed; `Not verified`; `Outside the brief`. A `BLOCKED` last line instead: answer it in the same conversation
(SendMessage) when the plan holds the answer; when it shows the plan or the spec is wrong, see SKILL.md section 3.

## Worktrees

- Every slice that needs a worktree gets it from you before the call, in the session's own folder too:
  `git -C <repo> worktree add <path> -b <job>/s<N> <job branch>`, and the brief's WORKTREE names that path. The
  Agent call carries no `isolation`: it is never `isolation: "worktree"`, whose branch names come from the harness,
  so the end sweep (SKILL.md section 4) cannot find them under `<job>/`.
- Every worktree brief says: never `git stash` (one stash list per repository: workers side by side take each
  other's entries); commit unfinished work on the worktree's branch instead.
- **After the merge,** `git worktree remove <path>` without `--force`, then `git branch -D <branch>` (after a squash
  `-d` always refuses). When the remove refuses, the worktree holds uncommitted files: name them to the user and
  leave it. A worktree left behind costs up to a gigabyte; 58 were found left over on 2026-11-19.

## A stopped worker

A notice "stopped at its N-turn limit" or an empty report is not done: SendMessage it once, "report what is done and
what is left", then compare the files yourself. Reuse a worker only while its tool calls plus the new work stay
under 80 and its context under about 150k; otherwise a fresh worker with the old one's report in its brief.

## The end reviews

**The reviewer's brief:** the spec path, the full diff from the job's base commit (one `Base: <commit>` line per
repository the change touches), the check slice's commit (it diffs the check files from there), the end-check
outputs, and the user's words from the spec. Never the chat, never your view of the change.

**Review findings.** The reviewer marks each done-when line met, missing, looks wrong or not asked for, with a
proof: a command and the output it gives now. Run the proof of each missing or looks-wrong line yourself before
spending a fix round on it.
- **Reproduced:** the fix brief starts with that command. The worker runs it and sees the failure, fixes the cause,
  runs it again and shows it pass. Fix only this; report anything else noticed instead of fixing it.
- **Not reproduced** (the command passes, or shows something else): the finding costs no fix round. It goes to the
  user as not reproduced, with the command and its output.
- **No command can show it** (a wrong text, a missing record): check the quoted lines against the file yourself.

**`/code-review` on a risky slice** follows the project's CLAUDE.md and no separate rules file
(https://code.claude.com/docs/en/code-review-local). Check each finding before acting on it, the same way.

## A blind look's brief

The `blind-reviewer` has only the Read tool; what it judges is what its brief hands it.

1. **Make the material.** Screenshots of every state, two sizes, zooms of small parts, each file named with its
   scale (`phone-390x844-3x.png`), in one folder in the system temp folder. A page in a project with
   `scripts/render-check.mjs`: `node scripts/render-check.mjs <page>` puts its shots in `.proof/<page name>/`. Text or a command: the page or message
   as a person reads it, or the command's docs and its output. Open each picture yourself: a blank or wrong-state
   shot is a failed shot. For a web page with the impeccable plugin, run `impeccable detect` first and fix its
   findings, so the blind look goes to what a scanner can't see.
2. **The brief:** a neutral question ("a friend asks: is this clear?"), every file by full path with its scale, a
   short word list for the product's own terms; for a page, also the reader's questions and the user's marked
   examples, as the `writing` skill's "A page: the fresh reader" says. No code, no reasoning, no list of changes, nothing from the build
   review. Last line `SYSTEMS MAP: none`.
3. **Save the answer** word for word as `verdict.md` beside the shots in `.proof/<page name>/` (the page's
   path with `/` as `__`, `.md` dropped); its first line, PASS or FAIL, is what verify-gate reads.
4. **Triage** each finding: fixed / disagree (with evidence) / out of scope. Fix every `[blocks]`, a `[slows]`
   when the fix is small, a `[nit]` only when cheap.
5. **After the fixes,** reshoot the same states and open them yourself; a `[blocks]` you could not fix goes to the
   user as open. No second blind round, except for a page with a `.proof/` folder: its new shots get one fresh
   look, and that answer replaces `verdict.md`. Delete the temp folder after the report.

## Why these defaults

- **One OK, not three stops** (user, 2026-11-19, phase 1 of `docs/2026-11-19-setup-review.md`): the grill settles
  the what, the spec writes it down, the user OKs the spec and the plan together.
- **The lead plans, no separate planner:** the model that writes the plan is the one that carries it out, as the
  vendors do it; a successor with no notes does 20-59% more work.
- **Sizes as counts, not time:** model time estimates run about 3x over; one plan here said 2 hours for 6 minutes
  of work.
- **Checks before the build:** a check written after the code by the same author tends to pass on whatever was built;
  committing it first and seeing it fail is what makes it a judge.
- **Three fix rounds:** Anthropic's number for a failing check before a person looks.
- **Merge one at a time and remove the worktree in the same step:** the 2026-11-19 git research found 58 left-over
  worktrees (1.8 GB) and 63 of 70 branches merged but not deleted.
- **Reproduce first, no extra checking agent** (2026-11-17): the reviewer hands a command, the lead runs it.
- **Three kinds of check** (release 26.6 layer review): scripts that run (the done-when checks, each slice's
  checks with the lint, the project's `verify` skill, CI); one fresh reader at four points (`plan-reviewer` on the
  plan, `/code-review` on a risky slice, `reviewer` at the end, `blind-reviewer` on what a person sees); one gate,
  verify-gate, on code and pages. The lead's own diff read and a separate retro were cut: neither caught anything.
- **The blind look** finds what the builder can't: "once you know how something works, you cannot reliably simulate
  not knowing" (NN/g).
