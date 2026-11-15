---
name: writing
description: Writing text that other people will read in the user's name or for them - emails, messages, posts, READMEs and docs, About lines, resumes, profiles, cover letters, form answers, PR descriptions, release notes. Use it whenever you draft, edit or polish such text, also when the ask doesn't say "write" (answer this recruiter, fill in this form, update the README, describe this PR). Not for chat replies to the user, commit messages, code comments, or files written for the user or for agents (plans, HANDOFF.md, CLAUDE.md, skills, notes).
---

# Writing for other people

This skill shapes one thing: the text another person will read (the draft, the file, the post). Your reply to
the user around it keeps its normal format; only the draft follows this page. A project's own writing rule
(`.claude/rules/writing.md`, or a writing line in its CLAUDE.md) wins where the two differ.

## Before the draft

1. **The one point.** Settle, for yourself, the one sentence the reader should take away. If it won't come, ask
   the user what the text is for. Everything else in the draft serves that sentence or goes.
2. **The facts you have.** Every name, number, date, result and claim comes from the user's files or from the
   user. When a sentence needs a fact you don't have, ask for it or leave the sentence out. An invented detail in
   someone's name is a claim they must later defend. (Fiction the user asks for is the exception.)
3. **Their voice.** If `~/.claude/writing-samples/` (or a samples folder the project names) holds texts the
   person wrote, read the one or two closest in kind and match their sentence length, word choice, punctuation,
   openings and sign-offs. A sample outranks the punctuation notes in tells.md. Take the voice from a sample,
   never its facts.
4. **The kind.** For an email, short note, README, docs, PR description, release notes, resume, profile, form
   answer or post, read its notes in [kinds.md](kinds.md).

## Writing it

- **Say it as you would tell the reader across a table**, then write that down: ordinary words, first person
  where the person is the writer, the main point in the first sentence.
- **A named specific instead of a claim.** "The report now takes 6 minutes instead of 40" carries what
  "significantly improved efficiency" only gestures at. Vagueness where a name would be easy is the thing
  readers notice first.
- **Say it literally.** Anthropic's description of mannered prose: it "substitutes metaphor and flourish for
  direct statement. Instead of 'a parameter worth varying,' the mannered writer produces 'a dial worth turning.'
  ... The fix is to say what you mean. When a literal phrase is available, use it."
- **Prose by default; structure where the content has it.** Use a list when the items are separate and
  parallel and the reader takes them one at a time: steps, install commands, options, requirements. An email,
  an answer, a README opening and a story are paragraphs, and a short message has no headings or bold.
- **Limits said plainly**, once, where they matter to the reader ("it tries every combination, so it suits
  short lists").
- **Rhythm that varies.** Mix long and short sentences. Give each sentence the punctuation it needs: commas,
  parentheses, a colon, a semicolon, now and then a dash.
- **Length that fits the occasion.** Stop after the last point; the reader keeps the middle without a recap.

## After the draft

Read it once as the reader would. Then check it against [tells.md](tells.md), strongest family first. One weak
tell is normal in human writing: act on a strong tell at one sighting, and on weak ones when several pile up in
one passage. Fix a tell by saying the specific thing it stood in for; a synonym moves the habit to the next
word. Then confirm the fix kept every fact and every caveat the reader needs.

For a draft in a file, `node ~/.claude/skills/writing/tell-check.mjs <file>` lists the marks a script can find
(stdin works too). A mark is a place to look, not a verdict: a quoted phrase or a literal use stays.

## When a helper drafts it

A brief that hands such text to a helper names this file (`~/.claude/skills/writing/SKILL.md`) and lists the
facts the helper may use, since the helper can't see the conversation that holds them.

Some checks in tells.md are adapted from blader/humanizer 3.1.0 (MIT) and Wikipedia's "Signs of AI writing".
