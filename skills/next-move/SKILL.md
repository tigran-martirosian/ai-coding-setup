---
name: next-move
description: Suggest the one highest-leverage thing to do next, based on the user's goals and the current project's state. Use when the user asks "what should I do next", "what's the highest-leverage thing", "what can you do for me", "next move", or runs /next-move.
---

# Next move

Answer one question: **what is the single highest-leverage thing to do right now to move the user toward their goals, and how much of it can Claude do?**

1. **Goals.** Read `~/.claude/goals.md`. If it doesn't exist, ask the user in one prompt: what they want to achieve this year, their current projects, what they'd gladly hand off, and their limits (time, money, skills). Save the answers there as short bullets, then continue.
2. **Current state.** If the current folder has `HANDOFF.md` or `CLAUDE.md`, read only the status and open-items parts. Don't sweep the project.
3. **Pick one.** Weigh how much it moves a named goal, how soon, and how much effort it takes. Prefer something Claude can do or start in this session.
4. **Reply:**
   - **The move**, in one sentence, and why it beats the alternatives (tie it to a named goal).
   - What Claude can do now, and what needs the user.
   - Up to two runners-up, one line each.
   - Offer to start. Don't start without a yes.
5. If something in `goals.md` looks done or out of date, say so and offer to update it.

Reply in the language the user writes in.
