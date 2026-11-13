// Run inside Nimbalyst: node ../read-aloud/scripts/cdp.mjs --file test/panel-check.js
// Clicks the Usage Plan gutter button and returns the panel's text (or says what is missing).
(async () => {
  const find = () =>
    [...document.querySelectorAll('button,[role="button"]')].find((e) =>
      /usage plan|claude plan/i.test((e.getAttribute('aria-label') || '') + (e.getAttribute('title') || '') + (e.getAttribute('data-tooltip') || ''))
    );
  const button = find();
  if (!button) return 'no gutter button: restart Nimbalyst after npm run install-ext';
  if (!document.querySelector('[data-usage-plan]')) button.click();
  for (let i = 0; i < 40; i++) {
    const panel = document.querySelector('[data-usage-plan]');
    if (panel && /%|No plan numbers|exit|Error/i.test(panel.innerText)) return panel.innerText;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'button found, panel did not show numbers: ' + (document.querySelector('[data-usage-plan]')?.innerText ?? 'no panel');
})();
