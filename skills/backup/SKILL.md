---
name: backup
description: Set up an encrypted backup of the Claude setup (settings, rules, skills, memory) and picked project folders to the user's own Backblaze B2 storage with restic, and back up when the user asks. Also shows the backup's state, runs a restore test, brings back a file or folder, turns a daily or weekly schedule on or off, and turns the backup off. Use when the user asks to back up, to set up a backup, to get back a lost or old file, whether the backup works, after an install or update offers it, or on /backup.
---

# Backup

restic locks the files on this PC with a password only the user keeps, then copies them to their own Backblaze B2 bucket. Backups run when the user asks; a daily or weekly schedule is optional.

`B="node ~/.claude/workers/backup.mjs"`

**Keys never pass through the chat.** Never ask for a key or a password here. Keys and the password are typed only in the setup window. If the user pastes one into the chat anyway, do not use it: tell them to delete that key at backblaze.com (Application Keys) and make a new one, because the chat keeps what is pasted.

## What `/backup` does

| The user says | Run |
|---|---|
| `/backup` | `$B status`. If it says `not set up yet`, go to **Setup**. Otherwise tell the user the last run, the size, the number of snapshots and the schedule. |
| `/backup now`, "back up" | `$B run`. Report the size, the files, any `skipped, over 100 MB` file by name, and the restore test line when there is one. |
| `/backup test` | `$B test`. `restore test: matches (...)` is good. On `restore test: differs`, show the listed paths and why. |
| `/backup folders` | **Folders** below. |
| `/backup restore <path>` | `$B restore "<path>"` (add `--to "<new folder>"` if the user names one). It never writes over the original. Tell the user where the copy is; they move back what they need. |
| `/backup schedule` | Ask one card: every day or every week. Then `$B schedule on --every day` or `--every week` (Sundays): at 21:00, a missed run runs at the next chance. It needs a restore test that matched first. `$B schedule off` stops it. |
| `/backup off` | `$B off`. It stops the schedule and deletes nothing. Pass on its lines on how to delete the backup by hand. |

When a command fails, it prints one `backup: ...` line. Give it to the user as it is, and do not try a way around it.

## Setup

1. **Get restic.** `$B get-restic`. It downloads restic 0.19.1 and checks it against the hash pinned in the worker. On `checksum mismatch`, stop and show the line; do not get restic from anywhere else.
2. **Account.** Ask if the user has a Backblaze account. If not, tell them: "Make a free account at backblaze.com (B2 Cloud Storage). Then open *Application Keys* and click *Generate New Master Application Key*. It is shown only once, so leave that page open." Wait for "done".
   If the user has no account yet, or wants to do it later, stop here and say: "Setup waits for your Backblaze account; `/backup` carries on from here."
3. **Setup window.** `$B setup --window`. A window named "Claude backup" opens on the PC. Tell the user what happens there:
   - they paste the master key ID and the key (the typing is hidden);
   - setup makes a private bucket and a key for this bucket only that can not delete, then forgets the master key;
   - they press Enter for a made-up password of 6 words (or type their own of 16+ characters);
   - the **recovery sheet** shows once. They save it in a password manager or on paper, then type the last word back;
   - the window ends with "Back to the chat".
   Wait for "done", then run `$B status`. If it still says `not set up yet`, ask the user for the window's last line (never for a key).
4. **Folders.** See **Folders** below. `~/.claude` is always in.
5. **First backup.** `$B run`. The first run also checks the backup and does a restore test. Report the size, the files, any skipped big file, and `restore test: matches`. If the test differs, show the paths and stop: the backup is not ready yet.
6. **Schedule.** Ask one card, no option marked: an automatic backup every week, every day, or only when you ask. Week or day: `$B schedule on --every week` or `--every day`. Only when asked: nothing; tell the user "`/backup now` backs up; `/backup schedule` turns an automatic one on later."
7. **What the user keeps:** the recovery sheet and their Backblaze login. Say it plainly: "Without the password nobody can read the backup, not even you. restic has no reset."

A backup to another disk instead of B2 (for example a USB drive): `$B setup --target local --repo "<folder on that disk>" --window`. The rest is the same.

## Folders

`$B folders` lists the folders in the projects folder with their size after the default excludes (`node_modules`, `.venv`, `dist`, `build`, `out`, `.next`, `target`, `.cache` and such). Ask one card, multi-select, nothing ticked: which folders to add. For each pick: `$B folders --add "<path>"`. To take one out: `$B folders --remove "<path>"`. A folder's `.git` is kept. Extra things to leave out go into that folder's `exclude` list in `~/.claude-backup/config.json`.

What is never in the backup: chat logs (`projects/**/*.jsonl`), scratch, temp and cache folders, browser profiles (login cookies), plugin caches, `node_modules` and Python environments, and files over 100 MB (each one named in the run's report).

## The recovery sheet

The setup window shows it once:

```
restic password: <6 words>
Bucket:          claude-backup-<8 characters>
Repository:      b2:claude-backup-<8 characters>:restic
Restore on a new PC:
  1. get restic 0.19.1: https://github.com/restic/restic/releases
  2. set B2_ACCOUNT_ID and B2_ACCOUNT_KEY (the key in ~/.claude-backup/b2.env, or a new key made at backblaze.com) and RESTIC_REPOSITORY=b2:<bucket>:restic
  3. restic restore latest --target <a new folder>   (it asks for this password)
Without this password nobody can read the backup, not even you: restic has no reset.
```

## Restore on a new PC

The old files come back with the recovery sheet. Running **Setup** on the new PC makes a new, separate backup; it does not open the old one.

1. Get restic 0.19.1 from its release page (or `$B get-restic` and use `~/.claude-backup/bin/restic`).
2. At backblaze.com, *Application Keys*, make a key for the bucket (read is enough). Set `B2_ACCOUNT_ID`, `B2_ACCOUNT_KEY` and `RESTIC_REPOSITORY=b2:<bucket>:restic` in the terminal.
3. `restic restore latest --target <a new folder>` and type the password when asked.
4. Copy what you need from the new folder into place.

The keys stay in the user's terminal; the chat only helps with the steps.

## Where things are

`~/.claude-backup/` (outside everything that is backed up): `password` and `b2.env` (owner-only), `config.json`, `excludes.txt`, `last-run.json`, `logs/` (last 30 runs), `bin/restic`. The bucket keeps hidden versions 30 days, so a stolen key can not wipe the backup at once.

Not verified: the B2 path has not been run against a real Backblaze account yet (it was tested against a local folder): the B2 API calls in setup, restic with a key that can not delete, and the setup window on each system. Turning the schedule on (Task Scheduler, launchd, systemd) was not run; only its command text is tested. The macOS and Linux restic files are pinned from the signed hash list but were not unpacked or run. Restore after an attack (unhiding old versions in B2) is not written yet.
