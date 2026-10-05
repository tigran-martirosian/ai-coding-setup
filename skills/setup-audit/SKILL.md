---
name: setup-audit
description: Audit of this Claude Code setup — where the tokens go, whether the Codex/agy workers and the hooks work and get used, subagent costs, what is loaded but hardly used — compared with the last audit and saved to ~/.claude/reports. Use when the user says "setup audit", "audit my setup", "is my setup working", or runs /setup-audit (optional: number of days, or a session to measure).
---

# Setup audit

Analysis first: **change nothing** until the user picks fixes. Use the workers for gathering, as `~/.claude/CLAUDE.md` says.

1. **Last time:** open the newest `~/.claude/reports/setup-audit-*.md`, if any. Read only its "Decisions" and "Still to measure" sections. Don't re-open decided items unless new numbers change them.
2. **Numbers:** `node ~/.claude/skills/usage-report/usage-scan.mjs --since <date of the last audit>` (else `--days 7`). Measure every "Still to measure" item with `--session`/`--minutes`/`--project`. Never read transcripts yourself.
3. **Health, in as few shell calls as possible:**
   - `~/.claude/settings.json` parses as JSON; every hook command in it points to a file that exists; no hook is registered twice.
   - Each hook still reacts: pipe `{"session_id":"audit","tool_name":"Agent","tool_input":{"subagent_type":"Explore","prompt":"x"}}` into `worker-nudge.mjs` (expect `"deny"` when a worker is set up, no output when none is); a 400-line temp file as `{"session_id":"audit2","tool_name":"Read","tool_input":{"file_path":"<file>"}}` into `big-read-gate.mjs` (expect `"deny"`).
   - Workers still work: `~/.claude/workers/ask.mjs --status` lists each worker as ready or says why not (with none set up, skip the rest of this check). For local files, if one is ready: `~/.claude/workers/ask.mjs "Reply OK"` must print which worker answered; the same with `--web` when a web worker is ready. With Antigravity ready, check that `agy models` still lists the model `ask.mjs` names (`BIG_READ_AGY_MODEL`, else the default in the script).
4. **Judge** (this stays with you): where did the tokens go; what is loaded globally but hardly used (compare the scan's "What gets used" section with `claude plugin list` and the global skills); did the workers take the searching and long reads; were hook blocks retried or ignored; any subagent over ~1M, and why; did the last audit's fixes hit their targets. For a second opinion on your findings, ask a worker if one is set up, and verify what it says.
5. **Save** `~/.claude/reports/setup-audit-<YYYY-MM-DD>.md` (add `-2` if it exists) in the same shape as the last one: numbers vs the last audit, workers and hooks, a short verdict, a decisions table (finding | fix now / later / not worth it | why, one line each, marked "pending user"), and what to measure next time.
6. **Reply:** numbers first (total, the change since last time, the top costs), then the proposed decisions, then ask which "now" items to apply, once, in one form. If that form is lost or interrupted, never show it again: apply the recommended items that are one-line reversible (back up the file first), say what was applied and how to undo it, and list the remaining choices as plain text. When applying, fix the cause (rule plus hook plus a test), then rerun the checks.

Budget: about 25 tool calls. Reply in the language the user writes in.
