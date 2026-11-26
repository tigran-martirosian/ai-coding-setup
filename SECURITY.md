# Security

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately through GitHub instead: [open a private report](../../security/advisories/new), or go to the Security tab and choose "Report a vulnerability". Only you and the repository owner see it.

Say what the problem is, which version you have (the `version` in `~/.claude/setup-state.json`, or `version.json` in your copy), and the steps that show it. You'll get an answer in the report thread. A fix goes into the next release, and the changelog says what it fixed once it's out.

Only the latest release gets fixes.

## What counts

Problems in the files this repository installs or runs, for example:

- a hook, skill, agent or worker that runs a command, reads a file or sends data it shouldn't
- a command that gets past a guard. The guards are the hooks marked "A guard." in the [hooks list](docs/reference/hooks.md); `push-key-scan` runs gitleaks, when it is installed, on what a push sends. `download-guard` only speeds up big downloads; it is not a guard
- the safety baseline of a push or a deploy (`workers/ship-check.mjs`) passing a key, a key file, or a live address that serves `/.env` or `/.git/HEAD`
- the permission rules the installer adds for saved sign-ins, SSH keys and `.env` files
- the installer, the updater and `/update-setup`: what they download, how they check it, and which files they overwrite
- the privacy scan (`scripts/privacy-check.mjs`) missing a path, address or key it should find
- the encrypted backups (`/backup`), the phone app's PC program and relay (the `phone-bot` add-on and `phone/`) and the Nimbalyst patch (`scripts/nimbalyst-patch`)

## What doesn't

- Claude Code, Nimbalyst, Firecrawl, defuddle, the plugins and the outside services Stratus talks to. Report those to their own makers.
- A rule the model ignores. The rules are text the model reads, and not every rule has a check behind it. Open a normal issue if a rule should have one.
- A hook that lets a call through after it crashes. The checks do that on purpose, so that a broken check doesn't block your work ([hooks list](docs/reference/hooks.md#guards)). It counts when one of the guards does it.
