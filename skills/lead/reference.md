# Lead: reference

Detail for `SKILL.md`, used at one step each; `SKILL.md` says when to read each section.

## The planner's brief

Its brief gives context and leaves the approach open; save it in the plan file's head as **Brief**, so a later planner can start from it:
- **The request, in the user's own words.** Quoted, not paraphrased.
- **The folders.** Every folder the work reads or changes, each with its commit (`git -C <folder> rev-parse --short HEAD`) and whether it has uncommitted changes, so it reads the copies the workers will change.
- **The situation.** What exists today, which files matter, what was already tried and how it went.
- **Decisions the user has made.** Only real ones (an explicit go, as the lead skill defines it), each with its reason and the user's words in quotes; what they said against a proposal comes first; what has no quote goes under "Proposed by Claude, not confirmed". Name the path of `DECISIONS.md` and quote the lines the job touches (the purpose record's entries for the things the job names, the newest dated section below it, and a grep for the topic).
- **What is still open.** The things nobody has decided yet.
- **What to send back.** The folders and commits it read, the job-list rows with each step's helper, the review call, the alternatives it weighed, and anything in the request it would push back on.

Keep out of the brief: your own idea of the solution (even as a suggestion), your guesses dressed up as constraints, step lists and "do X, not Y" rules, and leading questions ("should we use A for this?").

## A worker's brief

**A worker's brief.** Agent tool, `subagent_type` and `model` from the row's Helper (`description: "S3: what exactly"`). A `worktree` row whose files are in another repository gets its worktree from you before the call, `git -C <repo> worktree add <path> -b <branch> main`, and the brief's FILES name that path; its Agent call carries no `isolation`, which would branch the session's own folder, the wrong repository. Parallel rows in the session's own folder may still use `isolation: "worktree"`. A `worker`, model `fable` row passes `model: "fable"`; a `worker-code` or `worker-refactor` row passes that `subagent_type` and no model; a Sonnet row carries its `SONNET BECAUSE: <reason>` line into the brief.

```
JOB GOAL: the whole job, one sentence
JOB LIST: the plan file's path
STEP: S3 of 5, what this step does
DECIDES: the row's Decides cell (a build step: "nothing, follow <design file>")
SERVES: the row's Serves cell, pasted unchanged (the user's words and DECISIONS date)
EXPECT: what must already be true when it starts
FILES: to read, to change
NOT: what must not change
DONE WHEN: the one check that proves it
Budget: about N tool calls
```

Add the project's commands and its rule for checks when the step needs them: the worker doesn't see CLAUDE.md, and reads it only when the brief leaves out something it needs.

**Decisions in a brief are evidence, not conclusions.** Only an explicit go is a decision: a tick, "yes", "do it", "decided", or a plain choice between offered options. "I think", "what if", "let's redesign" is talk: it goes under "Talked about, not decided" in a brief, and into the topic's design note (`docs/<date>-<topic>-design.md`) or else HANDOFF.md under the topic, marked "talk, not decided"; when unsure, ask one line. A decided item holds the user's words in quotes, cleaned: only the words that carry the decision, misheard words fixed, fillers cut with "…", meaning unchanged; a form's field label and the full text of its ticked option (and anything typed with it) stay word for word. Each item says where it came from. What the user said against a proposal comes first. An item with no quote, and anything you worked out from a decision, goes under "Proposed by Claude, not confirmed". A worker told to write DECISIONS.md or a rule file writes only the quoted items and reports the rest back.

**The purpose record.** When the user says what a thing is for, write it into the first section of `DECISIONS.md`, `## What each thing is for`, one line per thing: `- **<thing>** (also: <name>, …): "<cleaned words>" · *<YYYY-MM-DD>* · from "<raw phrase>"`, and show the line to the user. A hook refuses a worker start on a row that names a recorded thing without that entry's words in Serves, or with a limit not marked `NARROWED: <what>, because <why>`: fix the row, not the hook.

**A reviewer's brief carries the purposes.** A plan-reviewer or reviewer brief quotes the Serves cell of each row it covers. A focus list adds to the agent's own checklist and never replaces it. A build review's request is the purpose decision plus the card the user ticked, never the card alone.

**What no helper sees.** No helper loads auto-memory, so a memory note that bears on the step is pasted into its brief. The project's systems map reaches every brief by itself as `SYSTEMS MAP:` lines; a planner, plan-reviewer or reviewer reads what the change reaches from those lines, and runs `node ~/.claude/skills/systems-map/map.mjs --near <thing> --project <folder>` only for a part they don't cover or whose links they cut, never when the brief has no `SYSTEMS MAP:` line.

**Worktree steps** need a project whose CLAUDE.md allows local git; you merge each one. After the stage commit and the full suites pass, remove the worktree, `git worktree remove <path>` without `--force`, then delete its branch with `git branch -D <branch>` (after a squash, `-d` always refuses: git does not see the branch as merged). When `git worktree remove` refuses, the worktree holds uncommitted files: name them to the user and leave it. A failed full run is followed by a rerun of only the failed tests (`node tests/run-all.mjs --failed` in a setup repo), not a second full run. A worktree left behind costs up to a gigabyte, and Claude Code only clears it after its chat-retention days.

## A stopped worker

- **A worker that stopped is not done.** A notice "stopped at its N-turn limit" or an empty report: SendMessage it once, "report what is done and what is left", then compare the files yourself. A cut or empty reviewer is NOT RUN. Reuse a worker only when its tool calls so far (`tool_uses` in its notice) plus the new step's budget stay under 80, and under about 150k context; otherwise start a fresh worker and paste the old one's report into the brief (a 70-call step once used 115, and the next step sent to that worker was refused).

## Re-plans and size-line stops

- **A helper stopped by the size line (`[worker-size]`, 180k) is followed by a fresh worker** whose brief carries its report, not by SendMessage: SendMessage would re-send its 180k.
- **A block that shows the plan itself is wrong goes back to the planner** with the plan file and the `BLOCKED` line: SendMessage to the same planner when its report shows turns to spare, otherwise a new planner run with the Brief and the plan file. It rewrites the saved rows in place, adds one `Changed <date>: <row>: <what>` line at the end per change, and keeps the State column; `/where-are-we` then brings the changed rows' steps in the tracker up to date and adds the new ones. A re-plan that changes only the blocked row and the rows that depend on it gets no plan review; one that adds or removes steps, or moves a file to another owner, goes to the `plan-reviewer`, told to check only the changed rows.

## A blind look's brief

The `blind-reviewer` has only the Read tool and loads no project rules: what it judges is what its brief hands it. Its checks, severity levels, report format and follow-up round are in the agent itself.

1. **Make the material.** For a screen, the author builds it first.
   - A web page, with the impeccable plugin installed (`~/.claude/plugins/cache/impeccable/impeccable/<version>/skills/impeccable/scripts/impeccable`, `impeccable.cmd` from cmd or PowerShell): run `"<scripts>/impeccable" detect <file>`, then `"<scripts>/impeccable" detect --viewport 390x844 <url>`. Findings print to stderr; read them instead of the exit code (2 means findings, but the `.cmd` can print `exit 0` under Git Bash). Fix every finding before the screenshots, so the blind look goes to what a scanner cannot see; a finding that is the project's deliberate choice goes into its `DESIGN.md`.
   - Screenshots go to one folder in the system temp folder, never into the project. Shoot the complete set the agent's "Screens" section lists (two sizes, zooms of small parts, every state). Name each picture's scale in its file name, as in `phone-390x844-3x.png`, or the GUI scale for a game or desktop UI.
   - Text or a command: the page or message as a person reads it, or the command's docs and the output it printed, saved to a temp file or pasted.
   Done when: you opened each picture or file yourself and it shows what it should (a blank or wrong-state shot is a failed shot).
2. **Write the brief.** A neutral question ("a friend asks: does this look good?" or "is this clear?"), every picture or file by full path with its scale, and a short word list for the product's own terms. No code, no reasoning, no description of what changed, no suspected problems, and for the final look nothing from the build review. The last line is `SYSTEMS MAP: none`: the map hooks add a project's connections to a helper's brief, and that line keeps them out.
3. **Triage.** Mark each finding against the picture or file: fixed / disagree (with the evidence) / out of scope. Fix 3s and 4s, a 2 only when cheap. A claim marked FALSE or UNVERIFIED is checked against the newest source before any text is cut.
4. **The one more look.** Fix, reshoot the same pictures and open them yourself. Then SendMessage the same blind reviewer the BEFORE and AFTER pictures or files and the list of claimed fixes; it answers in its follow-up form. That ends the loop: a 4 still open means the layout or the approach is wrong, so report it to the user as open. When a round's findings mostly undo the last round's fixes, that is taste: keep the last version that passed.
5. Delete the temp folder of pictures after the report.

## Claiming a row

Before it starts a row, a session claims it with one line in that row's State cell (a side session: in its lane's state file), `session <id>: S3, ends with commit + handoff`, where `<id>` is the 8 characters the job-done note "This session's id starts with …" gives at its first message. When it marks the row done, it keeps the claim in the cell: `done <hash>, session <id>: S3`. The hook then refuses its next commit or its helper for another row once and holds its turn end until it hands off. The claim and the done mark stay in the State cell because the hook reads them there; the step's status, proof and handoff comment go on its tracker item (`SKILL.md` section 4).

## Release review

A release that puts together pieces already reviewed gets one reviewer on what the pieces did not cover (merge points, version, changelog, docs), not a second pass over them. Once per release, `/setup-audit full` runs the blind look at the whole setup: the person's setup files and recent chats, read as the person who works with them, without the reasoning behind them.

## The reasons behind the defaults

Reference for `SKILL.md`, read when a default is questioned. Not steps. Sources for the planning and review defaults: the planning-review design and the memory-systems design (§3) of 2026-11-09, approved by the user on the 2026-11-09 form "Wave 1 designs: your review".

- **Worker start cost.** A `worker` starts small because it loads no CLAUDE.md; `worker-full` loads every tool and the CLAUDE.md files and costs much more. `worker-code` starts as small as a `worker` and runs Opus at high for code. `worker-refactor` starts as small as a `worker` but runs Fable at high, so each step costs far more.
- **Reuse.** A follow-up to a worker that just finished, while its cache is warm, costs a few hundred tokens against several thousand for a new worker.
- **Late follow-up.** Once the cache has expired, the whole context is paid for again, so a follow-up long after a worker stopped goes to a fresh worker with a written brief.
- **No agent teams.** Experimental, more tokens, no nesting, and they change how ordinary helpers start.
- **The stages.** They are the user's own order (DECISIONS 2026-11-09). The plan review is the new one: the rules had none, and the first single plan review found 6 Important faults. Research comes first when facts are missing, because a form built from guesses sends the user options with nothing behind them.
- **When a job is big.** The triggers (2 or more helper steps; a hook, rule, agent, skill, settings or CI change) are the code-review-gate's own, so the plan review and the build review fire on the same jobs. The decision is made from the plan, because the request is often one loose line and the row count is a fact. A one-step plan skips the plan review: it has no ownership, ordering or sizing conflicts between steps, three of the four kinds of fault plan reviews find ("Reviews can add a lot of value, but they are also a dangerous trap of overhead", Google design-doc practice).
- **Fixes go to the same planner.** Its context holds the reading, which is what makes the fix round cheap; a subagent can be resumed after it stops. `fixed` / `kept` per finding is the rule's "each Important finding is fixed or answered". A `kept` you disagree with goes to the user, as any difference between you and the planner does.
- **What the user sees of the review.** Counts and the kept findings only: the user decides on the plan, and the fixed findings are in the plan file's Review section.
- **One plan file per job, in the project.** Two homes (a job list and a plan file) let rows and their fixes drift apart; only 9 job lists existed in `~/.claude/job-lists/` against 1,349 worker briefs, so most jobs never used that folder. The project is where the user reads, where git keeps history and where the next session looks first.
- **The Review section is written as the report arrives.** So the file, not the session, holds the fix round's state, and a handover mid-round loses nothing; the Stage word in the handoff says where it stopped.
- **Re-plans rewrite rows in place with `Changed <date>`.** When the build proves the plan wrong, "It is strongly recommended to update the design doc" (Google). A re-plan that adds or removes steps or moves a file to another owner can bring in the same ownership and ordering faults as a first plan, so it gets the plan-reviewer on the changed rows. No top block that "wins over the rest": on 2026-11-12 two plans carried the user's changes only in such a block while their rows still showed the old version, and a session that builds from the rows builds the old version.
- **`plan cause` on BLOCKED lines.** It grows a replay set of real plan faults from the runs themselves instead of a one-off transcript scan. Fewer BLOCKED lines is expected from the planner's `git status` and the plan-reviewer's Expect checks, but it is not a target: a BLOCKED line is the worker doing its job.
- **The reviewer pipeline.** The review plan of 2026-11-10, approved on 2026-11-11, replaced "one reviewer at most". 2-3 reviewers only for a change with separate parts one reviewer can't read whole, each with its own part: Anthropic runs many reviewers only for "substantial changes", and a reviewer that sees only its part costs mostly its own start, not more reading. A second pass over the same piece stays out: fixing every finding of a second pass ends in "extra abstraction layers" (Anthropic), so the one more look comes only after a serious finding, once.
- **Named focus areas and the re-check.** Practice notes recommend "one reviewer with split, named focus areas plus a validate-before-report step"; the re-check before reporting follows the code-review command ("If you are not certain an issue is real, do not flag it").
- **The blind look.** It finds a different kind of fault: "once you know how something works, you cannot reliably simulate not knowing" (NN/g), and a reviewer "that never saw your conversation... isn't swayed by the reasoning" (Anthropic). It cannot take its own screenshots: anything that could open the app could also read the code, and then it is not blind. So the brief hands it the material.
- **Only an explicit go is a decision.** "I think we should only do it for big updates" was once written as decided and re-edited twice; the user said it was only talk. Quotes carried raw dictation, so they are cleaned to the words that carry the decision; a form's ticked option is not dictation and stays word for word. Talk goes to files that already exist (the design note or HANDOFF.md), so no new file kind.
