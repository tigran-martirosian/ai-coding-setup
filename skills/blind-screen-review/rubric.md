# Screen review rubric

The reviewer gets the Level, Name and Test columns of section 1, sections 2 to 4, the pictures and a short word list; the brief ends with `SYSTEMS MAP: none`. Nothing else: no code, no author reasoning.

## 1. Severity

| Level | Name | Test | Action |
|---|---|---|---|
| 4 | Blocker | A user cannot read, use or understand it: cut off, overlapped, off-screen, misleading, or text that fails the readability and contrast checks (13-14). Almost everyone sees it. | Fix |
| 3 | Major | Noticed within seconds, looks broken or amateur (cramped, misaligned by several px, inconsistent), or fails at one of the shot sizes. | Fix |
| 2 | Minor | A picky user notices on a second look (1-2 px off, uneven gap, a shade off). | Fix only if it is cheap |
| 1 | Cosmetic | Only a designer would mention it; another valid choice. | List only |
| 0 | Out of scope | Taste, a feature idea, content or business logic, something outside the screen, a deliberate platform look. | OUT-OF-SCOPE list |

## 2. Checks (yes = pass; report only the fails)

Each check is answered from the pictures. Default severity in brackets; the reviewer may change it with a reason.

**Layout**
1. [4] Inside the frame: every element sits fully inside its container at every shot size, a name inside its own hover or selected box included.
2. [4] No overlap: no two elements overlap unless plainly intended.
3. [3] Breathing room: every text string has a visible gap to its box edge and to its neighbours.
4. [3] Even padding: left and right look equal, top and bottom equal.
5. [3] Groups read as groups: the gap between groups is clearly bigger than the gap inside one.
6. [2] Even repeats: repeated rows, buttons and cards have identical gaps.
7. [3] Container fits content: no large empty area, nothing squeezed into a corner, no side much heavier without reason.

**Density**
8. [3] Not crammed: answered outright in the output (section 4).
9. [3] Countable: at most about 7 distinct groups; a first-time user could name each block's job in five seconds.
10. [3] Not empty either: no big flat area, no tiny content in a huge container that looks unfinished.
11. [3] Tightest case holds: at the smallest or largest shot size, with the longest string, it is still not crammed or clipped.

**Text**
12. [4] Fully visible: no clipped letter, cut-off end or overflow, in every language the product ships.
13. [4] Readable at the smallest shot size without squinting.
14. [4] Contrast: body text clearly stands out from what is behind it (aim 4.5:1; large text and icons 3:1).
15. [3] Few styles: at most 2-3 text sizes or styles; title, label, value and hint differ by more than colour.
16. [3] Clean wraps: no mid-word break, no lone word on a line where avoidable.
17. [3] No raw strings: no placeholder keys, `%s`, `null`, garbled characters, "TODO", fallback-font glyphs.
18. [3] Not colour alone: essential information also has an icon, sign, position or word.

**Colour**
19. [3] Palette fits the rest of the product (look at a comparison picture beside it).
20. [3] Every colour has a role (background, border, text, accent, good, bad); one accent does the "look here" job.
21. [3] Colours keep their meaning across screens and differ in lightness too.
22. [3] Disabled looks disabled and stays readable.

**Pixel craft**
23. [3] Crisp at every shot size: no blurry, half-pixel or stretched edge.
24. [3] Grid: aligned items share one pitch and equal spacing; icons are centred the same way.
25. [3] Clean borders: no distorted corner, seam or stray line; light comes from one direction.
26. [3] One icon style: same density, outline and drawn size on every icon; icons side by side in one row or column that differ in size are a 3, not an uneven repeat (6).

**Effects and states**
27. [3] Effects mean something and stay inside their area: nothing over text or a control, nothing blinking several times a second.
28. [3] Every state is shown and designed: hover, empty, full, locked, error (plain words). A state missing from the pictures is itself a finding: "state X not shown".

**At a glance**
29. [3] 3-second test: after three seconds you can say what it is for, what to do first, where the main value is.
30. [3] Looks like the same product as its sibling screens: title position, button style, wording for the same thing.

**Story** (only when the work is a page read top to bottom)
31. [3] Scrolling as a newcomer: is each section's grouping sensible, is its message clear, is the order logical, where does interest drop?

**AI look**
32. [3] No AI tells: the screen looks chosen for this product, not like the stock look generated pages share. The finding names the tell seen, from these families:
    - Palette: a purple-to-blue gradient, gradient-filled text, cyan or acid-green neon on near-black, cream with terracotta.
    - Type: Inter or Space Grotesk as the only face, one serif-italic accent word inside a sans headline, an all-caps spaced-out label or pill badge above the headline, monospace labels used as decoration.
    - Layout scaffolds: three identical icon-tile cards in a row, one giant hero number, cards inside bordered sections, fake code-editor window chrome on a page that is not about code, 01/02/03 numbering on things that are not steps.
    - Surfaces: a coloured stripe down one edge of a rounded card, frosted-glass blur as decoration, a glow that follows the cursor, a grain overlay, glowing shadows.
    - Copy: emoji in headings, dashes as the main punctuation, buzzwords ("seamless", "supercharge", "next-level"), meta lines strung together with middle dots, an arrow on every button.
    - Untouched defaults: a component library's stock look left as it ships, the same thin-line icon set on everything.

**Use** (judged from the shot's scale and the states shown; a check whose element is not on the screen passes)
33. [3] Big enough to hit: every tap or click target is at least 44 px for touch (24 px for a mouse-only screen) on its short side at the shot's scale, with small targets spaced so a finger cannot hit the neighbour; the main action sits where a thumb or pointer reaches it. Measure against the scale given with the picture; with no scale, take one image pixel as one CSS pixel on a desktop-width shot and say so, otherwise say "unsure" and rate 1. Judge only what looks clickable (a button, tab, link, toggle or chevron).
34. [3] Clear figure and ground: behind an open dialog, sheet or menu, the page is dimmed or blurred so the front layer is plainly the one in use; nothing the user needs is styled or placed like an ad (a banner strip, a boxed promo at the side or top, stock-photo tile).
35. [2] Choices shown up front: a choice the user must make shows its options on the screen, a few at a time (about 5), with the current, default or recommended one marked; a long list starts with search or filters, and a short one is not hidden in a dropdown.
36. [3] Steps read as one flow: the steps of a sequence (checkout, setup, a pipeline) are joined by one shared background or frame, a line or arrows, or a numbered progress bar, and the current step is marked; gaps alone are not enough.
37. [2] More is visible: a row or list that scrolls sideways shows part of the next item cut by the edge (or arrows or dots), so it does not look finished. Shortened text ending in "…" is not a scroll.
38. [2] Key items at the ends: in a menu, nav bar, list or row of options, the most important item is first or last, not in the middle. A set with a natural order (time ranges, sizes, steps, a sorted list) keeps that order and passes.
39. [3] Forms in one column: fields run in one column (short related fields such as city and postcode may share a row), labels sit outside the fields (a lone search or filter box may use a placeholder only), and on a pay or order screen the total stays in view next to the button. A button amount that differs from the shown total is a 4.

## 3. Persona and rules

- Persona: a picky user on a large monitor and on a small device. Judge only what a user sees.
- Judge reading, not truth. Mark a content claim FALSE only with a quoted contradicting fact line; otherwise UNVERIFIED, and the author checks it in the newest source before any text is cut.
- Every finding cites a check number, the picture, the size and the area, what the user sees, who notices and when, one concrete fix, and what that fix could break.
- At most 12 findings, worst first. "No issues" is a good answer. Unsure = say so and rate 1.
- No scores, no grades, no praise, no "redo the whole design".

## 4. Output format

```
FINDINGS (worst first)
1. [check #] [severity] where - what the user sees - who notices - fix (could break: ...)
DENSITY: Is it too dense or crammed? yes/no, why. Tightest shot still not crammed? yes/no, why.
3-SECOND TEST: what it is for, what I would do first.
OUT-OF-SCOPE: one line each, no severity.
```

## 5. Follow-up round (sent in round 2 only)

```
Follow-up review. Claimed fixed: [check # + where + one line each]. You get BEFORE and AFTER pictures.
(a) Each claimed fix: FIXED / NOT FIXED / PARTLY, with picture and area.
(b) Did a fix break something? Check number and severity.
(c) Per screen: BETTER / SAME / WORSE than before, and why.
(d) Any new severity 3 or 4. Do not report 2 or lower.
(e) Do not reopen: [accepted-as-is list]. Do not re-raise anything out of scope.
Then the DENSITY answer as in round 1.
```
