## Gathering information on Claude alone

No outside worker (Codex, Antigravity) is set up on this computer, so big gathering runs on Claude's cheaper models. **Big gathering goes to a budgeted subagent; thinking stays in the main session.** Either way the gathering happens: never skip a lookup to save tokens.

- **Send to a subagent** (`subagent_type: "worker"`, or the Agent tool's `model: "haiku"` for pure searching and listing): sweeping a folder or project, reading or summarising anything long (big files, logs, docs, converted PDFs, long command output), bulk drafting that Claude then checks and edits. "A cheap worker" in these rules means this.
- **Keep in the main session:** decisions, design, diagnosing bugs, writing or editing code, the final wording of the answer, anything that needs this conversation's context, and tiny lookups (one grep or one short file is faster than explaining it).
- **Web research:** WebSearch and WebFetch, several searches sent in one turn. For research that needs many pages, one `worker` subagent with a budget.
- Where a skill or a rule names Codex or Antigravity, do that step this way instead, and don't mention the missing worker in the answer.
- Ask the subagent for a short answer (with file paths and line numbers where relevant), and give it the budget described above.
- **A task written to a file gets short lines:** about 100 characters or fewer. Nimbalyst's file card doesn't wrap a long line and draws it over the edge of its box.
- Treat answers as leads: verify anything the final answer depends on.
