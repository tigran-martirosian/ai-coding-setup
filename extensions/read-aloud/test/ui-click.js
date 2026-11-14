// Evaluated inside the Nimbalyst window via scripts/cdp.mjs --file.
// Clicks Read aloud on the last visible control and samples its state.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const controls = [...document.querySelectorAll(".readaloud-control")].filter(
    (e) => !e.hidden,
  );
  const target = controls[controls.length - 1];
  const key = target.getAttribute("data-readaloud-key");
  const titles = () =>
    [...target.querySelectorAll("button, span[title]")]
      .map((b) => b.querySelector(".readaloud-word")?.textContent || b.title)
      .filter(Boolean)
      .join("|");
  const log = [];
  const sample = (label) =>
    log.push(
      `${label}: ${titles()} ${target.querySelector(".readaloud-status")?.textContent ?? ""} ${target.querySelector(".readaloud-error")?.textContent ?? ""}`.trim(),
    );
  const button = (word) =>
    [...target.querySelectorAll("button")].find(
      (b) =>
        ((b) => b.querySelector(".readaloud-word")?.textContent || b.title)(
          b,
        ) === word,
    );
  sample("before");
  button("Read aloud").click();
  for (let i = 0; i < 12; i++) {
    await sleep(250);
    sample(`t+${(i + 1) * 250}ms`);
  }
  const pauseBtn = button("Pause");
  if (pauseBtn) {
    pauseBtn.click();
    await sleep(300);
    sample("after pause");
    await sleep(1200);
    sample("still paused");
    button("Resume")?.click();
    await sleep(600);
    sample("after resume");
  }
  button("Close")?.click();
  await sleep(300);
  sample("after close");
  return { key, log: [...new Set(log)] };
})();
