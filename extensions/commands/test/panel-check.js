// Run inside Nimbalyst: node ../read-aloud/scripts/cdp.mjs --file test/panel-check.js
// Clicks the Commands gutter button and returns the popover's text (or says what is missing).
// It presses no command, so no session is started.
(async () => {
  const button = document.querySelector('button[data-panel-id*="commandbuttons"]');
  if (!button) return 'no gutter button: restart Nimbalyst after npm run install-ext';
  if (!document.querySelector('[data-command-buttons]')) button.click();
  await new Promise((r) => setTimeout(r, 500));
  const panel = document.querySelector('[data-command-buttons]');
  const inPopover = !!document.querySelector('#command-buttons-popover [data-command-buttons]');
  const text = panel ? panel.innerText : 'button found, nothing opened';
  if (inPopover) button.click();
  return (inPopover ? 'popover:\n' : 'not a popover:\n') + text;
})();
