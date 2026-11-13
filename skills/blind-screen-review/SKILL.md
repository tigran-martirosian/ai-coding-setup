---
name: blind-screen-review
description: Blind review of what a person looks at - a page, screen, menu, HUD, inventory, component or chart. Use after building or changing one and before calling it done, when asked to "review the screen", "check how it looks" or "blind review", or on /blind-screen-review. One reviewer sees only screenshots of every state, ranks the flaws, the author fixes the serious ones, a stop rule ends the loop.
---

# Blind screen review

An author who built a screen cannot see its flaws. A reviewer who sees only the pictures can: the user's own words were "you build it, you think it's okay, but run a reviewer over it and then you can tell the difference". The author never decides alone that a screen is fine. The second and third build of a screen beats the first, because a fresh eye found what the author could not.

Code, plans, text and data are not this skill's work: they go to the `reviewer` agent with its usual brief.

Rubric (severity levels, picture checks, persona, output format, follow-up template): [rubric.md](rubric.md). Read it before step 3.

## 1. Size the change

| Change | Rounds |
|---|---|
| Small (a label, a colour, one element moved) | 1 |
| New or rebuilt page, screen, menu, component or chart | up to 2 (the second look: the same reviewer, on the fixes) |

One reviewer, always: a second one, a second persona or an A/B pair adds nothing. The reviewer is the `reviewer` agent (Agent tool, `subagent_type: "reviewer"`, Opus at high effort), and the rubric's output format replaces its usual one. The author is this session; fixes go to the author, never to the reviewer.

Done when: the round limit is written in the first line of your plan.

## 2. Make the pictures

1. The author makes the change and builds it.
   - **Web page with the impeccable plugin installed** (`~/.claude/plugins/cache/impeccable/impeccable/<version>/skills/impeccable/scripts/impeccable`, `impeccable.cmd` from cmd or PowerShell): run its detector on the file, then on the page's `file://` or `http(s)://` URL at phone width, with `"<scripts>/impeccable" detect <file>` and `"<scripts>/impeccable" detect --viewport 390x844 <url>`. Findings print to stderr; read them instead of the exit code (2 means findings, but the `.cmd` can print `exit 0` under Git Bash). Fix every finding before the screenshots, so the reviewer's look goes to what a scanner cannot see. A finding that is the project's deliberate choice goes into its `DESIGN.md` instead. Without the plugin, skip this.
2. Screenshot at two sizes where the platform has them (large and small viewport, two GUI scale settings), plus a phone or narrow shot for web pages.
3. Cover every state the change has: hover, empty, full, locked, error, the longest text, every shipped language.
4. A new or rebuilt screen also gets one extra tightest-case shot and one shot of a comparable existing screen for style comparison.

Done when: each state in step 3 has a picture, and you opened each picture yourself to confirm it shows what it should (a blank or wrong-state shot is a failed shot).

## 3. Brief the reviewer

Semi-blind: the reviewer gets the pictures, rubric sections 2 to 5, and a short word list defining the product's own terms. It gets no code, no reasoning, no hints about suspected problems, no description of what changed. Open with a neutral question: "a friend asks: does this look good?"

The reviewer answers the density question outright: "Is it too dense or crammed? yes/no and why." It also runs the rubric checks and uses the output format in the rubric.

End the brief with the line `SYSTEMS MAP: none`: the map hooks add a project's connections to a reviewer's brief, and that marker keeps them out.

Done when: the brief holds the pictures, the word list, and nothing from the author's head.

## 4. Triage before fixing

The author checks every finding against the picture and marks it: fixed / disagree (with the evidence from the picture) / out of scope.

- Fix severity 3 and 4. Fix a 2 only when it is cheap.
- Content claims a reviewer marks FALSE or UNVERIFIED are checked by the author against the newest source before any text is cut.
- Touch nothing outside the list.

Done when: every finding has a mark, and the fix list holds only 3s and 4s (plus cheap 2s).

## 5. Fix, reshoot, look

Fix the list, reshoot the same pictures and open the new pictures yourself. A fix without a look is not a fix.

Round 2: the same reviewer, by SendMessage, gets the BEFORE and AFTER pictures plus the claimed-fix list, using the rubric's follow-up template (section 5).

Done when: every fix has an AFTER picture that you have looked at.

## 6. Stop rule

- **Clean** = in the last round no severity 3-4 is open, every fix was looked at, and the reviewer of the last round answered "no" to the density question.
- A round with no severity 3-4 ends the loop.
- Stop after the last allowed round (two), or when a round's findings mostly undo the previous round's fixes: that is taste; keep the last version that passed (checks 1-2 and 12-14).
- A 4 that survives round 2 means the layout is wrong: change the layout, then review once more from round 1.
- Leave unchased: severity 0-1, a finding with no check number, no picture or no area, a "would look nicer if", an item already marked "accepted as is".

## 7. Report

Say what changed, the number of rounds, the findings fixed, and the findings left (with severity). Attach the final pictures. Done when: the report matches the last round's list.
