---
name: security
description: Security checks at three levels - always on (the security-guidance plugin), quick (a change, before a commit, pull request or release) and deep (a one-time scan of a whole project). Use when the user asks for a security check, review, audit or scan, asks whether code is safe to publish or share, before a release, or runs /security [quick|deep].
---

# Security, in three levels

Run the smallest level that covers the ask, and name the level in the reply ("security: quick, 2 findings, both
fixed"). A release names it in its notes. Each level builds on a tool that already exists; this skill adds no hook.

| Level | What runs | Rough cost | When |
|---|---|---|---|
| Always on | Anthropic's security-guidance plugin | pattern warnings free; one review call per turn that changed code | every session, nothing to do |
| Quick | Claude Code's `/security-review` on the change, plus a secret scan | one review session, a few minutes | a change before a commit, pull request or release |
| Deep | deepsec over the whole project, then Cloudflare's security-audit skill as a second pass | deepsec: dollars per file read (about $100 for 126 files at the top model); second pass about $25 and 35 minutes for 700 files | once per project, or when a big new part arrives |

## Always on: the security-guidance plugin

Install and update turn it on (`claude plugin install security-guidance@claude-plugins-official`). It warns on
risky patterns as each file is edited, reviews the diff when a turn ends, and runs an agent review on `git commit`
and `git push`. Its findings come back as a message after the turn: fix each one, or say in one line why it is not
real. The reviews use the person's own Claude Code sign-in; no key goes into any settings file. They need Python
3.10 or newer (on Windows from python.org, not the Store); without Python the installer leaves the plugin off and
says so.

- Check: `claude plugin list` shows `security-guidance@claude-plugins-official` enabled.
- Off: `claude plugin disable security-guidance@claude-plugins-official`. One part off, as an environment
  variable: `ENABLE_STOP_REVIEW=0` (the end-of-turn review), `ENABLE_COMMIT_REVIEW=0` (the commit and push reviews),
  `ENABLE_CODE_SECURITY_REVIEW=0` (all the model reviews; the free warnings stay), `ENABLE_PATTERN_RULES=0` (the
  free pattern warnings on each edit), `SECURITY_GUIDANCE_DISABLE=1` (all of it).

## Quick: a change

1. Run the built-in review on the branch: `claude -p "/security-review"` from the project folder (the person can
   also type `/security-review` in a chat). In Git Bash put `MSYS_NO_PATHCONV=1` in front: without it the shell turns
   `/security-review` into a Windows path and the review never starts. It reads the diff against the main branch and reports only findings
   it judges exploitable.
2. Secrets in the change: `gitleaks git --log-opts="<base>..HEAD" .` when gitleaks is installed (free, seconds).
3. Each finding: fix it with a test that fails first, or say in one line why it is not real.

For a large pull request the person may ask for `/code-review ultra` (Anthropic's cloud runs many reviewers);
offer it, and run it only when they ask, since it is the costliest review.

Done when: every finding of steps 1 and 2 is fixed or answered, and the reply names the level and the count.

## Deep: a whole project, once

deepsec (`vercel-labs/deepsec`, Apache-2.0) first runs free pattern matchers over every file, then sends an agent
to read each candidate file and confirm or drop the finding. It is worth one run per project: before code goes
public, before others depend on it, or after a big new part (a server, a login, a phone app).

Then a second pass with Cloudflare's security-audit skill (`cloudflare/security-audit-skill`, MIT). It does not read
file by file: it maps the project's trust boundaries and sends one agent per boundary and attack class, then a fresh
agent tries to disprove each lead. That finds ways around the project's own guards and limits that a file-by-file
scan misses, for about a quarter of deepsec's cost. It does not replace deepsec: it gives fewer findings, and none
confirmed until checked by hand.

Steps, cost and risks of both: [deep-scan.md](deep-scan.md). Read it before the first command.

Done when: every finding is sorted as fixed (with a test), listed for later, or not real, in one file beside the
scan's output, and the reply names the level, how far the scan got and what it cost.
