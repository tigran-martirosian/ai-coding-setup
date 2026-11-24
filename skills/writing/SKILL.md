---
name: writing
description: Writing any text a person will read, in the user's name or for them - emails, messages, posts, a README, a tour, a guide or explainer, docs, release notes, a film script, a wiki page for colleagues, a description of work done (a PR, a report), About lines, resumes, profiles, cover letters, form answers. Use it whenever you draft, edit or polish such text, a page made for the user to read included, also when the ask doesn't say "write" (answer this recruiter, fill in this form, update the README, describe this PR). Not for chat replies to the user, commit messages, code comments, or working files agents read (plans, HANDOFF.md, CLAUDE.md, skills, notes).
---

# Writing for other people

This skill shapes one thing: the text another person will read (the draft, the file, the post). Your reply to
the user around it keeps its normal format; only the draft follows this page. A project's own writing rule
(`.claude/rules/writing.md`, or a writing line in its CLAUDE.md) wins where the two differ.

## Before the draft

A reader opens a text to get something, and every line they didn't come for costs them time. In the user's
words: "nobody just needs to read stuff just to read stuff". Written from the build chat, a text drifts into a
list of everything that was done; these steps start from the reader instead.

1. **The reader.** Name who reads it and the few questions they arrive with ("what is this?", "why would I want
   it?", "how do I start?", "what changed for me?").
2. **The one message.** The one sentence the reader should take away. If it won't come, ask the user what the
   text is for. Everything else in the draft serves that sentence or goes.
3. **The points.** List the candidate points, then cut to the few (often 3-5) that answer what the reader came
   for. What was tried and removed stays out, and so does the rare edge case; a small feature gets one line at
   most. Build details (how it was made, internal renames, what stayed the same) go to the changelog, or nowhere.
   For a page many people read (a README, a tour, a guide), show the user the shortlist and let them keep or cut
   before drafting; later pages of the same set follow the logic they OK'd.
4. **The facts you have.** Every name, number, date, result and claim comes from the user's files or from the
   user. When a sentence needs a fact you don't have, ask for it or leave the sentence out. An invented detail in
   someone's name is a claim they must later defend. (Fiction the user asks for is the exception.)
5. **Their voice.** If `~/.claude/writing-samples/` (or a samples folder the project names) holds texts the
   person wrote, read the one or two closest in kind and match their sentence length, word choice, punctuation,
   openings and sign-offs. A sample outranks the punctuation notes in tells.md. Take the voice from a sample,
   never its facts.
6. **The kind.** Read its notes in [kinds.md](kinds.md) (email, short note, README, tour and guides, wiki page,
   release notes, description of work done, film script, resume, profile, form answer, post).

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
- **A diagram only for branching or structure**: a choice with paths, or parts inside parts. At most 8 boxes,
  labels of 1-3 words. A straight sequence is a numbered list: a long column of boxes makes the reader scroll
  for what a list says in a few lines. Where the repository has `scripts/diagram-rule.mjs`, run it on the page.
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

## A page: the fresh reader

A page is a file people open on their own: a README, docs, a guide, release notes, the film. Once you know how
the thing works you can't read it as a newcomer; a `blind-reviewer` can.

1. **The rendered page.** Look at it where the reader will: `node scripts/render-check.mjs <page>` where the
   repository has it (light and dark, wide and phone, in the page's proof folder); else screenshots of it as
   shown, or the film's stills. Open each one yourself.
2. **The brief:** the screenshot paths with their scale, the reader's questions from step 1, the user's marked
   examples (passages the user called good or bad, with their reason, from the chat or a file they named; "none"
   when there are none), a short word list, and the last line `SYSTEMS MAP: none`. No code, no draft history,
   no list of changes.
3. **Its answer, word for word**, saved by you as `.proof/<page name>/verdict.md` (the page's path with `/` as
   `__` and `.md` dropped; the film: `.proof/film/verdict.md`). It can only read, so it answers in chat. Its
   first line, PASS or FAIL, is what verify-gate reads.
4. **On FAIL,** fix the page, render it again and ask a new `blind-reviewer`; its answer replaces the file.

## When a helper drafts it

A brief that hands such text to a helper names this file (`~/.claude/skills/writing/SKILL.md`) and lists the
facts the helper may use, since the helper can't see the conversation that holds them.

Some checks in tells.md are adapted from blader/humanizer 3.1.0 (MIT) and Wikipedia's "Signs of AI writing".
