## Gathering information on Claude alone

No outside worker (Codex, Antigravity) is set up on this computer, so big gathering runs on Claude's cheaper models. **Big gathering goes to a budgeted subagent; thinking stays in the main session.** Either way the gathering happens: never skip a lookup to save tokens.

- **Send to a subagent** (`subagent_type: "worker"`, or the Agent tool's `model: "haiku"` for pure searching and listing): sweeping a folder or project, reading or summarising anything long (big files, logs, docs, converted PDFs, long command output), bulk drafting that Claude then checks and edits. "A cheap worker" in these rules means this.
- **Keep in the main session:** decisions, design, diagnosing bugs, writing or editing code, the final wording of the answer, anything that needs this conversation's context, and tiny lookups (one grep or one short file is faster than explaining it).
- Where a skill or a rule names Codex or Antigravity, do that step this way instead, and don't mention the missing worker in the answer.
- Ask the subagent for a short answer (with file paths and line numbers where relevant), and give it the budget described above.
- **A task written to a file gets short lines:** about 100 characters or fewer. Nimbalyst's file card doesn't wrap a long line and draws it over the edge of its box.
- Treat answers as leads: verify anything the final answer depends on.

## Web research: Claude does it, from the source that knows

Never answer "that version may not be available", "it might not exist" or "I couldn't confirm" from
memory or from a search that came back thin. Every such fact has a place that knows it, and the
web-answer-gate hook blocks a reply that hedges without having checked one (`HEDGE_CHECK=off`).

- **A version, release or "does X exist" question is a lookup, not a search**, and takes a second:
  `node ~/.claude/workers/versions.mjs <target> [--has <version>]` — targets `postgresql`,
  `gh:owner/repo`, `npm:name`, `pypi:name`, `crates:name`, `docker:image`, `mvn:group:artifact`,
  `nuget:name`, or a bare name. Exit 5 means the version is not in that list; that is **not** proof it
  does not exist (endoflife.date carries no betas or release candidates at all, and no source is sure to
  have a release from the last few hours), so read the project's own page before saying it is unavailable.
  The registries are the opposite — npm, PyPI, GitHub releases and NuGet do list pre-releases, so a match
  can be an alpha; `versions.mjs` says PRE-RELEASE in as many words when it is. Anything with no target
  form: WebFetch the project's download or releases page.
- **A list of things from one site** (mods, packages, packs, plugins, actions) comes from that site's own
  catalogue API, which returns every match at once and exactly, where a search engine returns three:
  `https://api.modrinth.com/v2/search?query=<words>&facets=[["categories:forge"],["versions:1.20.1"]]&limit=20`,
  the npm, PyPI, crates and NuGet registries, `https://api.github.com/search/repositories?q=...`.
- **When the user asks for N things, the answer has N**, or it says how many were found and what was
  searched, in those words (the count check in web-answer-gate blocks the rest; `COUNT_CHECK=off`).
  Several differently-worded searches in one message beat one search repeated.
- **WebSearch takes `mode`: use `"extended"` for any research**, and `"standard"` only for a single
  reference fact. Measured on one question: `standard` gave 3 results from months-old pages,
  `extended` gave 6 with fresh ones.
- **A page that blocks a plain fetch**: `https://r.jina.ai/<full URL>` returns it as plain text.
- **Community opinion** ("what do people recommend", "is it any good") means real forum threads, and a
  site like Reddit needs your own signed-in browser: a plain fetch of its search JSON returns HTML and
  the text proxies get a 403. Drive your own browser for it rather than passing off a search summary.
- A page's own text beats anyone's summary of it: WebFetch the URL once you have it.
- For research that needs many pages at once, one `worker` subagent with a budget does the fetching
  and reports back; the reading of what it found stays here.
