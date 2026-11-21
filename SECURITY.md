# Security

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately through GitHub instead: [open a private report](../../security/advisories/new), or go to the Security tab and choose "Report a vulnerability". Only you and the repository owner see it.

Say what the problem is, which version you have (the `version` in `~/.claude/setup-state.json`, or `version.json` in your copy), and the steps that show it. You'll get an answer in the report thread. A fix goes into the next release, and the changelog says what it fixed once it's out.

Only the latest release gets fixes.

## What counts

Problems in the files this repository installs or runs, for example:

- a hook, skill, agent or worker that runs a command, reads a file or sends data it shouldn't
- a guard that a command can get past: the delete, SQL and find guards, the secret scan before a push (`push-key-scan`, with gitleaks) or its refusal of a raw deploy command. `download-guard` only speeds up big downloads; it is not a guard
- the safety baseline of a push or a deploy (`workers/ship-check.mjs`) passing a key, a key file, or a live address that serves `/.env` or `/.git/HEAD`
- the permission rules the installer adds for saved sign-ins, SSH keys and `.env` files
- the installer, the updater and `/update-setup`: what they download, how they check it, and which files they overwrite
- the privacy scan (`scripts/privacy-check.mjs`) missing a path, address or key it should find
- the encrypted backups (`/backup`), the phone app's PC program and relay (the `phone-bot` add-on and `phone/`) and the Nimbalyst patch (`tools/nimbalyst-patch`)

## What doesn't

- Claude Code, Nimbalyst, Firecrawl, defuddle, the plugins and the outside services the setup talks to. Report those to their own makers.
- A rule the model ignores. The rules are text the model reads, and the README's Limits section says so. Open a normal issue if a rule should have a check behind it.
- A hook that lets a call through after it crashes. That's on purpose for the checks (the README's Limits section explains it). It counts when one of the guards does it.
