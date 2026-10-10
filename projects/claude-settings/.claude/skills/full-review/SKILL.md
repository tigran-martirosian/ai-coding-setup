---
name: full-review
description: One review of how the work with Claude went over the last days - where the usage went, how the work was split between models and agents, where the reasoning and the chats went wrong, what took too long or was answered too fast, what keeps failing - ending in a list of measured options (another split between models, more work for helpers, a plugin or skill to add, a setup change, a fix) from which the user ticks what to do. Use when the user says "full review", "review everything", "review how we work", "what should we change", "why is this so inefficient", or runs /full-review (optional - a number of days, or a project name).
---

# Full review

The one review that ends in choices. `/usage-report` gives numbers only, `/setup-audit` checks that the
setup is healthy, `/chat-review` fits skills to the work; this runs their scanners together, adds what
they don't measure, and turns the result into options with a number behind each.

Scripts and a free worker do the reading; you judge and ask. **Change nothing until the user has
ticked it.** Never open chat records yourself. The free worker (Gemini or Codex, whichever is set up)
reads the chat digests: say so before step 3. No sentence from a chat goes into a rule, a skill, a web
search or the report.

`$S` is `.claude/skills/full-review`, `$C` is `.claude/skills/chat-review`, both in this folder. Days
default to 7; pass the user's `--days N` or `--project <name>` to all three scanners.

## 1. Last time

Open the newest `audits/review-*.md` (not the `-numbers` file) and read only its **Decided** and
**Still open** tables. What was declined is not offered again unless its number moved a lot, and then
say by how much. What was done is measured this time: did it move the number it was meant to move.

**A review younger than about five days:** say so in one line before step 2. Most of the same days get
scanned again and what was ticked then cannot be measured yet, so this run only looks for what is new:
decisions of that review stand, the split between models is not asked again, and the report names the
first day a measurement makes sense.

## 2. Numbers (one shell call)

`bash $S/numbers.sh --days N` runs `~/.claude/skills/usage-report/usage-scan.mjs` and
`$S/review-scan.mjs` and writes both reports to `audits/review-<date>-numbers.md` (`-2-numbers` when the
day already has one; it prints the name). Read that file
(about 250 lines) in two parts.

- usage-scan: totals, top sessions, subagents by type and model, workers, hook blocks, what gets used,
  wasted requests.
- review-scan (main chats only): the kind of work per request and the what-if table; where the time of
  each turn went; quick answers and long turns the user pushed back on, interrupted replies; the size
  of the hidden thinking; failed tool calls.

"Weight" is the rough plan weight (cache reads 0.1x, output 5x, Haiku 1, Sonnet 3, Opus 5, Fable 12.5).
Take every number in the report from this file. Don't do arithmetic by hand: if a figure is missing,
run the scanner again with other options (`--project`, `--top`, usage-scan's `--session`).

## 3. Chats (start it, then go on with step 4)

`node $C/chat-scan.mjs --days N`, then `node $C/read-digests.mjs <digest folder>` in the background
(timeout 600000). It writes `<project>.findings.md` next to each digest. Headings B (went wrong),
C (questions that missed), G (reasoning) and H (pace: LONG or SHORT) are the ones this review uses.
A project reported as FAILED: give one `worker` subagent that digest and `$C/reader-task.txt`.

## 4. Health

Step 3 of `~/.claude/skills/setup-audit/SKILL.md`, in as few shell calls as possible: every test suite
(the command that skill gives), the hook files that
`~/.claude/settings.json` names exist, `~/.claude/workers/ask.mjs --status`.

## 5. Judge (this stays with you)

Seven sections, each two to six lines. A scanner's "pushed back" list and the reader's lines are
leads: before one becomes a finding, check it in the digest (Grep the chat label, Read those lines).
Something counts when it was seen in two or more chats, or once at a cost you can name. Where the
numbers don't show a cause, write "cause not measured" instead of guessing one.

1. **Where the usage went:** the total against last time, the top projects and sessions, main chats
   against subagents, the share that is the context sent again.
2. **Who did the work:** the share per model; subagents by type and model (which ran on the leading
   model that a cheaper one could have run); did the free workers take the gathering; the looking and
   building stretches.
3. **Reasoning:** reader heading G, checked. Plus the thinking numbers (how much, at which effort
   setting, in which turns), and whether the turns with the most thinking are the ones that went wrong.
4. **Chats:** reader headings B and C, checked; questions answered in the user's own words; requests
   sent more than once; interrupted replies.
5. **Too long:** the turns that took longest and where their time went; the time by project; reader
   heading H marked LONG.
6. **Too short:** quick answers the user pushed back on; reader heading H marked SHORT.
7. **Failing:** failed suites, tools with a high failure rate, the most frequent errors, failure
   streaks, failed worker calls, hooks whose blocks cost more than they save.

## 6. Options

Turn findings into options. **An option with no number from this review behind it is not offered.**
Each one names: what was seen (the number), the change, what it should move and by about how much
(a range, from the scanners), what it costs or risks, how to undo it. Grep `DECISIONS.md` for each
before offering it: a decision the user made stands unless the number behind it changed, and then the
option says "decided on <date>, the number is now <x>". At most 12, the largest effect first.

**Sort a repeated correction before offering it.** One that a script can check (a fixed pattern, a
banned command, where a file goes) is offered as a hook with its test. One that needs judgment is
offered as a rule. A rule is for what no script can check.

| Kind | Offer it when | Where the number comes from |
|---|---|---|
| **Another split between models** (who leads, who does the work) | always, as one question | the what-if table, as it is; say that it assumes the same requests |
| **More work for helpers** (free worker for looking, Sonnet helpers or `/lead` for building) | looking stretches over 5% of the weight, or building stretches over 25% | "Could have gone to a helper", the low and the high end |
| **A cheaper model for a subagent type** | a type that ran on the leading model with routine work | usage-scan, "Subagents by type" |
| **A plugin, skill or tool to add** | a kind of work nothing in the setup covers, seen in two or more chats (reader heading E, or a tool that keeps failing) | look it up as in step 4 of `$C/SKILL.md` (`claude plugin list`, `npx skills find`, one web lookup); read its own page before offering it |
| **A setup change** (a rule, a hook, what is loaded) | a hook whose blocks cost more than the mistakes it stops; a rule that causes requests; a correction made twice | "Wasted requests", reader headings B and F |
| **A fix** | a failing suite, a tool failing in over 20% of its calls, an error seen 10 times or more | "Tool calls that failed", step 4 |
| **Something only the user can change** (how a job is asked for, attachments, when to start a new chat) | the cost comes from the request itself | the longest turns, sessions past 200k |

## 7. Save

`audits/review-<date>.md` (add `-2` if it exists): the seven sections, each with its numbers; the
options; a **Decided** table (option | ticked, declined or open | where it went), filled in after
step 8; **Still open** (what to measure next time). Findings in your own words, no quotes from chats.

## 8. Ask once

One `PromptForUserInput`:

- a `singleSelect` "Who leads and who does the work", `allowOther: true`, one option per row of the
  what-if table that is worth choosing, each with its weight against now in the description. Mark one
  "(recommended)" only as `~/.claude/CLAUDE.md` allows (`Checked:` or `Judgment:`, `Other wins if:`);
  when it comes down to how much quality the user will trade for usage, recommend nothing and say so.
- a `multiSelect` with the other options, nothing ticked in advance, the largest effect first.
  **title:** the change in plain words. **subtitle:** what was seen, what it should move, what it costs.

If nothing counted, say so plainly and ask nothing. If the form is lost or interrupted, never show it
again: list the options as text and change nothing.

## 9. Do what was ticked, then record

As `.claude/rules/changing-the-setup.md` says (the live file first, its test, fixed at the root), and a
ticked change in another project's setup files is made directly. A program or plugin: ask before each
install. Then fill the **Decided** table, add one line per decision to `DECISIONS.md`, rewrite
`HANDOFF.md`.

## 10. Reply

The verdict in two sentences, then one short section per heading of step 5 that has a finding (skip
the empty ones), then what was done, then what waits on the user. Link the report.

Budget: about 35 tool calls. The scanners and the worker do the reading; you read only the numbers
file, the findings and the digest lines you check.
