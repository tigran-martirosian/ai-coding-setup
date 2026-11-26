# Nimbalyst patches

On Windows, Stratus changes some of Nimbalyst's app files to add fixes, and Nimbalyst updates through Stratus
instead of by itself. This page lists each patch and the scripts that deliver them. How to turn the delivery off
and give updates back to Nimbalyst is in
[Install options and updates](../using/install-and-update.md#nimbalyst-updates-on-windows). On a Mac, nothing is
patched and Nimbalyst updates itself ([Platforms](../reference/platforms.md)).

## How a version gets in

1. Stratus names one Nimbalyst version, with its download address, size and checksums.
2. After a Stratus update, the delivery downloads that version and checks it against those numbers. A
   download that does not match is refused. A first install starts no delivery. `/update-setup` starts one even
   when Stratus is already the newest version, if no version is waiting yet or the last delivery failed.
3. When Nimbalyst closes, or at once through one restart card in the chat, the delivery installs the version and
   applies the patches.
4. A failed delivery opens Nimbalyst again, and the next `/update-setup` tries again.

The first patch turns Nimbalyst's own updater off, so a Nimbalyst update can't replace the patched files. Every
patch run applies it first. When it can't be applied, no other patch is applied either.

## The scripts

All of them are in `scripts/nimbalyst-patch/` and are copied to `~/.claude/scripts/nimbalyst-patch/`. They are
plain Node.js scripts with no npm packages.

| File | What it does |
|---|---|
| `pin.json` | Names the Nimbalyst version Stratus delivers: its download address, its size, and the checksums of the installer and of the app files it holds. |
| `patch.mjs` | Puts the patches into Nimbalyst's `app.asar` and keeps the original as `app.asar.orig`. `--status` shows what each patch would do, `--dry-run` checks every patch and writes nothing, and `--restore` puts the original back. It refuses while Nimbalyst runs. |
| `deliver.mjs` | Downloads the pinned version, checks it, installs it and runs `patch.mjs`. `--status` gives one line on where the delivery stands. `--off` stops the delivery and puts the original app files back; `--on` starts it again. |
| `restart.mjs` | The restart card's script. It closes Nimbalyst (an unpatched Nimbalyst waits for you to quit it from its tray icon), installs and patches, and opens Nimbalyst again, also after a failed step. It never stops a process by force. |
| `ext-swap.mjs` | Puts newly built Nimbalyst extensions in place while Nimbalyst is closed. Unlike the others, it also runs on a Mac. |
| `patches/<name>.mjs` | One file per patch, listed below. |

`patch.mjs` checks each patch against the installed app before it writes anything. A patch whose place in the
code has changed is skipped and named. Each changed file must still compile, or nothing is written.

`/pc-tidy` and the `session-cleanup` hook never stop a process whose command line holds `scripts/nimbalyst-patch/`,
so a delivery that waits for Nimbalyst to close is left alone.

## The patches

The six patches named by a number are ports of fixes proposed to Nimbalyst on GitHub; the number is the pull
request. The others are Stratus's own. When the installed Nimbalyst already holds the same fix, `patch.mjs
--status` reports the patch as retired.

| Patch | What it changes in Nimbalyst |
|---|---|
| `updater-block` | Turns Nimbalyst's own updater off; "Check for Updates" says where updates come from. It adds a clean quit for the restart script, and starts the delivery when Nimbalyst quits with a version waiting. |
| `1558` | A background task that finishes while a question card waits no longer wakes the session and closes the card. |
| `1758` | The chat stops pulling you back to the bottom while a reply streams and you scroll up to read. It changes Nimbalyst's own rule for following the end of the chat. On a Mac, where no patch runs, the `agents-panel` extension alone holds the view. |
| `1792` | A permission prompt for a shell command shows the agent's one-line description above the command. |
| `1836` | Text you type while one question card waits is sent as that card's answer, instead of waiting behind it. |
| `1867` | "Jump to question" goes to the newest open question card, not the oldest. |
| `1944` | Background task results no longer cut off the agent's turn. |
| `ask-line` | Nimbalyst's built-in instructions say a question card is for a quick yes/no or pick-one; anything that needs explaining goes in the reply. |
| `card-refused` | A question card that a hook refused is hidden, so you see one card for one question. |
| `chat-smooth` | The chat glides to new rows instead of jumping, and stops bouncing while a long session loads. |
| `commit-loaded` | The commit tool is loaded with each session, so a commit no longer fails first on guessed fields. |
| `endpoint-keep` | A second click on Nimbalyst's icon no longer makes the running app look closed to its command-line tool and the phone app. |
| `files-and-agents` | The right-panel view that shows edited files and the helpers list is named "Files & agents". |
| `files-chat-follows` | The chat beside the Files view shows the session you have open in the Sessions view. |
| `home-links` | A chat link that starts with `~/` opens the real file in your home folder. |
| `phone-door` | Adds five tools the phone app needs: answer a form, stop a session, remove a queued message, answer a plan and pin a session. |
| `right-panel-menu` | The right panel's view menu no longer goes missing after a project switch. |
| `settings-batch` | Nimbalyst no longer freezes while it saves settings: changes are written once, a second after the last one. |
| `settled-repeat` | Nimbalyst stops sending Claude background task results it has already read. |
| `sync-limit-stop` | A session that reached the sync server's size limit stops sending to it, instead of being refused on every message. |
| `tool-rows-stay` | Tool and helper cards stay where they first showed when the reply's text arrives. |
| `wakeup-note` | A scheduled wakeup that fires while its session is working arrives as a note in that turn, not as a queued message. |
