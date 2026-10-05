# How to use this setup

What the setup can do once it is installed: what each thing is for, what to type, and what you
should see. A command that starts with `/` is typed as the first thing in a message. Everything else
is plain words: say what you need.

`<projects>` below stands for the folder your project folders are in (`Projects` in your home folder
unless you chose another one). The copy of this page the installer puts into
`<projects>\claude-settings` names the real folder.

## Installing

You need Node.js 18 or newer and Claude Code. Codex, Antigravity, Nimbalyst and Handy (voice typing)
are optional, and the installer does not install them. To have the programs, the plugins and the app
settings put in place too, on Windows or a Mac, use [full-install.md](full-install.md) instead.

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
| `--codex yes` or `no`, `--agy yes` or `no` | Whether the rules use Codex and Antigravity. Without the flag the installer looks for `codex` and `agy` on the PATH. |
| `--replace-rules` | Replace a `~/.claude/CLAUDE.md` you already have. Without it a rules file with other content is left alone. |
| `--replace <name>` | Take the setup's version of one file the run listed under `Kept as yours`, for example `--replace hooks/sql-guard.mjs`. Can be given several times. |
| `--replace-all` | Take the setup's version of every file listed there, and the rules. For a computer whose old setup you don't want to keep. |
| `--dry-run` | Print what it would do and change nothing. |

- **Nothing of yours is lost.** A file the installer replaces is kept next to the new one as
  `<name>.before-install-<date>`. The notes files you fill in (each folder's `CLAUDE.md`,
  `profile.md`, `finds/INDEX.md`, `HOW-TO.md`) are written only when they are missing.
- **A file you changed stays yours.** If you had a hook or a skill with the same name as one of the
  setup's, or you changed one of the setup's after installing, the installer leaves it alone. It
  ends with the list `Kept as yours` and the two flags above. A run that changed something also
  saves what it printed in `~/.claude/setup-logs`, and names any hook in your settings whose script
  is not there.
- **Got Codex or Antigravity later?** Install it, sign in and run `node install.mjs` again. It
  rewrites the worker section of the rules and, with Codex, adds the picture skill to two folders.
  The installer saves the folder you ran it from as `repo` in `~/.claude/setup-state.json`, so a
  chat can find it again.
- **Updates.** Once a day the setup checks whether a newer version is released and says so in one
  line. Type `/update-setup` to install it: your own skills, hooks, settings and notes stay, and a
  rules file or one of the setup's files you changed yourself is replaced only after you say yes. `UPDATE_CHECK=off` in the
  environment turns the daily check off; `/update-setup` still works.
- **Optional extras the rules mention.** The installer does not install these; where one is missing
  the rule that names it simply doesn't apply.
  - **uv** (provides `uvx`): converts PDF, Word and Excel files to text; also reads videos and feeds.
  - **The `find-skills` skill**: looks for a skill that does what you ask.
  - **The `claude-code-setup` plugin**: suggests hooks and skills for a project.
  - **FFmpeg**: only the picture skill's careful run needs it.
- **The Nimbalyst extensions** are built from source. In each folder under `extensions`:
  `npm install`, `npm run build`, `npm run install-ext`, then restart Nimbalyst. You should see a
  new button in Nimbalyst's left gutter.
- **Colour themes.** The `ink-themes` extension adds five: Ink Aurora, Ivy, Graphite, Bone (the
  light one) and Tide. Press the **Theme** button at the bottom of the left gutter and pick one.
- **Voice typing** is Handy, a free program that runs on the computer (no account). On Windows:
  `winget install --id cjpais.Handy -e`; other systems: https://handy.computer. Open it once, allow
  the microphone and download the **Parakeet V3** model. In its settings choose push to talk on
  Right Alt, direct typing, and keeping the model loaded. Then click into a chat box, hold Right
  Alt, speak and release. You should see your words typed there.

## While you work

- **Just describe the task.** You never have to name a skill: Claude picks the matching one by
  itself.
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
  report, new project. Press one and a new chat starts in the open project with that command. You
  should see the new chat in the sessions list.
- **A second opinion that uses none of the Claude plan** (with Codex or Antigravity installed).
  Before building from a design or a plan, say "get a second opinion on this". The first free
  worker that is ready gives it.

## When a chat is busy or long

- **`/btw <note>`: add or correct something while Claude is working.** Open a second chat in the same
  project folder and type, for example, `/btw also keep the old column names`. You should see one
  line naming the chat the note went to. The busy chat reads the note before its next step and keeps
  going.
- **`/ask <question>`: ask about the busy chat without disturbing it.** In a second chat in the same
  folder: `/ask what are you doing right now`. You get a few lines about that chat; its work is not
  touched.
- **`/handoff`: continue in a fresh chat.** A long chat is slower and uses more of the plan. Type
  `/handoff`, or say yes when Claude offers it. It writes a short brief and opens a new chat that
  carries on from it. You should see the new chat on the Sessions board.
- **`/lead`: a big job with several parts.** One chat plans the work, runs a child chat for each
  part, has the result checked separately and reports. Claude also offers this by itself. The child
  chats show up on the board under the first one.

## Models

- A new chat starts on the model you chose, and stays on it: the rules don't steer you to another
  model and Claude doesn't ask to switch. In the terminal that is `"model"` in
  `~/.claude/settings.json`; in Nimbalyst it is the model you picked last in the model picker.
- Sonnet uses less of the plan than Opus. Routine jobs still go to a Sonnet helper and to the free
  workers whichever model you chat on.
- Three folders start on Opus by themselves: `ask-anything`, `internet-search`, `claude-settings`.

## Your projects

- **`/new-project`: once in every project folder you work in.** It asks what the project is and
  what "done" means, then writes the project's notes files. An existing `CLAUDE.md` is kept: Claude
  shows the missing lines and adds them after your yes.
- **`/board-cleanup`: the Sessions board is full.** It moves finished chats to Complete. To hide
  them, select the cards in the Complete column and choose Archive selected; Claude cannot archive
  for you.
- **`/project-scan`:** checks one project's Claude setup and saves a report.
- **`/next-move`:** names the one most useful thing to do next. It reads your goals from
  `~/.claude/goals.md`, so write a few lines there first (what you want to reach this year).

## How much of the plan is used

- **`usage`**: type this one word. A page opens in the browser, at no cost in tokens: how much of
  the week and of the 5-hour window is used, when each runs out at this pace, and which chats used
  the most. The forecast needs a day or two of readings first.
- **"will I run out?"**: the same forecast as a few lines in the chat.
- **The Usage Plan button** in Nimbalyst's left gutter (the `usage-plan` extension) shows the week's
  percentage. Click it for a small pop-up: both limits, your pace against what lasts until the
  reset, and when each runs out.
- **Where the percentages come from.** The `plan-usage-logger` hook reads your saved Claude login
  (`~/.claude/.credentials.json`) and asks api.anthropic.com for the plan percentages every 5
  minutes; the login goes to Anthropic only and is not written to the log. It has no switch: to turn
  it off, delete its three entries from `~/.claude/settings.json` (a later `node install.mjs` adds
  them back). On a Mac the login is in the Keychain, not in that file, so the forecast stays empty.
- **`/usage-report`:** the detailed numbers, saved as a file.

## The four folders for side work

Open the folder in Nimbalyst, or start Claude Code in it, and start a chat there. If you ask
something unrelated inside another project, Claude names the right folder and opens it for you.

### `<projects>\ask-anything`: anything you want to know

- Ask in plain words. Sources are named with their links.
- **`/court <question>`: a hard or contested question.** Several models answer alone and a chair
  gives the verdict. It asks first which court you want: the quick one (three answers, then the
  verdict) for an everyday question, or the full one (five answers, a blind review, then the
  verdict) when the answer has real stakes. The full court uses much more of the plan. Without
  Codex and Antigravity the court sits with its Claude seats only.
- **`/court readers <file>`: how a piece reads to different people.** For a resume, a README, a
  post or a page. Name the readers or let Claude propose three whose jobs differ (for a resume: the
  recruiter, the engineer, an outsider). Each reads it alone and says what works, what loses them
  and the one change they would make; a chair sums it up.
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

- **`/chat-review`: fit the setup to your real work.** It reads your recent chats on this computer,
  shows where Claude got in your way and which skills are missing, and sets up only what you tick.
  The chat digests are read by Codex (OpenAI) when Codex is set up; the findings stay on this
  computer. Run it again after a few weeks of work.
- **Adding Codex or Gemini later.** If you get a ChatGPT or a Google subscription, say "add the
  Codex worker" or "add the Antigravity worker" in a chat in this folder.
- **`/setup-audit`:** checks that the setup itself still works, and names what is loaded in every
  chat but hardly used. It asks which fixes to apply once, in one form.
- "Should we add tool X?" is a question for this folder.

## What the rules take care of

- Runs and checks things itself, and does not ask you to run a command it can run.
- Sends big reading and searching to a cheaper model or an outside worker, and keeps the thinking
  in the chat you are in.
- Marks finished chats Complete on the board.
