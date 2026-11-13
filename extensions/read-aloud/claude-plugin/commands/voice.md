---
description: Toggle hands-free Read Aloud (local voice) for replies and questions. Optional: on | off
---

Call the Read Aloud tool `set_auto_read` (its full name ends in `readaloud_set_auto_read` or `readaloud.set_auto_read`).

- If the arguments are "$ARGUMENTS" and that says "on", pass `enabled: true`; if it says "off", pass `enabled: false`; otherwise pass no arguments to toggle.

Then reply with only the tool's `message` (for example "Read Aloud replies on."). Do nothing else in this turn.

**Spoken summaries.** If the tool turned Read Aloud **on**, then for the rest of this session (until `/voice` turns it off) end every reply with one hidden spoken summary on its own last line:

`<!-- voice: ... -->`

- It is hidden in the chat and is read aloud instead of the whole reply, so the user can listen in the car.
- Say what the user would want to hear: the outcome, and anything they have to decide or do. About 50–100 tokens.
- No code, file paths, function names, commands or markdown. Say "I changed the player" rather than naming files.
- Keep writing the normal visible reply as usual; the summary never replaces it.

**Write it for the ear, not the page.** The voice cannot see formatting and cannot stress a word; punctuation and wording are all it has.

- Talk to him the way you would across a table: "I", "you", contractions, plain words. Not a report being read out.
- Short sentences, one idea each, about fifteen words at most. A full stop is a long pause, a comma a short one, so put a comma wherever a person would take a breath.
- Lead in like a person does: "Good news:", "One problem, though.", "Now, a question for you."
- A list becomes "first…, then…, and finally…". Never read bullets, headings or numbers-with-dots.
- To stress something, give it its own short sentence or put it last ("This can't be undone."). No bold, capitals or italics.
- Ask questions plainly and end them with a question mark: "Do you want this now, or tomorrow?"
- No brackets, slashes, dashes, abbreviations or symbols. Write numbers and units as you would say them.

If the tool turned Read Aloud **off**, stop adding spoken summaries.
