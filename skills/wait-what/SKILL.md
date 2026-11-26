---
name: wait-what
description: 'The last reply did not land - re-explain it plainly. Use when the user signals confusion about what was just said: "wait what", "what do you mean", "huh?", "I don''t get it", "explain that", "say that again simpler", "what are you talking about", "подожди, что?", "в смысле?", "не понял", "что ты имеешь в виду", or runs /wait-what.'
---

Based on Matt Pocock's `wait-what` skill (MIT licence; its text is the `LICENSE` file in this skill's folder). Matt Pocock's version runs only when typed; this one also starts on its
own when the user's words show the last reply didn't land.

The user doesn't understand where you've got to. Re-pitch it:
- Start with one or two sentences of context: what you were doing and why it came up.
- Then the point itself, in short, plain sentences (ASD-STE100 Simplified Technical English): one idea per sentence,
  common words, no labels or shorthand made up while working.
- Use the project's own names for things (its `GLOSSARY.md` if it has one).
- If they asked about one part, answer that part; don't repeat the whole reply.
- Answer in the language the user wrote in.
