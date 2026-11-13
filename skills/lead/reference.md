# Lead: the reasons behind the defaults

Reference for `SKILL.md`, read when a default is questioned. Not steps.

- **Worker start cost.** A `worker` starts small because it loads no CLAUDE.md; `worker-full` loads every tool and the CLAUDE.md files and costs much more. On replayed real jobs a worker matched the real commit at a quarter less cost.
- **Reuse.** A follow-up to a worker that just finished, while its cache is warm, costs a few hundred tokens against several thousand for a new worker.
- **Late follow-up.** Once the cache has expired, the whole context is paid for again, so a follow-up long after a worker stopped goes to a fresh worker with a written brief.
- **Why subagents, not child sessions.** A child session loads the whole setup before it starts and posts its report as a new turn here; a worker's report comes back short, inside this turn; and helpers edit files the brief never named more often in child sessions than in worker jobs.
- **Why this session doesn't build in a led job.** The opposite rule was tried once and taken back: it cost about twice the tokens per commit, with helpers one small job each, often on Opus.
