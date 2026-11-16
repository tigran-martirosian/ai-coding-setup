// Pairing (DS1 section 3, `pairing` and `pairing-expired`; pipe design, section 2). The iPhone scans the QR the PC
// shows with Telegram's own scanner; Telegram Desktop has no scanner, so there the code is pasted. The code is the
// PC's id and a secret, 26 letters, a dot and 26 letters; it works once, for 10 minutes.
import { readPairCode } from "../../shared/seal.mjs";
import { el } from "../frame/dom.js";
import { registerScreen } from "../frame/screens.js";
import { canScan } from "../frame/telegram.js";

const WORDS = {
  "bad-mac": "That code does not match. Check it, or ask the PC for a new one.",
  "other-user": "This PC is paired with another Telegram account.",
  "too-many-devices":
    "This PC already has 4 devices. Remove one in Settings on another device first.",
  "other-pc": "That code belongs to another PC. Ask your PC for a new one.",
  "no-pc": "The relay does not know that PC. Ask your PC for a new code.",
  "pc-offline":
    "Your PC is not connected. Check that it is on, then try again.",
  "bad-mac2":
    "The answer did not match the code, so pairing stopped for safety. Ask the PC for a new code.",
  timeout: "The PC did not answer. Try again.",
  unreachable: "Can't reach the relay.",
  "not-invited": "This app is invite-only.",
  "bad-sign": "Please close and reopen the app.",
};

function wordsFor(e) {
  if (e.code === "unsupported" || e.code === "failed")
    return `Could not save the key: ${e.message}. Pair again.`;
  return WORDS[e.code] ?? `Pairing failed: ${e.code ?? e.message}`;
}

function render(ctx) {
  const scan = canScan(ctx.tg);
  // choosing: the two ways in (an OK on a paired device, or the PC's code) before the code's steps.
  const view = {
    choosing: !ctx.params.code,
    typing: !scan,
    expired: false,
    busy: false,
    error: null,
  };
  const choice = el(
    "div.join-choice",
    el(
      "button.btn-main.join-ok-btn",
      { type: "button", onclick: () => ctx.go("device-join") },
      "OK it on my other device",
    ),
    el(
      "button.btn-quiet",
      {
        type: "button",
        onclick: () => {
          view.choosing = false;
          update();
        },
      },
      "Use the code from my PC",
    ),
  );
  const choiceNote = el(
    "p.pair-note",
    "Is the app already paired on another device? OK this one there. If not, use a code from your PC.",
  );
  const field = el("input.code-field", {
    type: "text",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    placeholder: "Paste the code from your PC",
    "aria-label": "Pairing code",
  });
  const error = el("p.field-error", { role: "alert", hidden: true });
  // A typed code is sent with the button right under the field, greyed until the field has text; the scan
  // keeps Telegram's main button.
  const pair = el(
    "button.btn-main.pair-btn",
    {
      type: "button",
      disabled: true,
      onclick: () => view.busy || submit(field.value),
    },
    "Pair with this code",
  );
  field.oninput = () => {
    pair.disabled = view.busy || !field.value.trim();
  };
  const fieldBox = el(
    "div.group.code-box",
    field,
    el("p.field-hint", "26 letters, a dot, then 26 more."),
    error,
    pair,
  );
  const steps = el(
    "div.block.steps",
    step(
      1,
      "Ask Nimbalyst for a code",
      'On your PC, say "pair my phone" in a session.',
    ),
    step(
      2,
      scan ? "Scan it, or type it" : "Copy the code there, paste it here",
      "A code works once, for 10 minutes.",
    ),
  );
  const only = el(
    "p.pair-note",
    "Only your account: the PC stays with the first Telegram account that pairs.",
  );
  const expired = el(
    "div.block.expired",
    el(
      "div.pc",
      el("span.pc-icon.warn", "!"),
      el(
        "div",
        el("div.pc-title", "That code ran out"),
        el("div.pc-meta", "A code works once, for 10 minutes."),
      ),
    ),
    el(
      "p.err",
      "On your PC, ask for a code again. It shows a new one; scan or paste that one.",
    ),
  );
  const restore = ctx.params.restorable
    ? el(
        "div.block.restore",
        el("p.err", "This phone has a saved key that can be restored."),
        el(
          "button.btn-quiet",
          {
            type: "button",
            onclick: () =>
              ctx.restore().then((ok) => ok || fail({ code: "restore" })),
          },
          "Restore the key",
        ),
      )
    : null;
  const typeInstead = el(
    "button.btn-quiet",
    {
      type: "button",
      onclick: () => {
        view.typing = true;
        update();
        field.focus();
      },
    },
    "Type the code instead",
  );

  function fail(e) {
    view.busy = false;
    if (e.code === "no-code") view.expired = true;
    else view.error = e.code === "restore" ? "No key to restore." : wordsFor(e);
    update();
  }

  async function submit(text) {
    try {
      readPairCode(text);
    } catch {
      view.error =
        "That is not a pairing code: it is 26 letters, a dot, then 26 more.";
      view.typing = true;
      return update();
    }
    view.busy = true;
    view.error = null;
    update();
    try {
      await ctx.pairWith(text);
    } catch (e) {
      fail(e);
    }
  }

  function update() {
    choice.hidden = !view.choosing;
    choiceNote.hidden = !view.choosing;
    expired.hidden = !view.expired || view.choosing;
    steps.hidden = view.expired || view.choosing;
    only.hidden = view.expired || view.choosing;
    fieldBox.hidden = !view.typing || view.choosing;
    error.hidden = !view.error;
    error.textContent = view.error ?? "";
    typeInstead.hidden = view.typing || view.choosing;
    pair.textContent = view.busy ? "Pairing…" : "Pair with this code";
    pair.disabled = view.busy || !field.value.trim();
    const scanNow = scan && !view.typing && !view.choosing;
    if (!scanNow) return ctx.mainButton(null);
    ctx.mainButton({
      text: view.busy
        ? "Pairing…"
        : view.expired
          ? "Scan the new code"
          : "Scan the code on your PC",
      busy: view.busy,
      onClick: () => {
        if (view.busy) return;
        ctx.tg.showScanQrPopup({ text: "The code on your PC" }, (text) => {
          submit(text);
          return true;
        });
      },
    });
  }

  queueMicrotask(update);
  return {
    content: el(
      "div",
      el(
        "p.lead",
        "Once only. After this the app finds your PC by itself whenever it is on.",
      ),
      restore,
      choiceNote,
      expired,
      steps,
      only,
      fieldBox,
    ),
    bottom: el("div", choice, typeInstead),
  };
}

const step = (n, title, detail) =>
  el(
    "div.step",
    el("span.num", String(n)),
    el("div", el("div.t", title), el("div.d", detail)),
  );

registerScreen({
  id: "pairing",
  tab: null,
  title: "Pair your PC",
  render,
  actions: [],
});
