# Test results

Two tests run in November 2026, before version 26.1. The raw runs stay on my computer: they hold my own sessions.

## The reviewer agent against a plain review

**Result: as many planted bugs found, with 40% fewer tokens, at 16% lower cost and 22% faster.**

| | Reviewer agent | Plain "review this change" |
|---|---|---|
| Planted bugs found (8 changes) | 5 | 5 |
| Cost per run | $1.13 | $1.34 |
| Time per run | 2.1 min | 2.75 min |
| Tokens per run | 214k | 357k |

- **Setup:** 16 small changes from my own projects: 8 real past commits that brought in a bug, and 8 clean ones. Each side reviewed every change once with the same model (Fable at high effort), the same tools, the same 50-turn limit and the same files; only the instructions differed: [agents/reviewer.md](../agents/reviewer.md) on one side, "review this change" on the other.
- **Graded** by a script against an answer key: a bug counts as found when a finding names its file and line and is rated above minor.
- **Per change:** the reviewer agent was cheaper on 12 of 16, used fewer tokens on 14 and was faster on 13.
- **False alarms, fixed since:** on the first run it flagged a problem in 5 of the 7 clean changes, against 3 of 7 for the plain prompt. It had been rating doubts about the request as Important; now it does that only when a realistic use would fail. Rerun on the same 7 clean changes after that fix, it flagged 2 of 7, fewer than the plain prompt. (Part of the first run's alarms came from the test itself, which showed each change as one file while the real commit also touched settings or tests; that part isn't fixed in the test yet.)

## The hooks on real sessions

**Result: over 12,000 hook runs with 0 crashes or errors, none slower than 5 seconds, and every guard right on 30 of 30 commands.**

- **Setup:** every hook ran on saved logs of real past sessions where the agent said "done" (some true, some not), on 32 made-up hard cases built from them, and on 30 shell commands for the guards.
- **Guards:** the delete, long-sleep and find guards were right on 30 of 30: each risky command was stopped and each look-alike was let through.
- **Test-run check:** "tests pass" with no test run after the last code edit was stopped in 4 of 4 hard cases.
- **Fixes it led to:** the test-run check now counts `uv run`, `poetry run`, `pipenv run` and `hatch run` test runs, and the reviewer rates a way around a guard as Important. Before the fixes, a hook sent back honest work in 4 of 12 real sessions; after them, 1 of 13. That last one changed 22 code files without a review, so the hook asked for one, which is what it's meant to do. I'm still working on getting it to 0.
