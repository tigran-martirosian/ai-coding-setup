---
name: Nimbalyst extensions (shared look)
description: One calm, premium look for every extension and for the Ink shell, with a colour for each state; a theme changes colour only.
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
    fontWeight: 600
    lineHeight: "22px"
  reading:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "24px"
  body:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  row-title:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  meta:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  heading:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "18px"
  label:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "18px"
  code:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  count:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    fontFeature: "tnum"
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
  control: "6px"
  window: "8px"
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
    typography: "{typography.row-title}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  main-button:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.row-title}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  orb:
    size: "24px"
    dotSize: 1.5
    textColor: "{colors.link}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
    size: "28px"
  row:
    backgroundColor: "transparent"
    typography: "{typography.row-title}"
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

**North star: a calm instrument you can read at a glance.** Premium, organic and comfortable to use: soft surfaces,
generous but exact spacing, readable text. It sits inside Nimbalyst, so it borrows the app's own icon set and theme
colours and looks like part of the app, not a plug-in. Calm does not mean colourless: a screen with no accents reads
as one big block of text, and the eye cannot tell what is what.

- **Layout follows use:** the thing used most sits first and largest; the rest is one step quieter.
- **Descriptive where it helps:** every number says what it is based on ("from 3 h of this week"); every state says what happens next.
- **Each state has its colour,** always beside its word (see the look rule below).
- **Signature:** a labelled elapsed-time tick on every usage bar ("time gone" against "used").
- **A theme changes colour only.** Shapes, type, spacing and motion are the same in all eleven Ink themes and in Nimbalyst's own themes.

Anti-references (the generic "AI dashboard" look): gradient cards, coloured glows, emoji icons, a big KPI row of
identical tiles, rainbow charts, badges on everything, sparkles.

## The look rule

Mock-ups give layout, sizes, words and states. They do not give colour, weight or separation. Where a mock-up and
this rule differ, this rule wins.

1. **Each state has a colour, always beside its word:**

   | State | Tone | Shows as |
   |---|---|---|
   | Running | accent text tone (`--nim-link`) | orb ink; the state word in weight 500 |
   | Needs you | warning tone | `listening` orb in that tone; words in 600; the row, banner or card on the tone at 12% |
   | Failed | error tone | the word "failed"; a still dot |
   | Done | grey | grey tick, muted title (no green) |
   | Stopped, to do | grey | grey dash or ring |
   | Unread | accent | still dot plus "New" |
   | Selected | surface-2 | the fill alone, no bar or stripe on any edge |

   Tokens: `--x-state-running`, `--x-state-needs` (and `--x-state-needs-tint`, the theme's warning at 12%), `--x-state-failed`,
   `--x-state-done`, `--x-state-stopped`, `--x-state-unread`, `--x-state-selected`. Every state word reads 4.5:1 or more on surfaces 0-2 in all eleven themes, and the
   "needs you" word also on its own tint (`node test.mjs` here measures it).
2. **The one main button of a view is filled with the accent;** every other button is quiet (no fill).
3. **Groups are visible.** Each group has a heading and is set off from the next by a hairline plus 16 px, or by its
   own surface tone. Spacing alone never separates two groups. Exception: the Commands list's groups have no headings,
   set apart by a hairline with 8 px above and below (the user's words on that list win, 2026-11-14).
4. **Three text levels per area, plus its title:** what matters more is bigger. Level 1 is what the area is for,
   level 2 names and controls, level 3 everything secondary (13 px, muted). Which text takes which token is in
   "Text levels by area" below. Counts that matter are in the text colour at 600.
5. **The test:** a person who has not seen the design looks at a screenshot for 5 seconds and can say what needs the
   user, what is running, and where each group starts.

## Colors

Never write a raw hex in an extension: use the `--x-*` token, which derives from the theme's `--nim-*` colour.

### Accent
- **Accent fill** (`--x-accent` = `--nim-primary`; Aurora `#6d60bd`, a muted deep purple; hover `--x-accent-hover`): the one main button's fill, the focus ring, a bar's fill. Text on it is `--x-on-accent` (4.5:1 or more in every theme).
- **Accent text** (`--x-accent-text` = `--nim-link`; Aurora `#aaa0e6`): the accent wherever it is text or a mark on a surface: the running state, unread, the selected bar, the orbs' ink. The fill accent is too dark for text on dark themes.

### Neutral
- **Surfaces** `--x-surface-0..3`: the app background, then 4%, 8%, 12% of the text colour mixed in oklab. Raise by tone, not by shadow.
- **Hairline** `--x-hairline`: text at 8%; the only border.
- **Overlays:** hover text 6% (light themes 4%), selected 10% (light 7%).
- **Text** `--x-text`, **muted** `--x-text-muted` for meta lines and anything secondary.

### Status
- The state tokens of the look rule carry status, always beside words. On light themes "needs you" is the warning tone mixed 25% toward the text and "failed" the error tone mixed 10% toward it, because the themes' own warning and error read under 4.5:1 there. No green for "done": done is grey, only failed is red. `--x-success`, `--x-warning`, `--x-error` stay for other uses (a forecast line, a chart's limit).

### Named rules
- **Charts** use the accent plus muted greys, not a palette per series; a second series is the accent at lower strength or `--x-text-muted`.
- **Theme palettes:** backgrounds near neutral (saturation under about 12%), one accent hue, no glows.

## Typography

One family: `--x-font-ui` = Figtree when an Ink theme is on (`--ink-sans`), else the app's UI stack. Code and paths: `--x-font-mono` = JetBrains Mono (`--ink-mono`), else Cascadia Mono or Consolas. Tokens are full `font` shorthands (`font: var(--x-body)`).

Four sizes do all the work: 16 for the one title of a view, 15 for text you read, 14 for names and buttons, 13 for
everything secondary. Weights stay 400, 500 and 600; nothing is 700 (bold in a reply is 600).

### Hierarchy
- **View title** `--x-title` 600 16/22: once per view; also a heading inside a reply.
- **Reading** `--x-reading` 400 15/24: text you read in full: reply text, a tracker item's text, the thinking line (word and seconds; the 24 px orb is the line's height).
- **Section heading** `--x-heading` 600 13/18, text colour, sentence case. Exception: the right panel's section
  headers ("Agents & commands", "Trackers") use the row title type, as big as the helper rows under them (user, 2026-11-14).
- **Row title** `--x-row-title` 500 14/20, text colour; labels and button words too.
- **Body** `--x-body` 400 14/20: the default.
- **Meta** `--x-meta` 400 13/18, muted: the one line under a row title, table cells, axis labels, dates, shortcuts.
- **Label** `--x-label` 500 13/18: small control labels: tabs, chips, small buttons, a state word.
- **Code** `--x-code` 400 13/20 in `--x-font-mono`: code, paths, commands, diff lines; ids and shortcuts only if they are technical text.
- **Count** `--x-count` 600 12/16 tabular: a count or id only inside a small fixed box (a badge, a ring, an avatar; an id at weight 400). Elsewhere a count is meta with tabular figures, so an area does not get a fourth size. Nothing is ever under 12 px.
- **Figure** `--x-figure` 550 18/24 tabular: a stat's number. **Hero figure** `--x-hero-figure` 600 32/36, −0.02em: the one number that matters on a view.
- The old `--x-caption` (12) and `--x-micro` (11) tokens are removed; every panel is on the scale above.

## Text levels by area

Level 1 is what the area is for, level 2 names and controls, level 3 everything secondary. Within a level the weight
follows the role: 500 for names and labels, 400 for typed or read text, 600 for group heads and the "needs you" word.
Levels 1 and 2 are in `--x-text`, level 3 in `--x-text-muted`, state words in their state tone (the look rule).
"Sizes" counts the sizes the area shows, title included, leaving out a 12 px mark in a fixed box.

| Area | View title | Level 1 | Level 2 | Level 3 | Sizes |
|---|---|---|---|---|---|
| Top bar and menu bar | none | `--x-row-title` 14: project name, branch, "New session" | none | `--x-meta` 13: menu bar words, the mode word | 2 |
| Rail | none | 14/600 initials on the project, account and org tiles | none | `--x-count` 12: ring percent (weight 500), badges, rail labels | 2 |
| Gutter | none | none | none | `--x-count` 12: icon labels (weight 500), the α mark, the sessions bubble | 1 |
| Session list | `--x-title` 16: project name | `--x-row-title` 14: session titles, "New session"; `--x-body` 14: search | `--x-heading` 13: group heads (Pinned, Today) | `--x-meta` 13: date, phase, path; `--x-label` 13: the Sessions/Files/Tracker switch, "running"; "Needs you" 13/600 | 3 |
| Chat | `--x-title` 16: session title; headings inside a reply | `--x-reading` 15: reply text, bold at 600, links, thinking line | `--x-row-title` 14: buttons such as "Jump to question" | `--x-meta` 13: elapsed time, tags, archive; `--x-label` 13: tab names; `--x-code` 13: inline code | 4 |
| Thinking line | none | `--x-reading` 15: word and seconds, orb 24 px | none | none | 1 |
| Needs-you bar | none | 14: "Needs you" at 600 in the needs tone, "1 question" at 400 | none | none | 1 |
| Chat box | none | `--x-body` 14: typed text and placeholder; `--x-row-title` 14: Note button | none | `--x-meta` 13: mode, model, effort, context use | 2 |
| Copy row | none | none | none | `--x-label` 13: Copy, Read aloud, Hands-free; icons 16 | 1 |
| Tool cards | none | `--x-row-title` 14: tool name, card title, question-card options | `--x-code` 13: paths, commands, diff lines | `--x-meta` 13: args summary, "1 edit", status word, hints; `--x-heading` 13: question heads | 2 |
| Right panel, wide and narrow | none | `--x-row-title` 14: section heads (the exception above), file scope title, helper and tracker rows | none | `--x-meta` 13: file detail line, subtitle, counts; `--x-label` 13: state words and status chip | 2 |
| Tracker list | `--x-title` 16: project name | `--x-row-title` 14: type rows (All, Plans, Decisions), "New item" | `--x-heading` 13: Trackers, Saved views, Types | `--x-meta` 13: path, counts, Ready; `--x-label` 13: switch; `--x-count` 12: α mark | 3 |
| Tracker table | none | `--x-row-title` 14: item titles | none | `--x-meta` 13: updated, owner, priority; `--x-label` 13: status word in its state tone | 2 (plus `--x-count` 12 for the id and avatar, in fixed boxes) |
| Tracker item view | `--x-title` 16: item title | `--x-reading` 15: the item's text; `--x-code` inside it | `--x-row-title` 14: buttons, linked sessions, link targets; `--x-body` 14: tag field | `--x-heading` 13: section heads (Sessions, Tags, Links); `--x-meta` 13: dates, type, key, empty lines; `--x-label` 13: pill values, "+ Add" | 4 |
| Commands | `--x-title` 16: "Commands" | `--x-row-title` 14: button names | none | `--x-meta` 13: the hint line | 3 |
| Usage popover | `--x-title` 16: "Usage Plan" | `--x-hero-figure` 32: the one figure | `--x-figure` 18: the stat figures | `--x-heading` 13: labels and the forecast verdict (in its tone, on its tint); `--x-meta` 13: captions; `--x-label` 13: links; "Now" `--x-count` 12 (the bar's tick label) | 4 |
| Systems map | the panel's header, if shown: `--x-title` 16 | `--x-row-title` 14: node names | none | `--x-meta` 13: legend | 3 |
| Menus (File, Theme, right panel chooser) | none | `--x-body` 14: item names | none | `--x-meta` 13: shortcuts (tabular) | 2 |

Importance across the window, biggest first: the chat's reading text (15) and the view titles (16); names in the side
panels and lists (14); everything secondary (13); the rail and gutter labels last (12). The middle of the window is
used most, so it has the largest text.

### Named rules
- Numbers are always `font-variant-numeric: tabular-nums`.
- Headings are sentence case; no uppercase eyebrow labels, no letter-spaced caps.

## Layout

- **Spacing scale** 4, 8, 12, 16, 24 (`--x-space-1..5`). Panel padding 16; gap between groups 16, inside a group 12, inside a row 8.
- Groups are separated by a heading plus a hairline and 16 of space, or by their own surface tone; not by cards around each one, and never by spacing alone.
- Rows are 28 (dense) or 36 high. Controls are 28 (icon, segmented) or 32 (button, input; `--x-control-height`).
- **Fullscreen panels** (Usage dashboard, Systems map) open in the main area from the extension's sidebar button; their own gutter button is hidden. Content width caps near 1200px and stays left-aligned with the header; the header is one line: title, the data's age ("as of 14:20"), then controls on the right.

## Elevation & Depth

Flat, layered by tone: surface-1 for a raised tile or a hovered row, surface-2 for the selected row, surface-3 for a bar's track. The only shadow is a
floating layer (popover, menu): `0 8px 24px rgba(0, 0, 0, 0.24)` plus a hairline border.

## Shapes

- **Radius:** 6 on rows, buttons and inputs (`--x-radius-control`); 8 on menus, popovers, cards and tiles (`--x-radius-window`); 4 only for a part inside a control (a segment inside a segmented control). Bars are fully round (height / 2); pills only for counts.
- Borders are 1px hairlines; a focused control gets the 2px accent ring (`--x-focus-ring`) on `:focus-visible`.
- **Icons:** Material Symbols Outlined (Nimbalyst's own set) at `--x-icon-settings` (`'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20`). An icon follows the level of the line it sits on: 16 px beside 13-15 px text (rows, menus, chips, the copy row), 18 px in a 28 px toolbar icon button, and the app's own 28 px in the rail and gutter (the rail is tuned on top of them). An icon only where it tells items apart.

## Components

### Buttons
- **Main button:** one per view, for the action that matters: filled with `--x-accent`, `--x-on-accent` text, 32 high, row-title type (14/500), radius 6; hover `--x-accent-hover`.
- **Button** (every other one): quiet. 32 high, hairline border, transparent, row-title type; hover overlay-hover, active overlay-selected with an inset hairline, disabled muted with no hover. Never two filled buttons side by side.
- **Icon button:** 28 square, no border, muted icon; hover overlay-hover and text colour.

### Rows and lists
- **Row:** 6/8 padding, radius 6, row-title type (two lines at most, full text in the tooltip), one meta line under it. No fill at rest, surface-1 on hover, surface-2 when selected. Its state shows by the look rule: orb or mark, state word in the state's tone; a "needs you" row on the needs tint.
- Long lists fold their finished items behind one "N done" line.

### Thinking orbs
- The orb library is `orbs/orbs.js` (thinking-orbs 0.3.2, MIT): `<canvas data-orb="searching" data-orb-px="24">`. It shows what a running agent is doing by shape; the words beside it still name the stage.
- **Size:** 24 px canvas in a 24 px slot (`--x-orb-size`), dots at 1.5x (`--x-orb-dot-size`; tokens.css sets it on every `canvas[data-orb]`). 64 px (the large design) only for one hero spot.
- **Ink:** `--x-orb-ink` = the accent text tone; the `listening` orb ("needs you") takes `--x-state-needs`. `--orb-dark` is 1 on dark themes and 0 on light ones (set in tokens.css). Dotted and flat per dot: no glow.
- **Orb per stage:**

  | What the agent is doing | Orb state (shape) |
  |---|---|
  | Thinking, no tool yet | `breathing` |
  | Reading or searching files or the web (Read, Grep, Glob, WebFetch, WebSearch) | `searching` |
  | Editing or writing files (Edit, Write) | `composing` |
  | Running a command (Bash) | `working` |
  | Planning (the planner, a plan being written) | `shaping` |
  | Waiting on its helpers, gathering their results | `connecting` |
  | A check or review running (tests, reviewer) | `solving` |
  | Waiting on the user (a question card open) | `listening`, in the needs-you tone |
  | No report for over 2 minutes | the same orb at `data-orb-speed="0.5"`, the words saying the wait |
  | Done / failed / stopped | no orb: grey tick / the word "failed" in the error tone / grey dash |

### Figures and bars
- **Stat tile:** surface-1, radius 8, figure on top, a meta line under it saying what it is based on.
- **Usage bar (signature):** an 8px track (4px for a small limit) on surface-3, accent fill drawn with `scaleX`, red only when the forecast runs out; a 2px text-coloured tick for the time gone, with its count-size label above ("now").
- **Forecast line:** one tinted line (tone at 12%), a status dot, the verdict in 550.

### Controls
- **Segmented control** (range pickers, filters): 28 high, surface-1, hairline, segments radius 4; the selected one on the surface with the text colour.
- **Input / search:** 32 high, hairline, radius 6, padding 0 12.

### Tables
- Meta type in the text colour, 36 rows, hairline between rows, no zebra and no vertical lines; numbers right-aligned and tabular; the header row in heading type, muted, sticky. A row opens its detail in place.

### Popover and hover card
- Width 320, surface-0, radius 8, hairline and the floating shadow; it rises 4px over 160ms. A hover card shows the one reading that matters.

### Motion
- 80 / 160 / 240ms on `cubic-bezier(0.2, 0, 0, 1)`; exits one tier faster; `prefers-reduced-motion` sets the durations to 0.

## Do's and Don'ts

### Do:
- Build from `--x-*` tokens only, so all eleven themes and the light ones work unchanged.
- Put the most-used reading first and largest; label every number with its basis and its time.
- Say states in words ("2 running", "as of 14:20", "rebuilding, up to 3 min").
- Check both a dark and a light theme (Ink Aurora and Ink Bone) before calling a screen done, then a blind look by the `blind-reviewer` agent.

### Don't:
- No raw hex, no colour outside the tokens, no gradients, glows, emoji or sparkles (the one kept sparkle is Nimbalyst's own "Commit with AI").
- No green for done; no colour without words, and no state without its colour.
- No text under 12 px; no two groups told apart by spacing alone.
- No word that makes working look stuck: a running item never reads "quiet", "idle" or "stalled". Say what it is still doing or waiting on, and for how long ("running a command (Bash) · 3m", "thinking · 2m").
- No coloured stripe on the edge of a row, menu item, card, note or banner (a left or right border, an inset box-shadow or a `::before` bar): it reads as AI-made. A state shows by fill, orb, mark and word.
- No card around every group, no row of identical KPI tiles, no uppercase labels.
- No browser-only features in a panel (no "Open in browser" link inside Nimbalyst).
