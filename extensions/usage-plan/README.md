# Usage Plan (Nimbalyst extension)

A gutter button that opens a small pop-up with the Claude plan numbers. It shows this week's usage and the
5-hour limit's usage as bars, a forecast line, and the budget and your pace side by side. One button opens
the full usage dashboard.

The button has no ring of its own: the app's own Claude ring shows the week's percent.

The numbers come from `~/.claude/skills/setup-audit/scripts/plan-ahead.mjs --json`, refreshed every 5 minutes
(`src/store.ts`). That script is [skills/setup-audit/scripts/plan-ahead.mjs](../../skills/setup-audit/scripts/plan-ahead.mjs), part of the setup-audit skill in this repository; the extension
draws what it returns.

## Full dashboard

The "Full dashboard" button in the pop-up opens the whole usage dashboard in the main area. It reads
`~/.claude/reports/usage-dashboard.json`. The panel rebuilds that file in the background when it is over an hour
old, when a plan week has reset since the build, or when you click Refresh. A progress bar shows while it builds.

Periods follow the plan's own week: This week, Last week, earlier weeks, and All. The weekly reset is at the same
time every week. If a plan change resets the week early, that week shows as two. Each week shows this computer's
part and other use. The build is quick because `usage-scan.mjs` keeps a per-file scan cache
(`~/.claude/reports/usage-scan-cache.jsonl`; `--no-cache` skips it, `--cache-file FILE` moves it).

The panel keeps its own copy of the dashboard code, `src/usage-dashboard-lib.mjs`. It must match
`skills/setup-audit/scripts/usage-dashboard-lib.mjs`; `tests/test-lib-copy.mjs` fails when they differ.

## Build and install

```
npm install
npm run build
npm run install-ext   # validates the bundle, copies to %APPDATA%\@nimbalyst\electron\extensions\usageplan
```

Then restart Nimbalyst: it loads new and changed extensions only at startup.

## Checks

- `npm test`: the panel's command returns the planner's JSON in cmd and PowerShell; the wording helpers; the dashboard data.
- In the running app: `node ../read-aloud/scripts/cdp.mjs --file test/exec-check.js` proves the
  call the gutter button uses before the panel is opened.
- In the running app: `node ../read-aloud/scripts/cdp.mjs --file test/panel-check.js` clicks the
  gutter button and prints the panel's text.
- In the running app: `node ../read-aloud/scripts/cdp.mjs --file test/dashboard-check.js` opens the full dashboard panel.
