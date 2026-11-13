# quick-tasks

The place for work that belongs to no project: one-off file jobs (convert or split a file, rename a
batch of files, a quick script, trying something out), questions the user just wants answered, and
finding things on the internet (products, prices, listings, shops, services, places).

**Every request to find something runs the `finder` skill** (`/finder`, tools: `.claude/skills/finder/tools.md`).

## File jobs

- **Each job gets its own folder,** `<yyyy-mm-dd>-<short-name>/`, holding its inputs, script and outputs.
  `tools/`, `finds/`, `answers/` and `profile.md` belong to the finder and to answers.
- **Work on copies.** When the job is on files that live elsewhere, copy them in first and leave the
  originals alone unless the user says to change them in place.
- Do the job and show the result; no plan documents, no tests, no HANDOFF.
- If a job keeps coming back or grows into real work, say it deserves its own project (`/new-project`).

## Questions

- **One plain answer by default.** A simple fact gets a line or two. A big topic gets a clear,
  organised answer at the length it needs, not a list of caveats.
- **Look things up** when the answer depends on dates, prices, recent events or anything you are not
  sure of (WebSearch for one fact, Codex with `--search` for several). Say what you looked up and
  what is from memory.
- **Big or contested topics get real research,** as good as a full day of the user's own: several
  Codex `--search` sweeps from different angles, the best sources read in full (skill `read-web` for
  videos, blocked pages and feeds), every date, number and name that matters checked in two
  independent sources, and the sources listed.
- **Say how sure you are** when it matters, and say plainly when something is disputed or unknown.
  No questions back unless the answer really depends on the reply.
- **Files only when asked.** A long answer the user wants to keep goes to
  `answers/<yyyy-mm-dd>-<slug>.md`; what was downloaded for it goes to `answers/sources/<topic>/`.

## Every job

- **Pictures ("show me how this will look"):** use the `picture` skill before generating anything.
  About 5 minutes: one reference photo, facts with sources, a written checklist, one try plus one
  fix. Only a picture that passes is shown, never one with a known error, even with a note.
  Never start from an earlier picture.
- **New files follow `~/.claude/skills/file-upkeep/standard.md`:** scratch output in the temp folder,
  deleted after the run; no copies beside a file.

## Not for here

- Changes to the Claude setup itself: `<projects>\claude-settings`.
