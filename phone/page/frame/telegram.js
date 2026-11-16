// Telegram start-up and theme (DS1 section 2). telegram-web-app.js (the pinned copy) writes every theme field as
// a --tg-theme-* variable and keeps them current on themeChanged; page.css maps those into the --nim-* slots. This
// file checks the required fields, sets the dark class, colours Telegram's own header and bottom bar, and wraps the
// main button, back button and haptics.

// Fields with no fallback (DS1's colour table): a missing one is shown as an error, never guessed.
const REQUIRED = [
  "text_color",
  "hint_color",
  "button_color",
  "button_text_color",
];

export function startTelegram() {
  const tg = globalThis.Telegram?.WebApp;
  if (!tg) throw new Error("Telegram's script did not load.");
  tg.ready();
  tg.expand();
  if (tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes();
  applyTheme(tg);
  tg.onEvent("themeChanged", () => applyTheme(tg));
  return tg;
}

export function applyTheme(tg) {
  const p = tg.themeParams || {};
  const missing = REQUIRED.filter((k) => !p[k]);
  if (!p.secondary_bg_color && !p.bg_color) missing.push("bg_color");
  if (missing.length)
    throw new Error(`Telegram gave no theme colour for ${missing.join(", ")}.`);
  document.documentElement.classList.toggle(
    "dark-theme",
    tg.colorScheme === "dark",
  );
  // Telegram's header and the page share the page colour, so the header flows into the page.
  const page = p.secondary_bg_color ? "secondary_bg_color" : "bg_color";
  if (tg.isVersionAtLeast("6.1")) {
    tg.setHeaderColor(page);
    tg.setBackgroundColor(page);
  }
  if (tg.isVersionAtLeast("7.10"))
    tg.setBottomBarColor(
      p.bottom_bar_bg_color ? "bottom_bar_bg_color" : "bg_color",
    );
}

// True inside a Telegram client that draws the native buttons. In a plain browser (a local run on the PC) the
// frame draws its own main button instead.
export function hasHost() {
  return (
    globalThis.TelegramWebviewProxy !== undefined ||
    (globalThis.external && "notify" in globalThis.external) ||
    globalThis.parent !== globalThis
  );
}

// Only the iPhone client has a QR scanner; Telegram Desktop pairs with a pasted code.
export const canScan = (tg) =>
  (tg.platform === "ios" || tg.platform === "android") &&
  tg.isVersionAtLeast("6.4");

export function haptic(tg, kind) {
  if (!hasHost() || !tg.isVersionAtLeast("6.1")) return;
  if (kind === "select") tg.HapticFeedback.selectionChanged();
  else tg.HapticFeedback.impactOccurred("light");
}

// One main button per screen: { text, onClick, busy } or null to hide it. `own` is the frame's drawn stand-in,
// used when there is no Telegram host.
export function setMainButton(tg, own, spec) {
  if (hasHost()) {
    const mb = tg.MainButton;
    if (setMainButton.handler) mb.offClick(setMainButton.handler);
    setMainButton.handler = null;
    if (!spec) return mb.hide();
    setMainButton.handler = () => {
      haptic(tg, "impact");
      spec.onClick();
    };
    mb.setText(spec.text);
    mb.onClick(setMainButton.handler);
    if (spec.busy) mb.showProgress(false);
    else mb.hideProgress();
    mb.show();
    return;
  }
  own.hidden = !spec;
  if (!spec) return;
  own.textContent = spec.text;
  own.disabled = Boolean(spec.busy);
  own.onclick = spec.onClick;
}

export function setBackButton(tg, onBack) {
  if (!hasHost() || !tg.isVersionAtLeast("6.1")) return;
  const bb = tg.BackButton;
  if (setBackButton.handler) bb.offClick(setBackButton.handler);
  setBackButton.handler = onBack;
  if (onBack) {
    bb.onClick(onBack);
    bb.show();
  } else bb.hide();
}
