---
name: finder
description: Run a hunt — find a product, deal, second-hand listing, shop, service or place on the internet, in the fixed order (pin down, search, check every page, check the limits, say the trade-off, table, save). Use for every request to find, hunt, research, compare or price something, for a follow-up round on an earlier hunt, when the user says "find me", "look for", "research <file>", "hunt", or runs /finder (optional — what to find, or a handoff or finds file to continue).
---

# A hunt

The order is fixed. One script and one hook do the checking, so use them instead of doing it by eye:
`tools/limits.mjs` (checks the limits) and the link gate (a Stop hook that blocks a reply with an
unopened link, a search page given as a product, or a limit-breaking listing that is not marked).
No extra agents.

**Two sizes, picked from the request, never asked.** The time is the whole thing, from the request
to the answer, and it is a limit, not a target.

| | Search, 5 to 7 minutes | Hunt, 10 minutes |
|---|---|---|
| When | One thing to look up: a product and where to buy it, a shop, a service, a place, what people say about something | Marketplaces and second-hand listings, a request with several parts, or the user says "thorough" |
| Questions before starting | None, unless it cannot start without one. Assume the obvious and say the assumption in the answer | One prompt, only for what the request does not say |
| Time question | Never | Once, in that prompt |
| Sources | One Codex sweep | The sites in `profile.md`, and a Codex sweep per angle |
| Pages opened | The few that will be linked, in one `peek.mjs` command | Every candidate |
| Half-time post | No | Yes |

In doubt, it is a search. A search never grows into a hunt on its own: if it found too little, say
so in one last line and let the user ask.

## 1. Start

- Read `profile.md` and `finds/INDEX.md`. If this thing was hunted before, read that hunt's file and
  continue it: the limits and what was ruled out still stand unless the user changes them.
- If the request names a file (`/finder research <file>`), read it first.
- **First hunt only, when `profile.md` still says "not asked yet" or "not looked up yet":**
  1. Ask the country, city, currency, units and search language in the pin-down prompt of step 2.
  2. Look up once, with one Codex `--search` run, which marketplaces, classifieds sites,
     price-comparison sites and big shops people in that country use, and which social networks and
     forums they sell, recommend and complain on. Show the list to the user, take their changes, and
     write it into `profile.md`. Every later hunt searches those sites first.
  3. If the answers are not written in English, write `tools/labels.json` once with the phrases you
     use in that language: `{ "save": ["<searches to save>"], "breaks": ["<ruled out>", "<over the limit>"] }`.
     The link gate reads it to recognise those two labels.

## 2. Pin down, in one prompt

Ask only what the request, `profile.md` and the earlier hunt do not answer:

- the budget (delivered), and new or used;
- the one or two limits that decide this kind of thing (weight for something carried, size for
  something that must fit), and the must-haves that can't give;
- what wins when two wishes pull apart;
- **how long this may take** (a hunt only; a search never asks): 10 minutes (pre-selected), 20, or
  as long as it takes.

Then:

1. Say the request back in one line.
2. Write `finds/sources/<topic>/limits.json` (the format is at the top of `tools/limits.mjs`):
   `max_price`, `max_weight` with `weight_unit`, `quantity`, `max_distance` with `distance_unit`,
   `banned` (kinds the user refused, such as "electric"), `minutes`. A limit the user stated is never
   loosened later, and a kind they refused is never offered again as a fallback. **Nothing to limit
   (no price, weight or distance): write no `limits.json` and no `candidates.json`, and skip the
   limits check.**
3. Note the time (`date +%H:%M`). The box is 7 minutes for a search, and what the user picked for a
   hunt. **In a hunt, at half the time box, post what is found so far** (a few lines, or "nothing
   yet, still checking X"). **When the box is used up, stop: answer with what there is and list
   what was not checked.** Don't run past it without asking.

## 3. Search

Choose the deciding facts for this hunt (delivered price, plus weight, size, material, whatever it
hangs on) and get each one for every candidate.

- **The sites in `profile.md` first.** For each marketplace or classifieds site that fits, open its
  search page for the query: `node tools/peek.mjs "<search address>" 4000 --find "<a word of the product>"`.
  If the script says the browser session could not be used, use the `browser_*` tools, or
  `https://r.jina.ai/<full address>` for a public page.
- **Shops, reviews, owners' reports: Codex `--search` sweeps in parallel**, in the background, each from
  a different angle (shops, the profile's sites, complaints, second-hand). Copy `tools/codex-task-template.md`
  to `finds/sources/<topic>/q<N>-<angle>.txt`, fill it in, and run:
  `codex --search exec --skip-git-repo-check -s read-only -c 'windows.sandbox="unelevated"' -c model_reasoning_effort="low" -o finds/sources/<topic>/a<N>.md "$(cat finds/sources/<topic>/q<N>-<angle>.txt)" < /dev/null > finds/sources/<topic>/log<N>.txt 2>&1`
  Read only the `a<N>.md` file, never the log. Its leads are leads: prices and links in them are often wrong.
- **Social media and forums from `profile.md`:** public posts and groups through a Codex `--search`
  sweep and `r.jina.ai`; a site behind a login only as `CLAUDE.md` says ("Sites behind a login").
- Videos, blocked pages and feeds: skill `read-web`.

## 4. Check every page before it is listed

- Open the candidates' own pages, all in one command (a few seconds a page):
  `node tools/peek.mjs <address> <address> ... 1500` (or WebFetch, or the browser).
  Take the price, shipping, condition, place and date from that page, not from a search row or a
  Codex answer.
- Gone, unclear or dead pages are not listed. A page that could not be opened gets no link.
- When the text does not settle a deciding fact (hand or electric, the real size), look at the
  listing's picture before listing it.

## 5. Check the limits

Write every opened candidate to `finds/sources/<topic>/candidates.json` and run
`node tools/limits.mjs finds/sources/<topic>`. Only the rows it keeps go in the main table. Copy its
"Dropped: N for weight, N for price ..." line into the answer. A fact that was not found is shown as
"not found", never guessed.

## 6. Answer

- **First line: the verdict.** If nothing meets every limit, say so and name the real choices. Never
  mix kinds of product in one table without saying what each kind can't do.
- **Then a short table, best for the user's stated priority first:** what (the name is the link to
  the item's own page), delivered price, the deciding facts, where, date checked, what you give up.
  Second-hand listings also get the date posted. No prose around the table beyond one line on what
  you would buy and why.
- Then the "Dropped:" line, and what was not checked.
- A search link appears only in a list introduced as "searches to save", never as a product.
- If a site was read without the user being signed in, the first line says so.

## 7. Save

- Write the hunt to `finds/<yyyy-mm-dd>-<topic>.md`: the request, the limits, the table, what was
  ruled out and why, what was not checked. **A later round adds a dated section to the same file; it
  never overwrites an earlier one.** Save even when the answer is "nothing today".
- Add or update the hunt's line in `finds/INDEX.md` (date, what, verdict, file).
- A standing fact learned on the way (a new place, a preference, a site that worked well or that
  blocks reading) goes into `profile.md`.
