// Run inside Nimbalyst: node ../read-aloud/scripts/cdp.mjs --file test/dashboard-check.js
// Opens the Usage Plan panel, clicks "Full dashboard", waits for the dashboard in the main area,
// and says whether the dashboard's own gutter button stays hidden (only one Usage icon in the side bar).
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  };
  const gutter = () => [...document.querySelectorAll('button[data-panel-id*="usageplan"]')];
  const usage = document.querySelector('button[data-panel-id="com.local.usageplan.usage-plan"]');
  if (!usage) return 'no Usage Plan gutter button: reload the window after npm run install-ext';
  if (!document.querySelector('[data-usage-plan]')) usage.click();
  let full;
  for (let i = 0; i < 40 && !full; i++) {
    full = [...document.querySelectorAll('[data-usage-plan] button')].find((b) => /full dashboard/i.test(b.innerText));
    if (!full) await wait(250);
  }
  if (!full) return 'popover has no "Full dashboard" button';
  full.click();
  let dash;
  for (let i = 0; i < 40 && !dash; i++) {
    dash = document.querySelector('[data-usage-dashboard]');
    if (!dash) await wait(250);
  }
  if (!dash) return 'clicked, but [data-usage-dashboard] never appeared';
  const r = dash.getBoundingClientRect();
  const extra = gutter().filter(visible);
  return [
    'dashboard in main area: ' + JSON.stringify(dash.innerText) + ' at ' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height),
    'visible usageplan gutter buttons: ' + extra.length + ' ' + JSON.stringify(extra.map((b) => b.getAttribute('data-panel-id'))),
    'all usageplan gutter buttons in DOM: ' + JSON.stringify(gutter().map((b) => b.getAttribute('data-panel-id'))),
  ].join('\n');
})();
