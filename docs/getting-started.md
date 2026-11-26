# Getting started

This page takes about five minutes. It starts where the installer stops and walks you through a first small job
and a first big one, so you know what Stratus adds to a normal Claude Code session and what you should see.

If you have not installed Stratus yet, follow the install section of the [README](../README.md) first.

## 1. Restart and open a folder

The installer ends with `Done. Restart Claude Code so it loads the hooks.` Close Claude Code (or Nimbalyst) and
open it again. The hooks, rules and skills load only at the start of a session.

To check that the hooks are in place, run this in Git Bash or a Mac terminal. Its output should contain
`(no note given)`:

```
echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | node ~/.claude/hooks/command-explain.mjs
```

A hook that fails while you work writes one line to `~/.claude/hooks/state/hook-errors.log`.

Then open a folder to work in:

- For a code project, open its folder in Nimbalyst, or run `claude` in it from a terminal. In a terminal, question
  cards appear as Claude Code's own prompts, and the Sessions board (Nimbalyst's board of chats by stage), the job tracker and the editor's buttons are not
  there ([what differs](reference/platforms.md#terminal-claude-code-and-nimbalyst)).
- For a quick question or a one-off file job, open `quick-tasks` in your projects folder (`Projects` in your home
  folder unless you chose another). The installer made it for you.

## 2. Send a first message

Ask for something small in plain words, for example "add a test for the sign-in form's empty-password case" or
"what does this CLI's `--force` flag do?". You don't have to name a skill: Claude picks the one that fits.

What you should see:

- **A size line first.** Claude sizes each request in one line: "Small: doing it now", "Medium: 2 questions first"
  or "Big: questions, then a plan". Reply with one word to change the size.
- **A plain-words line on each command.** When Claude wants to run a shell command, the permission popup shows the
  command with a last line that starts with `# WHAT THIS DOES:`. Read that line, then allow or deny. (If you turned on auto mode during the full install, a second model checks each command instead of asking you, and only risky commands show a popup; you can still see the line on each command card.)
- **A "Needs you" list at the end** when there is something for you to do. Anything to type or paste comes in a
  copy box, with where it goes and what you should see afterwards.

In a folder that is not set up as a project yet, the first reply of the day also asks, on a question card (a small
form with options, step 3), whether to set the folder up with `/new-project`. The options are Yes, Not now, Never here and Never in any folder. Pick
Yes for a project you will come back to: Claude asks what the project is and what "done" means, then writes the
notes files that the next sessions start from.

## 3. Answer a question card

When a choice is yours, Claude asks on a small form instead of guessing. A question with options has an **Other**
box for your own answer. An option marked "(recommended)" comes with one plain reason that Claude checked in this
chat, not a matter of taste. Questions that the files can answer are not asked: Claude decides those and lists
them.

## 4. Try a big job

Describe something with several parts, for example "add a checkout page to the web app with card and invoice
payment". Claude sizes it as big and does three things before any code is written:

1. **Questions.** The `grilling` skill first looks for code or a package that already does part of the job, then
   asks its questions in rounds: open questions as plain text, quick picks on a question card.
2. **A spec.** It writes a spec file in which each "done when" line has a check that proves it.
3. **A plan.** The `lead` skill writes the plan as numbered slices, has it reviewed once, and asks for one OK on
   the spec and the plan together.

After your OK, helpers build the slices, an independent reviewer checks the result against the spec, and the end
report shows each "done when" line with its proof. [Big jobs](using/big-jobs.md) explains each step.

**In Nimbalyst, use `/effort`, not the effort picker.** The install clears Nimbalyst's effort hand-over so each
helper can run at its own effort level. Type `/effort` in the chat to change the main session's effort.

## 5. Check your usage

Type the single word `usage`. In a terminal, a page opens in your browser; inside Nimbalyst, the data is refreshed
and Claude says where to click to see it. The page shows how much of the week and of the 5-hour window is
used, when each runs out at your current pace, and which chats used the most. Opening it costs no tokens. The
forecast needs a day or two of readings before it shows. On a Mac, the plan figures and the forecast stay empty,
because Claude Code keeps its sign-in in the macOS Keychain ([Usage](using/usage.md)).

## What Stratus changes compared with plain Claude Code

| | Claude Code with a few skills | With Stratus |
|---|---|---|
| Claude's claims | Nothing checks them | Hooks check a reply against the log of what Claude did |
| Before a big job | Claude starts building | Questions first, then a spec with a check for each line |
| Big jobs | You arrange the helpers | `/lead`: a reviewed plan, helpers side by side, one end review |
| Long chats | Compacted when nearly full, or by hand | Compacted at about 200k tokens during work; finished chats are left alone |
| Spending | `/usage`: the last 24 hours and 7 days | Per project, with a forecast of when you reach your limit |
| Security | Reviews you ask for | A review as Claude edits, a quick check before a release, a deep scan on request |

## Next

- [Using Stratus](HOW-TO.md): what to type for each task and what you should see.
- [Reference](reference/skills.md): every command and skill on one page.
- [All the docs](README.md): the pages on using Stratus, how it works and the reference.
