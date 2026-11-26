# Everyday work

This page covers what you see in a normal chat with Stratus installed: how Claude answers, asks and runs
commands, and how to steer a session that is busy or has grown long.

## Asking

Say what you need in plain words. You rarely have to name a skill: Claude picks the one that fits. Five commands
run only when you type them: `/btw`, `/next-move`, `/board-cleanup`, `/design-system` and `/untangle-codebase`.

Claude sizes each request in one line before it starts:

- **Small** (one change): built in the chat and shown working.
- **Medium** (one session, a few parts): one to three questions, each with a recommended answer, then the "done
  when" lines for your OK, then the build.
- **Big**: questions, a spec and a plan first ([Big jobs](big-jobs.md)).

Reply with one word to change the size. A medium job that grows becomes a big one, and Claude says so in one line.

## Permission popups

Every shell command Claude wants to run ends with a line that starts with `# WHAT THIS DOES:` and says in plain
words what the command does and what it changes. Read that line, then click Allow. If it describes something you
did not ask for, click Deny and tell Claude why.

On Windows with Git Bash the install turns Claude Code's PowerShell tool off, because Nimbalyst's permission popup
shows only the word "PowerShell" for it.

## Question cards

When a choice is yours, Claude asks on a small form. A question with options to pick from has an **Other** box (a
plain yes or no does not): type your own answer when no option fits.

A recommended option comes with one plain reason, from something Claude checked in that chat or looked up online,
never from taste. Claude asks only what is yours to decide (what you want, look and feel, scope, timing, money).
What the files can answer, it decides and lists.

A hook holds the cards to this. It refuses a card that shows shorthand codes from a plan file that you never wrote (such as S3
or T4 for its parts), or that asks no real decision, and says what to write instead; in Nimbalyst the refused card is hidden.
Smaller faults (a choice with one option, two recommended options, a question with no box for your own answer, a
"look at this" question with no link) come back as a note to fix in the reply. Labels your project really uses (product
codes, release tiers) go in the project's `.claude/card-labels.txt`, one per line, and always pass.

## "Needs you"

A reply that leaves something for you ends with a "Needs you" list. That is your to-do list. Anything to type or
paste comes in a copy box, with where it goes and what you should see afterwards.

## A note to a busy session: `/btw`

Nimbalyst holds a new message until the running reply ends. To add or correct something while Claude works, or to
ask what it is doing, open a second chat in the same project folder and type `/btw` with your note, for example
`/btw also keep the old column names` or `/btw what are you doing right now`.

- The busy session reads the note at once. It holds only a slow or consequential next step (a helper launch, a
  question, a long command) until it has read the note.
- A session that waits on a background job, or whose reply has just ended, is woken to read it without stopping the
  job.
- A running helper gets the note too while the session waits on it, and stops early to report when the note is not
  about its job.
- A question is answered without touching the session's work.

You should see one line naming the chat the note went to, or a few lines that answer your question. The busy
session lists the notes it read under "Your notes" in its reply, and says so when a note waited 2 minutes or more.
In Nimbalyst, the **Note** button next to Send does the same with the text you typed.

## A long chat: `/handoff`

Every step sends the whole conversation again, so a long chat gets slower and uses more of your plan. Type
`/handoff`, or say yes when Claude offers it. It writes a short brief and opens a new chat that starts from it. You
should see the new chat on the Sessions board. The brief also lets you carry the work on in another assistant, such
as ChatGPT or Gemini, when your Claude plan runs out.

Claude Code compacts a chat (summarises it) at about 200k tokens, while the work runs or before the next message,
so a finished chat is left as it is.

## Reading back while Claude works

In Nimbalyst, scroll up in the chat and it stays where you put it while new text arrives. Scroll back to the end,
press the round arrow at the bottom, or send a message, and it follows the newest text again. An open question card
also stays still while helpers keep writing around it. This comes from the `agents-panel` extension
([Nimbalyst](nimbalyst.md)), on Windows and macOS. On Windows, Nimbalyst patch `1758` also changes the app's own
rule for following the end of the chat ([Nimbalyst patches](../how-it-works/nimbalyst-patches.md)).

## Text for other people

The `writing` skill is for text other people will read: emails, posts, READMEs, profiles, resumes, form answers,
pull request descriptions and release notes. It starts from the reader: who reads it, the one thing they should take
away, and the few points they came for. The rest goes to a linked page or is left out. It drafts from the facts you
give, in your own voice when you keep a few of your own texts in `~/.claude/writing-samples/`, then checks the draft
for common signs of machine-written text and fixes each one by naming the specific thing. Chat replies keep their
usual format, and a project's own writing rule wins.

## What the rules take care of

Stratus's rules (`~/.claude/CLAUDE.md`, read in every session) make Claude:

- lead with the answer;
- run and check things itself, and not ask you to run a command it can run;
- send long reading and searching to a capped helper, and keep the thinking in the chat you are in;
- ask one question with options when the choice matters;
- put every project folder under git (`git init` when it has none) and commit finished work without asking, one
  commit per piece, with only the files that session changed; push or deploy only when you say so. To stop this,
  leave the rule out: `node ~/.claude/skills/update-setup/update.mjs --leave-out "Git in every project"`;
- fix a repeated mistake in the rule that caused it;
- in Nimbalyst, mark finished chats Complete on the Sessions board (this rule comes from the `nimbalyst-notes`
  hook, which adds Nimbalyst's own rules).

To leave one rule out, see `--leave-out` on [Install options and updates](install-and-update.md#installer-options).
Rules you write yourself go in `~/.claude/rules/my-rules.md`.

## Memory

Stratus relies on Claude Code's built-in auto memory (on by default, `autoMemoryEnabled`), which keeps notes per
project under `~/.claude/projects/<project>/memory/`. `/setup-audit memory` and `/update-project` check those notes
against each project's decisions, and `/backup` backs them up.
