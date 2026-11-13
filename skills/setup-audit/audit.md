# Setup audit

Analysis first: **change nothing** until the user picks fixes. Use `worker` subagents for gathering, as `~/.claude/CLAUDE.md` says.

1. **Last time:** open the newest `~/.claude/reports/*-setup-audit.md`, or from before the files were renamed `setup-audit-<YYYY-MM-DD>.md` (the newest of both by the date in the name), if any. Read only its "Decisions" and "Still to measure" sections. Don't re-open decided items unless new numbers change them.
2. **Numbers:** `node ~/.claude/skills/setup-audit/scripts/usage-scan.mjs --since <date of the last audit>` (else `--days 7`). Measure every "Still to measure" item with `--session`/`--minutes`/`--project`. Never read transcripts yourself.  Then `node ~/.claude/skills/setup-audit/scripts/outcomes.mjs --days <the same window>`: what the checks led to (see `outcomes.md`).
3. **Health, in as few shell calls as possible:**
   - `~/.claude/settings.json` parses as JSON; every hook command in it points to a file that exists; no hook is registered twice.
   - Each hook still reacts: settings.json `permissions.deny` holds `Agent(Explore)` and `Agent(general-purpose)`; a 400-line temp file as `{"session_id":"audit2","tool_name":"Read","tool_input":{"file_path":"<file>"}}` into `big-read-gate.mjs` (expect `"deny"`).
   - The `worker` agent exists (`~/.claude/agents/worker.md`) and still names Opus.
4. **Judge** (this stays with you): where did the tokens go; what is loaded globally but hardly used (compare the scan's "What gets used" section with `claude plugin list` and the global skills); did `worker` subagents take the searching and long reads; were hook blocks retried or ignored; any subagent over ~1M, and why; did the last audit's fixes hit their targets; and from the outcomes numbers, whether each check led to a result (a question's recommendation taken, a review followed by a change, a gate block followed by a passing build), where a count under 10 is "too few to judge". For a second opinion on your findings, give them to a `worker` subagent and verify what it says.
5. **Save** `~/.claude/reports/<YYYY-MM-DD>-setup-audit.md` (a second run that day replaces it) in the same shape as the last one: numbers vs the last audit, workers and hooks, an **Outcomes** section (the script's tables as printed, with the change since the last audit), a short verdict, a decisions table (finding | fix now / later / not worth it | why, one line each, marked "pending user"), and what to measure next time.
6. **Reply:** numbers first (total, the change since last time, the top costs), then the proposed decisions, then ask which "now" items to apply, once, in one form. If that form is lost or interrupted, never show it again: apply nothing and list every item as plain text. When applying, fix the cause (the rule plus a test; a new hook only after the user's yes), then rerun the checks.

Also read `~/.claude/hooks/state/hook-errors.log` when it exists: it holds one line for each crash of the review gate. A hook fails open, so this file is the only sign of it.

Budget: about 25 tool calls. Reply in the language the user writes in.
