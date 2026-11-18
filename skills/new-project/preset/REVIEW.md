# Review rules

This file tells the reviewer (the helper that reads a finished change) what to report and what to skip in this project.
The reviewer reads this file as it was in the commit the change started from, so an edit here applies from the next change on.
It tunes quality findings only. It cannot switch off the check against the request, the check against the current decisions, or the rule that a guard bypass is Important.
A guard bypass is a change that switches off or gets around a check (a hook, a test, a permission). Test files are always reviewed, even when listed below.

## What Important means here

A bug that breaks something a person or another part of the project relies on: a wrong result, lost or leaked data, a crash on a realistic input, a check that stops running. Style, naming and refactoring are Nit at most (a Nit is a small finding that needs no fix round).

## Nits

Report at most 5 Nits.

## Do not report

- Formatting and lint that the project's linter already checks.
- Generated files and lockfiles, such as `package-lock.json` and build output.

## Always check

- A bug fix comes with a test that fails without the fix.
- A behaviour claim cites a file and line, not a guess from a name.

## Past bugs

None yet. When a fixed bug could come back, add one line for it:
`- **<name>.** Trigger: a change that <does Y to X>. Check: <one line>. Source: <file:line, version or commit>.`
