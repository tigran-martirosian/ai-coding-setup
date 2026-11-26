# Extensions

Stratus has 8 extensions for the Nimbalyst editor. The installer builds 7 of them and puts them into Nimbalyst
when Nimbalyst is installed. The 8th, `read-aloud`, needs its own speech program, so you add it with
`node install.mjs --with read-aloud`.

`--extensions no` leaves all of them out. To turn one off, use Nimbalyst's extension settings.

| Extension | What it does | Where you see it |
|---|---|---|
| `agents-panel` | Shows helper agents and background commands while Claude works, running ones on top, with the model and effort each helper runs on. It also keeps a chat you scroll up in where you put it while a reply streams (on a Mac, nothing else does this), keeps an open question card still, and keeps the commit panel inside a narrow sidebar. | The Agents & commands list in the right sidebar |
| `board-tidy` | Archives old sessions on the Sessions board a minute after Nimbalyst starts and then every hour. Nothing is deleted. Needs Node.js 22.5 or newer. | No button; it runs by itself |
| `commands` | Opens a short list of the most used commands, such as lead, grill me, setup audit and disk tidy, and starts a new session in the open project with the one you pick (14 in all). It also adds the **Note** and **Try it** buttons next to Send, and line comments on diffs in Review. | A button in the left sidebar |
| `ink-themes` | Adds eleven colour themes that share one look: the Figtree font, 8px corners and hairlines instead of shadows. | Nimbalyst's theme list |
| `job-tracker` | Turns Nimbalyst's tracker into one page per project with the job in hand: what needs you, what is running and what is left. | The tracker |
| `read-aloud` | Reads Claude's replies aloud with the Kokoro speech model, which runs on your computer. An add-on, Windows only. | A button under the last reply |
| `systems-map` | Opens the project's systems map full screen as a graph of its parts and the links between them. | A button in the left sidebar |
| `usage-plan` | Shows this week's and the 5-hour limit's plan usage as bars, a forecast, and a link to the full usage dashboard. | A button in the left sidebar |

A session's phase is the stage it sits in on the Sessions board: Backlog, Planning, Implementing, Validating or
Complete. A session with no phase has not been given one. Board Tidy archives a session after this long with no
activity:

- Complete: 3 days.
- No phase: 14 days.
- Planning, validating or implementing: 30 days.
- Backlog: never.

Pinned, running and worktree sessions are never archived. The installer puts the `quick-tasks` folder on Board
Tidy's keep list (`~/.claude/board-tidy.json`), so its sessions stay.
