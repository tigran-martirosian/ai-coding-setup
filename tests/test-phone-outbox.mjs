// The phone page's outbox (phone/page/frame/outbox.js) on its own: what the session-screen tests do not reach.
// Run: node tests/test-phone-outbox.mjs
import { registerHooks } from "node:module";

// The build-only screens.generated.js, which outbox.js reads STORE_SUFFIX from: "" as in a plain build.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith("screens.generated.js"))
      return {
        url: `data:text/javascript,${encodeURIComponent('export const STORE_SUFFIX = "";')}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { createOutbox, RETRY_MS } = await import(
  "../phone/page/frame/outbox.js"
);

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  if (ok) pass++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const DAY = 24 * 60 * 60 * 1000;
const memStore = () => {
  const m = new Map();
  return {
    m,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

// ---- kept across a reload; an entry older than the PC keeps ids (7 days) is dropped
{
  let t = 1_000_000_000_000;
  const store = memStore();
  const box = createOutbox({ storage: store, now: () => t });
  const e = box.add({
    key: "s1",
    a: "session.send",
    d: { session: "s1", text: "hi" },
    text: "hi",
    how: "send",
  });
  check(
    "an id is m- and 32 hex characters",
    /^m-[0-9a-f]{32}$/.test(e.mid),
    e.mid,
  );
  check(
    "the entry is in localStorage",
    store.m.get("phone.outbox")?.includes(e.mid),
  );
  const again = createOutbox({ storage: store, now: () => t + 6 * DAY });
  check(
    "a reload within 7 days keeps the entry",
    again.get(e.mid)?.text === "hi",
  );
  const late = createOutbox({ storage: store, now: () => t + 7 * DAY });
  check("after 7 days the entry is dropped", late.list("s1").length === 0);
  t += RETRY_MS;
  check("past the hour it is stale", box.stale(box.get(e.mid)) === true);
  box.take(e.mid);
  check("the last entry taken empties the store", !store.m.has("phone.outbox"));
}

// ---- storage blocked (a webview): the outbox still works in memory
{
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  const box = createOutbox({ storage: blocked });
  const e = box.add({
    key: "s1",
    a: "session.note",
    d: { text: "x" },
    text: "x",
    how: "note",
  });
  check("blocked storage: the entry lives in memory", box.get(e.mid) === e);
}

// ---- one send per entry at a time; an old PC gets no id; a held send stays
{
  const box = createOutbox({ storage: memStore() });
  const e = box.add({
    key: "s1",
    a: "session.send",
    d: { text: "go" },
    text: "go",
    how: "send",
  });
  const asked = [];
  let release;
  const ask = (_a, d) => {
    asked.push(d);
    return new Promise((r) => {
      release = r;
    });
  };
  const one = box.send(e, ask);
  const two = box.flush(ask);
  check(
    "a send under way is not sent twice (send, then flush)",
    asked.length === 1,
  );
  release({ ok: true, d: {} });
  await one;
  await two;
  check("an answered entry leaves the outbox", box.get(e.mid) === null);
  check("the PC that takes ids gets the mid", asked[0].mid === e.mid);

  const e2 = box.add({
    key: "s1",
    a: "session.send",
    d: { text: "old" },
    text: "old",
    how: "send",
  });
  const seen = [];
  await box.send(
    e2,
    async (_a, d) => {
      seen.push(d);
      throw Object.assign(new Error("closed"), { code: "closed" });
    },
    false,
  );
  check(
    "an old PC gets the data without a mid",
    seen[0] && !("mid" in seen[0]),
  );
  check(
    "a link failure keeps the entry",
    box.get(e2.mid) !== null && !box.get(e2.mid).refused,
  );
  const heard = [];
  box.listen((x) => heard.push(x));
  await box.flush(async () => ({ ok: false, err: "no-session" }));
  check(
    "a refusal is kept on the entry and told to listeners",
    box.get(e2.mid)?.refused?.err === "no-session" && heard.length === 1,
  );
  let more = 0;
  await box.flush(async () => {
    more++;
    return { ok: true };
  });
  check("a refused entry is not sent again", more === 0);
}

// ---- a flush sends one at a time, oldest first (a session gets them in the order they were typed)
{
  let t = 1_000_000_000_000;
  const box = createOutbox({ storage: memStore(), now: () => t });
  for (const text of ["step 1", "step 2", "step 3"]) {
    box.add({ key: "s1", a: "session.send", d: { text }, text, how: "send" });
    t += 1000;
  }
  const order = [];
  let atOnce = 0;
  let most = 0;
  await box.flush(async (_a, d) => {
    atOnce++;
    most = Math.max(most, atOnce);
    await new Promise((r) => setTimeout(r, 20));
    order.push(d.text);
    atOnce--;
    return { ok: true, d: {} };
  });
  check(
    "a flush sends the waiting messages one after another, oldest first",
    most === 1 && order.join() === "step 1,step 2,step 3",
    JSON.stringify({ most, order }),
  );
}

// ---- a damaged store is kept beside it and said, not quietly overwritten
{
  const store = memStore();
  store.m.set("phone.outbox", "{half written");
  const said = [];
  const was = console.error;
  console.error = (m) => said.push(m);
  const box = createOutbox({ storage: store });
  console.error = was;
  box.add({ key: "s1", a: "session.send", d: {}, text: "x", how: "send" });
  check(
    "a damaged store is kept as phone.outbox.damaged and said on the console",
    store.m.get("phone.outbox.damaged") === "{half written" &&
      said.some((m) => /could not be read/.test(m)),
    JSON.stringify({ said, keys: [...store.m.keys()] }),
  );
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
