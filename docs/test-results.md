# Test results

Two tests ran in November 2026, before version 26.1. The raw runs are not published, because they hold private sessions.

## The reviewer agent against a plain review

**Result: as many known bugs found, with 40% fewer tokens and at 16% lower cost.**

| | Reviewer agent | Plain "review this change" |
|---|---|---|
| Known bugs found (8 changes) | 5 | 5 |
| Cost per run | $1.13 | $1.34 |
| Time per run | 2.1 min | 2.75 min |
| Tokens per run | 214k | 357k |

- **Setup:** 16 small changes from real projects: 8 past commits that brought in a bug, and 8 chosen as clean. Each side reviewed every change once with the same model (Fable at high effort), the same tools, the same 50-turn limit and the same files; only the instructions differed: the reviewer agent's prompt of that time on one side, "review this change" on the other. That prompt reviewed a change and rated each problem by severity; today's [agents/reviewer.md](../agents/reviewer.md) checks a finished big job against its spec instead.
- **Graded** by a script against an answer key: a bug counts as found when a finding names its file and line and is rated above minor.
- **Per change:** the reviewer agent was cheaper on 12 of 16, used fewer tokens on 14 and was faster on 13.
- **Clean changes:** one of the 8 clean changes turned out to hold a real bug, which both sides found. It is left out of the false-alarm counts below, so they are out of 7.
- **False alarms, fixed since:** on the first run the reviewer agent flagged a problem in 5 of the 7 clean changes, against 3 of 7 for the plain prompt. It had been rating doubts about the request as Important; now it does that only when a realistic use would fail. Rerun on the same 7 clean changes after that fix, it flagged 2 of 7, fewer than the plain prompt. Part of the first run's alarms came from the test itself: it showed each change as one file, while the real commit also touched settings or tests. The test still works that way.

## The hooks on real sessions

**Result: over 12,000 hook runs with 0 crashes or errors, none slower than 5 seconds, and every guard right on 30 of 30 commands.**

This test ran on the hooks of that time. Two of the tested hooks, the long-sleep guard and the code-review check, were removed in 26.5. The [CHANGELOG](../CHANGELOG.md) lists every removed hook, and [reference/hooks.md](reference/hooks.md) lists the current ones.

- **Setup:** every hook ran on saved logs of real past sessions where the agent said "done" (some true, some not), on 32 made-up hard cases built from them, and on 30 shell commands for the guards.
- **Guards:** the delete, long-sleep and find guards were right on 30 of 30: each risky command was stopped and each look-alike was let through.
- **Test-run check:** "tests pass" with no test run after the last code edit was stopped in 4 of 4 hard cases.
- **Fixes it led to:** the test-run check now counts `uv run`, `poetry run`, `pipenv run` and `hatch run` test runs, and the reviewer rates a way around a guard as Important. Before the fixes, a hook sent back honest work in 4 of 12 real sessions; after them, 1 of 13. In that one session, 22 code files changed without a review, so the code-review check asked for one, which was its job.
