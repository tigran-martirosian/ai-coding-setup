# Claude Code hooks

I delegate a lot of routine work to Claude Code. These are the small scripts I wrote to keep that cheap and under control. The hooks stop wasteful or risky actions before they run, and a scanner shows where the tokens went.

I work in Claude Code inside the Nimbalyst editor, and I hand searching and long reading to the Codex and Gemini command-line tools, which are cheaper for that. I wrote the rules for how the work is split, and the hooks enforce the ones that were being skipped. [docs/setup.md](docs/setup.md) describes how I work with these tools.

## Hooks

Each hook is one Node.js script. Claude Code runs it around a tool call and passes the call as JSON.

| Hook | What it does |
|---|---|
| `big-read-gate` | Blocks reading a large text file whole (over 350 lines or 50 KB) and tells the model to read only the part it needs. The idea comes from "shunt", a Claude Code plugin in Spotify's open-source [portal-ai-plugins](https://github.com/spotify/portal-ai-plugins) that keeps large file reads away from the main model to save tokens. |
| `worker-nudge` | Blocks the first try at a search subagent and points to the Codex or Gemini command-line tools instead. The same call tried again goes through. |
| `context-guard` | Warns when a session passes 200k tokens and suggests a fresh one. |
| `command-explain` | Blocks a shell command that doesn't end with a plain-words comment saying what it does. |
| `question-other` | Makes every multiple-choice question include a free-text answer. |
| `sql-guard` | Asks for confirmation before DROP, TRUNCATE, or DELETE and UPDATE without WHERE. |
| `handoff-brief` | After each reply, writes a short brief of the session so a new one can continue from it. |

Every hook fails open: on an error or input it doesn't understand, it lets the call through. Each can be switched off with an environment variable named at the top of its file. To see what a hook looks like, start with `hooks/worker-nudge.mjs`, which is under 70 lines.

`question-other` and `command-explain` are written for the Nimbalyst editor. The other five don't depend on the editor.

## Usage scanner

`scripts/usage-scan.mjs` reads the session transcripts and reports tokens per session and per subagent, and how often each hook blocked something. It showed me that one search subagent run used 0.6 to 4.3 million tokens, which is why `worker-nudge` exists.

```
node scripts/usage-scan.mjs --days 7
```

Over my last seven days of sessions (up to October 1, 2026) it counted 11 whole-file reads stopped by `big-read-gate` and 3 search subagents stopped by `worker-nudge`.

## Install

Needs Node.js. I run them on Windows, and the tests run on Windows too. Copy the files in `hooks` to `~/.claude/hooks` and merge `settings.example.json` into `~/.claude/settings.json`. The worker agent in `agents` and the handoff skill in `skills` go to the folders of the same name under `~/.claude`.

## Test

```
node tests/run-all.mjs
```

Eight test files run the hooks and the scanner as separate processes on made-up input. No model is called. They also run on GitHub Actions on every push.
