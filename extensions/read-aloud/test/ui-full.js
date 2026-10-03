// Evaluated inside the Nimbalyst window via: node scripts/cdp.mjs --file test/ui-full.js
// Exercises the real UI; restores hands-free to off at the end.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const ipc = (tool, args = {}) =>
    window.electronAPI.invoke('extensions:ai-call-backend-tool', {
      toolName: `readaloud.${tool}`,
      args,
      callerExtensionId: 'com.local.readaloud',
    });

  // Record which voice the player asks for (wrap invoke if the bridge allows it).
  const seenVoices = [];
  const origInvoke = window.electronAPI.invoke;
  try {
    window.electronAPI.invoke = function (channel, payload) {
      if (channel === 'extensions:ai-call-backend-tool' && payload?.toolName === 'readaloud.synthesize') seenVoices.push(payload.args.voice);
      return origInvoke.apply(this, arguments);
    };
  } catch {
    /* frozen */
  }

  const controls = () => [...document.querySelectorAll('.readaloud-control')].filter((e) => !e.hidden && e.offsetParent);
  const state = (c) =>
    [...c.querySelectorAll('button,span[title]')]
      .map((b) => b.title)
      .filter((x) => x && !/hands-free/i.test(x))
      .join('|');
  const waitFor = async (c, pred, ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (pred(state(c))) return Math.round(performance.now() - t0);
      await sleep(40);
    }
    return null;
  };

  const cs = controls();
  const A = cs[cs.length - 1];
  const B = cs[cs.length - 2];

  // 1. Cold start (worker was stopped): click -> first audio.
  A.querySelector('button[title="Read aloud"]').click();
  out.coldStartMs = await waitFor(A, (s) => s.startsWith('Pause|Stop'), 20000);
  const st1 = await ipc('status');
  out.workerAfterFirst = { worker: st1.worker, pid: st1.pid, loadMs: st1.loadMs };

  // 2. Only one plays: clicking B stops A.
  B.querySelector('button[title="Read aloud"]').click();
  await sleep(100);
  out.aAfterClickingB = state(A);
  out.warmStartMs = await waitFor(B, (s) => s.startsWith('Pause|Stop'), 20000);
  const st2 = await ipc('status');
  out.samePidAcrossRequests = st2.pid === st1.pid;
  out.requestsServed = st2.requestsServed;
  B.querySelector('button[title="Stop"]')?.click();
  await sleep(200);
  out.bAfterStop = state(B);

  // 3. Voice actually requested by the player, and what the backend used.
  const probe = await ipc('synthesize', { text: 'Voice probe.' });
  out.backendDefaultVoice = probe.voice;
  out.playerRequestedVoices = [...new Set(seenVoices)];
  try { out.savedConfig = await window.electronAPI.extensions.getConfig('com.local.readaloud'); } catch (e) { out.savedConfig = String(e); }

  // 4. Hands-free: turn on via the headphones button, then simulate a finished turn + a question card.
  const container = A.closest('.rich-transcript-messages');
  const autoBtn = A.querySelector('.readaloud-auto');
  autoBtn.click();
  await sleep(300);
  out.autoButtonOn = autoBtn.classList.contains('on');
  const key = B.getAttribute('data-readaloud-key');
  const fake = (idx, html, cls = '') => {
    const d = document.createElement('div');
    d.className = `rich-transcript-message ${cls}`;
    d.setAttribute('data-message-index', String(idx));
    d.setAttribute('data-readaloud-test', '1');
    d.innerHTML = html;
    container.appendChild(d);
  };
  fake(90001, `<span data-readaloud-key="${key}"></span>`, 'assistant');
  fake(90002, '<div class="rich-transcript-turn-elapsed">Finished in 1s</div>');
  out.autoReplyStartMs = await waitFor(B, (s) => s.includes('Stop'), 20000);
  B.querySelector('button[title="Stop"]')?.click();
  await sleep(300);

  fake(
    90003,
    '<div class="ask-user-question-widget"><span>Which voice should I use?</span><div>af_heart (recommended)</div><div>af_bella</div><button>Submit</button></div>'
  );
  // The question has no transcript control, so watch the backend for a new synthesize request.
  const before = (await ipc('status')).requestsServed;
  let questionSpoken = false;
  for (let i = 0; i < 60 && !questionSpoken; i++) {
    await sleep(250);
    questionSpoken = (await ipc('status')).requestsServed > before;
  }
  out.questionSpoken = questionSpoken;
  document.querySelectorAll('[data-readaloud-test]').forEach((e) => e.remove());

  // 5. /voice path: agent-side toggle is picked up by the UI poll.
  await ipc('set_auto_read', { enabled: false });
  await sleep(4500);
  out.uiAfterAgentOff = autoBtn.classList.contains('on') ? 'on' : 'off';
  await ipc('set_auto_read', { enabled: true });
  await sleep(4500);
  out.uiAfterAgentOn = autoBtn.classList.contains('on') ? 'on' : 'off';
  await ipc('set_auto_read', { enabled: false });
  await sleep(4000);
  out.finalHandsFree = autoBtn.classList.contains('on') ? 'on' : 'off';

  try {
    window.electronAPI.invoke = origInvoke;
  } catch {
    /* frozen */
  }
  return out;
})();
