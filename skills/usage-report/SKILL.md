---
name: usage-report
description: "Token and usage numbers from Claude Code transcripts — tokens per session and per subagent, Codex/agy worker calls, hook blocks — saved as a dated report, plus a forecast of the plan limits. Use when the user asks \"where did my tokens go\", \"usage report\", \"how much did X cost\", \"token report\", \"will I run out\", \"plan my usage\", or runs /usage-report (optional: number of days, a project name, or a session id)."
---

# Usage report

Numbers come from a script, not from reading transcripts. **Never open transcript files yourself.**

**Dashboard:** if the user asks for the usage dashboard, or a visual or clickable view, run `node ~/.claude/skills/usage-report/usage-dashboard.mjs` (builds `~/.claude/reports/usage-dashboard.html` from the last 90 days and opens it in the browser), reply in one line, and skip the steps below. The same goes for "how much other use (other devices or apps) the account has" or "how much of the plan isn't me": the page's "Claude plan, whole account" section estimates it from `~/.claude/usage-log/plan-usage.jsonl`, which the `plan-usage-logger` hook fills.

**Plan ahead:** if the user asks what to expect ("will I run out", "when does the limit run out", "plan my usage"), run `node ~/.claude/skills/usage-report/plan-ahead.mjs` (about 1 second), give its forecast and advice in a few lines, and skip the steps below. The dashboard shows the same under "Plan ahead". The usual hours of other use of the account are in `~/.claude/usage-log/plan-hours.json` (`otherUse`: `name`, `zone`, `from`, `to`, `days`, on the clock of its `zone`); change that file when the user says the hours changed.

1. **Run the scan** (about 1 second):
   `node ~/.claude/skills/usage-report/usage-scan.mjs [options]`
   - Default: the last 7 days, all projects. Map the user's words to options: `--days N`, `--project <part of the folder name>`, `--session <id prefix>` plus `--minutes N` for only the first N minutes of it, `--since`/`--until` for exact times, `--top N` for more sessions.
   - "Tokens" = input + cache + output, counted once per API message. Most of it is cache reads, so compare runs with each other, not with plan limits.
   - Use `--json` only when you need a field the markdown doesn't show (for example every session, or per-model totals).
2. **Compare:** if `~/.claude/reports/` has an older `usage-*.md`, read only its first 10 lines and compare the totals in one line.
3. **Save** `~/.claude/reports/usage-<YYYY-MM-DD>.md` (add `-2`, `-3` if it exists): the script output, then **What stands out**, 3–5 bullets:
   - the biggest costs and what they were (from the session titles);
   - any subagent over ~1M tokens, and whether a free worker (Codex/agy) could have done its gathering;
   - failed worker calls, and hook blocks followed by "retried" or "nothing";
   - the script's "Wasted requests" section (requests the setup itself causes: hook blocks, board-only and ToolSearch-only requests, failure streaks);
   - the change against the last report.
4. **Reply:** the total, the top 3 costs, what stands out, and a link to the report. For a full review with fixes, suggest `/setup-audit`.

Budget: about 6 tool calls. Reply in the language the user writes in.
