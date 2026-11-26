# Prompt audit

Finds what to cut or reword in the texts Claude reads: rules, agents, skills and the hook messages
that reach Claude. Each finding becomes one tick box with the exact old and new text. You read, judge
and list; **change nothing until the user has ticked it.**

The yardstick is the writing guide next to this file: `writing-guide/guide.md` (for skills also
`writing-guide/guide-mechanics.md`), by Matt Pocock, MIT licence in that folder. Read `guide.md` whole
before judging anything.

Work from your `claude-settings` project folder: `DECISIONS.md` and `audits/` live there. When it
does not exist, use the open folder.

## 1. Pick the texts

- **A path was given:** that file or folder only, as one group.
- **No path:** the setup's own texts in `~/.claude`, in three groups, plus a fourth when the open
  project has texts of its own:

| Group | Files |
|---|---|
| Rules and agents | `CLAUDE.md`, `rules/*.md`, `agents/*.md` |
| Skills | each `skills/*/SKILL.md` and the files it points at |
| Hook messages | the strings in `hooks/*.mjs` that reach Claude: `additionalContext`, a refusal's `reason`, text written to stderr before exit 2 |
| This project | the open folder's `CLAUDE.md`, `.claude/rules/`, `.claude/agents/`, `.claude/skills/` |

A group of more than about 15 files goes to one `worker` per group, side by side, each briefed with
this file's path, its group's files and the guide's path; you merge their boxes. A finding two groups
both report becomes one box.

## 2. Judge each text

A passage is a **finding** when it is one of these:

| Kind | Test |
|---|---|
| duplicate | The same meaning is written twice, in one file or in two that load together. Name the copy that stays |
| dead pointer | It names a file, skill, agent, hook, setting or command that does not exist. Check with Glob or Grep before you say so |
| contradiction | Two texts that load together tell Claude different things. Quote both |
| no-op | A sentence that changes nothing against what the model does by default. The fix deletes the whole sentence |
| ban only | A prohibition with no positive target, or a refusal that does not say what to do instead |
| buried step | The instruction sits behind asides, or a step has no clear done |
| weak pointer | A description or pointer that retells the body, names one branch twice, or is worded so it will not fire on its branch |
| sprawl | Material only some branches need sits inline, or a file is over a size its test sets |
| stale | It describes behaviour, a count or a name that has changed |

Mark each finding **Important** when it makes Claude act wrongly or waste a turn (a contradiction, a
dead pointer, a ban that sends Claude round in a retry, a skipped step, a file over its test's size);
otherwise **Nit** (shorter or clearer only). When the text may be there on purpose, look at its history
(`git log -L <line>,<line>:<file>` in the repo that holds it, or `DECISIONS.md` and `docs/decisions/`) and add "check
history: you decide whether …" to the box.

## 3. Write each box

One box per finding, in plain words, so it can be decided without opening the file:

```
- [ ] **<id>** (recommended) <what is wrong and what the fix gains, one sentence>
  - `<file>:<line>`
  - Old: "<the exact text>"
  - New: "<the exact text>" (or: delete)
  - Bytes: <+n or -n>
  - Test: <the test that checks this text, found by grepping the `tests/` folder of the repo or project that holds the file for a phrase of the old text, or "none">
```

"(recommended)" marks an Important finding only. Ids: R for rules, A for agents, B for skills, C for
hook messages, P for this project; numbered within each.

## 4. Save, then ask with one tick list

Write `audits/<yyyy-mm-dd>-prompt-audit.md`: what was read (the paths, and the commit where the
texts sit in git), the count of Important and Nit per group, one section of boxes per group, and a
last section "Not text" for code faults you came across. Then one `PromptForUserInput` with one
`multiSelect` per group, nothing ticked in advance, each item the box's id and sentence with its file
and line under it, Important items first; then an optional `editText` "Anything else?"
(`minLength: 0`). Outside Nimbalyst: the same items as numbered lists in the reply, and ask which numbers to
do. If nothing was found, say so and ask nothing.

## 5. Do only what was ticked

Apply each ticked box as written, in the file the setup's own rules say to change (a shipped file in
its source repo first). Run the test each box names, and a size test when a box changes bytes in a
capped file. Tick the box in the audit file. Add one line in the setup project's decision record (`DECISIONS.md` names the topic files) for the run. Reply short:
what was changed, what was not ticked. Reply in the language the user writes in.

Budget: about 40 tool calls per group.
