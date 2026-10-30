---
name: blind-review
description: Use when asked to "review this", "blind review" or "check this over", and after any big piece of work before calling it done (code, a design doc or plan, written text, a data or research result, a page or screen) - reviewers who see only the request and the result (pictures for visual work) rank the flaws, the author fixes the serious ones, a stop rule ends the loop. Or runs /blind-review.
---

# Blind review

An author who built it cannot see its flaws. Reviewers who see only the result can: the user's own words were "you build it, you think it's okay, but run a reviewer over it and then you can tell the difference". The author never decides alone that big work is fine. The second and third build of anything big beats the first, because a fresh reader found what the author could not.

Two paths share one loop. **Pictures** (a page, screen, component, chart): reviewers see only screenshots. **Everything else** (code, a design doc, a plan, written text, a data or research result, another review's report): reviewers see only the original request and the finished result.

Rubric (severity levels, picture checks, reviewer output format, follow-up templates, reviewer questions for non-picture work): [rubric.md](rubric.md). Read it before step 3.

## 1. Size the change

| Change | Reviewers | Rounds |
|---|---|---|
| Small (a label, a colour, one element moved; one function, one paragraph) | 1 | 1 |
| New or rebuilt page, screen, component or chart | 2, different personas, checks in a different order | up to 3 (rounds 2 and 3: one fresh reviewer each) |
| Big work that is not a picture (code across files, a design doc, a plan, a long text, a data or research result) | 2, different lenses (rubric section 6) | up to 3 (rounds 2 and 3: one fresh reviewer each) |

Reviewers are Agent subagents on the strongest model available, at high effort: judgment belongs there. The author is this session; fixes go to the author, never to the reviewer.

Done when: reviewer count and round limit are written down in the first line of your plan.

## 2. Make the pictures (visual work only)

1. The author makes the change and builds it.
2. Screenshot at two sizes where the platform has them (large and small viewport, two scale settings), plus a phone or narrow shot for pages.
3. Cover every state the change has: hover, empty, full, locked, error, the longest text, every shipped language.
4. A new or rebuilt screen also gets one extra tightest-case shot and one shot of a comparable existing screen for style comparison.

Done when: each state in step 3 has a picture, and you opened each picture yourself to confirm it shows what it should (a blank or wrong-state shot is a failed shot).

For anything else, collect the result instead: the files or diff for code, the doc, the plan, the text, the data with the query or method that produced it. Done when: you opened what you will hand over and it is the finished version.

## 3. Brief the reviewers

**Pictures.** Semi-blind: each reviewer gets the pictures, the rubric sections 2 to 5, and a short word list defining the product's own terms. Reviewers get no code, no reasoning, no hints about suspected problems, no description of what changed. Open with a neutral question: "a friend asks: does this look good?"

Every reviewer answers the density question outright: "Is it too dense or crammed? yes/no and why." They also run the rubric checks and use the output format in the rubric.

**Everything else.** Each reviewer gets the original request in the user's own words, the finished result (paths to the files or diff, the doc, the text, the data), a short word list of the product's terms, and rubric sections 6 and 7 with that reviewer's lens. Reviewers get none of the author's reasoning, drafts, earlier versions or chat, and no hints about suspected problems. Reviewers of code may read the surrounding files and run the tests. Open with: "a colleague asks: is this ready to hand in?"

Done when: each brief holds pictures (or the request and the result), the word list, and nothing from the author's head.

## 4. Triage before fixing

The author checks every finding against the picture or the result and marks it: fixed / disagree (with the evidence from the picture or the result) / out of scope. A finding two reviewers raised counts double.

- Pictures: fix severity 3 and 4. Fix a 2 only when both reviewers raised it and it is cheap.
- Everything else: fix serious and major. Fix a minor only when both reviewers raised it and it is cheap.
- Content claims a reviewer marks FALSE or UNVERIFIED are checked by the author against the newest source before any text is cut.
- Touch nothing outside the list.

Done when: every finding has a mark, and the fix list holds only the serious ones (plus qualifying minors).

## 5. Fix, check, look

Fix the list. Pictures: reshoot the same pictures and open the new pictures yourself. Everything else: reread the changed parts, rerun the tests or the numbers, and confirm each fix does what the finding asked. A fix without a look is not a fix.

Rounds 2 and 3: a fresh reviewer gets the BEFORE and AFTER (pictures, or the result before and after) plus the claimed-fix list, using the rubric's follow-up template (section 5 for pictures, section 7 for everything else).

Done when: every fix has an AFTER that you have looked at.

## 6. Stop rule

- **Clean** = in the last round's result there is no open severity 3-4 (serious or major, for work that is not a picture), every fix was looked at, and for pictures every reviewer of the last round answered "no" to the density question.
- A round with no severity 3-4 ends the loop.
- Stop after the last allowed round (three), or when a round's findings mostly undo the previous round's fixes: that is taste; keep the last version that passed. For pictures that means checks 1-2 and 12-14.
- A 4 (or a serious finding) that survives round 3 means the layout or the approach is wrong: change the layout, the design or the method, then review once more from round 1.
- Leave unchased: severity 0-1, a finding with no check number (pictures) or no quoted location (everything else), a finding with no picture and area, a "would look nicer if", an item already marked "accepted as is", a single reviewer's 2.

## 7. Report

Say what changed, the number of rounds, the findings fixed, and the findings left (with severity). Attach the final pictures, or name the final files. Done when: the report matches the last round's list.
