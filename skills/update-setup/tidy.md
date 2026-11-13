# Tidy the person's own rules

Read only after the person said yes to the tidy offer. Their own rules (`~/.claude/rules/my-rules.md`, and a project folder's `.claude/rules/my-rules.md`) load in every chat beside the setup's. The bar: every line that stays changes behaviour the person wants and repeats nothing the setup already does. Nothing removed is lost: the script puts it in a vault the chat never loads, restorable one entry at a time. Decide every block yourself; ask only about an important clash (step 4).

`OWN` below stands for `node ~/.claude/skills/update-setup/own-rules.mjs`.

## Steps

1. `OWN --report --homes`: per file its path, size and `sha`, then every block (`B1..Bn`, headings included) with its key, heading, flags and first words, then the hooks the setup wires (one line each) and its `permissions.deny` list. The setup's rules, skills and agents are already in this chat. Read each own-rules file in full beside the report.
2. One shell call for what the report can't check: `command -v` on every bare command name the rules use. A `missing:<path>` flag is a dead path; a relative path is never dead (it belongs to a project).
3. Give every block one kind (below) and write, in the system temp folder (never under `.claude`, where a `rules/` file would load in every chat), a ledger (JSON, one entry per block of every file) and per file its tidied text: the kept blocks word for word, the reworded ones as their `text`, in file order, under their headings. Done when every block of the report has exactly one entry.
4. Only if a block is `clash-important`: one question card (`AskUserQuestion`; in Nimbalyst `mcp__nimbalyst__AskUserQuestion`), at most 3 questions, the 3 that touch the most replies. Each: `Your rule: "<its words>". The setup's: "<the rule's lead>".` with the options `Keep mine (the setup's rule is set aside for you)` and `Use the setup's (yours goes to the vault)`, neither marked recommended: on taste the setup has no better answer. Put the answers in the ledger.
5. `OWN --check <ledger>`. It names every fault (a block with no entry, a kept block missing from the tidied text, a missing field). Fix each and run it again until it prints `check: ok` for every file.
6. `OWN --apply <ledger>`. It keeps dated copies, writes the tidied files, the vault, the moves and the undo, and saves the ledger under `~/.claude/setup-logs`. Then, for each lead in a file's `leaveOut`: `node ~/.claude/skills/update-setup/update.mjs --leave-out "<lead>"`. Then the summary.

## Kinds, tested in this order (a block that fits two takes the first)

1. **stale**: a finished task, dated note, log, to-do or changelog → `vault`. A password, key or token is stale too; the summary tells the person to move it to a password store.
2. **project-only**: about one project or folder → `move`, `to` that folder's `.claude/rules/my-rules.md` (the folder must exist; else keep it and say why).
   **file-type-only**: holds only for some file types → `move`, `to` a new `~/.claude/rules/<topic>.md`, with `"paths": ["<glob>", …]` in the entry; the script writes them as `paths:` frontmatter (an existing file only when its `paths:` match).
   **procedure**: a step-by-step recipe over about 8 lines, needed only sometimes → `move`, `to` `~/.claude/skills/<new-name>/SKILL.md`, with `"description": "<when to use it>"` in the entry, never an existing skill's name. A line that must always hold is a rule, not a procedure.
3. **dead**: names a path, folder or shell command that the report's `missing:` flag or step 2 proved isn't there → `vault`. A Claude tool, plugin or MCP server missing from this chat is not proof: the person may turn it on in other chats, so such a line is judged by the other kinds.
4. **covered**: a setup rule, hook, skill or agent already says or does it → `vault`, `by` it. **partly-covered**: the person's wording of a setup rule plus one real addition → `reword` to the addition only. An addition is real when Claude would act differently with it than with the setup alone: one more action or case the rule must cover (a deploy beside a push, one more folder), a stricter limit. Compare the two texts phrase by phrase before calling a block `covered`. An example, a reason, or an older wording that says nothing the setup's rule lacks is not an addition, and the block is `covered`. **duplicate**: means the same as another own block → `vault`, `by` the one kept.
5. **worse**: works against a setup rule where the setup way is plainly better (correctness, safety, usage), not a taste → `vault`, `by` the rule, named in the summary. Decide this by what the line makes Claude *do*, not by how it is worded: "I want", "never", "always" turn no action into a taste. A line that changes actions (pushing, deploying, deleting, guessing instead of asking, skipping checks) and would risk work, money or wrong results is `worse`, however personal it sounds; it is never asked about. **clash-small**: a taste that differs from a setup rule on one narrow point (a format, a unit, a language, a habit) → `reword` as `Unlike the setup's <rule lead>: ...`, never asked. **clash-important**: a taste that changes what the person reads or approves on most replies (length, order, how often they are asked) → `ask`, `by` the rule, `text` the `Unlike the setup's ...` wording. Before asking, test each candidate once more against `worse` and `clash-small`; most clashes are one of those.
6. **cost**: only makes Claude work more, read more, or use a bigger model or effort, for no result the person sees → `vault`. **no-op**: something Claude does anyway → `vault`.
7. **wordy**: own and wanted, but shouty, padded or a ban with a clear positive form → `reword`, meaning kept.
8. **own**: the person's field, projects, tools, people or taste; repeats nothing → `keep`, word for word.

A **heading** (`#` line) is `keep` while a kept, reworded or asked block sits under it, else `drop`.

**Taste or cost:** a line is taste when it changes what the person reads or sees (length, tone, language, format, naming, which of two good ways); it stays. It is cost when it changes only work behind the screen and the result would be the same or worse without it; it goes. A line that is both is reworded to its taste half; the cost half goes to the vault with the original.

**The writing checks** (for sorting and for every reworded line): a no-op is cut whole, not trimmed; one meaning lives in one place, the setup's place first; a line that no longer bears on the work is sediment; say the wanted behaviour, not the ban; no capitals or exclamation marks for weight. Checks adapted from Matt Pocock's writing-for-agents (MIT).

## Ledger

```json
{ "ledger": 1, "files": [ { "file": "<path from the report>", "sha": "<the report's sha>", "out": "<absolute path of the tidied text>",
  "blocks": [
    { "id": "B1", "key": "<key>", "kind": "heading", "verdict": "keep" },
    { "id": "B2", "key": "<key>", "kind": "covered", "verdict": "vault", "by": "rule: Verify before saying done" },
    { "id": "B5", "key": "<key>", "kind": "wordy", "verdict": "reword", "text": "<new wording>" },
    { "id": "B9", "key": "<key>", "kind": "clash-important", "verdict": "ask", "by": "rule: <lead>", "text": "Unlike the setup's <lead>: ...", "answer": null },
    { "id": "B12", "key": "<key>", "kind": "project-only", "verdict": "move", "to": "<folder>/.claude/rules/my-rules.md" } ],
  "leaveOut": [] } ] }
```

- `verdict`: `keep`, `reword`, `vault`, `move`, `ask`, `drop`. `by` (`rule: <lead>`, `hook: <name>`, `skill: <name>`, `agent: <name>`, `B<n>`) for covered, partly-covered, duplicate, worse and both clashes.
- `answer`: `mine` keeps `text`; when the person's rule replaces the setup rule whole, add its lead to `leaveOut`. `setup` vaults the block (take its `text` out of the tidied file). `null` (no answer) keeps `text`, so no clash is left; it is asked again next tidy.

## Summary, a few lines

```
Your own rules: <a> lines (<x> KB) → <b> lines (<y> KB), about <t> tokens less in every chat.
- Vaulted <n>: <count per kind, in words>.
- Works against the setup, vaulted: "<first words>" (setup: <rule>).    one line each
- Reworded <n>, meaning kept. Kept as your exceptions: "<first words>" (<setup rule>).
- Moved <n>: <count> to <file>, <count> to the skill <name>.
- Vault: ~/.claude/my-rules-vault.md · put one back: node ~/.claude/skills/update-setup/own-rules.mjs --restore <V-id>
- Undo all: node ~/.claude/skills/update-setup/own-rules.mjs --undo
```

Numbers come from the `--check` and `--apply` lines. One line more per project folder's file, same shape. Important clashes beyond the 3 asked are named as kept exceptions with "say 'vault <first words>' to drop one"; on that, run steps 1, 3, 5 and 6 again with only that block vaulted. Nothing is said per kept line.
