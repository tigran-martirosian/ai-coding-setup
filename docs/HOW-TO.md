# How to use this setup

What the setup can do once it is installed: what each thing is for, what to type, and what you
should see. A command that starts with `/` is typed as the first thing in a message. Everything else
is plain words: say what you need.

`<projects>` below stands for the folder your project folders are in (`Projects` in your home folder
unless you chose another one). The copy of this page the installer puts into
`<projects>\claude-settings` names the real folder.

## Installing

You need Node.js 18 or newer and Claude Code. Codex (for the picture skill), Nimbalyst and Handy (voice typing)
are optional, and the installer does not install them. It does install the `claude-hud` plugin and
the `find-skills` skill, unless you add `--plugins no`, and it
adds the Claude Code settings. To have the programs put in place too, on Windows or a Mac, use
[full-install.md](full-install.md) instead (its Mac steps have not been run on a real Mac).

Download the repository as a zip from its GitHub page (the green **Code** button, then **Download
ZIP**) and unzip it, or clone it. Open a terminal in that folder.

```
node install.mjs --dry-run
```

You should see one line for every file it would copy, every hook it would add, the rules file, the
four project folders and their settings, and `Nothing was changed.` as the last line.

```
node install.mjs
```

You should see the same lines without `[dry run]`, ending with `Done. Restart Claude Code so it loads
the hooks.` Run it a second time and every file line says `unchanged`, `kept` or `already wired`;
the rules, worker, extensions, voice typing and `Done.` lines are printed again.

| Flag | What it does |
|---|---|
| `--projects <folder>` | Where the four project folders go. The default is `Projects` in your home folder; a folder given once is remembered. |
| `--codex yes` or `no` | Whether the picture skill is added (it needs Codex). Without the flag the installer looks for `codex` on the PATH. |
| `--replace-rules` | Replace a `~/.claude/CLAUDE.md` you already have. Without it a rules file with other content is left alone. |
| `--replace <name>` | Take the setup's version of one file the run listed under `Kept as yours`, for example `--replace hooks/sql-guard.mjs`. Can be given several times. |
| `--replace-all` | Take the setup's version of every file listed there, and the rules. For a computer whose old setup you don't want to keep. |
| `--extensions no` | Leave the Nimbalyst extensions out. Without it they are built and put into Nimbalyst when Nimbalyst is installed. |
| `--dry-run` | Print what it would do and change nothing. |

- **Nothing of yours is lost.** A file the installer replaces is kept next to the new one as
  `<name>.before-install-<date>`. The notes files you fill in (each folder's `CLAUDE.md`,
  `profile.md`, `finds/INDEX.md`, `HOW-TO.md`) are written only when they are missing.
- **A file you changed stays yours.** If you had a hook or a skill with the same name as one of the
  setup's, or you changed one of the setup's after installing, the installer leaves it alone. It
  ends with the list `Kept as yours` and the two flags above. A run that changed something also
  saves what it printed in `~/.claude/setup-logs`, and names any hook in your settings whose script
  is not there.
- **Got Codex later?** Install it, sign in and run `node install.mjs` again. It
  adds the picture skill to two folders.
  The installer saves the folder you ran it from as `repo` in `~/.claude/setup-state.json`, so a
  chat can find it again.
- **Updates.** Every 12 hours the setup checks whether a newer version is released and says so in one
  line. Type `/update-setup` to install it: your own skills, hooks, settings and notes stay, and a
  rules file or one of the setup's files you changed yourself is replaced only after you say yes. `UPDATE_CHECK=off` in the
  environment turns the check off; `/update-setup` still works.
- **Optional extras the rules mention.** The installer does not install these; where one is missing
  the rule that names it simply doesn't apply.
  - **uv** (provides `uvx`): converts PDF, Word and Excel files to text; also reads videos and feeds.
  - **FFmpeg**: only the picture skill's careful run needs it.
- **The Nimbalyst extensions** are built from source. In the `usage-plan` and `commands` folders under
  `extensions`: `npm install`, `npm run build`, `npm run install-ext`, then restart Nimbalyst. You should
  see a new button in Nimbalyst's left gutter. The `ink-themes` extension needs only
  `npm run build` and `npm run install-ext`, and `agents-panel` needs no npm (both below).
- **Colour themes.** The `ink-themes` extension adds eleven: eight dark ones (Ink Aurora, Ivy,
  Graphite, Tide, Ember, Noir, Cobalt, Neon) and three light ones (Ink Bone, Frost, Blossom).
  Press the **Theme** button at the bottom of the left gutter, press **Ink themes** to unfold the
  list and pick one.
- **The agents list.** The `agents-panel` extension needs no npm: in its folder run
  `node build.mjs --install`, then restart Nimbalyst. You should see the **Agents & commands** list
  in the right sidebar with running items on top and finished ones folded behind an "N finished" line.
- **Voice typing** is Handy, a free program that runs on the computer (no account). On Windows:
  `winget install --id cjpais.Handy -e`; other systems: https://handy.computer. Open it once, allow
  the microphone and download the **Whisper Large v3 Turbo** model. In its settings choose push to talk on
  Right Alt, pasting with Ctrl+V, and keeping the model loaded. Then click into a chat box, hold Right
  Alt, speak and release. You should see your words appear there. Right Alt is AltGr on many
  non-US keyboards and typing breaks while it is bound: pick another key to hold, such as Right Ctrl.

## While you work

- **Just describe the task.** You rarely have to name a skill: Claude picks the matching one by
  itself. Three run only when you type them: `/btw`, `/phone-bot` and `/shared-usage`.
- **Permission popups.** Every command Claude wants to run ends with a line that starts with
  `# WHAT THIS DOES:` and says in plain words what it does and what it changes. Read that line, then
  click Allow. If it describes something you did not ask for, click Deny and tell Claude why.
- **Questions from Claude.** They come as a small form. A question with options to pick from has
  an "Other" box (a plain yes or no does not): type your own answer when no option fits.
- **"(recommended)" answers.** Under a recommended option Claude says whether it checked something
  (`Checked:`) or it is a judgment (`Judgment:`), and when another answer would be better
  (`Other wins if:`). `Checked:` means it really looked something up in that chat: a hook rejects
  the word otherwise. Take a `Judgment:` answer as an opinion, and read the last part before you
  click. A question with no recommendation depends on something only you know.
- **"Needs you" at the end of a reply.** That is your to-do list. Anything to type or paste comes in
  a copy box, with where it goes and what you should see afterwards.
- **The Commands button** (a lightning bolt in Nimbalyst's left gutter, from the `commands`
  extension). It opens a short list: board cleanup, next move, project scan, setup audit, usage
  report, PC tidy, new project, update setup (and chat review and full review in the
  `claude-settings` folder). Press one and a new chat starts in the open project with that command. You
  should see the new chat in the sessions list.
- **The Agents & commands list** (right sidebar, from the `agents-panel` extension) shows the helpers
  and background commands Claude has started. Each row is named after its job, for example
  `Web search: library sign-in steps`; hover a row to see the full command. Click "N finished" to
  open or fold the finished ones, and drag the list's bottom edge to make it taller.
- **Reading back while Claude works.** Scroll up in the chat and it stays there while new text
  arrives (also from the `agents-panel` extension). Scroll back to the end, press the round arrow at
  the bottom, or send a message, and it follows the newest text again.
- **Big files.** `big-read-gate` refuses to read a whole file of more than 350 lines or about 20,000
  characters, so Claude reads the part it needs. To move the limits, set `BIG_READ_MAX_LINES`
  (default 350) and `BIG_READ_MAX_BYTES` (default 20000) in the environment. A file you name in your
  own message is let through once.
- **A second opinion from a capped helper.**
  Before building from a design or a plan, say "get a second opinion on this". A `worker`
  subagent (about 15 tool calls) reads it and answers, and its answer is checked.

## When a chat is busy or long

- **`/btw <note or question>`: add or correct something while Claude is working, or ask what it is
  doing, without disturbing it.** Open a second chat in the same project folder and type, for
  example, `/btw also keep the old column names` or `/btw what are you doing right now`. You should
  see one line naming the chat the note went to, or a few lines about that chat; its work is not
  touched by a question.
- **`/handoff`: continue in a fresh chat.** A long chat is slower and uses more of the plan. Type
  `/handoff`, or say yes when Claude offers it. It writes a short brief and opens a new chat that
  carries on from it. You should see the new chat on the Sessions board.
- **`/lead`: a big job with several parts.** One chat plans the work, hands each part to a subagent
  that knows the goal, has the result checked separately and reports. Claude also offers this by
  itself.

## Models

- With no model set, a fresh install sets Opus at medium effort. A new chat starts on the model you
  chose, and stays on it: the rules don't steer you to another
  model and Claude doesn't ask to switch. In the terminal that is `"model"` in
  `~/.claude/settings.json`; in Nimbalyst it is the model you picked last in the model picker.
- Helpers run Opus as well, whichever model you chat on: a weaker model uses less of the plan but
  needs more steering. Only mechanical bulk work (renames, bulk edits, scans) goes to a Sonnet helper.
- Three folders start on Opus by themselves: `ask-anything`, `internet-search`, `claude-settings`.

## Your projects

- **`/new-project`: once in every project folder you work in.** It asks what the project is and
  what "done" means, then writes the project's notes files. An existing `CLAUDE.md` is kept: Claude
  shows the missing lines and adds them after your yes.
- **`/board-cleanup`: the Sessions board is full.** It moves finished chats to Complete. To hide
  them, select the cards in the Complete column and choose Archive selected; Claude cannot archive
  for you.
- **`/setup-audit scan`:** checks one project's Claude setup and saves a report.
- **`/next-move`:** names the one most useful thing to do next. It reads your goals from
  `~/.claude/goals.md`, so write a few lines there first (what you want to reach this year).
- **`/watch`: you have a video.** Give Claude a YouTube link or a video file and a question. A script fetches the subtitles and makes sheets of timed stills (an overview of the whole video, or about 5 stills a second for one stretch); a cheap model reads them, so a video costs a few thousand tokens to look through. Needs ffmpeg.
- **`/untangle-codebase`: a codebase has grown tangled.** Run it every few weeks: it untangles the whole project in one pass so later changes read less and break less. A command only, never loaded on its own (from [caldoai/skills](https://github.com/caldoai/skills), MIT).
- **`/shared-usage`: more than one person works on the subscription.** It sets up
  [ccpool](https://github.com/hexxt-git/ccpool), someone else's open-source tool, and shows how much of
  the limits each person used. It asks for your name and two passwords. Each person types the command on
  their own computer with the same group password. The token counts go to the tool author's server;
  chat text and file names stay on your computer. Its background program starts with the computer on
  Windows; the macOS start-up has not been tried on a real Mac. An add-on: `node install.mjs --with shared-usage` adds it.

## From your phone

- **`/phone-bot`: your own Telegram bot on your computer.** An add-on: `node install.mjs --with phone-bot` adds it. Claude walks you through making the bot
  in Telegram (@BotFather) and starts it here. It starts again at log-on. Only the first person who
  writes to it becomes its owner; everyone else is ignored.
- **What you can send:** photos, files, links, notes, albums and voice notes. Each is saved in
  `~/phone-inbox`, with one line per item in `index.md`. Voice notes become text when `uv` is installed.
- **Commands in the bot:** `/help`, `/last [n]` (the latest items), `/undo` (remove the last one),
  `/new` (the chat starts afresh) and `/chat on|off` (off means save only).
- **Plain text is a chat.** Claude Haiku answers on your own subscription. It can hand a request to
  a Nimbalyst session, but only after you tap Send.
- **Questions from a session** (a choice or a permission prompt) appear as buttons in Telegram. A form
  still has to be answered at the computer.
- **`/phone`:** in any session, looks at what you sent from the phone and carries on with it.
- **To stop:** `node ~/.claude/skills/phone-bot/setup.mjs --remove`. Your inbox folder stays.

## How much of the plan is used

- **`usage`**: type this one word. A page opens in the browser, at no cost in tokens: how much of
  the week and of the 5-hour window is used, when each runs out at this pace, and which chats used
  the most. The forecast needs a day or two of readings first.
- **"will I run out?"**: the same forecast as a few lines in the chat.
- **The Usage Plan button** in Nimbalyst's left gutter (the `usage-plan` extension) opens a small
  pop-up: both limits as bars, your pace against what lasts until the reset, and when each runs out. Its "Full dashboard" button opens the whole dashboard in the main area, with
  usage by the plan's week (This week, Last week, earlier weeks, All).
- **Where the percentages come from.** The `plan-usage-logger` hook reads your saved Claude login
  (`~/.claude/.credentials.json`) and asks api.anthropic.com for the plan percentages every 5
  minutes; the login goes to Anthropic only and is not written to the log. To turn it off, set
  `PLAN_USAGE_LOGGER=off` in the environment. On a Mac the login is in the Keychain, not in that file, so the forecast stays empty.
- **`/setup-audit usage`:** the detailed numbers, saved as a file.

## The four folders for side work

Open the folder in Nimbalyst, or start Claude Code in it, and start a chat there. If you ask
something unrelated inside another project, Claude names the right folder and opens it for you.

### `<projects>\ask-anything`: anything you want to know

- Ask in plain words. Sources are named with their links.
- **A video or a page that will not open.** Paste a YouTube link and ask what the video says, or
  give the address of a page: Claude reads the subtitles or the page's text. Videos and feeds need
  the program uv.
- **"Show me how this will look"** (with Codex installed). A generated picture, about 5 minutes. You
  see it only after it passed a written checklist. Say "careful run" for a slower and stricter one.

### `<projects>\internet-search`: finding products, prices, places

- Say "find me ...". The first time it asks where you live and looks up the marketplaces,
  classifieds sites and social networks people use there. Later searches start with those.
- One thing to look up takes 5 to 7 minutes and asks nothing. Marketplaces, second-hand listings or
  a request with several parts is a hunt: it asks once for your budget, your limits and how long it
  may take (10 minutes unless you pick more), and posts what it has at half time.
- Every link in the answer is a page Claude opened: a hook in this folder blocks a reply with a link
  that was not opened. What it found is saved in the folder's `finds`.
- The pages are read through Nimbalyst's built-in browser. Without Nimbalyst Claude reads them with
  its own web tools, which more shops block.

### `<projects>\quick-tasks`: one-off file jobs

- "Convert this file", "rename these files", "split this document", a quick script. Each job gets
  its own dated folder and works on copies, so your originals stay as they are.
- Pictures work here too, with Codex installed ("show me how this will look").

### `<projects>\claude-settings`: changing the setup itself

- **`/setup-audit chat`: fit the setup to your real work.** It reads your recent chats on this computer,
  shows where Claude got in your way and which skills are missing, and sets up only what you tick.
  The chat digests are read by `worker` subagents, which use some of your Claude
  usage; the findings stay on this computer. Run it again after a few weeks of work.
- **`/setup-audit full`: one review of how the work went.** Where the usage went, which model did the work, where the reasoning and the chats went wrong, what took too long or was answered too fast, and what keeps failing. It ends in a short list of options, each with the number behind it, and changes only what you tick.
- **Adding Codex later.** If you get a ChatGPT subscription, say "add Codex" in a chat in this
  folder; the picture skill is added.
- **`/setup-audit`:** checks that the setup itself still works, and names what is loaded in every
  chat but hardly used. It asks which fixes to apply once, in one form.
- "Should we add tool X?" is a question for this folder.

## What the rules take care of

- Runs and checks things itself, and does not ask you to run a command it can run.
- Sends big reading and searching to a helper (a capped `worker` subagent on Opus), and keeps the thinking
  in the chat you are in.
- Marks finished chats Complete on the board.
