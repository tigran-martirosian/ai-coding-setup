# Setup audit

The monthly run: once a month. Analysis first: **change nothing** until the user picks fixes. Use `worker` subagents for gathering, as `~/.claude/CLAUDE.md` says.

1. **Last time:** open the newest `~/.claude/reports/*-setup-audit.md`, or from before the files were renamed `setup-audit-<YYYY-MM-DD>.md` (the newest of both by the date in the name), if any. Read only its "Decisions" and "Still to measure" sections. Don't re-open decided items unless new numbers change them.
2. **Numbers:** `node ~/.claude/skills/setup-audit/scripts/usage-scan.mjs --since <date of the last audit>` (else `--days 7`). Measure every "Still to measure" item with `--session`/`--minutes`/`--project`. Never read transcripts yourself.  Then `node ~/.claude/skills/setup-audit/scripts/outcomes.mjs --days <the same window>`: what the checks led to (see `outcomes.md`).
3. **Health, in as few shell calls as possible:**
   - `~/.claude/settings.json` parses as JSON; every hook command in it points to a file that exists; no hook is registered twice.
   - Each hook still reacts: settings.json `permissions.deny` holds `Agent(Explore)` and `Agent(general-purpose)`; `{"session_id":"audit2","tool_name":"Bash","tool_input":{"command":"find / -name x"}}` into `find-guard.mjs` (expect `"permissionDecision":"deny"`: a whole-drive search is refused).
   - The `worker` agent exists (`~/.claude/agents/worker.md`) and has a `model:` line; step 4 checks that its runs use it.
4. **Models and prompts:** start both, then read their output when they end.
   - `node ~/.claude/skills/setup-audit/scripts/model-check.mjs` (about 1 second): did each recent helper run on the model its agent file or its call names, read from `message.model` in the run's log. Each `MISMATCH` line is a finding. A run older than the last change to its agent file (`git -C ~/.claude log -1 --format=%ad -- agents/<name>.md`, or the file's modified time where `~/.claude` has no git) is compared with the new model: drop that line, it is no finding.
   - The built-in prompt audit, headless, report only (several minutes: `run_in_background`, its output to a file in the temp folder, then wait for it):
     `cd ~/.claude && MSYS_NO_PATHCONV=1 claude -p "/doctor prompt-audit Scope: CLAUDE.md, output-styles/, agents/ and skills/*/SKILL.md. Report only: write no file, edit nothing, commit nothing." --max-turns 40`
     Each finding it names (a file and a line, what is wrong) is a finding.
5. **Judge** (this stays with you): where did the tokens go; what is loaded globally but hardly used (compare the scan's "What gets used" section with `claude plugin list` and the global skills); did `worker` subagents take the searching and long reads; were hook blocks retried or ignored; any subagent over ~1M, and why; did the last audit's fixes hit their targets; and from the outcomes numbers, whether each check led to a result (a question's recommendation taken, a review followed by a change, a gate block followed by a passing build), where a count under 10 is "too few to judge". For a second opinion on your findings, give them to a `worker` subagent and verify what it says.
6. **Save** `~/.claude/reports/<YYYY-MM-DD>-setup-audit.md` (a second run that day replaces it) in the same shape as the last one: numbers vs the last audit, workers and hooks, an **Outcomes** section (the script's tables as printed, with the change since the last audit), a **Models and prompts** section (the model check's counts and each mismatch, each prompt-audit finding with its file and line), a short verdict, a decisions table (finding | fix now / later / not worth it | why, one line each, marked "pending user"), and what to measure next time.
7. **Reply:** numbers first (total, the change since last time, the top costs), then the proposed decisions, then ask which "now" items to apply, once, in one form. If that form is lost or interrupted, never show it again: apply nothing and list every item as plain text. When applying, fix the cause (the rule plus a test; a new hook only after the user's yes), then rerun the checks.

Also read `~/.claude/hooks/state/hook-errors.log` when it exists: it holds one line for each crash of the review gate. A hook fails open, so this file is the only sign of it.

Budget: about 30 tool calls. Reply in the language the user writes in.
