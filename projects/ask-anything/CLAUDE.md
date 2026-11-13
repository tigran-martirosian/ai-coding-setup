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

## The court

`/court <question>` puts **any** hard question (a decision, advice with stakes, strategy, a diagnosis, a
contested fact, history with competing readings) to seats that answer alone: GPT as researcher,
Gemini as analyst, and Claude seats on Opus (sceptic, pragmatist, wildcard). An Opus chair gives the
verdict (skill `court`; runs kept in `court/`).

- **There are two courts, and the skill asks which one at the start of every run.** The quick court:
  GPT, Gemini and the sceptic, then the chair. The full court: all five seats, a blind review of the
  answers by GPT and Gemini, then the chair (about 180k Opus tokens).
- The seats are **jobs, not topics**, so they fit any subject. Four more join when the user names
  them: `specialist` (answers as a working expert in the field of the question), `verifier` (checks
  the claims the answer hangs on against sources), `steelman` and `ethicist`. All are in
  `~/.claude/skills/court/roles.md`; a new seat is one more section there.
- **Offer the court in one line after your own answer** when the question is contested, has real
  stakes (money, health, career, relationships) or depends on which school of thought is right. Don't
  offer it for a plain fact.
- There is one court. Don't build a second council beside it; add a seat instead.

## Not for here

- Finding things to buy, listings and prices: `<projects>\internet-search`.
- One-off file jobs (convert, rename, a quick script): `<projects>\quick-tasks`.
- Changes to the Claude setup itself: `<projects>\claude-settings`.
