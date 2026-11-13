# Project scan

Analysis only: **change nothing** until the user picks fixes.

1. **Target:** the folder given, else the current folder. Name = the folder's name.
2. **Inventory in one shell call:** line counts of `CLAUDE.md`, `HANDOFF.md`, `DECISIONS.md`; the files in `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `.claude/hooks/`; and the hooks registered in `.claude/settings.json` and `.claude/settings.local.json`.
3. **Checks.** For any file over 350 lines, give a `worker` subagent (Sonnet, about 15 tool calls) the specific question instead of reading it whole; its answer is a lead, check it.
   - **Hooks:** the settings files parse as JSON; every registered hook file exists; if the project has hook tests (`test-*.mjs` next to its hooks or in `scripts/`), run them.
   - **Skills and agents:** each has `name` and `description` in its frontmatter. Agents doing mechanical work (moving files, running checks, formatting) shouldn't be on Opus; an agent without a tool-call budget in its instructions is a cost risk.
   - **CLAUDE.md:** longer than ~200 lines; rules that repeat `~/.claude/CLAUDE.md` word for word; delegation rules (which agent reads long files) that differ from the ones in `~/.claude/CLAUDE.md`; backticked paths that don't exist (check them in one shell call).
   - **Data:** if the project keeps data (look for `*.db`, `*.sqlite`, a `data/` folder; one Glob), `CLAUDE.md` or a rule file must say where each store lives as a full path and give the exact command that reads it, using a tool that is installed (check with `command -v`). A store that is only named, or not mentioned, is a finding: sessions spend their first requests looking for it.
   - **HANDOFF.md:** its last-updated date, and open items that look done or stale. Over about 120 lines is a finding: it should hold the current state only.
   - **DECISIONS.md:** over about 300 lines, or an old decision kept next to the newer one that reverses it, is a finding: the new line replaces the old one, and the history moves to `docs/archive/`.
   - **Tokens:** `node ~/.claude/skills/setup-audit/scripts/usage-scan.mjs --project <name> --days 14`. Note the biggest sessions and subagent types, and any subagent over ~1M.
4. **Save** `~/.claude/reports/setup-audit scan-<name>-<YYYY-MM-DD>.md`: the numbers, then a table: finding | fix now / later / not worth it | why (one line).
5. **Reply:** the 3 most important findings, a link to the report, and ask which "now" items to apply.

Budget: about 15 tool calls. Reply in the language the user writes in.
