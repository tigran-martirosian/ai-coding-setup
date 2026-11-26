# The development process

Stratus runs Claude Code through the steps a careful software team follows: requirements, a spec with acceptance
criteria, a reviewed plan, parallel branches, code review, acceptance testing and retros, with security checks from each edit through to deploy. Some steps are
checked by a script that can refuse, some by a reviewer that works apart from the builder, and the rest are
instructions Claude follows but nothing forces. The table says which is which.

## Practice by practice

Each row is one practice, how Stratus does it, and what holds it in place (the last column). A big job is
split into slices: pieces small enough for one helper agent to build in one run.

| Practice | How Stratus does it | Held by |
|---|---|---|
| Triage | Every request is sized in one line as small, medium or big, and the size decides how much of the process below runs. You can overrule the size in a word. | Instruction |
| Requirements | The `grilling` skill first looks for what already exists: the project's own code, then a maintained package. You choose between reusing and building. Then it asks its questions in rounds. | Instruction |
| Acceptance criteria | The spec lists "done when" lines, and each line names the check that proves it. | Reviewer, when called |
| Planning and design review | The `lead` skill splits the work into slices, each with its files, its helper and the spec lines it proves. A `plan-reviewer` reads the plan once against the spec and your own words. Nothing is built before your OK. | Reviewer when called, your OK |
| Helper agents | Seven helper agents, each with a fixed model and reasoning effort for its kind of work: reading, code, refactors with many dependents, review. Each stops after 80 turns (a turn is one model call). | Claude Code settings |
| Branches and merges | Slices that run in parallel get their own git worktrees and are merged one at a time. A helper stays inside its files and stops with a `BLOCKED` report when what it finds contradicts the plan. | Instruction |
| Code review | A slice the plan marks as risky gets `/code-review`, and Claude checks each finding against the code before changing anything. | Instruction |
| Tests | A reply after a code edit with no test run since is returned to Claude to run one before it reaches you. | Hook `verify-gate` |
| Test integrity | Claude reruns every slice's checks itself, and a helper may not edit, weaken or skip a test to get a pass. | Instruction |
| Final acceptance | At the end, a `reviewer` checks the finished work against each "done when" line, running the checks itself. It gets the spec, the diff and the check outputs, never the chat that produced them. | Reviewer, when called |
| Usability | When a person will see the result, a `blind-reviewer` gets only screenshots or the text, as a newcomer would, and answers PASS or FAIL. | Reviewer, when called |
| Safety guards | Guard hooks refuse hard-to-undo actions, such as recursive deletes outside temp folders, SQL without `WHERE`, and keys in a `git push`. A guard that crashes refuses instead of letting the call through. | 8 guard hooks |
| Evidence | A reply that links a web page Claude never opened is returned to Claude before you see it. | Hook `link-gate` |
| Decision records | Hard-to-reverse decisions go to `DECISIONS.md`, the project's terms to `docs/glossary.md`, and a systems map of the project's parts and their links, which helpers are briefed from. | Instruction |
| Board and status | A Nimbalyst tracker holds each job's steps; the `where-are-we` skill marks a step done when a commit shows it, and lists what waits for you. | Instruction |
| Retros | Claude logs friction with its own tools in one line (`log-papercut`). `/setup-audit chat` reads recent chats and proposes fixes, and nothing changes until you tick one. `/setup-audit outcomes` counts whether the checks led anywhere: reviews followed by a code change, and blocked replies followed by a passing test. | You |

## What enforces it

1. **Hooks** are Node.js scripts that Claude Code runs around each step. They read the session's log of tool calls,
   so a reply can be checked against what was actually run: "tests pass" with no test in the log goes back. There
   are 31, eight of them guards. Each has an off switch, an environment variable that you set
   ([hooks reference](../reference/hooks.md)).
2. **Reviewers** see the plan or the result, never the builder's reasoning, and any shell command of theirs that
   would change a file is refused.
3. **Instructions** (rules and skills) shape what Claude does but cannot block it. The rows marked "Instruction"
   rest on them. That includes calling the reviewers: nothing forces one to run, but when one runs, it works apart
   from the builder.

## Security

Security runs in layers, from every edit to a whole-project scan ([Security](../using/security.md)):

1. **On every edit:** Anthropic's `security-guidance` plugin warns on risky code as each file is written, and
   reviews the change at the end of each turn and at each `git commit` and `git push`.
2. **Before a commit, pull request or release:** `/security` runs Claude Code's `/security-review` on the change
   and a gitleaks scan for secrets.
3. **Once per project:** `/security deep` runs the deepsec scanner over the whole codebase, then a second audit
   pass.
4. **At every push:** a hook asks before a push whose new lines hold something shaped like a key or token, or that
   adds a key file.
5. **At every deploy**, in a project that turns it on: `ship-check` lists what the deploy uploads and fails on env
   files, source maps and built-in keys, then checks that the live site returns 404 for `/.env` and `/.git/HEAD`
   and sends its security headers. A raw deploy command is refused in favour of this checked one.

The safety guards in the table refuse destructive commands whatever the model was told. Stratus's own CI scans
every commit in its history for keys and runs a privacy scan on each pull request.

## How it keeps improving

The improvement work runs on the maintainer's install, and its results reach every install as a release.

- **A nightly upkeep run** checks new releases of Claude Code, Nimbalyst, plugins and the repository's own
  packages, takes an update when the test suite passes with it, and fixes what it breaks in the same run when that is
  minutes of work; a longer fix waits for the maintainer.
- **Research agents** read release notes, other setups and user reports every day. Each finding is checked
  against the roadmap, and the maintainer decides what gets built.
- **One tracker** collects every finding: agents' friction notes, chat reviews, review findings and failures hit
  during builds. Reviewers read it first, so nothing is reported twice.
- **Rule changes are tested.** A reworded rule is replayed on past requests that went wrong, under the old text and
  the new, and a judge model sees both answers unlabelled and scores them.
- **Each new Claude model** gets a reread of the rules: a rule the new model follows without being told is deleted, and
  each cut is logged with its reason.
- **Releases** go through a pull request. CI runs the full suite on Windows and macOS, a lint, a type check, a key
  scan of the whole history and a privacy scan, and renders every changed page light and dark. Installs check for a
  release every 12 hours and update themselves; `AUTO_UPDATE=off` makes each update wait for `/update-setup`.

## Measured

Two tests ran in November 2026 ([Test results](../test-results.md)). On 8 past commits that each brought in a bug,
an earlier version of the end `reviewer` found 5, the same as a plain "review this change" prompt, with 40% fewer tokens. The hooks ran
more than 12,000 times on replayed real sessions and made-up hard cases with no crash, and the guards were right on 30 of 30 shell
commands: each risky command was stopped, and each harmless look-alike let through.
