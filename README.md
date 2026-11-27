<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/banner-dark.svg"><img src="docs/img/banner.svg" alt="Stratus"></picture>
</p>

<p align="center"><b>English</b> | <a href="README.ru.md">Русский</a></p>

<p align="center">Claude plans each job with you, helper agents build and review it, and checks catch false claims, with extensions for the <a href="https://nimbalyst.com">Nimbalyst</a> editor and a Telegram app for your sessions.</p>

<p align="center">Runs on Claude Code, in Nimbalyst or a terminal. Fullest on Windows; most parts also run on macOS.</p>

<p align="center">
  <a href="https://github.com/tigran-martirosian/ai-coding-setup/releases/latest"><img src="docs/img/badge-release.svg" alt="Latest release"></a>
  <a href="https://github.com/tigran-martirosian/ai-coding-setup/actions/workflows/tests.yml"><img src="https://github.com/tigran-martirosian/ai-coding-setup/actions/workflows/tests.yml/badge.svg?branch=main" alt="Tests"></a>
  <a href="LICENSE"><img src="docs/img/badge-licence.svg" alt="Licence: source-available, not open source"></a>
  <img src="docs/img/badge-platforms.svg" alt="Platforms: Windows and macOS">
</p>

<p align="center">
  <a href="#install">Install</a> · <a href="docs/getting-started.md">Getting started</a> · <a href="docs/how-it-works/overview.md">How it works</a> · <a href="docs/README.md">Docs</a>
</p>

https://github.com/user-attachments/assets/6384f243-b336-4dae-b890-b14bfb9e6847

- **Big jobs, planned and reviewed.** Questions, a spec, helpers building the parts side by side, a review against the spec.
- **Claims checked against the log.** Hooks compare Claude's claims with Claude Code's log and send a false claim back.
- **Guards on risky commands.** Destructive SQL and a push that contains a secret key ask you first.
- **Extensions for the Nimbalyst editor.** A page per job, running helpers, a commands button, usage, a map of your project's parts, themes.
- **Plan use in view.** Type `usage` for your token and plan use and a limit forecast.
- **A phone app.** A Telegram Mini App to follow and answer your sessions.

## Requirements and platforms

You need Claude Code (2.1.321 or newer), signed in, and Node.js 18 or newer (22.5 for some Nimbalyst parts: [Dependencies](docs/reference/dependencies.md)). A Max plan works best: reviews run on Fable, Anthropic's largest model. On the $20 Pro plan, reviews use Opus instead. API keys, Bedrock and Vertex need Fable access. Nimbalyst, a desktop editor for Claude Code chats, is optional ([what needs it](docs/reference/platforms.md#terminal-claude-code-and-nimbalyst)). Linux is untested.

| | Windows | macOS |
|---|---|---|
| Rules, hooks, skills, helpers, Nimbalyst extensions | Yes | Yes |
| Nimbalyst updated and patched by Stratus | Yes | No |
| Plan usage forecast | Yes | No |
| Add-ons: the phone app, Read Aloud (replies spoken) | Yes | No |

The full list: [Windows and macOS](docs/reference/platforms.md).

## Install

> [!IMPORTANT]
> Stratus is source-available, not open source. You may use and change your own copy, but not publish, share or sell it ([LICENSE](LICENSE)).

Unzip or clone the repository into a folder you keep until the first update ([why](docs/how-it-works/install.md#keep-the-folder-you-installed-from)), and run one option there.

**Option 1: guided full install.** Claude asks which subscriptions you have, sets up Nimbalyst, Node.js and the other programs, then Stratus, following [these steps](docs/full-install.md).

```
claude "Read docs/full-install.md and carry out every step in it."
```

**Option 2: Stratus files only, for a terminal or existing Nimbalyst.** The installer adds:

- the Stratus files and its Claude Code settings;
- four Claude Code plugins and one skill, all from other authors ([which](docs/using/install-and-update.md#what-the-install-sets-up));
- the Nimbalyst extensions, if Nimbalyst is installed;
- two folders in `~/Projects`: `quick-tasks` for one-off asks, `claude-settings` for changing Stratus.

```
node install.mjs --dry-run
node install.mjs
```

`--dry-run` shows what would change. `--plugins no`, `--extensions no` and `--no-theme` each skip a part; `--with phone-bot,read-aloud` adds the Windows add-ons. On a Mac, add `--node "$(command -v node)"` to both lines.

Your own hooks and skills stay; a replaced file is backed up first. On Windows, later updates also update and patch Nimbalyst (`NIMBALYST_FOLLOW=off` stops that; [Nimbalyst patches](docs/how-it-works/nimbalyst-patches.md)). All changes: [What the install changes](docs/reference/install-changes.md).

Then take the five-minute [Getting started](docs/getting-started.md). In a team repository, [keep Stratus out of the way](docs/using/projects.md#work-in-an-existing-or-team-repository).

## Uninstall

In the folder you installed from, or, after an update, in the newest `v<version>` folder under `~/.claude/setup-source`:

```
node install.mjs --uninstall
```

Delete that folder by hand. The run removes what Stratus wrote, unless you changed it, and puts back the files it replaced. The plugins, extensions, project folders and most settings stay; the run says how to remove each ([What `--uninstall` leaves](docs/how-it-works/install.md#what---uninstall-leaves)).

## How a job runs

Claude first says in one line whether an ask is small, medium or big. Name another size to change it.

- **Small:** made now and shown working.
- **Medium:** one to three questions with recommended answers, done-when lines for your OK, then built.
- **Big:** a spec with a check per line, a plan you approve, helpers building the parts side by side, one review against the spec.

What to say: [Using Stratus](docs/HOW-TO.md). Each step: [Big jobs](docs/using/big-jobs.md). The whole process, step by step, and how Stratus keeps improving: [The development process](docs/how-it-works/development-process.md).

## What you get

### Checks that catch false claims

A turn that edits code but runs no build or test does not end. The `verify-gate` hook tells Claude:

> verify-gate: code was edited this turn (cart.ts) and no build or test ran after the last edit. Run the project's build or test now, then finish; if it has none, say so in the reply.

Other checks catch a link Claude never opened and a reply that answers nothing. All 32 hooks, guards and off switches: [Hooks](docs/reference/hooks.md).

### Research with tags

Each research finding is **Solid** (three or more sources), **Thin** (one or two independent sources), **Ours** (Claude's own reasoning) or **Old** (only evidence from before 2025).

### Security in three levels

The security-guidance plugin reviews risky code as Claude edits it. `/security` reviews a change and scans it for secrets. `/security deep` scans a whole project.

### Costs under control

Helpers run on the model their job needs: Sonnet reads, Opus codes, Fable reviews. What costs money or plan use: [Costs](docs/reference/costs.md).

## What leaves your computer

Claude Code sends your work to Anthropic. Stratus adds:

| What | Where | When | Off switch |
|---|---|---|---|
| Your Claude sign-in, to read plan use | api.anthropic.com | At most every 5 minutes | `PLAN_USAGE_LOGGER=off` |
| Update checks, and updates that install without asking | GitHub | Every 12 hours | `UPDATE_CHECK=off`, `AUTO_UPDATE=off` |
| Project files, to draw the project map | Anthropic | New projects; large existing ones after your yes; then weekly | `MAP_NUDGE=off` |
| Addresses of pages the local Firecrawl page reader can't open | Firecrawl's cloud | If you installed Firecrawl | `FIRECRAWL_CLOUD=off` |
| Project and package names, when Claude checks a version | endoflife.date, GitHub, package registries | During a job | None |
| Sessions, encrypted end to end; alerts and sent files in plain text | Telegram; the phone app's relay | With the phone app | `node ~/.claude/skills/phone-bot/pc/setup.mjs remove` |
| Encrypted backups | Your Backblaze B2 storage | Only with `/backup` | `/backup off` |

No hosted relay: run your own bot and relay ([Phone app](phone/README.md)) or join one by invite. The relay also serves the phone page, so you trust its owner. Backups are tested against a local folder, not yet against Backblaze.

## Limits

- A check knows a page was opened, not what was on it.
- A hook that hits an error lets the call through; a guard refuses it. The next session names the crashed hook.
- Not every rule has a check behind it.
- A check can send Claude back by mistake; open an issue then.

## Test results

- The reviewer agent found the same known bugs as a plain review prompt (5 of 8) with 40% fewer tokens.
- The hooks ran over 12,000 times on replayed and made-up sessions without a crash.
- Fixes from the tests cut false alarms from 4 in 12 real sessions to 1 in 13.

Measured before version 26.1, on older hooks and reviewer ([details](docs/test-results.md)).

## Help

- **A bug or a question:** open an issue. A security problem goes privately ([SECURITY.md](SECURITY.md)).
- **Changes per version:** [CHANGELOG.md](CHANGELOG.md).
- **Tests:** `node tests/run-all.mjs` on Node.js 22.6+ ([how they run](docs/how-it-works/overview.md#tests)).
- **Pull requests** aren't accepted: the licence doesn't allow sharing changed code ([CONTRIBUTING.md](CONTRIBUTING.md)).
