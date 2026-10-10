---
name: plan-first
description: Think before acting on a big or vague request - restate what is being asked and why, name the shortest route and what could go wrong, show the plan in a form, and start only after a yes. Use when the user types /plan-first <request>, or says "plan first", "think before you start", "don't just start".
disable-model-invocation: true
---

# Plan first

The request follows the command. Nothing is changed before the user says yes.

## 1. Understand it (no tools yet)

Write down for yourself, from the request and what is already in the conversation:

- **What is asked,** in one sentence, and **what it is for** (the result the user wants to have at the end).
- **What "done" looks like:** the one check that would prove it.
- **What is unclear** and would change the work if guessed wrong.

## 2. Look only at what the plan needs

At most five lookups (a file, `HANDOFF.md`, `DECISIONS.md`, one search), sent together in one step.
Reading to carry the work out comes later.

## 3. Write the plan

- **The shortest route first:** the steps in order, seven at most, each with the files it touches.
  Start with the step that could settle the matter or prove the idea wrong most cheaply.
- **Where it could fail,** and what you would do instead (the second route), so a failing step
  leads to a switch and not to more tries of the same thing.
- **What it will cost,** roughly: a few steps, or a long job with helpers.
- For a job that is big or hard to undo, the plan comes from the `planner` agent (Agent tool,
  `subagent_type: "planner"`); the brief rules are in the `lead` skill. Otherwise write it yourself.

## 4. Show it and wait

One form (`PromptForUserInput`):

- the request as you understood it, as an `editText` field the user can correct;
- the steps as a `multiSelect`, all ticked, so a step can be dropped;
- each open point from step 1 as its own question with options and `allowOther: true`.

In the chat, above the form: the plan in a few lines, and the one thing the user may be missing.

## 5. Carry it out

After the yes, do the ticked steps to the end. When a step fails twice, take the second route from
the plan or ask; don't keep repairing the first one.
