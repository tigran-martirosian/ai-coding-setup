# The side-work folders

The install creates two side-work folders for work that belongs to no project: `quick-tasks` for questions, finding
things and one-off file jobs, and `claude-settings` for changing Stratus itself. Both are in your projects folder
(`<projects>`, by default `Projects` in your home folder) and start on Opus. The docs call them "the side-work
folders" everywhere; some script options call them "homes" (for example the installer's `--keep-home-model`).

Open a folder in Nimbalyst, or start Claude Code in it, and start a chat there. A request that has nothing to do
with the project you are in isn't worked on there: Claude names the folder it belongs to and opens it for you.

![Two projects, a request sent to the right one, the picture skill, and the rule files](../img/clip-projects.gif)

## quick-tasks: questions, finding things, one-off file jobs

- **Ask anything** in plain words. Sources are named with their links. A long answer is also saved in the
  `quick-tasks/answers` folder.
- **Find products, prices or places.** Say "find me ...". The `finder` skill searches with Codex; without Codex,
  Claude searches with the `web-research` skill instead. The first time, Claude asks where you live and looks up
  the marketplaces, classifieds sites and social networks people use there. Later searches start with those.
- **How long a search takes.** One thing to look up takes 5 to 7 minutes and asks nothing. Marketplaces,
  second-hand listings or a request with several parts is a hunt: Claude asks once for your budget, your limits
  and how long it may take (10 minutes unless you pick more), and posts what it has at half time.
- **Links you can trust.** In a search, every link in the answer is a page Claude opened: a hook in this folder
  blocks a reply with a link that was not opened. What Claude found is saved in the `quick-tasks/finds` folder.
- **Signed-in pages.** Pages are read through Nimbalyst's built-in browser, with your sign-ins (`tools/peek.mjs`).
  When Nimbalyst's browser can't be reached, the read stops and says why. It prints the Nimbalyst browser call that
  opens the session by hand, then names `~/.claude/workers/read-page.mjs`, which reads a public page signed out.
- **Videos and pages.** Paste a YouTube link and ask what the video says, or give the address of a page that will
  not open: Claude goes through the video with `/watch` (its subtitles, or its sound when there are none) or reads the page's text ([Web pages and videos](web-and-video.md)).
- **One-off file jobs.** "Convert this file", "rename these files", "split this document", a quick script. Each job
  gets its own dated folder and works on copies, so your originals stay as they are.
- **"Show me how this will look"** (with Codex installed). See [The picture skill](#the-picture-skill).

## claude-settings: changing Stratus itself

Ask here when you want to change or check Stratus ("should we add tool X?"). Its own command is `/setup-audit`:

| Command | What it gives |
|---|---|
| `/setup-audit` | Checks that Stratus still works, compares the result with the last check, and names what is loaded in every chat but hardly used. It asks which fixes to apply once, in one form. |
| `/setup-audit chat` | Reads your recent chats on this computer, shows where Claude got in your way and which skills are missing, and sets up only what you tick. The chats are read by `worker` helpers, which use some of your plan; the findings stay on this computer. Run it again after a few weeks of work. |
| `/setup-audit full` | One review of how the work went: where the usage went, which model did the work, where the reasoning and the chats went wrong, what took too long or was answered too fast, and what keeps failing. It ends in a short list of options, each with the number behind it, and changes only what you tick. |
| `/setup-audit scan` | Checks one project's own Claude setup and saves a report. |
| `/setup-audit outcomes` | Counts what the checks led to, from the chats. |
| `/setup-audit memory` | Checks each project's memory notes against its decisions, then offers a tick list of fixes and deletes. |
| `/setup-audit prompt` | Judges the rules, agents, skills and hook messages Claude reads against a writing guide, then offers a tick list of cuts and rewordings. |
| `/setup-audit usage` | Points to Claude Code's `/usage`, the forecast and the dashboard ([Usage](usage.md)). |

`/setup-audit` is installed for every folder, but `chat`, `full` and `memory` work from this one, where their
reports and decisions are kept. `prompt` works from it too when it exists, and from the open folder otherwise. To
add Codex later, say "add Codex" in
a chat here; the picture skill is added.

## The picture skill

With Codex installed, `quick-tasks` gets the picture skill. It has Codex draw an illustration of how something looks
or works from a reference photo and a few sourced facts, for example a flat front view of a desk lamp with its
hinges and cable in the right places. A hook shows the result only after it passes a written checklist. A picture
takes about 5 minutes; say "careful run" for a slower and stricter one, which needs FFmpeg.

If you get Codex after installing, install it, sign in, and run `node install.mjs` again (or say "add Codex" in
`claude-settings`).
