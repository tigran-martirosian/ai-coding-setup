# Costs

Most of Stratus runs as local scripts and spends no model calls. This page lists the parts that use your Claude
plan, spend money, or take disk space or memory. A figure Stratus has not measured is marked "not measured".

**Your Claude plan.** A Max plan or higher works best, because the plan reviewer, the end reviewer and the helper
for long refactors run on Fable, Anthropic's largest model. On the $20 Pro plan, which has no Fable, the installer
writes Opus wherever Stratus names Fable, so everything still runs
([Install options and updates](../using/install-and-update.md#claude-code-version-and-plan)). How much of a Pro
plan's limits a big job uses is not measured.

| Part | What it costs | When |
|---|---|---|
| Text every session loads | The rules in `~/.claude/CLAUDE.md` (about 12 KB, 2,100 words), the descriptions of the 20 skills (21 with the phone-bot add-on) Claude can pick by itself (about 9 KB) and of the 7 helpers (about 2.5 KB), measured from the repository's files. Your own `~/.claude/rules/my-rules.md` and the plugins' own text come on top; those are not measured. | Every session, before your first message |
| `security-guidance` plugin | Its pattern warnings are free. It makes one model review call for each turn that changed code, and runs an agent review on each `git commit` and `git push`. The cost of each review is not measured. The plugin's own environment variables turn the reviews off; [Security](../using/security.md) lists them. | Always on, once the plugin is installed |
| Auto mode's classifier | A second model checks each command and file change before it runs. Nimbalyst runs it, and Stratus sets no model for it ([Auto mode](../using/checks.md#auto-mode)). Its cost is not measured. | In each project where auto mode is on: the full install and `/update-setup` ask once, and a yes turns it on for `quick-tasks`, `claude-settings` and, from `/update-setup`, the open project |
| `/security deep` | Measured on a project of about 700 files: the deepsec scan marked 126 files to read and cost about $100 at API rates; the second pass with Cloudflare's security-audit skill took about 35 minutes and cost about $23. On a Claude subscription it counts against your plan instead. | Only when you ask for it |
| Helpers started by `/lead` and other skills | They use your Claude plan like any other session. | When a skill starts them |
| Systems map | One background `worker` helper builds the map, in about 50 tool calls. A stale map is refreshed by the same kind of helper, without asking, at most once a week. | A build only after you say yes; a refresh when the map is stale |
| `/setup-audit chat` | One `worker` helper per project reads that project's chats (by default the last 14 days, at most 8 projects), and the main session spends about 30 tool calls. | Only when you ask for it |
| `/setup-audit full` | The same chat readers, plus one `blind-reviewer`, and about 35 tool calls in the main session. | Only when you ask for it |
| `/setup-audit` (the monthly audit) | `worker` helpers gather the figures, one headless Claude Code run (Claude Code's own `/doctor prompt-audit`, at most 40 turns) checks the prompts, and the main session spends about 30 tool calls. | Only when you ask for it |
| `plan-usage-logger` and the `usage` dashboard | No model call and no tokens. | Always |
| Phone app voice notes | A speech model of about 480 MB is downloaded once. | Only with the `phone-bot` add-on |
| `read-aloud` extension | About 350 MB of memory for each project it reads in. It runs on your computer, with no cloud cost. | Only with the `read-aloud` add-on |
| Encrypted backup | Your own Backblaze B2 storage, billed by Backblaze. | Only when you set it up with `/backup` |
