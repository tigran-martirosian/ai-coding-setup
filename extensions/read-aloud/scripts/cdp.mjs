// Dev helper: evaluate a JS expression inside the running Nimbalyst window
// via the DevTools port. Usage: node scripts/cdp.mjs "<expression>"
// or: node scripts/cdp.mjs --file some-script.js
import fs from 'node:fs';
import path from 'node:path';

const portFile = path.join(process.env.APPDATA, '@nimbalyst', 'electron', 'DevToolsActivePort');
const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('Nimbalyst/resources/app.asar'));
if (!page) throw new Error('Nimbalyst window not found');

let expr = process.argv[2];
if (expr === '--file') expr = fs.readFileSync(process.argv[3], 'utf8');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
ws.send(JSON.stringify({
  id: 1,
  method: 'Runtime.evaluate',
  params: { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true },
}));
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== 1) return;
  const r = msg.result;
  if (r.exceptionDetails) console.log('EXCEPTION', JSON.stringify(r.exceptionDetails).slice(0, 800));
  else console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 1));
  ws.close();
});
