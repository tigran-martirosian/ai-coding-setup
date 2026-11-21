# Usage

Where the tokens went comes from Claude Code's own `/usage`: the last 24 hours and 7 days, split by skill, helper and MCP server. **Never open transcript files yourself.**

**Dashboard:** if the user asks for the usage dashboard, or a visual or clickable view, run `node ~/.claude/skills/setup-audit/scripts/usage-dashboard.mjs` (builds `~/.claude/reports/usage-dashboard.html` from the last 90 days and opens it in the browser), reply in one line, and stop. The same goes for "how much other use (other devices or apps) the account has" or "how much of the plan isn't me": the page's "Claude plan, whole account" section estimates it from `~/.claude/usage-log/plan-usage.jsonl`, which the `plan-usage-logger` hook fills.

**Plan ahead:** if the user asks what to expect ("will I run out", "when does the limit run out", "plan my usage"), run `node ~/.claude/skills/setup-audit/scripts/plan-ahead.mjs` (about 1 second), give its forecast and advice in a few lines, and stop. The dashboard shows the same under "Plan ahead". The usual hours of other use of the account are in `~/.claude/usage-log/plan-hours.json` (`otherUse`: `name`, `zone`, `from`, `to`, `days`, on the clock of its `zone`); change that file when the user says the hours changed. An early weekly reset counts as a plan change (the split relearns its scale) unless its local day is listed in that file's `samePlanResets` (`["2026-11-14"]`): add the day when the user says a reset was a free one that kept the plan.

**Any other usage question** ("usage report", "where did my tokens go", which skill or helper costs the most): point the user to `/usage` in one line; they type it in the chat. When they want the numbers in this reply instead, run `MSYS_NO_PATHCONV=1 claude -p "/usage"` and give its lines. A window longer than 7 days, or one project: the dashboard above (90 days, by project, model, day and chat).

Budget: about 2 tool calls. Reply in the language the user writes in.
