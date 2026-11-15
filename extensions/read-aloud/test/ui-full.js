// Evaluated inside the Nimbalyst window via: node scripts/cdp.mjs --file test/ui-full.js
// Exercises the real UI on the one Read aloud strip (the end of the last finished turn).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const ipc = (tool, args = {}) =>
    window.electronAPI.invoke("extensions:ai-call-backend-tool", {
      toolName: `readaloud.${tool}`,
      args,
      callerExtensionId: "com.local.readaloud",
    });

  // Record which voice the player asks for (wrap invoke if the bridge allows it).
  const seenVoices = [];
  const origInvoke = window.electronAPI.invoke;
  try {
    window.electronAPI.invoke = function (...args) {
      const [channel, payload] = args;
      if (
        channel === "extensions:ai-call-backend-tool" &&
        payload?.toolName === "readaloud.synthesize"
      )
        seenVoices.push(payload.args.voice);
      return origInvoke.apply(this, args);
    };
  } catch {
    /* frozen */
  }

  const controls = () =>
    [...document.querySelectorAll(".readaloud-control")].filter(
      (e) => !e.hidden && e.offsetParent,
    );
  const state = (c) =>
    [...c.querySelectorAll("button,span[title]")]
      .map((b) => b.querySelector(".readaloud-word")?.textContent || b.title)
      .filter(Boolean)
      .join("|");
  const waitFor = async (c, pred, ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (pred(state(c))) return Math.round(performance.now() - t0);
      await sleep(40);
    }
    return null;
  };

  const cs = controls();
  out.visibleStrips = cs.length; // expected: 1
  const A = cs[cs.length - 1];

  // 1. Cold start (worker was stopped): click -> first audio.
  [...A.querySelectorAll("button")]
    .find((b) => b.textContent.endsWith("Read aloud"))
    .click();
  out.coldStartMs = await waitFor(A, (s) => s.startsWith("Pause|Next"), 20000);
  const st1 = await ipc("status");
  out.workerAfterFirst = {
    worker: st1.worker,
    pid: st1.pid,
    loadMs: st1.loadMs,
  };

  A.querySelector(".readaloud-close")?.click();
  await sleep(200);
  out.afterClose = state(A);

  // 3. Voice actually requested by the player, and what the backend used.
  const probe = await ipc("synthesize", { text: "Voice probe." });
  out.backendDefaultVoice = probe.voice;
  out.playerRequestedVoices = [...new Set(seenVoices)];
  try {
    out.savedConfig = await window.electronAPI.extensions.getConfig(
      "com.local.readaloud",
    );
  } catch (e) {
    out.savedConfig = String(e);
  }

  try {
    window.electronAPI.invoke = origInvoke;
  } catch {
    /* frozen */
  }
  return out;
})();
