---
name: grilling
description: 'Questions before a medium or big job, then what done looks like (in chat for a medium job, a spec file for a big one). Use when a job is sized medium or big, when the user says "grill me", "задай мне вопросы", "погоняй меня по плану" or asks (in any language) to stress-test a plan, decision or idea.'
---

Based on Matt Pocock's `grilling` skill (MIT licence; its text is the `LICENSE` file in this skill's folder), with card rules and a spec step added.

Interview the user until you reach a shared understanding. Map this as a **design tree**: every decision branches
into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the
questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round:
number each question and give your recommended answer with its reason. Then wait for the user's answers before the
next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>, because <reason>

---

❓ **Q2** - ...
```

Word each question so "yes" accepts your recommended answer. A matter of taste gets no recommendation.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions
that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another
question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact, dispatch a helper in the
background to find it: a `worker` for files, docs or code; for a web question that needs judgement, a helper with `model` and `effort` set in the call.
Don't block on it: only the questions downstream of it wait; ask the rest of the frontier now. The _decisions_ are
the user's: put each to them and wait.

## Fuzzy words

A **fuzzy word** is one two people would check differently: a feel ("smooth", "clean", "tight", "nice to use"),
a comparison ("as good as T3", "like the Claude app") or a size with no number ("compact", "fast", "a few
buttons"). Sharpen every fuzzy word in the ask, and in the docs the job builds on, as its own frontier question,
ahead of the questions that hang off it. Research it first with a helper: the reference app measured or
screenshotted, what users of similar tools praise or complain about, the usual numbers. Then ask with two or three
concrete readings and your pick, e.g. "smooth chat": text streams in word by word / the view holds still while you
read / no scroll frame over 16 ms. Where the context already pins the word ("smooth scrolling"), put the number in
your recommendation and still ask. Each answer becomes a done-when line with a number, a side-by-side reference or
a list of behaviours; a fuzzy word still in the spec is an open branch.

A word that could name two different things ("account": the customer or the login?) is a question for the
`domain-modeling` skill. In a code project, call it alongside this one, so each settled term lands in
`docs/glossary.md` and each hard-to-reverse choice in `DECISIONS.md` as the answers come in.

## The first fact

**What already exists** is the first fact to find, before the first round: the project's own code and its packages,
then a maintained package, template or repo that does the job. Each find enters a question as the recommended base,
so the user picks between using it and building; the answers go into the spec's "Built on".

## Plain text or a card

- Open "what and why" questions go as plain text, as above. Their own words carry more than any options can.
- A question card (`AskUserQuestion`) only for a yes/no, a pick-one or a pick-what-applies whose options are real,
  known outcomes. Never turn an open question into pre-made options.
- One card is one small round: usually 1-3 questions, 4 at most, most important first, none depending on another.
  Labels of 1-5 words, each a different outcome; the description says what happens or what it costs. No "Other"
  option: the typing box is always there.
- A card shows no links, files or line breaks. What the user needs to judge it (a short summary, clickable links
  to the files it is about) goes in the reply's text before the card, in the same reply; never a card alone.
- A re-asked question keeps its wording and its recommendation; if your pick changed, say which fact changed it.
- If a typed note replaces a card's answer and doesn't answer it, go on with the recommended options as stated
  assumptions and re-ask only the ones that block the next step.

## The end

The interview is done when the frontier is empty: every branch visited, nothing left silently assumed. Then say in
about five lines what you took from the answers, naming any question left unanswered and what you assumed for it.
Go on unless the user corrects a line.

- **Medium job:** write the done-when lines in chat (the "Done when" format of [spec-template.md](spec-template.md),
  no file) and wait for the user's OK on them.
  Then build in this session.
- **Big job:** write the spec file `docs/<date>-<job>-spec.md` from [spec-template.md](spec-template.md), then run
  the `lead` skill on it. The user's OK comes once, on the spec and the plan together.

Put the user's exact answers that set numbers, orders, names or limits into the spec word for word, under "Your
words". A paraphrase there is how a limit gets lost.
