# internet-search

The place for finding things on the internet: products, prices, deals, second-hand listings, shops,
services, places. There is no code project here, only the hunt's own tools.

**Every request to find something runs the `finder` skill** (`/finder`, `.claude/skills/finder/`).
It holds the fixed order of a hunt: pin down, search, check every page, check the limits, say the
trade-off, table, save. This file holds the tools and the standing limits.

- Earlier hunts: `finds/INDEX.md` (one line each). The user's standing facts, and the sites and
  social media to search where they live: `profile.md`.
- **The time is a limit, not a target:** 5 to 7 minutes for one thing to look up, 10 for marketplaces
  or a request with several parts (asked once there). When it is used up, answer with what there is
  and list what was not checked. Accuracy still comes first inside it: nothing unopened is linked
  and nothing is guessed.

## Tools here

| Tool | What it does |
|---|---|
| `node tools/peek.mjs <url>... [chars] [--find "words"]` | Opens the pages in a hidden browser session, one after another, and prints each one's address, title and text. Give every page in one command |
| `node tools/limits.mjs finds/sources/<topic>` | Checks `candidates.json` against `limits.json`; prints what stays and the "Dropped:" line |
| `tools/codex-task-template.md` | The text of a Codex `--search` sweep (it costs no Claude usage) |
| `tools/labels.json` | Written once by the finder skill when answers are not in English: the phrases for "searches to save" and "ruled out" |
| `node tools/test-finder.mjs` | Tests for the link gate and the limits check |

- `peek.mjs` opens and drives its own hidden browser session through Nimbalyst (`tools/browser.mjs`),
  so reading a page needs no `browser_*` call. If it says the session could not be used, it prints
  the call that opens it by hand; if that fails too, use the `browser_*` tools.
- **The link gate** (`.claude/hooks/link-gate.mjs`, a Stop hook) blocks a reply or a `finds/` file with a
  link that was not opened in this session, a search or category page given as a product, or a listing
  that failed `limits.mjs` and is not marked. A search link passes only on a line that says it is a
  search to save. Off switch: `LINK_GATE=off`.
- Plain fetches are blocked by many shops; the hidden browser session usually gets through.
  `https://r.jina.ai/<full URL>` returns any public page as plain text.
- A price typed inside double quotes on a command line can lose its currency sign and first digit:
  Codex tasks go in a file and are passed as `"$(cat file)"`.
- WebSearch and WebFetch are for a quick look only.
- Videos, blocked pages and feeds: skill `read-web` (no login needed).

## Sites behind a login

Only through a browser window the user signed in to themselves (a tab of Nimbalyst's built-in
browser), and only to search and read. Every browser tab and hidden session in Nimbalyst shares one
set of sign-ins, kept until Nimbalyst is closed, so signing in once in a visible tab is enough.

- **Never** post, comment, message a seller, like, follow, save, buy, change settings or sign in.
- Never copy, export or store cookies or passwords.
- Go at a human pace: a handful of pages per hunt, no rapid paging.
- At a login wall or a "confirm it's you" check, stop and tell the user to sign in in that window.
- If the browser cannot reach the site, give the user the ready-made search link instead (as a search
  to save).

## Limits

- Don't buy, order, book or contact anyone. The user does that.
- Prices and stock change: every price carries the date it was checked.
- Say plainly when nothing good was found; don't pad the table.

## Not for here

- General questions: `<projects>\ask-anything`. One-off file jobs: `<projects>\quick-tasks`.
- Changes to the Claude setup itself: `<projects>\claude-settings`.
