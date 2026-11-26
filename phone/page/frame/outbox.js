// The outbox (phone README, "Sends that survive a dropped link"): Send, Queue, Note and New session to a PC whose
// hello says `ids`, and those written before the link comes (`early`: the session view sends them once it does,
// without an id to a PC whose hello has none). Each message gets an id (`mid`) made here and is kept in localStorage until the PC answers;
// the frame sends every waiting message again on each new channel session (flush), and the PC answers a repeat
// with its first answer, so nothing runs twice. A message waits silently for RETRY_MS; after that it no longer goes
// out by itself (the session view shows "Not sent yet" with Send now and Discard). A PC refusal is kept on the
// entry until a session view shows it (its words go back in the box). localStorage can be blocked in a webview:
// the outbox then lasts while the page does. No DOM here: the tests run it in Node. The store's key ends in the
// build's STORE_SUFFIX, so a test copy's messages wait apart from the real app's.
import { STORE_SUFFIX } from "../screens.generated.js";

export const RETRY_MS = 60 * 60 * 1000;
// The PC keeps an id 7 days (pc/core/sent-ids.mjs KEEP_MS); an entry older than that is dropped.
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
// Read at call time, as in keystore.js. The page's own outbox below is made when this file is evaluated, which is
// after screens.generated.js: only app.js (after its screens.generated.js import) and the later-loaded session
// screen import this file.
const storeKey = () => `phone.outbox${STORE_SUFFIX}`;

const newMid = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return `m-${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
};

// A rejected ask is a link problem (ChannelError, not-connected): the message waits. A resolved answer with
// ok: false is the PC's refusal.
export function createOutbox({
  storage = globalThis.localStorage,
  now = Date.now,
} = {}) {
  let entries = load();
  const flying = new Map(); // mid -> Promise of the send under way
  const listeners = new Set();

  function load() {
    let raw;
    try {
      raw = storage?.getItem(storeKey());
    } catch {
      return []; // storage blocked: the outbox lives in memory
    }
    if (!raw) return [];
    try {
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) throw new Error("not a list");
      return list.filter((e) => e?.mid && now() - e.at < KEEP_MS);
    } catch (err) {
      // A damaged store is kept beside it before the next save overwrites it, and said.
      try {
        storage.setItem(`${storeKey()}.damaged`, raw);
      } catch {
        /* storage full or blocked */
      }
      console.error(
        `outbox: the stored messages could not be read (${err.message}); kept as ${storeKey()}.damaged`,
      );
      return [];
    }
  }
  function save() {
    try {
      if (entries.length) storage?.setItem(storeKey(), JSON.stringify(entries));
      else storage?.removeItem(storeKey());
    } catch {
      /* storage blocked: the outbox in memory stays */
    }
  }
  const find = (mid) => entries.find((e) => e.mid === mid) ?? null;

  const box = {
    // { key, a, d, text, how }: key is the session view's (a session id, or new:<project>), a the action, d its
    // data without the id.
    add(m) {
      const e = { ...m, mid: newMid(), at: now() };
      entries.push(e);
      save();
      return e;
    },
    list: (key) => entries.filter((e) => e.key === key),
    get: find,
    // Past the silent retries: it goes out only when the user presses Send now.
    stale: (e) => !e.refused && now() - e.at >= RETRY_MS,
    // Removes an entry (sent, discarded, or its refusal shown).
    take(mid) {
      const had = entries.length;
      entries = entries.filter((e) => e.mid !== mid);
      if (entries.length !== had) save();
    },
    // Send now: the silent retries start over.
    renew(mid) {
      const e = find(mid);
      if (!e) return null;
      e.at = now();
      save();
      return e;
    },
    // Sends one entry with `ask(action, data)`; `ids` is whether the PC takes message ids (an old PC gets the data
    // without one). Resolves with { r } once the PC answered (ok, or its refusal) or { held: error } when the link
    // failed first; listeners get { entry, r } for every answer. One send per entry at a time.
    send(e, ask, ids = true) {
      const going = flying.get(e.mid);
      if (going) return going;
      const run = (async () => {
        let r;
        try {
          r = await ask(e.a, ids ? { ...e.d, mid: e.mid } : e.d);
        } catch (err) {
          return { held: err };
        }
        if (!find(e.mid)) return { r };
        if (r?.ok) box.take(e.mid);
        else {
          e.refused = { err: r?.err ?? "failed", ...r };
          save();
        }
        for (const fn of [...listeners]) fn({ entry: e, r });
        return { r };
      })();
      flying.set(e.mid, run);
      run.finally(() => flying.delete(e.mid));
      return run;
    },
    // A new channel session: every waiting entry within its silent retries goes again, one after another in the
    // order they were written, so a session gets them in the order they were typed.
    async flush(ask, ids = true) {
      const out = [];
      const due = entries
        .filter((e) => !e.refused && !box.stale(e) && !flying.has(e.mid))
        .sort((x, y) => x.at - y.at);
      for (const e of due) out.push(await box.send(e, ask, ids));
      return out;
    },
    // Ends a waiting entry that is not on its way (`refusal` as the PC's would be): listeners get it, and it stays
    // until a session view shows it. An entry gone, refused or under way is left as it is.
    giveUp(mid, refusal) {
      const e = find(mid);
      if (!e || e.refused || flying.has(mid)) return;
      e.refused = refusal;
      save();
      for (const fn of [...listeners]) fn({ entry: e, r: refusal });
    },
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return box;
}

export const outbox = createOutbox();
