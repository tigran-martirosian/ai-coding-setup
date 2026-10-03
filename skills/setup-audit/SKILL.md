---
name: setup-audit
description: Audit of this Claude Code setup — where the tokens go, whether the Codex/agy workers and the hooks work and get used, subagent costs — compared with the last audit and saved to ~/.claude/reports. Use when the user says "setup audit", "audit my setup", "is my setup working", or runs /setup-audit (optional: number of days).
---

# Setup audit

Analysis first: **change nothing** until the user picks fixes. Use the workers for gathering, as `~/.claude/CLAUDE.md` says.

1. **Last time:** open the newest `~/.claude/reports/setup-audit-*.md`, if any. Read only its "Decisions" and "Still to measure" sections. Don't re-open decided items unless new numbers change them.
2. **Numbers:** `node ~/.claude/skills/usage-report/usage-scan.mjs --since <date of the last audit>` (else `--days 7`). Never read transcripts yourself.
3. **Health, in as few shell calls as possible:**
   - `~/.claude/settings.json` parses as JSON; every hook command in it points to a file that exists; no hook is registered twice.
   - Each hook still reacts: pipe `{"session_id":"audit","tool_name":"Agent","tool_input":{"subagent_type":"Explore","prompt":"x"}}` into `worker-nudge.mjs` (expect `"deny"` when a worker is set up, no output when none is); a 400-line temp file as `{"session_id":"audit2","tool_name":"Read","tool_input":{"file_path":"<file>"}}` into `big-read-gate.mjs` (expect `"deny"`).
   - Workers still work, for each worker that `~/.claude/CLAUDE.md` names (with none named, skip this check): Codex with one tiny call (the command in `~/.claude/CLAUDE.md`, task "Reply OK"); Antigravity with `agy models`, and check that the model named in `~/.claude/CLAUDE.md` is still listed.
4. **Judge** (this stays with you): where did the tokens go; did the workers take the searching and long reads; were hook blocks retried or ignored; any subagent over ~1M, and why; did the last audit's fixes hit their targets.
5. **Save** `~/.claude/reports/setup-audit-<YYYY-MM-DD>.md`: numbers vs the last audit, workers and hooks, a short verdict, a decisions table (finding | fix now / later / not worth it | why, one line each, marked "pending user"), and what to measure next time.
6. **Reply:** numbers first (total, the change since last time, the top costs), then the proposed decisions, then ask which "now" items to apply. When applying, fix the cause (rule plus hook plus a test), then rerun the checks.

Budget: about 20 tool calls. Reply in the language the user writes in.
