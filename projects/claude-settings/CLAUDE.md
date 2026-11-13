# claude-settings

The place for changing the Claude setup itself (the rules in `~/.claude/CLAUDE.md`, hooks, skills,
plugins, Nimbalyst settings) and for questions like "should we add tool X?". Project work doesn't
happen here.

- **The installer can be run again at any time.** `node install.mjs`, run in the folder saved as
  `repo` in `~/.claude/setup-state.json`, adds what is missing, keeps a dated copy of every file it replaces
  (in `~/.claude/setup-logs/<YYYY-MM-DD>-install-backup/`, never next to the file) and leaves the notes files in these two folders as they are.
  One of the setup's files that was changed here stays too: the run lists it under `Kept as yours`,
  and `--replace <name>` or `--replace-all` takes the setup's version.
  `node install.mjs --dry-run` prints what it would do and changes nothing.
- **Adding Codex later.** With a ChatGPT subscription: install the Codex CLI
  (`npm i -g @openai/codex`) and run `codex login`. Then run `node install.mjs` again: it finds
  Codex (or takes `--codex yes|no`) and adds the picture skill to the `quick-tasks` folder (without
  Codex it takes it out again). Afterwards:
  - check the sign-in (`codex login status`);
  - offer to install FFmpeg (only the picture skill's slower "careful run" needs it).
- **`/setup-audit chat` fits the setup to the real work.** It reads the recent chats of every project on
  this computer (a script and `worker` subagents, which run on Claude, do the reading), finds where Claude got in the way
  and which skills or tools are missing, shows a tick list and sets up only what is ticked, in the
  project it belongs to. Run it after a few weeks of work, or when the same problem keeps coming back.
- **`/setup-audit full` is the one review that ends in choices.** It runs the usage scanner, a second scanner (the kind of work per request, what another split between models would have cost, where the time of each turn went, failed tool calls, context size) and the chat reading together, writes a report to `audits/`, and asks once which of the measured options to carry out. Run it every week or two.
- **Keep the old version first.** Before changing a file such as `~/.claude/settings.json` or `~/.claude/CLAUDE.md`
  by hand, commit it if its folder is a git repo, else copy it to `~/.claude/setup-logs/<YYYY-MM-DD>-<topic>/` (never next to itself).
- **Change one thing, test it for real, write it down.** Every change gets one line in `DECISIONS.md`
  here: what changed, why, the date.
- **New files follow `~/.claude/skills/file-upkeep/standard.md`:** dated notes in `docs/`, `docs/research/`,
  `audits/`; scratch and test output in the temp folder, deleted after the run; no copies beside a file.
- **A new tool:** look up what it does and what it costs in every session first. Turn it on for the
  one project that needs it, not globally, unless most sessions need it.
- **Reports:** `/setup-audit` (is the setup working), `/setup-audit usage` (where the tokens went),
  `/setup-audit scan` (one project's setup).
- **How to use the setup:** `how-to.md` here, with an example for each feature.

## Not for here

- General questions, finding things on the internet and one-off file jobs: `<projects>\quick-tasks`.
