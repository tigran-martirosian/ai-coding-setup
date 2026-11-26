// Tests for the PC program's message ids (skills/phone-bot/pc/core/registry.mjs and core/sent-ids.mjs): an action
// registered with `once` takes an optional `mid`, runs once per device and id, and a repeat gets the first answer,
// also after a restart of the PC program (pc-state.json keeps each id 7 days). The hello says the PC takes ids.
// Run: node tests/test-phone-pc-once.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PC = path.join(ROOT, "skills", "phone-bot", "pc");

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const show = (v) => JSON.stringify(v)?.slice(0, 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-pc-once-"));
const home = path.join(tmp, "home");
fs.mkdirSync(home, { recursive: true });
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
});

// Test actions: test.post counts its runs and can be held open; test.refuse always refuses; test.plain has no once.
const runs = { post: 0, refuse: 0 };
let hold = null;
const actionsDir = path.join(tmp, "actions");
fs.mkdirSync(actionsDir);
fs.writeFileSync(
  path.join(actionsDir, "test.mjs"),
  `import { ActionError } from ${JSON.stringify(new URL("../skills/phone-bot/pc/core/registry.mjs", import.meta.url).href)};
export function register(r) {
  const t = globalThis.onceTest;
  r.add({ name: "test.post", once: true, input: { text: { type: "string", min: 1, max: 100 } },
    run: async (d) => { t.runs.post++; if (t.hold) await t.hold; return { posted: d.text, n: t.runs.post }; } });
  r.add({ name: "test.refuse", once: true, input: { text: { type: "string", min: 1, max: 100 } },
    run: () => { t.runs.refuse++; throw new ActionError("no-session"); } });
  r.add({ name: "test.plain", input: {}, run: () => ({ plain: true }) });
}
`,
);
globalThis.onceTest = {
  runs,
  get hold() {
    return hold;
  },
};

const { createRegistry } = await import(
  "../skills/phone-bot/pc/core/registry.mjs"
);
async function newRegistry(dir = actionsDir) {
  const r = createRegistry();
  await r.load(dir);
  return r;
}
let rn = 0;
const askOn = (reg, device) => (a, d) =>
  reg.handle({ k: "req", id: `r-${++rn}`, a, d }, { device, page: "ok" });
const statePath = path.join(home, ".phone-app", "pc-state.json");
const readSent = () =>
  fs.existsSync(statePath)
    ? (JSON.parse(fs.readFileSync(statePath, "utf8")).sent ?? {})
    : {};

let failure = null;
try {
  let reg = await newRegistry();
  let ask = askOn(reg, "dev-A");

  // ---- one id runs once; the repeat gets the first answer
  const first = await ask("test.post", { text: "hi", mid: "m-1" });
  const again = await ask("test.post", { text: "hi", mid: "m-1" });
  check(
    "a send with an id runs once; the repeat gets the first answer and runs nothing",
    first.ok &&
      first.d.n === 1 &&
      again.ok &&
      again.d.n === 1 &&
      runs.post === 1,
    show({ first, again, runs }),
  );
  check(
    "the repeat's answer carries the repeat's own request id",
    again.id !== first.id && again.id === `r-${rn}`,
    show({ first: first.id, again: again.id }),
  );
  const other = await ask("test.post", { text: "hi", mid: "m-2" });
  check(
    "another id runs again",
    other.ok && other.d.n === 2 && runs.post === 2,
    show(other),
  );
  const noId = await ask("test.post", { text: "hi" });
  check(
    "a send without an id (an old page) runs as before",
    noId.ok && noId.d.n === 3,
    show(noId),
  );

  // ---- a repeat while the first still runs waits for that one's answer
  let open;
  hold = new Promise((r) => {
    open = r;
  });
  const slow1 = ask("test.post", { text: "slow", mid: "m-slow" });
  // the first send runs and is held
  for (const end = Date.now() + 20000; runs.post < 4; await sleep(5))
    if (Date.now() > end)
      throw new Error("the first slow send did not start running within 20 s");
  const slow2 = ask("test.post", { text: "slow", mid: "m-slow" });
  // the repeat is not answered while the first is held (a wrong one runs again or answers at once)
  await sleep(30);
  hold = null;
  open();
  const [s1, s2] = await Promise.all([slow1, slow2]);
  check(
    "a repeat that comes while the first is still running waits for it and gets the same answer",
    s1.ok && s2.ok && s1.d.n === s2.d.n && runs.post === 4,
    show({ s1, s2, runs }),
  );

  // ---- a refusal is an answer too: the repeat gets it and nothing runs again
  const r1 = await ask("test.refuse", { text: "x", mid: "m-r" });
  const r2 = await ask("test.refuse", { text: "x", mid: "m-r" });
  check(
    "a refusal is kept: the repeat gets the same refusal and runs nothing",
    !r1.ok &&
      r1.err === "no-session" &&
      !r2.ok &&
      r2.err === "no-session" &&
      runs.refuse === 1,
    show({ r1, r2, runs }),
  );

  // ---- ids are per device, and one id names one action
  const askB = askOn(reg, "dev-B");
  const b1 = await askB("test.post", { text: "hi", mid: "m-1" });
  check(
    "the same id from another device is its own send",
    b1.ok && b1.d.n === 5,
    show(b1),
  );
  const wrong = await ask("test.refuse", { text: "hi", mid: "m-1" });
  check(
    "an id already used for another action is refused, never answered with that action's answer",
    !wrong.ok && wrong.err === "bad-input" && wrong.field === "mid",
    show(wrong),
  );
  const badMid = await ask("test.post", { text: "hi", mid: "has space" });
  const longMid = await ask("test.post", { text: "hi", mid: "x".repeat(65) });
  check(
    "an id that is not 1-64 letters, digits, - or _ is bad input",
    badMid.err === "bad-input" &&
      badMid.field === "mid" &&
      longMid.err === "bad-input",
    show({ badMid, longMid }),
  );
  const plain = await ask("test.plain", { mid: "m-p" });
  check(
    "an action without once still refuses an id",
    !plain.ok && plain.err === "bad-input" && plain.field === "mid",
    show(plain),
  );

  // ---- a restart of the PC program keeps the answers (pc-state.json)
  const kept = readSent();
  check(
    "pc-state.json keeps each id by device with its time and answer",
    kept["dev-A:m-1"]?.a === "test.post" &&
      kept["dev-A:m-1"].res?.d?.n === 1 &&
      typeof kept["dev-A:m-1"].at === "string",
    show(kept),
  );
  reg = await newRegistry();
  ask = askOn(reg, "dev-A");
  const afterRestart = await ask("test.post", { text: "hi", mid: "m-1" });
  check(
    "after a restart the repeat still gets the first answer and runs nothing",
    afterRestart.ok && afterRestart.d.n === 1 && runs.post === 5,
    show({ afterRestart, runs }),
  );

  // ---- a send the PC program died in the middle of: the repeat is refused, never run a second time
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.sent["dev-A:m-died"] = {
    a: "test.post",
    at: new Date().toISOString(),
  };
  fs.writeFileSync(statePath, JSON.stringify(state));
  const died = await ask("test.post", { text: "hi", mid: "m-died" });
  check(
    "a repeat of a send that was running when the PC program stopped is refused with send-unclear and not run",
    !died.ok && died.err === "send-unclear" && runs.post === 5,
    show({ died, runs }),
  );

  // ---- ids older than 7 days go
  const old = JSON.parse(fs.readFileSync(statePath, "utf8"));
  old.sent["dev-A:m-old"] = {
    a: "test.post",
    at: new Date(Date.now() - 8 * 86400_000).toISOString(),
    res: { ok: true, d: { n: 99 } },
  };
  fs.writeFileSync(statePath, JSON.stringify(old));
  const oldAgain = await ask("test.post", { text: "hi", mid: "m-old" });
  check(
    "an id older than 7 days is forgotten: it runs as a new send",
    oldAgain.ok && oldAgain.d.n === 6,
    show(oldAgain),
  );
  await ask("test.post", { text: "hi", mid: "m-new" });
  check(
    "writing a new id drops the ones older than 7 days from pc-state.json",
    !readSent()["dev-A:m-old"] || readSent()["dev-A:m-old"].res?.d?.n !== 99,
    show(Object.keys(readSent())),
  );

  // ---- the real actions: Send, Queue, Note and New session take an id
  const real = await newRegistry(path.join(PC, "actions"));
  const askReal = askOn(real, "dev-A");
  const withId = {
    "session.send": { session: "s", text: "t", mid: "m-real-1" },
    "session.queue": { session: "s", text: "t", mid: "m-real-2" },
    "session.note": { session: "s", text: "t", mid: "m-real-3" },
    "session.new": { project: "p", text: "t", mid: "m-real-4" },
  };
  const fields = {};
  for (const [a, d] of Object.entries(withId)) {
    const r = await askReal(a, d);
    fields[a] = r.field ?? r.err;
  }
  check(
    "session.send, session.queue, session.note and session.new take an id (no bad-input on mid)",
    Object.values(fields).every((f) => f !== "mid"),
    show(fields),
  );
  const stop = await askReal("session.stop", { session: "s", mid: "m-x" });
  check(
    "other actions (session.stop) still refuse an id",
    stop.err === "bad-input" && stop.field === "mid",
    show(stop),
  );

  // ---- the hello says this PC takes ids
  const seal = await import("../phone/shared/seal.mjs");
  const { createChannel } = await import(
    "../skills/phone-bot/pc/core/channel.mjs"
  );
  const K = seal.randomBytes(32);
  const dev = "dev-hello";
  const sent = [];
  const channel = createChannel({
    keys: { devices: [{ device: dev, K: seal.toB64u(K) }] },
    send: (f) => sent.push(f),
    registry: real,
    context: () => ({ page: "ok", setupVersion: "0" }),
    pcVersion: "0",
  });
  const h = { v: seal.PROTOCOL, t: "app", dev, sid: "s1", n: 0 };
  await channel.onApp({
    ...h,
    c: await seal.sealHello(K, h, {
      k: "hello",
      np: seal.toB64u(seal.randomBytes(16)),
      pageVersion: "0",
      protocol: seal.PROTOCOL,
    }),
  });
  const reply = sent[0] && (await seal.openHello(K, h, sent[0].c));
  check(
    "the PC's hello says it takes message ids (ids: true)",
    reply?.ids === true,
    show(reply),
  );
} catch (e) {
  failure = e;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (failure) {
  check("the run finished", false, failure.stack);
}
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
