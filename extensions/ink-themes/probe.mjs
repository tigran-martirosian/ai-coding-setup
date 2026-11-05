// Checks selectors.json against the running Nimbalyst: which app selectors the Ink shell relies on match nothing now.
// Start Nimbalyst with --remote-debugging-port=9222 (or set CDP_PORT), then:   node probe.mjs
// Prints the app version, the selectors that match nothing, and (separately) the ones whose surface is not on screen right now.
// Exit code 1 when a selector that should be on screen matches nothing.
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const selectors = JSON.parse(fs.readFileSync(new URL('./selectors.json', import.meta.url), 'utf8'));

const res = await fetch(`http://127.0.0.1:${PORT}/json/list`).catch(() => null);
if (!res?.ok) throw new Error(`Nimbalyst is not answering on port ${PORT}: start it with --remote-debugging-port=${PORT}`);
const pages = await res.json();
const page = pages.find((p) => p.type === 'page' && p.title === 'Nimbalyst') || pages.find((p) => p.type === 'page');
if (!page) throw new Error(`no window on port ${PORT}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('could not open the debugger connection')); });
const ask = (expression) => new Promise((ok, bad) => {
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id !== 1) return;
    if (msg.error) return bad(new Error(JSON.stringify(msg.error)));
    if (msg.result.exceptionDetails) return bad(new Error(msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text));
    ok(msg.result.result.value);
  };
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
});

// One answer per selector: how many elements, and how many of them take up room (the sidebar and its
// header exist twice, one copy hidden at 0x0 in the Files view; those do not count as "on screen").
const found = await ask(`(() => ${'{'}
  const sels = ${JSON.stringify(selectors.map((s) => s.selector))};
  return { ua: navigator.userAgent, rows: sels.map((s) => {
    const all = document.querySelectorAll(s);
    const shown = [...all].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 || r.height > 0; }).length;
    return [all.length, shown];
  }) };
${'}'})()`);
ws.close();

const version = found.ua.match(/@nimbalyst\/electron\/([\d.]+)/)?.[1] ?? found.ua;
const unmatched = [];
const offScreen = [];
const hiddenOnly = [];
selectors.forEach((s, i) => {
  const [count, shown] = found.rows[i];
  if (count === 0) (s.onlyWhen ? offScreen : unmatched).push(s);
  else if (shown === 0) (s.onlyWhen ? offScreen : hiddenOnly).push(s);
});

console.log(`Nimbalyst ${version}`);
const old = [...new Set(selectors.map((s) => s.seenIn))].filter((v) => v !== version);
if (old.length) console.log(`selectors.json was last seen in ${old.join(', ')}: when this run is clean, set seenIn to ${version}`);
for (const s of unmatched) console.log(`UNMATCHED  ${s.selector}   (${s.what})`);
console.log(`${unmatched.length} unmatched of ${selectors.length - offScreen.length} checked, ${offScreen.length} not checked` + (hiddenOnly.length ? ` (${hiddenOnly.length} present but only hidden)` : ''));
if (offScreen.length) {
  console.log('not checked (surface off screen; open it and run again):');
  for (const s of offScreen) console.log(`  ${s.selector}   [needs: ${s.onlyWhen}]`);
}
process.exit(unmatched.length ? 1 : 0);
