# Usage Plan (Nimbalyst extension)

A gutter button that opens a small pop-up with the Claude plan numbers. It shows this week's usage and the
5-hour limit's usage as bars, a forecast line, and the budget and your pace side by side. One button opens
the full usage dashboard.

The button has no ring of its own: the app's own Claude ring shows the week's percent.

The numbers come from `~/.claude/skills/setup-audit/scripts/plan-ahead.mjs --json`, refreshed every 5 minutes
(`src/store.ts`). That script is [skills/setup-audit/scripts/plan-ahead.mjs](../../skills/setup-audit/scripts/plan-ahead.mjs), part of the setup-audit skill in this repository; the extension
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
