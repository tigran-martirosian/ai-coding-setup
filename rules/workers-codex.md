## External workers first for gathering information

Codex runs on the user's ChatGPT subscription and costs no Claude usage. It is a Bash command, not a subagent, so the "don't spawn agents" default doesn't apply to it. **Gathering goes to it by default; thinking stays with Claude.** Either way the gathering happens: if the worker isn't a fit or fails, do the lookup yourself instead of skipping it.

- **Send to the worker:**
  - Finding things: "where is X", "which files do Y", sweeping a folder or project.
  - Reading or summarising anything long: big files, logs, docs, converted PDFs, long command output.
  - Looking things up: web research that needs several searches or reading pages, library or API facts, prices, comparisons of options. One Codex call replaces several turns. A single quick fact is fine with WebSearch (it adds only ~700 tokens).
  - A second opinion on a plan, diff or diagnosis before Claude settles on it.
  - Bulk drafting (lists, sample data, boilerplate text) that Claude then checks and edits.
- **Keep in Claude:** decisions, design, diagnosing bugs, writing or editing code, the final wording of the answer, anything that needs this conversation's context, and tiny lookups (one grep or one short file is faster than a 10–40 second worker call).
- **The command**, for local files, code and web research: `codex exec --skip-git-repo-check -s read-only -c 'windows.sandbox="unelevated"' -c model_reasoning_effort="low" "<task>" < /dev/null`. For web research put `--search` before `exec` (`codex --search exec ...`). Drop the effort flag only for a hard research question. Without `--skip-git-repo-check` it refuses to run in a folder with no git. On Windows, without the unelevated sandbox it can't read files. Don't add `--ephemeral`: the record each run saves under `~/.codex/sessions` is what the usage dashboard reads (tokens and the account-wide plan percentage).
- Antigravity (Gemini) is not set up on this computer: where a skill or a rule names it, use Codex.
- Ask for a short answer (with file paths and line numbers where relevant). Run the worker in the background when Claude has other work to do meanwhile.
- **A task written to a file gets short lines.** When a worker's task is too long for the command and goes into a text file, break it into lines of about 100 characters or fewer. Nimbalyst's file card doesn't wrap a long line and draws it over the edge of its box.
- **Search subagents are the big cost:** on the author's computer, Explore/general-purpose runs processed 0.6–4.3M tokens each. A hook (worker-nudge) blocks the first try of those subagents and points here. Retry the identical call only if it really needs a Claude subagent (for example, it must edit files).
- Treat answers as leads: verify anything the final answer depends on. Never let a worker edit files.
- For a question that spans a whole project, pack it first: `npx repomix --compress -o <temp file>`, then point the worker at that file. Never read a repomix pack yourself.
