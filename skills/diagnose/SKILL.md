---
name: diagnose
description: Find the cause of a bug with a failing command first, then ranked guesses, one change at a time. Use when the user says "diagnose" or "debug this", reports something broken, failing, flaky or slow that a first look did not explain, or when a fix has already failed once.
---

# Diagnose

Shortened from `diagnosing-bugs` in
https://github.com/mattpocock/skills (MIT).

Every output you show has its secrets replaced by `<REDACTED>`. Commands read secrets from environment variables,
so the secrets stay out of what you show.

## 1. A red command first

Before any theory about the cause, build **one command** that fails on this exact symptom. In rough
order of preference: a failing case in the test file that covers the code, a script that feeds the
code a saved input and compares the output, a headless browser script, the same input run through the
old and the new version, a saved real request or log played back through the code, `git bisect run` with the
command when an older commit worked, a loop that runs the trigger many times for a bug that shows only sometimes.

Done when you have run it once, shown the command and its output, and it is:
- **red on this bug:** it checks the symptom the user described and would turn green once fixed;
- **the same every run** (for a bug that shows only sometimes: a failure rate high enough to work with);
- **fast:** seconds;
- **run by you alone**, with nobody clicking.

Reading code to form a theory comes after this command exists. If no such command can be built, say
what you tried and ask the user for what would make one possible (a saved input, a log, access).

Then shrink it: remove inputs, settings and steps one at a time, run again after each, and keep only
what the failure needs.

## 2. Three to five guesses, ranked

Write each as a prediction: "If X is the cause, changing Y makes the red command go green." A guess
with no prediction is sharpened or dropped. Show the ranked list to the user, then start testing
without waiting for an answer.

## 3. One change at a time

Each probe tests one prediction. Every debug line carries one tag, for example `[DBG-a4f2]`, so one
search finds them all at the end. A debugger or REPL, where there is one, comes before debug lines. For slowness,
measure first: a timing baseline, then bisect; debug lines rarely show where the time goes.

## 4. Fix

1. Put the shrunk failing case into the test file, at a place where the bug happens as it does for the user (its
   real callers, its real chain of calls). Its expected value comes from the user's report or the spec, never
   recomputed the way the code computes it. Watch it fail. With no such place in the code, say so in the reply: a
   bug the code cannot hold a test for is itself a finding.
2. Apply the fix and watch it pass.
3. Run the red command from step 1 on the original, unshrunk case.

**Stop after two failed fixes.** A fix is a change made here after a probe confirmed its guess; ruled-out guesses in step 3 do not count. When two fixes have left the red command red, stop fixing and call the `stuck-advisor` agent once, if the agent is installed and its calls for this session are left: brief it as its description says (the one question, the files with lines; the red command, the output's key lines, each fix and why it failed, the ruled-out guesses, cut to fit). Apply its steps as the one advised fix; an answer that names a missing fact instead counts as no fix: get that fact, then stop as below. When that fix also leaves the red command red, or no calls are left, stop: take out this run's tagged probes and fix edits only (never reset, stash or check out the tree; the red command and anything uncommitted from before the run stay), write down each ruled-out guess with the output that ruled it out, and hand off to a fresh session (handoff skill) with the red command and that list. A third fix of your own in the same context mostly retries the first two; the advised one comes from a reader outside it.

## 5. Done when

- the red command is green on the original case;
- the new test case passes;
- a search for the debug tag finds nothing;
- the reply and the commit message name the guess that was right, with the command and the output lines that show it.
