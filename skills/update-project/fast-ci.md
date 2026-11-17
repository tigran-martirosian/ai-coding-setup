# CI speed pass

A project pass sends a project here when its CI takes over 5 minutes at the median (P26 in
[`checks.md`](checks.md)). Goal: CI that is fast and still proves all it proved before. Each change goes
on its own branch and pull request, as the project's `Git:` line says.

## 1. Time it first
Before any change, read the last 20 completed runs of the workflow the pass named:
`gh run list --workflow <file> --status completed --limit 20 --json databaseId,conclusion,createdAt,updatedAt`.
Count only runs that did the work (`success`, `failure`, `timed_out`). Take the median run and the
slowest run, and read each one's jobs and steps with `gh run view <id> --json createdAt,jobs` (each
job and step has `startedAt` and `completedAt`). Put every job's time in one of three buckets:
- **waiting**: from the run's `createdAt` to the job's start (a queue for a runner, or `needs:` on
  another job);
- **setup**: checkout, toolchain, install, cache restore, a build the tests need;
- **running**: the test, lint and type-check steps.

Done when a table shows each job's three buckets at the median and at the slow end, and names the
biggest bucket.

## 2. Fix the biggest bucket first
One change at a time, biggest bucket first:
- **waiting**: jobs chained by `needs:` that can run side by side; a matrix wider than the platforms the
  project ships to.
- **setup**: a dependency cache keyed on the lock file (the `cache:` input of `actions/setup-node` or
  `actions/setup-python`); install only what the job uses; build once and hand the result on as an
  artifact.
- **running**: tests in parallel on all the runner's cores. vitest, jest and `node --test` run files
  side by side by default: check that nothing turns it off (`--runInBand`, `--maxWorkers=1`,
  `--test-concurrency=1`, a one-thread pool). pytest needs pytest-xdist and `-n auto`. Then split the
  suite into jobs by each file's recorded time, from a timings file refreshed from CI runs, so the jobs
  end close together; a file with no time yet goes to the shorter job. `pytest-split` does this;
  `--shard` in jest and vitest splits by file count, so a long file needs a small script that splits by
  time.
- **the CI workflow**: a new commit cancels the outdated run (`concurrency:` with
  `group: ${{ github.workflow }}-${{ github.ref }}` and `cancel-in-progress: true`). A deploy or release
  workflow always runs to the end: cancelled halfway, it leaves a half-done release.

A faster tool (a linter, a type checker, a package manager) replaces a slow one only when the table shows
that step is slow. Tests run on the runtime the code ships on (a Node project's tests stay on Node).

## 3. What stays true
- **The full suite runs before code reaches main**, on every pull request. After a split, the jobs'
  file lists together hold every test file: check it.
- **Green means the code works.** A check that needs a retry has a bug: find it and fix it (a race, a
  shared file, a time limit that fails under load; test the behaviour, not the wall clock). Retries,
  longer timeouts and skipped tests never make a run green.
- **A "changed tests only" mode** (`vitest --changed`, `jest --onlyChanged`, pytest with the
  pytest-testmon plugin, `pytest --testmon`) is quick feedback while working, beside the full suite.
  `pytest --lf` is a different thing: it reruns the last failures. Prove a changed-only mode once
  before anyone trusts it: break a line a test covers, as an uncommitted change, run the mode and see
  it go red; then put the line back.

## 4. Numbers for each change
Each change carries its bucket's time before and after, from real CI runs, in its pull request body:
"setup 2m 10s -> 40s, median of 5 runs". A change that does not move its bucket is reverted.

Done when the median run is under 5 minutes, or the table shows that what is left is the tests running
in parallel and split by time. Reply: the table before, the table after, and each change with its numbers.
