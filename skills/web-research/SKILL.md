---
name: web-research
description: Web facts from the source that knows them. Use for any web research, and before stating a version, a release or whether something exists; for a list of things from one site; when the user asks for N things; for community opinion or a Reddit or X link; or to read any page.
---

# Web research

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
  reference fact.
- **A page that blocks a plain fetch**: `https://r.jina.ai/<full URL>` returns it as plain text.
- **Community opinion** ("what do people recommend", "is it any good") means real forum threads, and a
  site like Reddit needs your own signed-in browser: a plain fetch of its search JSON returns HTML and
  the text proxies get a 403. Drive your own browser for it rather than passing off a search summary.
- A page's own text beats anyone's summary of it. WebFetch answers a question about a page, but a
  small model writes that answer, so it cuts quotes and long pages. When the exact words matter (a
  quote, a SKILL.md to compare, a changelog) and `npx` is available, save the page as Markdown with
  `npx -y defuddle parse <url> --md > <file>.md` in the temp folder, Grep/Read that file, and delete it
  after reading; a page the user asked to keep goes to `docs/research/` instead. `r.jina.ai` stays for sites
  that block it. The `web-fetch` helper that stands in when you have no WebFetch runs on Haiku too: a
  page a decision rests on (a choice, a recommendation, a fact the reply depends on) is read by a `worker`
  given the URL and the question, or saved with defuddle as above, not by `web-fetch`.
