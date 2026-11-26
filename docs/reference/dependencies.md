# Dependencies

This table lists the programs Stratus uses, what needs each one, and whether the installer gets it for you. The
[full install](../full-install.md) installs Nimbalyst, Node.js, Git and uv on every computer, and Codex and ffmpeg
when you have a ChatGPT subscription. `node install.mjs` on its own installs none of these programs, with one exception: on Windows, with the phone app
add-on (`--with phone-bot`), it starts a background download of uv (through winget, when uv is missing) and of a
speech model of about 480 MB for voice notes. On Windows, Stratus updates and `/update-setup` also download the
Nimbalyst installer of the version Stratus names (about 460 MB, from Nimbalyst's releases on GitHub), unless
`NIMBALYST_FOLLOW=off` ([Nimbalyst patches](../how-it-works/nimbalyst-patches.md)).

| Program | Needed for | Required | Installed by `install.mjs` |
|---|---|---|---|
| Node.js 18 or newer | The installer and every hook | Required | No |
| Node.js 22.5 or newer | Everything that reads Nimbalyst's database: notes between Nimbalyst sessions (`/btw`), the compact-self tool, the Nimbalyst figures in the usage dashboard, Board Tidy, the phone app, and moving a project folder with `/file-upkeep` | Optional | No |
| Node.js 22.6 or newer | Running the repository's tests (`node tests/run-all.mjs`): some read SQLite with `node:sqlite`, and the extension tests use `--experimental-strip-types` | Optional | No |
| Claude Code | Everything; the install stops below the version in `version.json` (`claudeCodeMin`) | Required | Updated when a newer version is out |
| Git | The plugin installer, and each project's history | Optional | No |
| Git Bash (Windows) | The shell Claude uses; with it, the PowerShell tool is turned off | Optional | No |
| Nimbalyst | The extensions, the board and the tracker skills | Optional | No |
| uv (`uvx`) | The MarkItDown document converter (PDF, Word, PowerPoint and Excel to text), and yt-dlp when yt-dlp itself is not installed; voice notes in the phone app | Optional | No; with the phone app add-on on Windows, yes (through winget) |
| Python 3.10 or newer | The `security-guidance` plugin; the `site-login` skill needs Python too | Optional | No; the plugin waits until Python is there |
| Playwright | The `site-login` skill and the headless check of `/gridlines` | Optional | No; each skill says how to add it |
| Codex CLI | The `picture` skill, and the `finder` skill in the `quick-tasks` folder (without Codex, Claude searches with the `web-research` skill instead) | Optional | No |
| ffmpeg | `/watch` and the video frames of the `picture` skill; on a Mac, `/watch` needs Homebrew's `ffmpeg-full` | Optional | No |
| yt-dlp | `/watch` and the `picture` skill, for a video link; run through `uvx` when it is not installed | Optional | No |
| GitHub CLI (`gh`) | `/new-project` when it makes a GitHub repository, and the GitHub checks of `/update-project` | Optional | No |
| gitleaks | The broad secret scan in `push-key-scan` | Optional | No |
| restic | `/backup` | Optional | No; `/backup` downloads it itself |
| Handy | Voice typing | Optional | No |
| The plugins `claude-hud`, `security-guidance`, `frontend-design`, `impeccable` and the `find-skills` skill | The status line, security reviews and design tools | Optional | Yes, unless `--plugins no` |

## Tools some skills use

Neither installer installs these. A skill uses one when it is there, or fetches it for the run.

| Tool | Used by | How it gets there |
|---|---|---|
| Firecrawl Local | Web page reading (`web-research`): reads a page, a PDF or an Office file on your computer | You install it; without it, defuddle reads pages |
| defuddle | Web page reading when Firecrawl Local is not installed | Fetched through `npx` when needed |
| OpenCLI | Reading sites through your signed-in browser; the `opencli-readonly` hook lets only its read commands through | You install it |
| deepsec | `/security deep`, the scan over the whole project | Fetched through `npx`, at a pinned version, during the scan |
| Cloudflare's security-audit skill | `/security deep`, the second pass | Cloned for the run, at a tested commit |
| gdu or WizTree | A faster scan of big folders in `/disk-tidy` | You install it; `/disk-tidy` works without it |
| Kokoro speech program | The `read-aloud` extension | You install it and give its folder in Read Aloud's settings ([read-aloud](../../extensions/read-aloud/README.md)) |
