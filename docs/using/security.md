# Security

The `security` skill works in three levels and names the level it ran in its reply, for example "security: quick, 2
findings, both fixed". A release names the level in its notes.

| Level | What runs | When |
|---|---|---|
| Always on | Anthropic's `security-guidance` plugin. It warns on risky code as each file is edited, reviews the change when a turn ends, and reviews each `git commit` and `git push`. | Every session. Install and update turn it on. |
| Quick: `/security` | Claude Code's `/security-review` on the change, plus a gitleaks scan for secrets. | A change before a commit, a pull request or a release. |
| Deep: `/security deep` | The deepsec scanner over the whole project, then Cloudflare's security-audit skill as a second pass. | Once per project, or when a big new part arrives. |

The always-on review makes one extra review call on each turn that changed code. The deep scan sends a model to read each file
it flags through your own Claude login, so it counts against your Claude plan's usage, not a separate bill. It uses
a lot of it, so it runs only when you ask. [Costs](../reference/costs.md) gives the figures. On Windows, Cloudflare's
second pass needs a small change to its two checking scripts first; the skill makes it.

The plugin needs Python 3.10 or newer (on Windows, from python.org, not the Microsoft Store). Without it the
installer leaves the plugin off and says so; the next install or update tries again. `claude plugin list` shows
whether it is on. To turn it off, run `claude plugin disable security-guidance@claude-plugins-official`. The
plugin also reads these environment variables:

- `SECURITY_GUIDANCE_DISABLE=1` turns off all of the plugin.
- `ENABLE_CODE_SECURITY_REVIEW=0` turns off every model review (turn end, commit and push). The free warnings stay.
- `ENABLE_STOP_REVIEW=0` turns off only the review when a turn ends.
- `ENABLE_COMMIT_REVIEW=0` turns off only the commit and push reviews.
- `ENABLE_PATTERN_RULES=0` turns off only the free warnings as each file is edited.

## Pushes and deploys

The `push-key-scan` hook asks you before a `git push` whose new lines hold something shaped like a key or token
(`sk-ant-`, `ghp_`, an AWS key id, a private key block, a database address with a password), or that adds a key
file (`.env.*`, `.dev.vars`, `*.pem`, `*.key`, `.claude/settings.local.json`). gitleaks, when installed, also scans
the outgoing commits and the uncommitted changes. Without gitleaks, a project switched on with `ship-check init`
asks before the push and names the install command; any other project gets one note line.

`ship-check` is the safety baseline for a push and a deploy, switched on per project:

```
node ~/.claude/workers/ship-check.mjs init
```

This writes `.claude/ship-check.json` and adds the missing ignore lines for secret files. Then:

| Command | What it checks |
|---|---|
| `push` | Tracked key files, and gitleaks over the new commits. `--history` scans every commit; `--full` also runs `npm audit --audit-level=high` and checks GitHub's secret scanning and push protection. |
| `build <folder>` | Lists what a deploy uploads and fails on env files, source maps, dotfiles and keys built into the files. |
| `live <url>` | Checks that `/.env`, `/.git/HEAD` and similar paths return 404, and that the security headers are there. |
| `deploy -- <command>` | Runs the build check, your deploy command and the live check, in that order. |

In a project with `ship-check` switched on, a raw deploy command (`wrangler deploy`, `vercel`, `npm run deploy` and
the like) is refused, and Claude is given the `ship-check deploy -- <command>` line to run instead.
`SHIP_CHECK=off` turns that refusal off.
