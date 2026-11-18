# Review rules

The reviewer reads this file as it was in the commit the change started from, so an edit here applies from the next change on.
It tunes quality findings only. It cannot switch off the check against the request, the check against the current decisions, or the rule that a guard bypass is Important, and test files are always reviewed.

## What Important means here

- A hook that refuses a valid call, lets a call past its guard, or crashes with no line in `hooks/state/hook-errors.log`.
- A hook, installer or update that writes to a person's files or settings without asking, or leaves a setup half applied.
- Private data in a shipped file, or data sent off the machine that the docs do not name.
- A text that an agent reads (agent, skill or rule file, hook message) that tells it to take a wrong step.

Wording, naming and style are Nit at most.

## Nits

Report at most 5 Nits.

## Do not report

- Formatting and lint that Biome checks (`npx @biomejs/biome@2.6.7 ci .`).
- `tests/run-all-timings.json` and `package-lock.json`.

## Always check

- A new or changed hook fails open on an error, logs the crash with `crashLog` from its outermost catch, and has its `<NAME>=off` switch.
- A new hook is wired in `settings.example.json`, and `tests/test-wiring.mjs` covers it.
- A change that a person would notice has a line under `## [Unreleased]` in `CHANGELOG.md`.
- A new or changed shipped file passes `node scripts/privacy-check.mjs`.

## Past bugs

- **A hook's return value became its exit code.** Trigger: a change to `out` or `emit` in `hooks/lib/hook-io.mjs`, or a hook callback that returns the result of a write. Check: a refusal still exits 0. Source: `hooks/lib/hook-io.mjs` lines 153-154.
- **A dead hook looked like a quiet one.** Trigger: a new hook, or a change to a hook's outermost `catch`. Check: the crash lets the call through and writes one line through `crashLog`. Source: `hooks/lib/crash-log.mjs` lines 1-5.
- **Two hooks saved one state file at once.** Trigger: a hook that writes a state or JSON file with `fs.writeFileSync` and not through `hooks/lib/state.mjs`. Check: the write uses the shared state helpers (own `.part` file, rename with retries). Source: `hooks/lib/state.mjs` lines 32-35.
- **"Block once" that was not once.** Trigger: a Stop hook that blocks and relies only on `stop_hook_active` to block once. Check: the block is remembered in the hook's own state for each session. Source: `hooks/verify-gate.mjs` lines 22-23.
- **A switch set in settings did not reach the hook.** Trigger: a hook that reads its switch or setting only from `process.env`. Check: it reads the settings files as well, through `hooks/lib/settings-env.mjs`. Source: `hooks/verify-gate.mjs` lines 19-21.
- **The same folder under two spellings.** Trigger: a change that compares or opens a path from a tool input, the temp folder or a worktree without `hooks/lib/paths.mjs`. Check: both sides go through the path helpers (Git Bash `/c/`, a short Windows name, a linked folder on macOS, a worktree). Source: `hooks/lib/paths.mjs` line 5; CHANGELOG 1.0.113 and 1.0.64.
- **A note on a command's first line widened "always allow".** Trigger: a change to `hooks/command-explain.mjs` or to a text that tells Claude where the explanation line goes. Check: the explanation stays the last line of the command. Source: `hooks/command-explain.mjs` line 6.
- **One session took another session's file as its own.** Trigger: a hook that reads a file that another open session can also write (a summary, the working tree's changes). Check: the hook proves that the file or edit is this session's, from its own transcript. Source: `hooks/handoff-brief.mjs` lines 250-251; CHANGELOG 1.0.81.
- **The app's own refusal was read as the user's.** Trigger: a change to code that reads a refused or cancelled tool call from the transcript. Check: a call the app turned down or cancelled is not counted as the user saying no, and a lost message is sent again. Source: CHANGELOG 1.0.106 and 1.0.66.
- **A helper stopped at its limit counted as finished.** Trigger: a change to code that decides whether a helper or reviewer is done. Check: a turn-limit stop or an empty report counts as not finished. Source: `hooks/helper-stopped.mjs` lines 2-5; CHANGELOG 1.0.74.
- **An agent file that Claude Code dropped without a word.** Trigger: a change to the frontmatter of a file in `agents/`. Check: the frontmatter is valid YAML, and `tests/test-agents.mjs` passes. Source: CHANGELOG 26.2 ("The blind reviewer loads again").
- **The plan parser read the wrong table.** Trigger: a change to how a hook or script reads a plan's rows. Check: only the rows of the plan's job table count, and a note from another row is not a claim on this one. Source: CHANGELOG 26.3.3.
- **Hook test input broken by the shell.** Trigger: a test or doc that builds hook JSON inside a shell string. Check: the JSON is built in Node or in a file. Source: `docs/full-install.md` line 161.
- **An unpinned Biome checked nothing.** Trigger: a script, test or doc that runs `npx biome`. Check: it runs `npx @biomejs/biome@<pinned version>`, as `CONTRIBUTING.md` line 36 does. Source: `CONTRIBUTING.md` line 36.
