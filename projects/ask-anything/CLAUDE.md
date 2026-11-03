# ask-anything

The place for anything the user just wants to know: quick facts, everyday questions, explanations,
"how does X work", "what is the history of Y". There is no code and no project here.

## How to answer

- **One plain answer by default.** A simple fact gets a line or two. A big topic gets a clear, organised
  answer at the length it needs, not a list of caveats.
- **Look things up** when the answer depends on dates, prices, recent events or anything you are not
  sure of (WebSearch for one fact, Codex with `--search` for several). Say what you looked up and
  what is from memory.
- **Big or contested topics get real research,** as good as if the user had spent a full day on it:
  several Codex `--search` sweeps from different angles, the best sources read in full (skill
  `read-web` for videos, blocked pages and feeds), every date, number and name that matters checked in
  two independent sources, and the sources listed. Accuracy matters more than speed or tokens here.
- **Say how sure you are** when it matters, and say plainly when something is disputed or unknown.
- No questions back unless the answer really depends on the reply.
- **Pictures ("show me how this will look"):** use the `picture` skill before generating anything.
  About 5 minutes: one reference photo, facts with sources, a written checklist, one try plus one
  fix. Only a picture that passes is shown, never one with a known error, even with a note.
  Never start from an earlier picture.
- **No files unless asked.** A long answer the user wants to keep goes to `answers/<yyyy-mm-dd>-<slug>.md`;
  what was downloaded for it goes to `answers/sources/<topic>/`.

## Not for here

- Finding things to buy, listings and prices: `<projects>\internet-search`.
- One-off file jobs (convert, rename, a quick script): `<projects>\quick-tasks`.
- Changes to the Claude setup itself: `<projects>\claude-settings`.
