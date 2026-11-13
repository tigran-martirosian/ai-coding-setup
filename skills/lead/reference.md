# Lead: the reasons behind the defaults

Reference for `SKILL.md`, read when a default is questioned. Not steps.

- **Worker start cost.** A `worker` starts small because it loads no CLAUDE.md; `worker-full` loads every tool and the CLAUDE.md files and costs much more.
- **Reuse.** A follow-up to a worker that just finished, while its cache is warm, costs a few hundred tokens against several thousand for a new worker.
- **Late follow-up.** Once the cache has expired, the whole context is paid for again, so a follow-up long after a worker stopped goes to a fresh worker with a written brief.
