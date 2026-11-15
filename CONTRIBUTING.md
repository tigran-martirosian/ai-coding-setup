# Contributing

Issues are welcome. Pull requests are not accepted.

The [LICENSE](LICENSE) lets you use the code and change your own copy, but not publish or share changes. So a pull request from outside can't be merged, and it will be closed. If you've found a fix, describe it in an issue: what was wrong and what you changed. That helps just as much.

## Reporting a bug

Open an issue with the bug form. It asks for:

- your system (Windows, macOS or another; Linux is untested) and its version
- the Claude Code version (`claude --version`), and the Nimbalyst version if you use it
- the setup version: the `version` in `~/.claude/setup-state.json`, or `version.json` in your copy if that file is missing
- what you did, what you expected, and what happened instead
- for a hook that crashed, its lines from `~/.claude/hooks/state/hook-errors.log`
- for a send-back you think was wrong, the hook's name and the message the agent got

Before you paste a log, take out anything private: your home folder path, names, keys and tokens.

A security problem goes through a private report instead. See [SECURITY.md](SECURITY.md).

## If you change your own copy

### Running the tests

You need Node.js 18 or newer.

```
node tests/run-all.mjs
```

`--only a,b` runs just those test files, `--failed` reruns what failed last time, and `--verbose` runs one file at a time with full output. The README's Tests section says what the tests cover and what CI runs.

### Lint and format

`npx @biomejs/biome@2.6.7 ci .` must pass; CI runs the same Biome version. `npx @biomejs/biome@2.6.7 check --write .` formats the code and applies the safe fixes. The style is 2 spaces, double quotes, trailing commas and 80 columns. A rule with 20 findings or fewer is on and its findings are fixed; a `biome-ignore` comment says why where a fix would change behaviour.

Left out of the formatter: Markdown; CSS, because tests read it as text and match the hand layout; `extensions/shared/orbs/orbs.js`, a generated, minified bundle (left out of Biome entirely); the JSON files that scripts write with `JSON.stringify` (`version.json`, `tools/nimbalyst-patch/pin.json`, `rules/history.json`, `extensions/ink-themes/manifest.json`), so a script run changes nothing; and `skills/update-setup/update.mjs`, where the privacy word list allows a word on one line number.

Rules turned off, each with more than 20 findings:

- `useTemplate`: string concatenation is the house style; style only.
- `noImportantStyles`: the themes must beat the host app's own CSS.
- `noAssignInExpressions`: assignments inside conditions and expressions, such as `if ((m = s.match(re)))` and `(o.list ??= [])`.
- `useOptionalChain`: its fix is unsafe, and a rewrite needs review.
- `noExplicitAny`: host app APIs that have no types.
- `useIterableCallbackReturn`: `forEach` arrow bodies that return a value.

### Names

Files and folders use lowercase words joined by hyphens: `link-gate.mjs`, `update-setup/`, `test-link-gate.mjs`. Each test file is named after what it tests, with `test-` in front.

A hook's name ends with what kind of hook it is:

| Ending | What the hook does | Example |
|---|---|---|
| `-gate` | Checks a step or a reply against the session log, and refuses it or sends it back with what to do | `link-gate`, `verify-gate` |
| `-guard` | Stops or rewrites a risky or wasteful command before it runs; some ask you first | `delete-guard`, `sql-guard` |
| `-check` | Looks at something when a session starts or a message arrives, and tells you about it | `update-check`, `transcript-check` |
| `-nudge` | Suggests or starts something useful and never blocks | `map-nudge`, `pc-tidy-nudge` |
| `-alert` | Tells you about something that changed | `experiment-alert` |
| `-logger` | Records numbers for later, with nothing shown | `plan-usage-logger` |
| `-brief` | Writes a brief: the handoff note, or the lines added to a helper's brief | `handoff-brief`, `map-brief` |

A hook with another name does one job that fits none of these, such as `session-cleanup` or `cold-cache`.
