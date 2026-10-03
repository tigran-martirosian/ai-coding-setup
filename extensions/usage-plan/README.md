# Usage Plan (Nimbalyst extension)

A gutter button that shows the week's percent in a ring and opens a small pop-up with the Claude plan
numbers: the weekly and 5-hour limits, when each runs out, and the daily and hourly budget against the
pace. One button opens the full usage dashboard.

Nimbalyst draws an extension's gutter button itself and ignores a panel's `gutterButton` export, so the ring
is a style rule on the app's button (`src/gutter.ts`). If an app update changes that button, the plain icon
shows instead.

The numbers come from `~/.claude/skills/usage-report/plan-ahead.mjs --json`, refreshed every 5 minutes
(`src/store.ts`). That script is part of my usage tooling and is not in this repository; the extension
draws what it returns.

## Build and install

```
npm install
npm run build
npm run install-ext   # validates the bundle, copies to %APPDATA%\@nimbalyst\electron\extensions\usageplan
```

Then restart Nimbalyst: it loads new and changed extensions only at startup.

## Checks

- `npm test`: the panel's command returns the planner's JSON in cmd and PowerShell; the wording helpers.
- In the running app: `node ../read-aloud/scripts/cdp.mjs --file test/exec-check.js` proves the
  call the gutter button uses before the panel is opened.
- In the running app: `node ../read-aloud/scripts/cdp.mjs --file test/panel-check.js` clicks the
  gutter button and prints the panel's text.
