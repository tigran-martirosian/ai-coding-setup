# Big jobs

A big job is one with several parts that must fit together, more than one session of work, a new project, or a
result judged by measuring or by eye. For such a job Stratus asks its questions first, writes down what "done"
means, plans the work and has it checked, before helpers build it. You give one OK, on the spec and the plan
together.

You don't need a command to start: describe the job, and Claude sizes it as big. `/lead` starts the same flow
directly.

## 1. Questions and a spec

The `grilling` skill runs first. Before its first question it looks for what already exists: your project's own
code and packages, then a maintained package or template that does the job. You pick between using it and
building, and the answer goes into the spec's "Built on" section.

Then it asks its questions in rounds (open questions as plain text, quick picks on a question card) and writes a
spec file. Each "done when" line in the spec names the
check that proves it. Say "grill me" to have any plan or idea questioned this way.

For a medium job (one session, a few parts) there is no spec file: Claude asks one to three questions, puts the
"done when" lines in the chat for your OK, and builds it in the same session.

## 2. The plan

The `lead` skill writes the plan in the main session, starting from the spec. The plan splits the work into
slices: pieces small enough for one helper to build in one run. Each slice names the "done when" lines it proves, its files and the helper that builds it. The size is a
count of slices and sessions, never a time estimate.

A `plan-reviewer` reads the plan once before you see it. It holds each slice against the spec and your own words
and checks six things: every "done when" line is proved, your words are kept, nothing is dropped, each slice runs as
written, files that two slices share have clear edges, and risky slices are marked. It reports each finding with
its proof.

Then you give your one OK. No helper starts before it.

## 3. The build

Each slice goes to a helper that knows the goal of the whole job, not only its own step. Slices that run side by
side each get their own git worktree and are merged one at a time. A helper stays inside the files it was given,
reports anything else it notices, and stops with a `BLOCKED` line when what it finds contradicts the plan. It
never edits, weakens or skips a test to get a green result.

When a slice comes back, Claude runs its checks again itself. A slice the plan marks as risky also gets
`/code-review` on its change, and Claude checks each finding before acting on it.

## 4. The review

At the end, one `reviewer` checks the result against the spec, for correctness only. It gets the spec, the full
change and the outputs of the final checks, never the chat. It runs each "done when" line's check itself where it
can and marks the line met, missing, wrong or not asked for. The end report shows each "done when" line with its
proof.

## The blind look

When a person will see, read or use the result (a page, a screen, a chart, a message, a document or a command's
output), the `blind-reviewer` looks at it as a newcomer would. It gets only the screenshots of every state, the
text or the output, never the code or the reasoning behind them. It looks once, at the finished result, beside the
end review. It ranks the flaws by how much they hurt, and its answer opens with PASS, or with FAIL when a flaw
blocks the reader. The serious flaws are fixed, and there is no second look (Stratus's own repository adds one:
[Page proof](../how-it-works/overview.md#page-proof-in-this-repository)).

## A second opinion

Before you build from a design or a plan, say "get a second opinion on this". A capped `worker` helper (about 15
tool calls) reads it and answers, and Claude checks the answer before it relies on it.

## Which helper does the work

The main session starts helpers with the Agent tool. Stratus ships seven, each with a fixed model, so the cost of
a step does not depend on the model you chat on.

| Helper | Model | What it is for |
|---|---|---|
| `worker` | Sonnet, medium effort | One numbered step of a job, or one clear one-off task: long reading of local files, research across many pages, a second opinion. Fable at medium for charts, science or maths; Fable also for web research that needs judgement. It starts without the `CLAUDE.md` files and with file, shell and web tools only. |
| `worker-code` | Opus, high effort | A step that writes or changes code. |
| `worker-full` | Opus, high effort | A step that needs a skill or an MCP tool such as the browser. It has every tool and loads the `CLAUDE.md` files, so it costs more to start. |
| `worker-refactor` | Fable, high effort | A long refactor that is not mechanical: a change to an interface, a type, a data shape or a module split with too many dependents to list, or a refactor step that already failed on `worker-code`. A rename is never a reason. |
| `plan-reviewer` | Fable, high effort | One read-only pass over a big job's plan, once per job. |
| `reviewer` | Fable, high effort | One read-only pass over the finished job, once at the end. |
| `blind-reviewer` | Opus, medium effort | The newcomer's look described above. It can only read the files it is handed. |

Every worker stops after 80 turns. A quick web lookup stays in the main session, which reads the source that knows
the answer.

The install denies Claude Code's built-in `Explore` and `general-purpose` helpers, which have no turn limit, so
their work comes to the capped `worker` instead. In session logs, single uncapped helpers used 0.6 to 4.3 million
tokens each. The exact settings are in [Install changes](../reference/install-changes.md).

On the $20 Pro plan the Fable helpers run on Opus ([Install options and updates](install-and-update.md#claude-code-version-and-plan)).

## The model you chat on

With no model set, a fresh install sets Opus at medium effort. A new chat starts on the model you chose and stays
on it: the rules don't steer you to another model, and Claude doesn't ask to switch. In the terminal that is
`"model"` in `~/.claude/settings.json`; in Nimbalyst it is the model you picked last in the model picker.

- **Effort.** Each helper runs at the effort its agent file sets. Nimbalyst would pass its effort pick to every
  helper, so the install switches that hand-over off. As a result, Nimbalyst's effort picker no longer changes the
  level; type `/effort` in the chat to change the main session's.
- **The Fable advisor**, a second, larger model that the main session can ask for advice, is off until you type
  `/advisor fable`. `/advisor off` turns it off again.
- **The two side-work folders** (`quick-tasks` and `claude-settings`) start on Opus. An older install had
  `quick-tasks` on Sonnet ([Upgrading from an older install](install-and-update.md#upgrading-from-an-older-install)).
