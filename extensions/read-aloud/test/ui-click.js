// Evaluated inside the Nimbalyst window via scripts/cdp.mjs --file.
// Clicks Read aloud on the last visible control and samples its state.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const controls = [...document.querySelectorAll('.readaloud-control')].filter((e) => !e.hidden);
  const target = controls[controls.length - 1];
  const key = target.getAttribute('data-readaloud-key');
  const titles = () => [...target.querySelectorAll('button, span[title]')].map((b) => b.title).filter(Boolean).join('|');
  const log = [];
  const sample = (label) => log.push(`${label}: ${titles()} ${target.querySelector('.readaloud-status')?.textContent ?? ''} ${target.querySelector('.readaloud-error')?.textContent ?? ''}`.trim());
  sample('before');
  target.querySelector('button[title="Read aloud"]').click();
  for (let i = 0; i < 12; i++) {
    await sleep(250);
    sample(`t+${(i + 1) * 250}ms`);
  }
  const pauseBtn = target.querySelector('button[title="Pause"]');
  if (pauseBtn) {
    pauseBtn.click();
    await sleep(300);
    sample('after pause');
    await sleep(1200);
    sample('still paused');
    target.querySelector('button[title="Resume"]')?.click();
    await sleep(600);
    sample('after resume');
  }
  target.querySelector('button[title="Stop"]')?.click();
  await sleep(300);
  sample('after stop');
  return { key, log: [...new Set(log)] };
})();
