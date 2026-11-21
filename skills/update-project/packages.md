# Package upkeep (monthly)

A pass, or the person, sends a project here to update its packages. Goal: nothing goes stale, and
the person hears about it only when a choice is theirs. Work in each package folder the note names.

**Skip a folder** whose package files already show in `git status --porcelain` (someone's change in
progress; an undo would wipe it), or that is git-ignored, vendored or an old copy; name it in the Upkeep line.

## The test command
The project's own: the `Checks` section of its `CLAUDE.md`, else `npm test` when `package.json` has a real
`test` script, else `pytest` when a `tests/` folder exists. None found: change nothing; name the outdated
packages in the reply only ("no tests to prove them"), no card.

## 1. Small updates: silent
Same major version, released at least 7 days ago (`date -d '7 days ago' +%F` gives the date).
- npm (`package-lock.json`): `npx --yes npm-check-updates --target minor --cooldown 7 -u`, then `npm install`.
  pnpm or yarn lock: the same check, then `pnpm install` or `yarn install`.
- uv (`uv.lock`): `uv lock --upgrade --exclude-newer <date> --dry-run` lists the changes. Upgrade only the
  same-major ones: `uv lock --exclude-newer <date> --upgrade-package <name>` for each, then
  `uv sync --exclude-newer <date>`. Major changes go to the card.
- `requirements.txt` with `==` pins: for each pin, the newest same-major release at least 7 days old, from
  `https://pypi.org/pypi/<name>/json` (`releases`, `upload_time`). No pins, or a `pyproject.toml` with no
  lock: list the newer versions in the reply only, change nothing.

Then run the test command. Green: keep. Red: undo the folder's package files (`git checkout -- <files>`; the
skip rule above makes this safe), reinstall, and say "packages left as they were: tests failed" in the Upkeep
line. No commit of its own: the change goes in the session's next commit, like any other edit.

## 2. Security: at once
- npm: `npm audit --omit=dev`; a high or critical problem.
- Python: `uv export --no-hashes --format requirements-txt -o <temp>/req.txt` (or the `requirements.txt`
  itself), then `uvx pip-audit -r <that file> --no-deps --disable-pip`; any finding (it gives no severity).

Told in the reply's first lines, with the package and the fix; the fix goes through the same test rule.

## 3. Big updates: one card
New major versions, at least 7 days old (`npx --yes npm-check-updates --target latest --cooldown 7`; for
Python, the uv dry run above or PyPI). Leave out each package the person skipped before at the same or a
newer major: `~/.claude/package-skips.json`, `{"<project folder>": {"<package>": "<major>"}}`.
Nothing left: no card. Else one `mcp__nimbalyst__PromptForUserInput` form with one `multiSelect` (one item
per package, "vite 7 → 8", nothing ticked); elsewhere a numbered list in the reply and ask which numbers.
- Ticked: update it, run the tests, undo it when red and say so.
- Not ticked: write its major into `package-skips.json`; it is asked again only when a newer major comes out.

## The Upkeep line
One part: "N packages updated, tests green", "packages left as they were: tests failed", or "packages up to
date"; plus "M big updates asked" when the card went out, and any skipped folder.
