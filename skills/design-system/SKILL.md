---
name: design-system
description: Show, write or refresh the project's DESIGN.md (its colours, type, spacing, components and look rules) and use it for the design work at hand.
disable-model-invocation: true
---

# The project's design system

A project with a look keeps its design system in one `DESIGN.md` (designmd.ai / Google Stitch format: tokens in YAML frontmatter, then Overview, Colors, Typography, Layout, Shapes, Components, Do's and Don'ts). Look for the project's own `DESIGN.md`, and for a screen inside Nimbalyst also the shared look of the Nimbalyst extensions (Ink shell, every extension and its fullscreen panels): `extensions/shared/DESIGN.md` in the setup's own folder (the newest `~/.claude/setup-source/v<version>/` after an update, else the folder it was installed from). That screen starts from the shared file, then the project's own.

**With no argument:** find the project's `DESIGN.md` (root first, then `.claude/`) and give a short summary: the accent, the fonts, the Do's and Don'ts. None found: say so and offer to write one.

**Writing or refreshing one** (`/design-system write`, or after a redesign): if the impeccable plugin is installed, follow its document mode (`/impeccable:document`). Without it: read the real CSS and write the tokens from it. Either way every value comes from the real CSS; no token is invented. Check afterwards that each colour in the frontmatter appears in the source. After the eight core sections add two more:
- **Responsive Behavior:** one small-screen line per component (what collapses, stacks, scrolls or hides, and below which width).
- **Known Gaps:** the states not yet designed, at least error, empty, loading and long text, each with what happens today. The blind look shoots exactly these states.

The Don'ts carry an "AI look" line. These **AI tells** are blocking: a purple-to-blue gradient, gradient-filled text, neon cyan or acid green on near-black, cream with terracotta; Inter or Space Grotesk as the only face, one serif-italic word in a sans headline, a spaced-out all-caps label or pill above the headline, monospace labels as decoration; three identical icon-tile cards in a row, one giant hero number, cards inside bordered sections, fake code-editor chrome on a page not about code, 01/02/03 numbering on things that are not steps. The blind look checks these and a few more families (check 32 in `agents/blind-reviewer.md`).

**Design work** (`/design-system <what to design>`): read the `DESIGN.md` first, open one real reference as the global rule says, and build within its tokens and Do's and Don'ts. A change to the look that breaks a rule there goes to the user before it is built. After building, a blind look by the `blind-reviewer` agent, briefed as the lead skill's reference.md says ("A blind look's brief").

**A brand-new screen or page** starts with a short design plan, before any code:
- 4-6 named colours with hex values and the role of each;
- the typefaces and their roles;
- a rough ASCII wireframe;
- 3-4 principles;
- the one memorable element, with the rest kept disciplined.

Then check the plan against the AI tells above and rewrite anything that reads as a generic default; only then build. When the job's plan has a design step, this plan is the content of that step's design file, not a second document. A change that fits inside an existing `DESIGN.md` skips the plan.
