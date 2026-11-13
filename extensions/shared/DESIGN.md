---
name: Nimbalyst extensions (shared look)
description: One quiet, premium look for every extension and for the Ink shell; a theme changes colour only.
colors:
  # Normative values are the --x-* tokens in tokens.css, derived from the theme's --nim-* colours.
  # The hex below is the default theme, Ink Aurora (ink-themes/themes.mjs), for reference only.
  surface-0: "#16151a"
  side: "#100f13"
  raised: "#211f27"
  stripe: "#1b1a20"
  border: "#2c2a36"
  text: "#ebe9f3"
  text-muted: "#c1bdd1"
  text-faint: "#958fa9"
  accent: "#6d60bd"
  accent-hover: "#7d71cc"
  on-accent: "#ffffff"
  focus: "#8f83d8"
  link: "#aaa0e6"
  success: "#7fd6ae"
  warning: "#e0c27a"
  error: "#e8a0a8"
  info: "#a7b6ee"
typography:
  title:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 550
    lineHeight: "22px"
  body:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  caption:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  micro:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "14px"
  figure:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 550
    lineHeight: "24px"
    fontFeature: "tnum"
  hero-figure:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: "36px"
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  mono:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, monospace"
rounded:
  inner: "4px"
  control: "8px"
  window: "12px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
components:
  button:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
    size: "28px"
  row:
    backgroundColor: "transparent"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    padding: "6px 8px"
    height: "36px"
  stat-tile:
    backgroundColor: "{colors.raised}"
    typography: "{typography.figure}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  segmented:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.control}"
    height: "28px"
  popover:
    backgroundColor: "{colors.surface-0}"
    rounded: "{rounded.window}"
    width: "320px"
---

# Design System: Nimbalyst extensions

Source of truth: [`tokens.css`](tokens.css) (the `--x-*` tokens, copied into each extension at build) and
`../ink-themes/themes.mjs` (the eleven palettes). Every new screen of an extension, the Ink shell or a fullscreen panel
(Usage dashboard, Systems map) starts from this file.

## Overview

**North star: a quiet instrument.** Premium, organic and comfortable to use: soft surfaces, generous but exact
spacing, nothing shouts. It sits inside Nimbalyst, so it borrows the app's own icon set and theme colours and looks
like part of the app, not a plug-in.

- **Layout follows use:** the thing used most sits first and largest; the rest is one step quieter.
- **Descriptive where it helps:** every number says what it is based on ("from 3 h of this week"); every state says what happens next.
- **One accent** for focus, selection and the one number that matters; status is a dot plus words.
- **Signature:** a labelled elapsed-time tick on every usage bar ("time gone" against "used").
- **A theme changes colour only.** Shapes, type, spacing and motion are the same in all eleven Ink themes and in Nimbalyst's own themes.

Anti-references (the generic "AI dashboard" look): gradient cards, coloured glows, emoji icons, a big KPI row of
identical tiles, rainbow charts, badges on everything, sparkles.

## Colors

Never write a raw hex in an extension: use the `--x-*` token, which derives from the theme's `--nim-*` colour.

### Primary
- **Accent** (`--x-accent` = `--nim-primary`; Aurora `#6d60bd`, a muted deep purple): focus ring, selected item, a bar's fill, the one primary button. Text on it is `--x-on-accent` (contrast 4.5 or more in every theme).

### Neutral
- **Surfaces** `--x-surface-0..3`: the app background, then 4%, 8%, 12% of the text colour mixed in oklab. Raise by tone, not by shadow.
- **Hairline** `--x-hairline`: text at 8%; the only border.
- **Overlays:** hover text 6% (light themes 4%), selected 10% (light 7%).
- **Text** `--x-text`, **muted** `--x-text-muted` for labels, captions and anything secondary.

### Status
- `--x-success`, `--x-warning`, `--x-error` (and the theme's info): only for status, always beside words. A tinted line is the tone at 12% over the surface. No green for "done": done is grey, only failed is red.

### Named rules
- **The one-accent rule:** one accent per view. Charts use the accent plus muted greys, not a palette per series; a second series is the accent at lower strength or `--x-text-muted`.
- **Theme palettes:** backgrounds near neutral (saturation under about 12%), one accent, no glows.

## Typography

One family: `--x-font-ui` = Figtree when an Ink theme is on (`--ink-sans`), else the app's UI stack. Code and paths: JetBrains Mono (`--ink-mono`). Tokens are full `font` shorthands (`font: var(--x-body)`).

### Hierarchy
- **Title** 550 16/22: a panel's heading, once per view.
- **Body** 400 13/20: the default.
- **Caption** 400 12/16: labels (550 and muted for a label above a figure), table cells, row titles.
- **Micro** 400 11/14: meta lines, counts, axis labels, the tick's label.
- **Figure** 550 18/24 tabular: a stat's number. **Hero figure** 600 32/36, −0.02em: the one number that matters on a view.

### Named rules
- Numbers are always `font-variant-numeric: tabular-nums`.
- Headings are sentence case; no uppercase eyebrow labels, no letter-spaced caps.

## Layout

- **Spacing scale** 4, 8, 12, 16, 24 (`--x-space-1..5`). Panel padding 16; gap between groups 16, inside a group 12, inside a row 8.
- Groups are separated by a hairline and 16 of space, not by cards around each one.
- Rows are 28 (dense) or 36 high. Controls are 28 (icon, segmented) or 36 (button, input).
- **Fullscreen panels** (Usage dashboard, Systems map) open in the main area from the extension's sidebar button; their own gutter button is hidden. Content width caps near 1200px and stays left-aligned with the header; the header is one line: title, the data's age ("as of 14:20"), then controls on the right.

## Elevation & Depth

Flat, layered by tone: surface-1 for a raised tile or a running row, surface-3 for a bar's track. The only shadow is a
floating layer (popover, menu): `0 8px 24px rgba(0, 0, 0, 0.24)` plus a hairline border.

## Shapes

- **Radius:** 12 for a window or popover, 8 for every control, row and tile, 4 as the inner minimum (a segment inside a segmented control). Bars are fully round (height / 2).
- Borders are 1px hairlines; a focused control gets the 2px accent ring (`--x-focus-ring`) on `:focus-visible`.
- **Icons:** Material Symbols Outlined (Nimbalyst's own set) at `--x-icon-settings` (`'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20`), 16px in rows, 18px in the gutter. An icon only where it tells items apart.

## Components

### Buttons
- **Button:** 36 high, hairline border, transparent, body type; hover overlay-hover, active overlay-selected with an inset hairline, disabled muted with no hover.
- **Icon button:** 28 square, no border, muted icon; hover overlay-hover and text colour.
- Only one filled accent button per view, for the action that matters.

### Rows and lists
- **Row:** 6/8 padding, radius 8, caption title (two lines at most, full text in the tooltip), micro meta line under it. Running/active rows sit on surface-1 with a hairline; finished ones are transparent and muted.
- Long lists fold their finished items behind one "N done" line.

### Figures and bars
- **Stat tile:** surface-1, radius 8, figure on top, a micro or caption line under it saying what it is based on.
- **Usage bar (signature):** an 8px track (4px for a small limit) on surface-3, accent fill drawn with `scaleX`, red only when the forecast runs out; a 2px text-coloured tick for the time gone, with its micro label above ("now").
- **Forecast line:** one tinted line (tone at 12%), a status dot, the verdict in 550.

### Controls
- **Segmented control** (range pickers, filters): 28 high, surface-1, hairline, segments radius 4; the selected one on the surface with the text colour.
- **Input / search:** 36 high, hairline, radius 8, padding 0 12.

### Tables
- Caption type, 36 rows, hairline between rows, no zebra and no vertical lines; numbers right-aligned and tabular; the header row micro and muted, sticky. A row opens its detail in place.

### Popover and hover card
- Width 320, surface-0, radius 12, hairline and the floating shadow; it rises 4px over 160ms. A hover card shows the one reading that matters.

### Motion
- 80 / 160 / 240ms on `cubic-bezier(0.2, 0, 0, 1)`; exits one tier faster; `prefers-reduced-motion` sets the durations to 0.

## Do's and Don'ts

### Do:
- Build from `--x-*` tokens only, so all eleven themes and the light ones work unchanged.
- Put the most-used reading first and largest; label every number with its basis and its time.
- Say states in words ("2 running", "as of 14:20", "rebuilding, up to 3 min").
- Check both a dark and a light theme (Ink Aurora and Ink Bone) before calling a screen done, then a blind look by the `blind-reviewer` agent.

### Don't:
- No raw hex, no second accent, no gradients, glows, emoji or sparkles (the one kept sparkle is Nimbalyst's own "Commit with AI").
- No green for done; no colour without words.
- No word that makes working look stuck: a running item never reads "quiet", "idle" or "stalled". Say what it is still doing or waiting on, and for how long ("running a command (Bash) · 3m", "thinking · 2m").
- No card around every group, no row of identical KPI tiles, no uppercase labels.
- No browser-only features in a panel (no "Open in browser" link inside Nimbalyst).
