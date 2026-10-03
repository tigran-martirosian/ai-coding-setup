---
name: picture
description: Generate a picture with Codex of how something looks, works or is set up, in about 5 minutes, and show it only after it passes a short written checklist. Use whenever the user asks to see, picture, draw or illustrate something ("show me how this will look", "what would the setup look like"), and before any Codex-generated image is made or shown.
---

# A generated picture, checked before it is shown

**Time: about 5 minutes when the first try passes, about 8 with the one fix**: speed
comes first, and the picture does not have to be perfect. The user sees one picture: the one that
passed. A picture with a known error is never shown, linked or described, with or without a disclaimer.
`picture.mjs gen` refuses to generate until steps 1 and 2 are on disk, and the `picture-gate` hook
refuses to show a Codex picture without steps 1, 2 and 5.

Work in the job's own folder (quick-tasks: `<yyyy-mm-dd>-<name>/`; ask-anything: `answers/sources/<topic>/`).
The script is `~/.claude/shared-skills/picture/picture.mjs`, called `$P` below.

1. **Facts first, in 2 minutes.** Two things, at the same time:
   - one saved reference picture that shows the WHOLE object, uncropped (a product photo, or a photo of
     it in use if a search turns one up at once). The image model copies what the photo shows and
     invents the rest, so a cropped photo gives wrong proportions;
   - one quick lookup (Codex `--search` at low effort, in the background) for the facts the layout
     hangs on: the real sizes in cm, what goes in where and comes out where, how it is mounted.

   Write `facts.md`:
     ```
     ## In use
     - photos/product.jpg: the whole machine, from https://...
     ## Facts
     - The water goes in at the top tank. source: https://...
     - The handle sticks out 12 cm; the machine is 30 cm tall. source: https://...
     ```
   The reference picture goes under "In use" (`- none: <why>` only when the thing does not exist yet).
   At least three facts, each with a source: a saved picture, a link, or `user`. Don't inherit facts
   from an earlier prompt or picture. **A fact the layout hangs on that has no source is not guessed
   and not a footnote:** ask the user, or take 3 more minutes for video frames (see "Careful run").
2. **Checklist.** Write `checklist.md`: these four standing lines, with their tags, filled in for this
   subject, plus 4 lines of its own that can be checked by looking, including what the user said they
   don't want and "nothing in the picture that is not named in the prompt".
   - `[view]` a flat, straight-on front or side view: the front edge of the table or base is one
     horizontal line, legs and uprights are vertical, every rectangle is a rectangle. (Another view
     only when the user asked for it; then the line names that view.)
   - `[sizes]` the parts have their real proportions; name the two or three sizes that matter, in cm.
   - `[physical]` each thing comes out of, goes into and is attached to a place where it physically
     can; name each one ("the water comes out at the tap under the tank, not out of the side").
   - `[fasteners]` every clamp, bolt, strap and hand grips two real surfaces and holds what it is
     meant to hold; name each one. (None in the picture: say so.)

   Every number in the checklist comes from `facts.md`, never from the prompt's own choices.
3. **Prompt**, in `prompt.txt` (the fix: `prompt-2.txt`). Defaults, unless the user asked otherwise:
   - plain white background, instructional illustration, only the named objects, the words "nothing else";
   - the view in geometric terms: "a flat front view like an engineering drawing: the table's front
     edge is one horizontal line, the legs are vertical, the top is one slab of even thickness". No
     three-quarter view: that is where the image model bends tables and misplaces parts. In a flat
     view nothing can lie on the table top and still be seen, so let it hang, stand or be held;
   - room for the object's real height: say how much of the picture's width the object takes and pick
     the format to fit (a wide frame with a hand above and a table below squashes a tall object);
   - the reference picture attached and described ("photo 1 shows the whole machine; copy its proportions");
   - the process runs in one direction like a diagram (left to right, or top to bottom);
   - sizes in cm for the parts that matter; where each thing comes out from, not only in which
     direction; every connection stated: what each part is attached to, what each clamp or hand touches;
   - every clamp, bolt or strap drawn where it is seen side-on, gripping both surfaces it holds;
   - hands only, no body; about five objects at most; few labels, each with its exact text;
   - the checklist at the end, under "Check before finishing".

   A new job is always a new picture. Never start from a picture of an earlier job, from one the user
   rejected, or from a try whose `[view]` failed: an edit keeps the view and the layout.
4. **Generate** (1 to 2 minutes; give the Bash call a 10-minute timeout):
   `node $P gen prompt.txt tries/try-1.png photos/product.jpg`
5. **Check.** Open the picture with Read and write `tries/try-1.check.md`, one line per checklist line:
   `- PASS [view]: <the line> (what you see)` or `- FAIL: <the line> (what is wrong)`.
   - Sizes have a tolerance: the picture has to represent what was asked for, not match it to the
     centimetre. A part off by about an inch (2 to 3 cm) here or there passes; write the numbers in
     the `[sizes]` line. A size fails when anyone comparing with the reference would call it wrong at
     a glance (a part far longer or shorter than the real one).
   - No tolerance for what is wrong in kind: a skewed table, a thing coming out of the wrong place,
     the wrong side, a part attached to nothing. "Unclear" is FAIL.
   - `- MINOR:` is only for a flaw that changes nothing the user would do or believe (a label's font).
     A clearly wrong size, a wrong position, exit point or attachment is FAIL. At most two MINOR lines.
6. **Any FAIL: the picture is not shown.** One fix, so 2 tries in all:
   - a small fault on a try whose `[view]` passed: an edit pass. Attach the try and the reference, and
     write a prompt that says "keep everything, change only these N things";
   - a wrong view or layout: a new prompt that removes the cause. Never an edit.
7. **Show only the try that passes,** with `mcp__nimbalyst__display_to_user`: the try file itself, and
   next to it the reference picture. Say in one sentence what the MINOR lines are, if any. Don't
   mention, link or show the failed try; it stays in `tries/`.
   - A copy for the answer folder: copy the picture first, then its `.check.md`, and add the line
     `Job folder: <path>` to the copied check file.
   - The session stays `validating` until the user says the picture is right. If they reject it, add
     `- FAIL: rejected by the user: <what they said>` to its check file and offer a careful run.
8. **Neither try passes:** say so plainly, show neither, and offer two ways on: a careful run (about
   15 to 20 minutes) or a drawn diagram (SVG or Excalidraw), which is exact where image models are not.

## Careful run (only when the user asks for it, or after they reject a picture)

The slow, thorough version: about 15 to 20 minutes, up to 4 tries.

- Frames of the thing in use: `node $P frames <youtube id or link> yt` saves a video's still-frame
  sheets (no video or audio is downloaded); open the sheets with Read, then
  `node $P cut yt/<sheet>.jpg <row> <column> yt/use-<what>.jpg`. Save 2 to 4 and list them under "In use".
  "Which side, which way" questions are answered by frames; a Codex web search cannot watch video.
- A second pair of eyes on every try: `node $P review tries/try-1.png` writes `tries/try-1.review.md`
  with the points R1, R2, ... Answer each in the check file (`- FAIL R1: ...` when true,
  `- PASS R1: <what the picture really shows>` when not). It reports too much rather than too little;
  settle each point by measuring, not by impression. The gate holds the picture until every point is answered.
