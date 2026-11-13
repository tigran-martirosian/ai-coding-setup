---
name: design-system
description: Show, write or refresh the project's DESIGN.md (its colours, type, spacing, components and look rules) and use it for the design work at hand.
disable-model-invocation: true
---

# The project's design system

A project with a look keeps its design system in one `DESIGN.md` (designmd.ai / Google Stitch format: tokens in YAML frontmatter, then Overview, Colors, Typography, Layout, Shapes, Components, Do's and Don'ts). Look for the project's own `DESIGN.md`, and for a screen inside Nimbalyst also the shared look of the Nimbalyst extensions (Ink shell, every extension and its fullscreen panels): `extensions/shared/DESIGN.md` in the setup's own folder (the newest `~/.claude/setup-source/v<version>/` after an update, else the folder it was installed from). That screen starts from the shared file, then the project's own.

**With no argument:** find the project's `DESIGN.md` (root first, then `.claude/`) and give a short summary: the accent, the fonts, the Do's and Don'ts. None found: say so and offer to write one.

**Writing or refreshing one** (`/design-system write`, or after a redesign): if the impeccable plugin is installed, follow its document mode (`/impeccable:document`). Without it: read the real CSS and write the tokens from it. Either way every value comes from the real CSS; no token is invented. Check afterwards that each colour in the frontmatter appears in the source.

**Design work** (`/design-system <what to design>`): read the `DESIGN.md` first, open one real reference as the global rule says, and build within its tokens and Do's and Don'ts. A change to the look that breaks a rule there goes to the user before it is built. After building, `/blind-screen-review`.
