---
name: court
description: Hold a court of models on one question — GPT and Gemini (where set up) and several Claude seats with different jobs answer independently, GPT and Gemini review the answers blind, and an Opus chair gives the verdict. There is a quick court and a full one; the user picks at the start of each run. Use when the user types /court <question>, says "hold court", "ask the court", "what does the council think", or accepts your offer of a court on a contested question.
---

# Court

Seats answer alone, two outside models review the answers without knowing who wrote what, and
a chair on Opus gives the verdict from the unnamed answers. You (the session) are the clerk: you
start the steps and relay the verdict; you don't answer or judge yourself. GPT runs through the Codex
command-line tool and Gemini through the Antigravity one (`agy`), on the user's own subscriptions.
**Every seat and the chair run on a strong model**; that is the point of the court. Seats, their
models and their briefs are in `roles.md` next to this file.

## Which court

There are two. **Ask which one before every run**, as one question with these two options, unless
the user already said it (`/court quick <question>`, `/court full <question>`, "the full court"):

- **Quick court:** GPT, Gemini and the Sceptic answer, and the chair gives the verdict from those
  three answers. No review step. About half the Claude usage of the full court (two Opus calls, not
  four) and one step less to wait for.
- **Full court:** every `default: yes` seat answers (five), GPT and Gemini review the answers blind,
  then the chair.

Recommend the quick court for an everyday question and the full court when the answer has real
stakes (money, health, career, something hard to undo) or the user wants to be sure, and give that
reason in the option's description. A seat the user names joins either court.

**Seats that are not set up.** The GPT seat needs `codex` on the PATH and the Gemini seat needs `agy`.
`court.mjs` leaves out the seat and the reviewer of a tool that is missing, without an error, and
`review` writes the bundle without reviews when no reviewer is left. Offer and name only the seats
that can sit. With neither tool, hold the full court only: its three Claude seats, then the chair.

## Steps

1. **Question.** Pick a run folder `court/<yyyy-mm-dd>-<short-slug>/` in the project root and write the
   question to `question.txt` in it with the Write tool. Write the question in full, with every
   qualifier the user gave; the seats see nothing else. If the user typed `/court` with no question,
   use the question they asked last.
2. **Answers, all in one message so they run in parallel:**
   - Bash, timeout 600000: `node ~/.claude/skills/court/court.mjs open court/<folder>` (the GPT and
     Gemini seats; it leaves out a seat whose tool is not on this computer).
   - One Agent call per `runs on: claude` seat that sits: in the full court every seat with
     `default: yes` in `roles.md`, in the quick court only `sceptic`, plus in both any other seat the
     user named: `subagent_type: "worker"`, `model:` the seat's model from `roles.md`,
     `run_in_background: false`. The prompt is the seat's brief, then the answer rules below, then the
     question, then: "Write your answer to `<absolute run folder>/<seat id>.md` with the Write tool and
     reply with the one word: done. Use no other tool, unless your brief above allows one."
   - Answer rules, word for word: "Answer the question below on your own. Lead with your answer, then
     the reasoning. At most 220 words, plain language. End with two lines: `Confidence: high|medium|low`
     and `Would change my mind: <one thing>`. Do not ask questions back."
3. **Review (full court).** Bash, timeout 600000: `node ~/.claude/skills/court/court.mjs review court/<folder>`.
   It writes `bundle.md` (the question, every answer under a letter, the blind reviews, no names)
   and prints the key (letter = seat). Don't read the bundle or the seat files yourself.
   **Quick court:** run `node ~/.claude/skills/court/court.mjs bundle court/<folder>` instead. It writes
   the same `bundle.md` and key without the reviews and takes a second.
4. **Chair.** One Agent call: `subagent_type: "worker"`, `model: "opus"`, `run_in_background: false`,
   with the chair's brief below and the absolute path of `bundle.md`. Don't give it the key.
5. **Relay.** Read `verdict.md` and give it as the reply, with each letter replaced by its seat from
   the key (for example "the Sceptic (Claude)"). Add a last line, **Court**: quick or full, the seats
   that sat and any seat or reviewer that failed.

## The chair's brief

"You chair a court of AI models. Read `<absolute path>/bundle.md`: one question, several anonymous
answers (A, B, ...) and, where there are any, reviews of them. Write the verdict to `<absolute path>/verdict.md` with
the Write tool and reply with the one word: done. You may use WebSearch once or twice to settle a
disputed fact the verdict hangs on. Rules:
- Decide on the merits. Count how many answers landed on each side and report it, but a lone answer
  with a source beats four without one. A longer or more confident answer is not a better one.
- Sections: **Verdict** (the answer, first, in a few sentences); **Agreed** (what all answers share);
  **Disputed** (each real disagreement, which letters said what, who is right and why); **Vote**
  (letters per side); **Confidence** (high, medium or low, and what would change it).
- Refer to answers by letter only. At most 350 words, plain language."

## Rules

- **No silent skips.** A seat that fails or times out is named in the reply; the court goes on with
  the rest. With fewer than two answers, say so and answer alone.
- **One round.** No debate rounds by default: extra rounds mostly add agreement, not accuracy. If the
  verdict shows a real split, offer one more round in which each seat gets the strongest objection to
  its answer.
- Don't hold court on a plain fact ("how many legs does a spider have"). Say it is not worth a court
  and answer.
- To add a seat, add a section to `roles.md`. Switches: `COURT_TIMEOUT_MS` (per call, default 420000),
  `COURT_AGY_MODEL` (default `gemini-3.8-flash-high`), `COURT_GPT_EFFORT` (default `high`).
