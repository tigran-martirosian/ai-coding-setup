// A further device joins by an OK on a paired one (pipe design, section 15). This device shows "Waiting for OK"
// with the six-digit check number; a paired device shows the request as a card over its screen (askCard, drawn by
// the frame) with OK and No. The frame (app.js) asks the PC (ctx.join), stores the key after an OK and opens Home.
import { KINDS } from "../../shared/seal.mjs";
import { el } from "../frame/dom.js";
import { registerScreen } from "../frame/screens.js";

const CODE_TOO = "Try again, or use the code from your PC.";
const WORDS = {
  waiting: "Waiting for OK",
  "not-paired": "Your account has no paired PC yet. Use the code from your PC.",
  "no-device": "Your PC has no paired device yet. Use the code from your PC.",
  "other-user": "This PC belongs to another Telegram account.",
  "bad-sign": "Close the app and open it again.",
  "too-old": "Close the app and open it again.",
  "too-many-devices":
    "Your PC has 4 devices. Remove one in Settings on another device.",
  busy: "Another device is asking right now. Try again in 3 minutes.",
  "dev-taken": "Something changed the request on the way. Nothing was saved.",
  "bad-reveal": "Something changed the request on the way. Nothing was saved.",
  // A new page load asks with a new device id, so "refused" here is the No (the PC's 10 minutes are per id).
  refused: "Your other device said No. Nothing was saved.",
  "too-many-asks":
    "Too many tries. Try again later, or use the code from your PC.",
  expired: `No answer in 3 minutes. ${CODE_TOO}`,
  "bad-mac3": `The answer did not check out. Nothing was saved. ${CODE_TOO}`,
  "bad-answer": `The answer did not check out. Nothing was saved. ${CODE_TOO}`,
  "pc-error": "Your PC could not save the new device. Nothing was saved.",
  timeout: "The PC did not answer. Try again.",
  unreachable: "Can't reach the relay.",
  "not-invited": "This app is invite-only.",
};

const hhmm = (t) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// The line for a state or a failure: a ChannelError's code, a key store's error, or "waiting".
export function joinWords(code, e = null) {
  if (code === "pc-offline")
    return `Your PC is offline (${e?.extra?.lastSeen ? `last seen ${hhmm(e.extra.lastSeen)}` : "not seen yet"}). Start it, then try again.`;
  if (code === "unsupported" || code === "failed")
    return `Could not save the key: ${e?.message}. Try again.`;
  return WORDS[code] ?? `Joining failed: ${code}`;
}

// "482913" as "482 913".
export const groupWord = (word) => `${word.slice(0, 3)} ${word.slice(3)}`;

const kindWords = (kind) => {
  if (!Object.hasOwn(KINDS, kind)) throw new Error(`"${kind}" is not a kind`);
  return KINDS[kind];
};

function render(ctx) {
  // The request lives in the view's params, so a redraw of this screen does not ask the PC again.
  const run = (ctx.params.run ??= ctx.join());
  const head = el("h2.join-head", "Asking your PC…");
  const word = el("div.join-word", { hidden: true });
  const hint = el(
    "p.join-hint",
    { hidden: true },
    "Open the app on your other device and check it shows the same number.",
  );
  const none = el(
    "p.join-hint",
    { hidden: true },
    "None of your devices has the app open now. Open it there, or use the code from your PC.",
  );
  const error = el("p.err.join-error", { role: "alert", hidden: true });
  const toCode = el(
    "button.btn-main",
    {
      type: "button",
      hidden: true,
      onclick: () => ctx.toPairing({ code: true }),
    },
    "Use the code from my PC",
  );
  const again = el(
    "button.btn-quiet",
    {
      type: "button",
      hidden: true,
      onclick: () => {
        ctx.params.run = null;
        ctx.redraw();
      },
    },
    "Try again",
  );
  const cancel = el(
    "button.btn-quiet",
    {
      type: "button",
      onclick: () => {
        ctx.params.left = true;
        run.then(
          (j) => j.cancel(),
          () => {},
        );
        ctx.toPairing({});
      },
    },
    "Cancel",
  );

  function failed(e) {
    if (ctx.params.left) return;
    head.textContent = "Not joined";
    word.hidden = hint.hidden = none.hidden = cancel.hidden = true;
    error.hidden = false;
    error.textContent = joinWords(e.code ?? e.message, e);
    toCode.hidden = again.hidden = false;
  }

  run.then((j) => {
    head.textContent = joinWords("waiting");
    word.textContent = groupWord(j.word);
    word.hidden = hint.hidden = false;
    none.hidden = j.open !== 0;
    j.done.catch(failed);
  }, failed);

  return {
    content: el(
      "div",
      el("div.group", el("div.block.join-box", head, word, hint, none, error)),
    ),
    bottom: el("div.join-bottom", toCode, again, cancel),
  };
}

registerScreen({
  id: "device-join",
  tab: null,
  title: "Add this device",
  render,
  actions: [],
});

// OK and No stay off this long after a card first shows, so a tap meant for the screen under it does nothing.
export const ARM_MS = 1000;
const firstShown = new Map(); // rid -> when its card was first drawn

// The request on a paired device. ask: { rid, kind, word, until }; state: null (open), "ok" (joined), or a line
// to show ("Already answered on your other device"). onAnswer(ok) sends device.answer.
export function askCard({ ask, state, busy }, onAnswer) {
  const who = kindWords(ask.kind);
  if (state === "ok") {
    firstShown.delete(ask.rid);
    return el("div.join-card", el("div.join-card-title", `${who} joined`));
  }
  if (!firstShown.has(ask.rid)) firstShown.set(ask.rid, Date.now());
  const wait = firstShown.get(ask.rid) + ARM_MS - Date.now();
  const no = el(
    "button.btn-quiet.join-no",
    {
      type: "button",
      disabled: busy || wait > 0,
      onclick: () => onAnswer(false),
    },
    "No",
  );
  const yes = el(
    "button.btn-main.join-yes",
    {
      type: "button",
      disabled: busy || wait > 0,
      onclick: () => onAnswer(true),
    },
    "OK",
  );
  if (wait > 0 && !busy)
    setTimeout(() => {
      no.disabled = false;
      yes.disabled = false;
    }, wait);
  return el(
    "div.join-card",
    { role: "dialog", "aria-label": "A device wants to join" },
    el("div.join-card-title", `${who} wants to join your PC`),
    el("div.join-word", groupWord(ask.word)),
    el(
      "p.join-hint",
      "Only tap OK if you are holding that device now and it shows this number.",
    ),
    state ? el("p.err", { role: "alert" }, state) : null,
    el("div.join-card-buttons", no, yes),
  );
}
