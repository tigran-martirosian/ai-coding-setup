// Run inside Nimbalyst: node ../read-aloud/scripts/cdp.mjs --file test/send-check.js
// Proves the call a button makes (see src/commands.ts): it starts a new session in the open project
// with the command as its first message. The reply takes minutes, so this only waits for a refusal.
(async () => {
  const sent = window.electronAPI.invoke('extensions:ai-send-prompt', {
    prompt: '/next-move',
    sessionName: 'Next move',
    model: 'claude-code:sonnet',
  });
  const refused = await Promise.race([
    sent.then(() => '', (e) => String(e?.message ?? e)),
    new Promise((r) => setTimeout(() => r(''), 5000)),
  ]);
  return refused ? 'refused: ' + refused : 'sent: look for a new "Next move" session in the sessions list';
})();
