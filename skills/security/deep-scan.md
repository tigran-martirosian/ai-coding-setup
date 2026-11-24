# Deep scan: deepsec, then Cloudflare's security-audit skill

deepsec has two stages. `scan` runs pattern matchers over every file: free, seconds, no model. `process` sends a
Claude agent to read each candidate file and write up what it confirms: this is where the cost is.

## Cost

Measured on a repo of about 700 files: `scan` took 2 seconds and marked 126 files. `process` on all 126 at the top
model and the highest effort took 5.5 hours and about $100 at API prices (on a Claude subscription it counts
against the plan's usage instead), and found 89 findings. Medium effort costs less. Start with `--limit 5`, read
what it found, then decide on the rest with the person.

## Risks, before the first command

- **No key anywhere.** The scan uses the person's own `claude` login (`ai: { mode: "local" }` below). Never write
  an API key or token into `settings.json`, `deepsec.config.ts`, `.env.local` or any file in the project.
- **The agents run unattended.** deepsec starts them with Read, Grep, Glob and Bash allowed and no prompts. Its
  sandbox for Bash works on macOS and Linux only; on Windows Bash runs unsandboxed. Scan only code the person
  trusts. Code from someone else is scanned inside a container or a virtual machine.
- **The output stays private.** The workspace and its findings live in `.deepsec/`; add `.deepsec/` to
  `.git/info/exclude` so they never reach a remote.

## Steps

From the project folder:

1. `npx -y deepsec@2.3.16 init .deepsec . --scaffold-only` creates the workspace without installing anything (a pinned version; check
   `npm view deepsec version` and its changelog before moving to a newer one).
   Then `npm install` inside `.deepsec/`. (Let init do the install only where `pnpm` is on the PATH; on Windows
   its own install step fails to find npm.)
2. In `.deepsec/deepsec.config.ts`, add two lines inside `defineConfig({`:
   `defaultAgent: "claude-agent-sdk",` and `ai: { mode: "local", provider: "local" },`.
3. Fill `.deepsec/data/<id>/INFO.md` as `.deepsec/data/<id>/SETUP.md` asks: 50-100 lines on what the project is,
   who calls it and what it trusts. Every agent batch reads it, so it is short.
4. `npx deepsec scan` inside `.deepsec/`. Free; it prints the files with candidates.
5. `npx deepsec process --limit 5 --thinking-level medium` for a first look; it prints the cost when it ends.
   Then all candidates, or the files that matter most with `--filter <path prefix>`, with the person's OK.
   A run that stops is resumed with `--run-id`.
6. `npx deepsec export --format md-dir --out ./findings`: one file per finding.

## Second pass: Cloudflare's security-audit skill

After deepsec's findings are sorted, run Cloudflare's skill (`cloudflare/security-audit-skill`, MIT) once. It is
instructions only, plus two Node scripts that check its output. In six phases it maps the trust boundaries, sends one
hunter agent per boundary and attack class, gives each lead to a fresh agent that tries to disprove it, and writes
`REPORT.md` and `NEEDS-VALIDATION.md`. Without an operating-system sandbox it never runs the project's code, so a
lead that needs a run stays "needs validation": check each one yourself.

Measured on the same repo of about 700 files, after deepsec: 35 minutes and about $23 at API prices (on a Claude
subscription it counts against the plan's usage instead), 10 leads. Of those, 4 were real and new to deepsec (two
ways past a guard hook, two limits a stranger could use up), 3 were already in deepsec's list, and 3 were not real.

Risks, before the first command:

- **Load it only for the run.** Installed for every session, it also answers everyday security questions in place
  of this skill. Keep it in a folder outside the project and load that folder with `--plugin-dir` for the one run.
- **Its output stays outside the project:** give it an output folder outside the project; it refuses a folder
  inside unless git ignores it.
- **On Windows its two checking scripts stop** with "OS no-follow and nonblocking input protection is unavailable"
  (upstream issue #117: Node has no `O_NOFOLLOW` on Windows). In the clone, change `readFileWithinLimit()` in
  `validate-findings.cjs` and `validate-coverage-ledger.cjs`: on `win32`, refuse a symlink with `fs.lstatSync`
  and open the file read-only without the two flags. Their own tests (`node validate-findings.test.cjs`,
  `node validate-coverage-ledger.test.cjs`) pass after.

Steps:

1. Clone it outside the project at the tested commit: `git clone https://github.com/cloudflare/security-audit-skill
   <folder>` and `git -C <folder> checkout c1c8a8c` (read its commits before moving to a newer one).
2. From the project folder: `claude --plugin-dir <folder> --add-dir <folder> --add-dir <output folder>`,
   then ask: `security audit this codebase, output to <output folder>`. It takes the standard depth.
3. Sort each lead of `NEEDS-VALIDATION.md` and each confirmed finding of `REPORT.md` as below, in the same
   `SORTED.md`, after checking it in the code or on a real input to the hook it names.

## Findings

Sort every finding into one of three, in one file beside the findings (`SORTED.md`, one line each: file, verdict,
why, fix commit):

- fixed: real and small; fixed with a test that fails before the fix;
- listed: real, but bigger than a few lines; it goes to the project's task list or release notes;
- not real: the code changed, or the finding is wrong; say which.
