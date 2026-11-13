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
- **Reading a page: the cheapest step that gives the words you need.**
  1. A quick question about a page: WebFetch. A small model writes its answer, so it cuts quotes and
     long pages; never use it (or the `web-fetch` helper) for a page a decision rests on.
  2. The exact words (a quote, a SKILL.md to compare, docs, a changelog), when `npx` is available:
     `npx -y defuddle@0.19.6 parse <url> --md > <file>.md` in the temp folder, then Grep/Read the file and
     delete it after reading; a page the user asked to keep goes to `docs/research/`.
  3. A GitHub repo: `gh repo view <o>/<r>`, `gh api repos/<o>/<r>/readme`, `gh release view -R <o>/<r>`.
  4. A page built by script, a signed-in page, or one that refuses the steps above:
     `node <projects folder>/quick-tasks/tools/peek.mjs <url>...` (Nimbalyst's browser, its sign-ins
     shared; `--find "words"`; `--save <file>` writes the whole text and prints its length).
     `--engine obscura` reads with a headless browser fallback (Obscura), signed out; peek.mjs also
     switches to it by itself when Nimbalyst's browser can't be reached, and says so. Last:
     `https://r.jina.ai/<full URL>`.
- **A page a decision rests on** (a choice, a recommendation, a fact the reply depends on) is saved whole
  (defuddle, or `peek.mjs --save`) and read in full from that file by a `worker` given the file and the
  question. **10-100 pages:** defuddle each to its own file side by side, or one `peek.mjs --save` command
  with every URL; workers read the files.
- **Obscura** is put in `~/.claude/obscura` by the setup's install (one pinned release, its SHA-256
  checked); a missing one comes back by running the setup's `install.mjs` again.
- **Community opinion** ("what do people recommend", "is it any good") means real forum threads, and a
  site like Reddit needs a signed-in browser: a plain fetch of its search JSON returns HTML and the text
  proxies get a 403. Read it with `peek.mjs` on the thread (signed in through Nimbalyst; the `site-login`
  skill signs the user in once; with `--engine obscura` signed out, about a third of the comments), not
  from a search summary.
