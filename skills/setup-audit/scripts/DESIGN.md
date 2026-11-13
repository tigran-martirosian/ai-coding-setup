---
name: Usage dashboard
description: Dark slate utility dashboard for plan usage and cost, data first, one sky-blue accent.
colors:
  page: "#0f172a"
  panel: "#020617"
  rule: "#1e293b"
  ink: "#f8fafc"
  ink-secondary: "#cbd5e1"
  muted: "#94a3b8"
  accent: "#38bdf8"
  good: "#10b981"
  warn: "#eab308"
  bad: "#ef4444"
  series-1: "#38bdf8"
  series-2: "#a78bfa"
  series-3: "#64748b"
  series-0: "#475569"
  tooltip-border: "#334155"
  hover: "rgba(148,163,184,.1)"
  select: "rgba(56,189,248,.35)"
typography:
  body:
    fontFamily: "\"Segoe UI\", system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "\"Segoe UI\", system-ui, -apple-system, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
  headline:
    fontFamily: "\"Segoe UI\", system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
  label:
    fontFamily: "\"Segoe UI\", system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  figure:
    fontFamily: "\"Segoe UI\", system-ui, -apple-system, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tabular-nums"
  code:
    fontFamily: "Consolas, ui-monospace, monospace"
    fontSize: "13px"
rounded:
  sm: "3px"
  md: "8px"
  lg: "10px"
spacing:
  xs: "8px"
  sm: "14px"
  md: "16px"
  lg: "24px"
  page: "28px"
components:
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "18px 22px 20px"
  table-row:
    textColor: "{colors.ink}"
    padding: "8px 14px 8px 0"
  table-row-hover:
    backgroundColor: "{colors.hover}"
  table-row-open:
    backgroundColor: "{colors.hover}"
  table-header:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
  selection:
    backgroundColor: "{colors.select}"
  range-button-on:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.panel}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  chip:
    textColor: "{colors.accent}"
    rounded: "{rounded.md}"
    padding: "2px 10px"
  chip-hover:
    backgroundColor: "{colors.hover}"
  popover:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  status-good:
    textColor: "{colors.good}"
  status-warn:
    textColor: "{colors.warn}"
  status-bad:
    textColor: "{colors.bad}"
---

# Design System: Usage dashboard

## Overview

The template is `usage-dashboard.html` in this folder; `~/.claude/reports/usage-dashboard.html` is built output, never edited.

**Creative North Star: "The Instrument Panel"**

A dark slate utility dashboard, data first. Flat panels sit on a slate page, numbers lead and chrome stays out of the way. It mirrors the look of Nimbalyst's usage popover. The page reads top down: the plan, who used it, where it went.

There is one accent, sky blue, for interaction and for the first data series. Green, yellow and red appear only to say how a limit or a state is doing. Nothing else is coloured.

**Key Characteristics:**
- Flat panels, one border, no shadows.
- Segoe UI throughout, tabular figures for every number.
- One sky-blue accent; good, warn and bad are status only.
- Hover and selection are translucent tints, never new hues.

## Colors

Slate neutrals carry the whole page; sky blue is the only chromatic voice, and three status colours are reserved for meaning.

### Primary
- **Sky Accent** (`accent`): range button that is on, chips, focus outline, caret, links of interaction. First data series (`series-1`) uses the same value.

### Neutral
- **Slate Page** (`page`): the page background and the background of an opened detail row.
- **Ink Black Panel** (`panel`): every panel, input, range control and the popover; also the text on the accent button.
- **Slate Rule** (`rule`): all borders, table row lines, bar tracks.
- **Near-White Ink** (`ink`): primary text. **Soft Ink** (`ink-secondary`): legends, descriptions, inactive controls. **Slate Muted** (`muted`): notes, units, table headers, axis labels.
- **Popover Edge** (`tooltip-border`): the popover border and the scrollbar thumb.
- **Series** (`series-1` accent blue, `series-2` violet, `series-3` slate, `series-0` dark slate): the chart and split-bar segments; `series-0` also draws baselines.
- **Hover Tint** (`hover`): hover and open state of rows, days, ranks and buttons; also the busy-hour column.
- **Selection Tint** (`select`): text selection.

### Status
- **Good** (`good`), **Warn** (`warn`), **Bad** (`bad`): the state of a limit or a row. Bad and warn text in a limit footer is semibold.

### Named Rules
**The Status Meaning Rule.** Green, yellow and red mean good, warn and bad, and nothing else. Never use them for decoration, series or emphasis.

**The One Accent Rule.** Sky blue is the only accent. A new highlight reuses it or uses a neutral.

## Typography

**Body Font:** Segoe UI (with system-ui, -apple-system, sans-serif)
**Code Font:** Consolas (with ui-monospace, monospace), only inside detail rows

**Character:** Plain system sans, weights 400 and 600 only. Hierarchy comes from size and weight, never from a second family.

### Hierarchy
- **Figure** (600, 30px, 1): the percentage of a limit. Other big numbers are 26px, 600.
- **Title** (600, 22px, 1.2): the page heading.
- **Headline** (600, 17px, 1.3): panel headings.
- **Body** (400, 15px, 1.5): everything by default.
- **Label** (400, 13px): notes, table headers, axis labels, legends, popover text.

### Named Rules
**The Tabular Rule.** Every number uses tabular figures and is right aligned in tables.

## Layout

One centred column, max 1120px, padding 32px 28px 96px (20px 14px 64px under 900px). Panels stack with a 16px gap. Two-column grids (plan, side by side lists) use equal `minmax(0, 1fr)` columns and collapse to one column under 900px. Tables are 100% wide, rows have 8px vertical padding, and wide tables scroll sideways inside their panel. Ranked lists are a four-column grid (label, bar, value, note) and drop the note on small screens.

## Elevation & Depth

Flat. Depth comes from tone only: the near-black panel sits on the slate page, a 1px rule marks the edge. The only floating element is the popover, which has a border and no shadow. A hover or selection is a translucent tint over the existing surface.

### Named Rules
**The Flat Panel Rule.** A panel is never nested in another panel, and nothing gets a shadow.

## Shapes

Gentle corners: 10px on panels, 8px on controls, inputs, chips, popover and the "more" button, 3-4px on bars and tracks, 2px on legend dots. Borders are 1px in the rule colour. Focus is a 2px accent outline offset by 2px. Transitions are .15s and switch off for reduced motion.

## Components

### Cards / Panels
- **Corner Style:** 10px.
- **Background:** the panel colour, with a 1px rule border.
- **Shadow Strategy:** none.
- **Internal Padding:** 18px 22px 20px (16px on small screens).

### Table rows
- **Style:** text on the panel, a 1px rule line under every row, 8px vertical padding, header cells muted at 13px.
- **Hover:** background becomes the hover tint (`tr.row:hover`), cursor pointer, .15s transition.
- **Open:** an expanded row keeps the hover tint; its detail row uses the page colour.
- **Selected text:** the selection tint.

### Range buttons and chips
- **Range:** a segmented control with rule dividers; the active button is accent filled with panel-coloured semibold text; hover is the hover tint.
- **Chip:** accent outline and accent text, 8px radius, hover is the hover tint.

### Status text
- **Good / Warn / Bad:** text colour only, set by the `good`, `warn` and `bad` rules. A limit bar uses the same colour as its percentage.

### Popover
- **Style:** panel background, tooltip-border 1px edge, 8px radius, 13px text, label left and value right.

## Do's and Don'ts

### Do:
- **Do** keep colour meaning: good, warn and bad only for the state of a limit or row.
- **Do** use the single sky-blue accent for interaction and the first series.
- **Do** take every colour from the frontmatter tokens, which mirror the `:root` custom properties of `usage-dashboard.html`.
- **Do** use tabular figures and right alignment for numbers.
- **Do** use the hover tint for hover and open rows, and the selection tint for selection.

### Don't:
- **Don't** use green, yellow or red as decoration, series or emphasis.
- **Don't** add a second accent colour.
- **Don't** invent a token; add it to `:root` in the template first, then here.
- **Don't** add shadows or nest a panel inside a panel.
- **Don't** edit `~/.claude/reports/usage-dashboard.html`; change the template and rebuild.

## Responsive Behavior

One breakpoint, `max-width: 900px`. Touch targets are the desktop sizes; nothing grows for touch.

- **Page:** padding drops from 32px 28px 96px to 20px 14px 64px.
- **Panels:** padding drops to 16px.
- **Plan and two-column grids:** collapse to one column.
- **Ranked lists:** the note column is hidden; columns become label (at least 80px), bar, 64px value.
- **Chat table:** the second and third columns are hidden; titles cut at 200px instead of 440px; the split bar cell is 90px wide.
- **Search field:** full width.
- **Other tables:** keep every column and scroll sideways inside their panel.
- **Range buttons, chips, popover:** unchanged.

## Known Gaps

- **Error:** none designed. The data is baked into the page at build time; if it is missing or broken, the script stops and the panels stay blank.
- **Empty:** designed as a muted one-line sentence in the panel ("Nothing recorded in this period.", "No chats match."). The daily chart hides itself when the range has fewer than two days.
- **Loading:** none, and none needed: the page is static output with the data inside it.
- **Long text:** rank labels, chat titles and part descriptions cut with an ellipsis, the full text in a `title` tooltip only (not reachable by touch). Gemini titles wrap. Long lists show the first rows and a "Show all" button.
