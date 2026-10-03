---
name: chat-review
description: Review the user's recent chats on this computer to see what they work on, where Claude got in the way (questions whose options missed, answers the user corrected or interrupted, requests they had to repeat, tools that failed) and which skills or tools are missing for that work, then show a tick list and set up only what the user ticks. Use when the user says "review my chats", "what am I missing", "fit the setup to my work", "find skills for my projects", or runs /chat-review (optional - a number of days, or a project name).
---

# Chat review

Fits the setup to what the user really does. A script and the Codex worker do the reading; you
judge, look up what exists, and ask. **Change nothing until the user has ticked it.** No chat text
goes into a rule, a skill, a report or a web search, and no report is sent to anyone. The only
reader besides you is the Codex worker (OpenAI), the same one that reads long files: when Codex is
set up, it reads the chat digests, so tell the user that before the scan.

`$S` below is `.claude/skills/chat-review` in this folder.

## 1. Scan

`node $S/chat-scan.mjs` (with `--days <N>` or `--project <name>` when the user gave one; the
default is 14 days and the 4 busiest projects). It prints one line per project and writes one
digest per project to `~/.claude/reports/chat-review/<date>/`. Never read the chat records yourself.

Then read the "Decided" table of the newest `~/.claude/reports/chat-review/findings-*.md`, if there
is one: what was declined is not offered again, and what was set up is checked, not set up twice.

## 2. Read the digests

`node $S/read-digests.mjs <digest folder>` (Bash, timeout 600000). It gives every digest to the
Codex worker at the same time, with the fixed questions in `reader-task.txt`, and writes
`<project>.findings.md` next to each digest. A project with fewer than 5 requests is skipped.

Read only the `.findings.md` files. If a project is reported as FAILED, give one `worker` subagent
that digest and the text of `reader-task.txt` (it reads the digest in parts), and say that it was used.

## 3. Judge (this stays with you)

Codex's lines are leads. Before a finding becomes a proposal, check it in the digest: Grep the chat
label, then Read those lines.

**What counts:** something seen in two or more chats; or once, when the user said "always" or
"never" about it; or a question whose options missed (once is enough: the fix is cheap). A one-off
slip that no rule would have prevented is listed under "seen, nothing to change", not turned into a rule.

Give each finding that counts exactly one remedy, the smallest that fixes it:

| What was seen | Remedy |
|---|---|
| The user corrected the same thing more than once | One line in that project's `CLAUDE.md`, in the user's own terms. In `~/.claude/CLAUDE.md` only when it showed up in two or more projects |
| A question whose options missed, or that asked what the notes already said | The answer goes into the project's `CLAUDE.md` or `DECISIONS.md` as a standing fact, so it is not asked again |
| The same task asked for three or more times, done in the same steps | A small skill in that project's `.claude/skills/<name>/`, written from the steps that worked |
| A kind of work nothing in the setup covers (a file format, a service, a kind of analysis) | A skill, plugin or tool that already exists: see step 4. A new one is written only if none fits |
| "Never do X", said and meant | A hook in the project (a small script and its test) |
| A tool that kept failing or a program that was missing | The fix, or the program named with what it is for |

## 4. Look up what already exists (only for the remedies that need it)

In this order, and stop at the first that fits:

1. Installed but turned off: `claude plugin list`.
2. Skills: `npx skills find "<two or three plain words for the kind of task>"`.
3. One Codex `--search` run: "skills, plugins or tools for <kind of task> in Claude Code".

Search words describe the kind of task in general words; never a name, a table, a file or a
sentence from the chats. Before proposing a find, read its own page or `SKILL.md`: what it does,
who made it, what it loads into every session. Don't propose what you have not read.

## 5. Ask: one tick list

One `PromptForUserInput` with one `multiSelect`, nothing ticked in advance, at most 12 items, the
strongest first. Each item:

- **title:** the change in plain words, starting with the project's name ("reports: a skill for ...").
- **subtitle:** what was seen (how many times, in which week), where the change goes (that project,
  or everywhere), and what it costs if anything (a program to install, text loaded in every chat).

If nothing counted, say so plainly and ask nothing. Don't pad the list.

## 6. Set up only what was ticked

- **In the project it belongs to:** its `CLAUDE.md`, its `.claude/skills/` and `.claude/settings.json`
  (`enabledPlugins`), `claude mcp add -s local`. Only these setup files; never the project's own work.
- **Global** only for a rule that showed up in two or more projects. Save a dated copy of
  `~/.claude/CLAUDE.md` first (`CLAUDE.md.bak.<yyyymmdd>-chat-review`).
- **A program:** ask before each install, with what it is for.
- **A new skill:** short, in the project, with a description that says when to use it.
- Check each change once: the rule is there exactly once, the skill is listed, the hook answers its test.

## 7. Save and reply

Write `~/.claude/reports/chat-review/findings-<yyyy-mm-dd>.md`: for each project one line on what
the work is, then the findings in your own words (no quotes from the chats), then a **Decided** table
(proposal | ticked or declined | where it went), then "seen, nothing to change".

Reply short: what was set up and where, what was declined, and which of it needs a new chat (a rule
in a `CLAUDE.md` is read when a chat starts; skills and hooks are picked up by running chats). Add
one line to this folder's `DECISIONS.md` per change. Reply in the language the user writes in.

Budget: about 30 tool calls. The scan and Codex do the reading; you read only findings and the
digest lines you check.
