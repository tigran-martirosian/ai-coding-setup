# claude-settings

The place for changing the Claude setup itself (the rules in `~/.claude/CLAUDE.md`, hooks, skills,
plugins, Nimbalyst settings) and for questions like "should we add tool X?". Project work doesn't
happen here.

- **The installer can be run again at any time.** `node install.mjs`, run in the folder saved as
  `repo` in `~/.claude/setup-state.json`, adds what is missing, keeps a dated copy of every file it replaces
  (`<name>.before-install-<yyyymmdd>`) and leaves the notes files in these four folders as they are.
  `node install.mjs --dry-run` prints what it would do and changes nothing.
- **Adding a worker later.** With a ChatGPT subscription: install the Codex CLI
  (`npm i -g @openai/codex`) and run `codex login`. With a Google subscription: install the
  Antigravity CLI and sign in by running `agy` once. Then run `node install.mjs` again: it finds the
  workers that are installed (or takes `--codex yes|no --agy yes|no`), rewrites the worker section
  of `~/.claude/CLAUDE.md` and, with Codex, adds the picture skill to two of the folders (without
  Codex it takes it out again). Afterwards:
  - check the sign-in (`codex login status`, `agy models`);
  - Antigravity: if `agy models` doesn't list the model named in `~/.claude/CLAUDE.md`, write the
    newest `*-flash-medium` model it lists into the rules instead;
  - Codex: offer to install FFmpeg (only the picture skill's slower "careful run" needs it).
- **`/chat-review` fits the setup to the real work.** It reads the recent chats of every project on
  this computer (a script and the Codex worker do the reading), finds where Claude got in the way
  and which skills or tools are missing, shows a tick list and sets up only what is ticked, in the
  project it belongs to. Run it after a few weeks of work, or when the same problem keeps coming back.
- **Save a dated copy first.** Before changing `~/.claude/settings.json` or `~/.claude/CLAUDE.md`
  by hand, copy it next to itself as `<name>.before-<topic>-<yyyymmdd>`.
- **Change one thing, test it for real, write it down.** Every change gets one line in `DECISIONS.md`
  here: what changed, why, the date.
- **A new tool:** look up what it does and what it costs in every session first. Turn it on for the
  one project that needs it, not globally, unless most sessions need it.
- **Reports:** `/setup-audit` (is the setup working), `/usage-report` (where the tokens went),
  `/project-scan` (one project's setup).
- **How to use the setup:** `HOW-TO.md` here, with an example for each feature.

## Not for here

- General questions: `<projects>\ask-anything`. Finding things on the internet:
  `<projects>\internet-search`. One-off file jobs: `<projects>\quick-tasks`.
