---
name: domain-modeling
description: Build and sharpen a project's domain model - the words it uses for its own things, written to docs/glossary.md as they settle, and the hard-to-reverse decisions written to DECISIONS.md. Use when discussing what a project's terms mean, writing or editing its glossary, or recording a decision that is hard to reverse, surprising and a real trade-off.
---

# Domain Modeling

Taken from Matt Pocock's `domain-modeling` skill (MIT, see LICENSE). Changed only where this setup differs: the
glossary is `docs/glossary.md` (file names are lowercase here) and a decision goes into the project's `DECISIONS.md`,
this setup's decision record, instead of a `docs/adr/` file.

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging
terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise.
(Merely *reading* `docs/glossary.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This
skill is for when you're changing the model, not just consuming it.)

`grilling` already sharpens fuzzy words about *how good* something must be ("smooth", "fast") into done-when lines.
This skill sharpens the *nouns*: which thing a word names. The two run together in `grill-with-docs`.

A `docs/speech-glossary.md` (misheard word → meant word, for a user who dictates) is a different file; leave it alone.

## File structure

Most repos have a single context:

```
/
├── DECISIONS.md
├── docs/
│   └── glossary.md
└── src/
```

If a `docs/glossary-map.md` exists, the repo has multiple contexts. The map points to where each one lives:

```
/
├── DECISIONS.md                      ← system-wide decisions
├── docs/
│   └── glossary-map.md
├── src/
│   ├── ordering/
│   │   └── docs/glossary.md
│   └── billing/
│       └── docs/glossary.md
```

Create files lazily: only when you have something to write. If no `docs/glossary.md` exists, create one when the
first term is resolved. If no `DECISIONS.md` exists, create it when the first decision is worth recording.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `docs/glossary.md`, call it out immediately.
"Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you
mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that
probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it:
"Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update the glossary inline

When a term is resolved, update `docs/glossary.md` right there. Don't batch these up: capture them as they happen.
Use the format in [glossary-format.md](glossary-format.md).

`docs/glossary.md` should be totally devoid of implementation details. Do not treat it as a spec, a scratch pad, or
a repository for implementation decisions. It is a glossary and nothing else.

### Offer decisions sparingly

Only offer to record a decision when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip it. Use the format in [decision-format.md](decision-format.md).
