# Outcomes

What the checks led to, counted from the chats of this computer. Hook counts say a gate fired; these say what happened next. Numbers come from a script: **never open transcript files yourself.**

1. **Run** `node ~/.claude/skills/setup-audit/scripts/outcomes.mjs [--days N] [--project <part of a folder name>]` (about 20 seconds; default 14 days). It prints four sections, each with its sample size:
   - **rec-check:** questions with a recommended option, before rec-check began and after; how often the recommended option was taken; how often rec-check said change and what the user then chose.
   - **Reviews:** reviewer helpers and code-review runs followed by a code change.
   - **Verify gate:** blocks followed by a passing build or test.
   - **Map:** helpers briefed with Systems map lines against helpers without: edits outside the brief, stopped helpers.
2. **Save** `~/.claude/reports/<YYYY-MM-DD>-outcomes.md` (a second run that day replaces it): the script's output as printed.
3. **Reply** with the numbers as printed, each with its sample size. A figure under 10 is "too few to judge": say so, and name the day to run it again (a section with no cases yet fills as the check is used). State what the numbers show, with no cause the script did not measure. If an older `*-outcomes.md` is there, put the two runs side by side in one line per section.

Budget: about 4 tool calls.
