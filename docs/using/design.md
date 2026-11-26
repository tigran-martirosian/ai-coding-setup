# Design

Install and update turn on two design plugins, and Stratus adds two design commands of its own. A plugin you
removed stays removed at the next update.

- **`frontend-design`** (Anthropic): guidance for a distinctive look instead of a template.
- **`impeccable`** (Paul Bakaus): commands to design, critique, audit and polish an interface, and checks on
  interface edits.
- **`/gridlines`** draws guide lines down an interface, finds every item that misses its line and fixes the
  paddings, so sidebars, toolbars, panels, menus and tables share a few edges. It follows Karri Saarinen's redraw of
  the Linear sidebar.
- **`/design-system`** shows, writes or refreshes the project's `DESIGN.md` (its colours, type, spacing, components
  and look rules) and uses it for the design work at hand. It runs only when you type it.
