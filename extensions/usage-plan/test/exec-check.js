// Run inside Nimbalyst: node ../read-aloud/scripts/cdp.mjs --file test/exec-check.js
// Proves the call the gutter button uses before the panel is opened (see src/store.ts).
(async () => {
  const r = await window.electronAPI.invoke('extension:exec', {
    extensionId: 'com.local.usageplan',
    command: 'node -e "console.log(6*7)"',
    timeout: 20000,
  });
  return JSON.stringify(r);
})();
