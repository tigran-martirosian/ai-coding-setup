// Evaluated inside the Nimbalyst window via: node scripts/cdp.mjs --file test/ui-controls.js
// Checks the speed button, skip ahead and stop on the longest visible reply; restores the speed.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const visible = [...document.querySelectorAll('.readaloud-control')].filter((e) => !e.hidden && e.offsetParent);
  if (!visible.length) return 'no visible Read Aloud control (open a session with assistant replies)';
  const len = (c) => (c.parentElement?.textContent ?? '').length; // this markdown block only
  const key = visible.sort((a, b) => len(b) - len(a))[0].getAttribute('data-readaloud-key');
  const c = () =>
    [...document.querySelectorAll(`.readaloud-control[data-readaloud-key="${key}"]`)].find((e) => !e.hidden && e.offsetParent) ??
    document.querySelector('.readaloud-control.active') ??
    document.createElement('span');
  const btn = (title) => [...c().querySelectorAll('button')].find((b) => b.title.startsWith(title));
  const status = () => c().querySelector('.readaloud-status')?.textContent ?? '';

  out.markerTextShown = document.body.innerText.includes('<!-- voice');

  const speedBtn = c().querySelector('.readaloud-speed');
  const before = speedBtn.textContent;
  speedBtn.click();
  await sleep(100);
  out.speed = `${before} -> ${c().querySelector('.readaloud-speed').textContent}`;

  btn('Read').click();
  const t0 = performance.now();
  while (!btn('Skip') || !/playing|Pause/.test([...c().querySelectorAll('button')].map((b) => b.title).join())) {
    if (performance.now() - t0 > 15000) break;
    await sleep(50);
  }
  await sleep(600);
  out.beforeSkip = status();
  btn('Skip').click();
  await sleep(1500);
  out.afterSkip = status() || '(item finished)';
  btn('Stop')?.click();
  await sleep(200);
  out.stopped = !btn('Stop');

  // Restore the original speed.
  for (let i = 0; i < 4 && c().querySelector('.readaloud-speed').textContent !== before; i++) {
    c().querySelector('.readaloud-speed').click();
    await sleep(50);
  }
  out.speedRestored = c().querySelector('.readaloud-speed').textContent === before;
  return JSON.stringify(out);
})();
