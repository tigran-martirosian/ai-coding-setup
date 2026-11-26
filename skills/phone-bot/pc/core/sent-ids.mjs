// Message ids (phone outbox, docs: phone/README.md "Sends that survive a dropped link"). The phone gives each
// Send, Queue, Note and New session an id (`mid`) and sends it again on every new channel session until the PC
// answers. The PC keeps each id with its answer in pc-state.json (`sent`, by "<device>:<mid>") for 7 days, so a
// repeat gets the first answer and nothing runs twice; a repeat that comes while the first still runs waits for it.
// An id written as running with no answer and no run in this program is a send the PC program stopped in the
// middle of: its repeat is refused with send-unclear, never run a second time.
import { readState, updateState } from "./state.mjs";

export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const MID_INPUT = {
  type: "string",
  min: 1,
  max: 64,
  pattern: /^[A-Za-z0-9_-]+$/,
  optional: true,
};

// One store per PC program: `running` holds this program's runs still under way.
export function createSentIds() {
  const running = new Map(); // key -> Promise of the answer

  const fresh = (e, now) =>
    e && now - Date.parse(e.at) < KEEP_MS ? e : undefined;

  function write(key, entry) {
    const now = Date.now();
    updateState((s) => {
      const sent = s.sent && typeof s.sent === "object" ? s.sent : {};
      for (const [k, e] of Object.entries(sent))
        if (!fresh(e, now)) delete sent[k];
      if (entry) sent[key] = entry;
      else delete sent[key];
      s.sent = sent;
    });
  }

  // run() gives the answer ({ ok, ...rest }, without the request id); refuse(field) and unclear() make the
  // answers for an id used for another action and for a send whose run was cut off.
  return async function once(device, mid, action, run, { refuse, unclear }) {
    const key = `${device}:${mid}`;
    const busy = running.get(key);
    if (busy) {
      const res = await busy;
      return res.a === action ? res.res : refuse();
    }
    const had = fresh(readState().sent?.[key], Date.now());
    if (had) {
      if (had.a !== action) return refuse();
      return had.res ?? unclear();
    }
    const job = (async () => {
      write(key, { a: action, at: new Date().toISOString() });
      const res = await run();
      // The action ran: its answer goes back even when pc-state.json can't take it (a repeat then gets send-unclear).
      try {
        write(key, { a: action, at: new Date().toISOString(), res });
      } catch (e) {
        console.error(
          `sent-ids: the answer to ${key} was not kept: ${e.message}`,
        );
      }
      return { a: action, res };
    })();
    running.set(key, job);
    try {
      return (await job).res;
    } finally {
      running.delete(key);
    }
  };
}
