// Run inside Nimbalyst: node ../read-aloud/scripts/cdp.mjs --file test/intercept-check.js
// Proves a click on the gutter button can be caught before the app sees it (the app does not switch
// to the sidebar panel). Leaves the app as it was.
(async () => {
  const button = document.querySelector('button[data-panel-id*="usageplan"]');
  if (!button) return 'no gutter button';
  const before = {
    ring: !!document.getElementById('usage-plan-gutter-ring')?.textContent,
    panel: !!document.querySelector('[data-usage-plan]'),
    active: button.className.includes('active'),
    rect: JSON.stringify(button.getBoundingClientRect()),
  };
  let caught = 0;
  const stopIt = (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('button[data-panel-id*="usageplan"]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    caught++;
  };
  const types = ['click', 'mousedown', 'pointerdown'];
  for (const t of types) window.addEventListener(t, stopIt, true);
  for (const t of ['pointerdown', 'mousedown', 'click']) button.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
  await new Promise((r) => setTimeout(r, 600));
  for (const t of types) window.removeEventListener(t, stopIt, true);
  const after = { panel: !!document.querySelector('[data-usage-plan]'), active: button.className.includes('active') };
  return JSON.stringify({ before, caught, after, reactDom: typeof window.ReactDOM, createRoot: typeof window.ReactDOM?.createRoot });
})();
