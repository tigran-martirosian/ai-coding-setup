# Blind review rubric

Reviewers get sections 2 to 5 and the pictures, nothing else: no code, no author reasoning.

## 1. Severity

| Level | Name | Test | Action |
|---|---|---|---|
| 4 | Blocker | A user cannot read, use or understand it: cut off, overlapped, off-screen, misleading. Almost everyone sees it. | Fix |
| 3 | Major | Noticed within seconds, looks broken or amateur (hard-to-read text, cramped, misaligned by several px, inconsistent), or fails at one of the shot sizes. | Fix |
| 2 | Minor | A picky user notices on a second look (1-2 px off, uneven gap, a shade off). | Fix only if both reviewers raised it and it is cheap |
| 1 | Cosmetic | Only a designer would mention it; another valid choice. | List only |
| 0 | Out of scope | Taste, a feature idea, content or business logic, something outside the screen, a deliberate platform look. | OUT-OF-SCOPE list |

## 2. Checks (yes = pass; report only the fails)

Each check is answered from the pictures. Default severity in brackets; the reviewer may change it with a reason.

**Layout**
1. [4] Inside the frame: every element sits fully inside its container at every shot size.
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
26. [3] One icon style: same density and outline on every icon.

**Effects and states**
27. [3] Effects mean something and stay inside their area: nothing over text or a control, nothing blinking several times a second.
28. [3] Every state is shown and designed: hover, empty, full, locked, error (plain words). A state missing from the pictures is itself a finding: "state X not shown".

**At a glance**
29. [3] 3-second test: after three seconds you can say what it is for, what to do first, where the main value is.
30. [3] Looks like the same product as its sibling screens: title position, button style, wording for the same thing.

**Story** (only when the work is a page read top to bottom)
31. [3] Scrolling as a newcomer: is each section's grouping sensible, is its message clear, is the order logical, where does interest drop?

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

## 5. Follow-up round (fresh reviewer; paste above section 4)

```
Follow-up review. Claimed fixed: [check # + where + one line each]. You get BEFORE and AFTER pictures.
(a) Each claimed fix: FIXED / NOT FIXED / PARTLY, with picture and area.
(b) Did a fix break something? Check number and severity.
(c) Per screen: BETTER / SAME / WORSE than before, and why.
(d) Any new severity 3 or 4. Do not report 2 or lower.
(e) Do not reopen: [accepted-as-is list]. Do not re-raise anything out of scope.
Then the DENSITY answer as in round 1.
```

## 6. Design-doc reviewer (new system or big change, not visual)

The reviewer gets the doc and a short word list of the product's terms, nothing more. Questions: does the design hold together, what breaks at the edges, what is missing, what is the riskiest assumption. Findings are rated serious / major / minor; the author acts on serious and major only.
