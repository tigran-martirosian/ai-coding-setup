// Smoke test for dist/backend.js outside Nimbalyst, with a fake host context.
// Run after `npm run build`: node test/backend.smoke.mjs
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { activate } from "../dist/backend.js";

const registered = [];
const api = await activate({
  services: {
    log: () => {},
    registerMcpTools: async (tools) => {
      registered.push(...tools);
      return { registered: tools.map((t) => t.name) };
    },
  },
});
const m = api.methods;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

assert.deepEqual(Object.keys(m).sort(), [
  "shutdown_worker",
  "status",
  "stop",
  "synthesize",
  "warmup",
]);
assert.ok(
  registered.every((t) => t.panelOnly),
  "no tool is visible to agents",
);
console.log("ok - tools registered; none visible to agents");

let t0 = Date.now();
const a = await m.synthesize({ text: "Result. Everything passed." });
const firstMs = Date.now() - t0;
const s1 = await m.status({});
assert.equal(s1.worker, "ready");
assert.ok(Buffer.from(a.audio, "base64").subarray(0, 4).toString() === "RIFF");
t0 = Date.now();
await m.synthesize({ text: "Second request." });
const secondMs = Date.now() - t0;
const s2 = await m.status({});
assert.equal(s2.pid, s1.pid, "same worker process for both requests");
assert.equal(s2.requestsServed, 2);
console.log(
  `ok - model stays loaded: pid ${s1.pid}, first call ${firstMs} ms (incl. load ${s1.loadMs} ms), second ${secondMs} ms`,
);

const v = await m.synthesize({
  text: "Voice check.",
  voice: "bogus voice; rm -rf",
});
assert.ok(v.audio, "invalid voice names fall back to the default voice");
console.log("ok - voice name sanitized to the default voice");

const p1 = m.synthesize({ text: "One." });
const p2 = assert.rejects(m.synthesize({ text: "Two." }), /cancelled/);
await new Promise((r) => setTimeout(r, 20)); // let both reach the worker queue
const stopped = await m.stop({});
await p1;
await p2;
console.log(`ok - stop cancels queued work (cancelled ${stopped.cancelled})`);

execSync(`taskkill /PID ${s2.pid} /F`, { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const crashed = await m.status({});
assert.equal(crashed.worker, "error");
assert.match(crashed.lastError, /exited unexpectedly/);
await m.synthesize({ text: "Back again." });
const s3 = await m.status({});
assert.equal(s3.worker, "ready");
assert.notEqual(s3.pid, s2.pid);
console.log(
  `ok - crash detected ("${crashed.lastError}") and worker restarted as pid ${s3.pid}`,
);

await assert.rejects(
  m.synthesize({ text: "x", dir: "C:\\NoSuchTTS" }),
  /Missing: Python: C:\\NoSuchTTS\\venv\\Scripts\\python\.exe/,
);
const miss = await m.status({ dir: "C:\\NoSuchTTS" });
assert.equal(miss.missing.length, 3);
console.log(`ok - missing paths reported: ${miss.missing.join(" | ")}`);

await m.synthesize({ text: "Recovered after fixing the folder." });
const s4 = await m.status({});
assert.equal(s4.worker, "ready");
console.log("ok - retry works once the folder is valid");

const pid = s4.pid;
api.deactivate();
await new Promise((r) => setTimeout(r, 2500));
assert.equal(alive(pid), false, "worker process gone after deactivate");
console.log(`ok - deactivate terminated worker pid ${pid}`);
process.exit(0);
