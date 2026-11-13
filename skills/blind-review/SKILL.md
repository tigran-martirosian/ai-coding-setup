---
name: blind-review
description: Use after any change to something a person looks at (a page, screen, component, chart, or a design doc for a new system) and before calling it done - semi-blind reviewers who see only pictures rank the flaws, the author fixes the severe ones, stop rule ends the loop. Or runs /blind-review.
---

# Blind review

An author who built it cannot see its flaws. Reviewers who see only the result can: the user's own words were "you build it, you think it's okay, but run a reviewer over it and then you can tell the difference". The author never decides alone that a layout is fine.

Rubric (severity levels, checks, reviewer output format, follow-up template, design-doc questions): [rubric.md](rubric.md). Read it before step 3.

## 1. Size the change

| Change | Reviewers | Rounds |
|---|---|---|
| Small (a label, a colour, one element moved) | 1 | 1 |
| New or rebuilt page, screen, component or chart | 2, different personas, checks in a different order | up to 3 (rounds 2 and 3: one fresh reviewer each) |
| Design doc for a new system or big change (not visual) | 1 | at most 2, act only on serious and major findings |

Reviewers are Agent subagents on Opus at high effort: judgment belongs on the strongest model of this setup. The author is this session; fixes go to the author, never to the reviewer.

Done when: reviewer count and round limit are written down in the first line of your plan.

## 2. Make the pictures (visual work)

1. The author makes the change and builds it.
2. Screenshot at two sizes where the platform has them (large and small viewport, two scale settings), plus a phone or narrow shot for pages.
3. Cover every state the change has: hover, empty, full, locked, error, the longest text, every shipped language.
4. A new or rebuilt screen also gets one extra tightest-case shot and one shot of a comparable existing screen for style comparison.

Done when: each state in step 3 has a picture, and you opened each picture yourself to confirm it shows what it should (a blank or wrong-state shot is a failed shot).

## 3. Brief the reviewers

Semi-blind: each reviewer gets the pictures, the rubric sections 2 to 5, and a short word list defining the product's own terms. Reviewers get no code, no reasoning, no hints about suspected problems, no description of what changed. Open with a neutral question: "a friend asks: does this look good?"

Every reviewer answers the density question outright: "Is it too dense or crammed? yes/no and why." They also run the rubric checks and use the output format in the rubric.

For a design doc, send the doc, the word list and rubric section 6.

Done when: each brief holds pictures (or the doc), the word list, and nothing from the author's head.

## 4. Triage before fixing

The author checks every finding against the picture and marks it: fixed / disagree (with the evidence from the picture) / out of scope. A finding two reviewers raised counts double.

- Fix severity 3 and 4. Fix a 2 only when both reviewers raised it and it is cheap.
- Content claims a reviewer marks FALSE or UNVERIFIED are checked by the author against the newest source before any text is cut.
- Touch nothing outside the list.

Done when: every finding has a mark, and the fix list holds only 3-4 items (plus qualifying 2s).

## 5. Fix, reshoot, look

Fix the list, reshoot the same pictures, and open the new pictures yourself. A fix without a look is not a fix.

Rounds 2 and 3: a fresh reviewer gets BEFORE and AFTER pictures plus the claimed-fix list, using the rubric's follow-up template.

Done when: every fix has an AFTER picture you have looked at.

## 6. Stop rule

- **Clean** = in the last reshot pictures there is no open severity 3-4, every reviewer of the last round answered "no" to the density question, and every fix was looked at.
- A round with no severity 3-4 ends the loop.
- Stop after the last allowed round, or when a round's findings mostly undo the previous round's fixes: that is taste; keep the last version that passed checks 1-2 and 12-14.
- A 4 that survives round 3 means the layout is wrong: change the layout or cut content, then review once more from round 1.
- Leave unchased: severity 0-1, a finding with no check number, a finding with no picture and area, a "would look nicer if", an item already marked "accepted as is", a single reviewer's 2.

## 7. Report

Say what changed, the number of rounds, the findings fixed, and the findings left (with severity). Attach the final pictures. Done when: the report matches the last round's list.
