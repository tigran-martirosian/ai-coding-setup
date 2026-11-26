# Windows and macOS, terminal and Nimbalyst

Stratus runs on Windows and macOS, in Claude Code in a terminal or inside the Nimbalyst editor. Most of it works
the same everywhere. The two tables on this page list the parts that differ. Linux is untested.

## Windows and macOS

| Part | Windows | macOS |
|---|---|---|
| Hooks, agents, rules and every skill but `/pc-tidy` | Yes | Yes |
| `/pc-tidy` (memory and leftover processes) | Yes | No: it stops and says it is Windows only |
| Plan usage forecast (`plan-usage-logger`, the Usage Plan button, the usage dashboard's forecast) | Yes | No: Claude Code keeps the login in the macOS Keychain, and the hook reads only `~/.claude/.credentials.json`, so the forecast stays empty |
| `session-cleanup` (closes what a session started) | Yes | No: the hook does nothing |
| Nimbalyst updates and patches through Stratus | Yes | No: Nimbalyst updates itself |
| `read-aloud` extension | Yes | No |
| Phone app (`phone-bot`) | Yes | No |
| PowerShell tool turned off | Yes, when Git Bash is installed | Not used |
| `PowerShell(...)` permission rules | Yes | Not added |
| Handy voice typing settings | Written by `node scripts/app-settings.mjs --handy` | Set by hand in Handy's own window |
| A file link that Nimbalyst's chat opens | `/C:/path/file.md` | `/Users/you/file.md` |
| Hooks start when Nimbalyst opens from the Dock | Yes | Give `--node <full path to node>` to the installer when Node.js is not on the app's PATH |

## Terminal Claude Code and Nimbalyst

The rules, hooks, skills and helpers work in both. What needs Nimbalyst is its window (the extensions), its Sessions
board (the board in Nimbalyst that shows each chat as a card) and its tracker (the list of a job's steps).

| Part | Terminal Claude Code | With Nimbalyst |
|---|---|---|
| Rules, hooks, skills and helpers; `/lead`'s questions, plan, build and review | Yes | Yes |
| The 8 extensions ([Extensions](extensions.md)): the Commands button with its **Note** and **Try it** buttons, the Agents & commands list, the job tracker page, the systems map graph, the Ink themes, the Usage Plan button, Board Tidy and Read Aloud | No | Yes |
| `/lead`'s job card and `/where-are-we` | No: both use Nimbalyst's tracker | Yes |
| `/board-cleanup` and Board Tidy | No: both tidy the Sessions board | Yes |
| `/btw`, a note to a busy session in the same folder | Yes | Yes, and also to a session by its Nimbalyst id, or as a new message after the current work (`--after`) |
| `/handoff` | Prints the line to paste into a new session | Opens the new session itself |
| The phone app | No | Yes, on Windows, while Nimbalyst is open |
| The Nimbalyst figures in the usage dashboard | No | Yes |
