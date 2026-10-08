---
name: new-project
description: Set up a new or existing project folder so Claude can work in it efficiently from day one — a short CLAUDE.md, HANDOFF.md and DECISIONS.md, .claude/ rules/skills/agents folders, and a check of which installed tools (plugins, MCP servers, cheap workers) this project should use, turned on for this project only. Use when the user starts a new project, says "set this project up", "bootstrap", "new-project", or opens a folder that has no CLAUDE.md.
---

# New project setup

Goal: any project gets the same solid base, so every future session starts with the right
context and uses the right tools without being told.

## 1. Understand the project (ask, don't guess)

Look at the folder first (a file listing, `package.json`/`pyproject.toml`/etc.).
Then ask in **one** AskUserQuestion/PromptForUserInput round, with sensible defaults filled in,
each as its own question (not a tick-list):
- What is it, and who is it for? (one sentence)
- What does "done" look like for the first milestone?
- Stack and key commands (build, test, run, lint), if not obvious from the files.
- Any hard rules: sources of truth, things never to touch, style or tone.
- If the project works with data (tables, reports, loads): where the data comes from, what reads
  the result (a report, a screen, another system), how often it refreshes, and how Claude can run
  queries here (which command or connection, whether it points at test or real data, or that only
  the user can run them).

## 2. Create the base (skip what already exists, never overwrite)

| File | Content |
|---|---|
| `CLAUDE.md` | **Under 60 lines.** What the project is (2–3 lines) · `Start with HANDOFF.md, then DECISIONS.md` · key commands · folder map · hard rules, each linking to a `.claude/rules/*.md` file for details · for a data project, the step 1 answers (sources, what reads the result, refresh, how to run queries) · for any project that keeps data (a database, a log, data files): where each one lives as a full path, and the exact command that reads it with a tool that is installed · `Designs and plans live as markdown files in docs/; reply with a short summary and a link, not the whole design in chat` · which tools to use here (step 3) |
| `HANDOFF.md` | Current state, what's next, open questions. Rewritten at the end of every working session so a fresh session can pick up cold. |
| `DECISIONS.md` | Every user decision as **decision** — why · *origin, date*. It wins over older docs. Newest first per section. |
| `docs/` | Design documents and plans, one markdown file per topic. |
| `.claude/rules/` | One short file per rule area (e.g. `content-sources.md`, `code-style.md`) that is too long for CLAUDE.md |
| `.claude/skills/`, `.claude/agents/` | Project-only skills from step 3; otherwise empty for now. Add a project skill when a workflow repeats 3+ times, and a read-only reviewer agent when output quality needs an independent check. |
| `.claude/settings.json` | `permissions.allow` for the project's safe, frequent commands (test, lint, build) so they don't prompt, and `enabledPlugins` from step 3 |

Keep everything short. CLAUDE.md is loaded into every session and every line costs tokens.
An existing `CLAUDE.md` is never rewritten: add only the parts of its row that it lacks, after
showing the user those lines and getting a yes.

## 3. Pick the tools this project should use, and turn them on here only

Check what's installed (`claude plugin list` shows each plugin as enabled or disabled,
`claude mcp list`, `agy --version`, `codex login status`) and what could be added (the
`find-skills` skill, if it is installed). Many plugins are off globally on purpose, so other sessions stay small.
List your picks for the user, one line each on what it helps with, and ask once before turning
anything on. Then, for each accepted pick:
- **Installed plugin that is off:** add `"<name>@<marketplace>": true` under `enabledPlugins` in
  the project's `.claude/settings.json` (create the file or key if missing; keep other keys).
  Don't run `claude plugin enable`: that turns it on in every folder.
- **Skill not installed yet** (needs Node's `npx`; `find-skills` is where you found it): from the
  project folder run `npx -y skills add <repo> --skill <name> -a claude-code -y` (no `-g`), then check it is under
  the project's `.claude/skills/`.
- **MCP server:** `claude mcp add -s local ...` from the project folder.

Tell the user to start a new session in the project so they load. Then add a **"Tools in this
project"** section to CLAUDE.md that names only the relevant ones and when to use them. Typical
picks:

| If the project… | Tell sessions to use |
|---|---|
| uses a library or framework | **Context7** for current docs before writing code against it |
| has a web UI | Nimbalyst **Browser** to preview it and check it; if they are installed, **Playwright** to check it in a real browser and **Frontend Design** for the look; **Designeer** (https://www.designeer.xyz, a free list of design galleries, component libraries, and type and colour tools; nothing to install) for references before a new page or a redesign |
| needs UI or architecture planning | Nimbalyst **MockupLM** mockups and **Excalidraw** diagrams before building |
| has a database or data model | Nimbalyst **DataModelLM** (`.datamodel`) for the schema, kept in step with the DDL, and the matching database best-practices skill |
| has large files or docs | The big-read gate is global. Name the biggest files here so sessions go straight to targeted reads or a cheap worker. |
| takes in PDFs, Word, PowerPoint or Excel | **MarkItDown**: convert to `.md` once, keep the `.md` next to the source, and read that |
| is research-heavy | **NotebookLM** if it's set up, and any installed research agents |
| has a plan and multiple steps | **Superpowers** brainstorm → plan → build → review, and Nimbalyst **Planning** trackers |

Also add any project-specific cheap-worker routing, for example "summaries of `logs/` go to
agy or a haiku subagent". A design or plan is a good thing to get a second opinion on from
Codex or agy before building.

## 4. Finish

- Tell the user what was created and turned on, in a short table, and what to fill in (open questions).
- Don't run `/init` on top of this. It tends to pad CLAUDE.md. Keep CLAUDE.md accurate and short
  by editing it when something changes.
