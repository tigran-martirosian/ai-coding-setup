// The frame (DS1 section 2): start-up, the screen in view, the tab bar, the main and back buttons, and the link
// to the PC. It closes the socket when the page is hidden and, when shown again, opens a new one with a new hello
// and draws the screen again, so every screen asks for fresh state (pipe design, section 9).

import { askCard } from "../screens/device-join.js";
import { PAGE_VERSION } from "../screens.generated.js";
import {
  ChannelError,
  join,
  openLink,
  openSession,
  pair,
  socketUrl,
} from "./channel.js";
import { el, ICONS, icon } from "./dom.js";
import {
  forgetPairing,
  loadPairing,
  restorePairing,
  savePairing,
} from "./keystore.js";
import { hasScreen, screen, tabScreens } from "./screens.js";
import {
  haptic,
  hasHost,
  setBackButton,
  setMainButton,
  startTelegram,
} from "./telegram.js";

const RETRY_S = [1, 2, 5, 10, 30];
const OFFLINE_RETRY_S = 10;
const $ = (id) => document.getElementById(id);

// Close words that stop the page until it is opened again; the rest retry.
const STOPS = {
  "not-invited": "This app is invite-only.",
  "bad-sign": "Please close and reopen the app.",
  "no-init-data": "Open this page from the bot's Open button in Telegram.",
};

const st = {
  tg: null,
  pairing: null, // { K, pcId, dev, where }
  link: null,
  session: null,
  hello: null,
  problem: null, // { text, offline?: { lastSeen } }
  connecting: false,
  asleep: false,
  retry: 0,
  timer: null,
  view: null, // { id, params, y }: y is the box's scroll when the user left the screen
  stack: [],
  tabY: new Map(), // tab screen id -> its scroll when the user left it
  listeners: new Set(),
  beforeSleep: new Set(), // sends that must go out before the link closes
  // An alert's Open button opens /?o=<handle>; once linked, the PC turns the handle into its session.
  alert: new URLSearchParams(location.search).get("o"),
  notice: null, // a line about the alert that could not be opened
  asks: new Map(), // rid -> { ask, state, busy }: a device that asks to join, shown as a card over the screen
  cardLayer: null, // the element the cards sit in, made with the first card
};

// Telegram.WebApp.platform to the device kinds of the pipe design, section 15 (KINDS in seal.mjs); a platform
// not on this list is the design's own "other" ("Another device").
const PLATFORM_KINDS = {
  ios: "iphone",
  android: "android",
  android_x: "android",
  tdesktop: "desktop",
  macos: "mac",
  web: "web",
  weba: "web",
  webk: "web",
};
const deviceKind = () => PLATFORM_KINDS[st.tg.platform] ?? "other";

function fatal(text) {
  $("app").hidden = true;
  const f = $("fatal");
  f.hidden = false;
  f.replaceChildren(el("p", text));
}

const hhmm = (t) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function x25519Works() {
  try {
    await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
    return true;
  } catch {
    return false;
  }
}

// ---- the link to the PC

function problemOf(e) {
  const code = e instanceof ChannelError ? e.code : "failed";
  if (STOPS[code]) return { text: STOPS[code], stop: true };
  if (code === "protocol")
    return {
      stop: true,
      text:
        e.extra.pc > e.extra.page
          ? "Telegram has an old copy of the app: close and reopen it."
          : `This app (protocol ${e.extra.page}) and your PC program (protocol ${e.extra.pc}) cannot talk. Update the PC with /update-setup.`,
    };
  if (code === "pc-offline") return { offline: e.extra };
  if (st.limitAt)
    return {
      text: `The relay is near its free daily limit. It works again at ${hhmm(st.limitAt)}.`,
    };
  if (code === "unreachable") return { text: "Can't reach the relay." };
  return { text: "Reconnecting…" };
}

async function connect() {
  if (st.connecting || st.asleep || !st.pairing || st.session) return;
  st.connecting = true;
  clearTimeout(st.timer);
  let link = null;
  try {
    link = await openLink({
      url: socketUrl(location.href),
      initData: st.tg.initData,
      WebSocket,
    });
    link.listen((f) => {
      if (f.t === "limit") st.limitAt = f.resetAt;
    });
    st.link = link;
    const s = await openSession(link, {
      K: st.pairing.K,
      dev: st.pairing.dev,
      pageVersion: PAGE_VERSION,
      onEvent: (body) => {
        if (body.e === "device.ask" || body.e === "device.asked")
          return joinCard(body);
        for (const fn of st.listeners) fn(body);
      },
    });
    // The PC sends every open request again at hello, so the cards start afresh with each session.
    st.asks.clear();
    drawCards();
    st.session = s;
    st.hello = s.hello;
    st.problem = null;
    st.retry = 0;
    st.limitAt = null;
    s.ended.then((e) => {
      if (st.session !== s) return;
      st.session = null;
      link.close();
      if (!st.asleep) later(e);
    });
    draw();
    if (st.alert) openAlert(s);
  } catch (e) {
    link?.close();
    if (st.link === link) st.link = null;
    later(e);
  } finally {
    st.connecting = false;
  }
}

// Opens the session an alert points to; a handle that is gone or too old says so above the screen.
async function openAlert(s) {
  const handle = st.alert;
  st.alert = null;
  let r;
  try {
    r = await s.ask("alerts.resolve", { handle });
  } catch (e) {
    r = e;
  }
  if (r?.ok) return go("session", r.d);
  const why = r?.err ?? r?.code ?? r?.message ?? "no answer";
  st.notice =
    why === "expired"
      ? "That alert is older than 7 days: find the session in Projects."
      : `Could not open the alert's session: ${why}.`;
  draw();
}

function later(e) {
  const p = problemOf(e);
  st.problem = p;
  draw();
  if (p.stop) return;
  const s = p.offline
    ? OFFLINE_RETRY_S
    : RETRY_S[Math.min(st.retry++, RETRY_S.length - 1)];
  st.timer = setTimeout(connect, s * 1000);
}

// The page is hidden: answers still in their Undo go out first (the user saw them as sent), then the bye.
async function sleep() {
  if (st.asleep) return;
  st.asleep = true;
  clearTimeout(st.timer);
  const waiting = [...st.beforeSleep];
  st.beforeSleep.clear();
  if (waiting.length) {
    await Promise.allSettled(waiting.map((fn) => fn()));
    if (!st.asleep) return; // shown again meanwhile: the session stays
  }
  const s = st.session;
  const link = st.link;
  st.session = null;
  st.link = null;
  if (s) s.bye().finally(() => link?.close());
  else link?.close();
}

function wake() {
  if (!st.asleep) return;
  st.asleep = false;
  st.retry = 0;
  if (st.pairing) connect();
}

// Pairs with a code from the scanner or the text box; on success the app opens on its first tab.
async function pairWith(code) {
  const link = await openLink({
    url: socketUrl(location.href),
    initData: st.tg.initData,
    WebSocket,
  });
  try {
    const p = await pair(link, {
      code,
      initData: st.tg.initData,
      kind: deviceKind(),
    });
    const where = await savePairing(st.tg, p);
    st.pairing = { ...p, where };
  } finally {
    link.close();
  }
  st.stack = [];
  goFirst();
  connect();
}

// Asks to join by an OK on a paired device (pipe design, section 15). Resolves once the PC waits, with
// { word, open, done, cancel() }; `done` resolves after the key is stored and Home is open.
async function joinWith() {
  const link = await openLink({
    url: socketUrl(location.href),
    initData: st.tg.initData,
    WebSocket,
  });
  let j;
  try {
    j = await join(link, { kind: deviceKind(), initData: st.tg.initData });
  } catch (e) {
    link.close();
    throw e;
  }
  const done = j.done
    .then(async (p) => {
      const where = await savePairing(st.tg, p);
      st.pairing = { ...p, where };
      st.stack = [];
      goFirst();
      connect();
    })
    .finally(() => link.close());
  done.catch(() => {});
  return {
    word: j.word,
    open: j.open,
    done,
    cancel: () => {
      try {
        j.cancel();
      } finally {
        link.close();
      }
    },
  };
}

// ---- a device that asks to join: a card over the current screen on every paired device

function joinCard({ e, d }) {
  if (e === "device.ask") st.asks.set(d.rid, { ask: d, state: null });
  else {
    const card = st.asks.get(d.rid);
    if (!card) return;
    if (d.answer !== "ok") st.asks.delete(d.rid);
    else {
      card.state = "ok";
      setTimeout(() => {
        st.asks.delete(d.rid);
        drawCards();
      }, 3000);
    }
  }
  drawCards();
}

async function answerAsk(rid, ok) {
  const card = st.asks.get(rid);
  card.busy = true;
  drawCards();
  haptic(st.tg, ok ? "success" : "select");
  let r;
  try {
    r = await st.session.ask("device.answer", { rid, ok });
  } catch (e) {
    r = { ok: false, err: e.code ?? e.message };
  }
  card.busy = false;
  if (!r.ok) {
    card.state =
      r.err === "answered"
        ? "Already answered on your other device"
        : `The PC did not take the answer: ${r.err}`;
    if (r.err === "answered" || r.err === "unknown-request")
      setTimeout(() => {
        st.asks.delete(rid);
        drawCards();
      }, 3000);
  }
  drawCards();
}

function drawCards() {
  const cards = [...st.asks.entries()];
  if (!st.cardLayer) {
    if (!cards.length) return;
    st.cardLayer = el("div.join-layer");
    $("app").append(st.cardLayer);
  }
  const layer = st.cardLayer;
  layer.hidden = cards.length === 0;
  layer.replaceChildren(
    ...cards.map(([rid, c]) => askCard(c, (ok) => answerAsk(rid, ok))),
  );
}

// ---- screens

// Without the full set of actions the PC answers, a screen is drawn greyed: an unverified page may only ask
// for pc.status (pipe design, section 6).
const offered = (action) => action === "pc.status" || st.hello?.page === "ok";

function ctx(params) {
  return {
    params,
    tg: st.tg,
    pageVersion: PAGE_VERSION,
    hello: st.hello,
    connected: Boolean(st.session),
    pairing: st.pairing,
    ask(action, data) {
      if (!st.session) return Promise.reject(new ChannelError("not-connected"));
      return st.session.ask(action, data);
    },
    // A recording to the PC in sealed pieces (channel.js sendStream); the PC's answer names the stream.
    sendStream(bytes, mime, onProgress) {
      if (!st.session) return Promise.reject(new ChannelError("not-connected"));
      return st.session.sendStream(bytes, mime, onProgress);
    },
    offered,
    // The box the screen scrolls in; the page itself never scrolls.
    scrollBox: $("content"),
    onEvent(fn) {
      st.listeners.add(fn);
    },
    // fn() runs when the page is hidden, before the link closes; returns the function that takes it back.
    beforeSleep(fn) {
      st.beforeSleep.add(fn);
      return () => st.beforeSleep.delete(fn);
    },
    go,
    back,
    redraw: () => draw(),
    mainButton: (spec) => setMainButton(st.tg, $("main-btn"), spec),
    haptic: (kind) => haptic(st.tg, kind),
    pairWith,
    join: joinWith,
    // The pairing screen again, with no back step; { code: true } opens it on the code's steps.
    toPairing: (params) => {
      leave();
      st.stack = [];
      st.view = { id: "pairing", params, y: 0 };
      draw(0);
    },
    restore: async () => {
      const p = await restorePairing(st.tg);
      if (!p || p.restorable) return false;
      st.pairing = p;
      goFirst();
      connect();
      return true;
    },
    // After Settings' Unpair, once the PC forgot this device: the stored key goes, the link closes and the pairing
    // screen shows with no back step. A key store that cannot delete throws, and Settings says so.
    unpaired: async () => {
      await forgetPairing(st.tg);
      st.pairing = null;
      st.session = null;
      st.hello = null;
      st.problem = null;
      clearTimeout(st.timer);
      st.link?.close();
      st.link = null;
      st.asks.clear();
      drawCards();
      st.stack = [];
      st.tabY.clear();
      st.view = { id: "pairing", params: { restorable: false }, y: 0 };
      draw(0);
    },
    // The Checks screen of the test build hands over to the normal start.
    startApp: () => begin(),
  };
}

// Every screen scrolls the frame's one box (#content), never the page: Telegram's iPhone header darkens as the page
// scrolls. The frame keeps where each screen was left: a back-stack entry in its view, a tab's top screen in
// st.tabY. A new screen opens at the top; Back and a tab go back to the kept place.
function leave() {
  if (!st.view) return;
  st.view.y = $("content").scrollTop;
  if (screen(st.view.id).tab !== null) st.tabY.set(st.view.id, st.view.y);
}

function go(id, params = {}) {
  st.notice = null;
  leave();
  const tab = screen(id).tab !== null;
  if (st.view && !tab && st.view.id !== "pairing") st.stack.push(st.view);
  else st.stack = [];
  st.view = { id, params, y: tab ? (st.tabY.get(id) ?? 0) : 0 };
  draw(st.view.y);
}

function back() {
  const prev = st.stack.pop();
  if (!prev) return draw();
  st.view = prev;
  draw(prev.y);
}

function goFirst() {
  const first = tabScreens()[0];
  st.view = first ? { id: first.screen.id, params: {}, y: 0 } : null;
  draw(0);
}

function banner() {
  if (!st.pairing || st.view?.id === "checks") return null;
  const p = st.problem;
  if (p?.offline)
    return el(
      "div.group.frame-state",
      el(
        "div.block",
        el(
          "div.pc",
          el("span.pc-icon", icon(ICONS.pc)),
          el(
            "div",
            el("div.pc-title", "PC off or asleep"),
            el(
              "div.pc-meta",
              p.offline.lastSeen
                ? `Last seen ${hhmm(p.offline.lastSeen)}`
                : "Not seen yet",
            ),
          ),
        ),
        el(
          "p.err",
          "The phone cannot wake it. Turn the PC on and the app connects by itself; this page updates.",
        ),
      ),
    );
  if (p) return el("p.frame-line", p.text);
  if (!st.session) return el("p.frame-line", "Connecting…");
  if (st.hello?.page !== "ok")
    return el(
      "p.frame-line.warn",
      "This page is not the one your PC was built for: only status works. Update the PC, or tell the owner.",
    );
  if (st.notice) return el("p.frame-line.warn", st.notice);
  return null;
}

// y: where the box scrolls once the screen is drawn; a redraw of the same screen (a reconnect, a notice) keeps
// the place the user is at.
function draw(y = $("content").scrollTop) {
  st.listeners.clear();
  setMainButton(st.tg, $("main-btn"), null);
  const bottom = $("bottom-extra");
  if (!st.view) {
    // A build with no tab screens yet: the frame says where the link stands.
    $("content").replaceChildren(
      el("h1.large-title", "Nimbalyst"),
      banner() ?? el("p.frame-line", "Connected to your PC."),
    );
    bottom.replaceChildren();
    drawBars(null);
    return;
  }
  const s = screen(st.view.id);
  const out = s.render(ctx(st.view.params));
  const isNode = out instanceof Node;
  const title =
    typeof s.title === "function" ? s.title(st.view.params) : s.title;
  const grey = s.actions.some((a) => !offered(a)) && st.session;
  // One wrapping element, as el() skips the empty slots (replaceChildren would print them as "null").
  $("content").replaceChildren(
    el(
      "div",
      el("h1.large-title", title),
      banner(),
      grey ? el("p.frame-line", "Read-only: this page is unverified") : null,
      el(grey ? "div.greyed" : "div", isNode ? out : out.content),
    ),
  );
  bottom.replaceChildren(...(isNode || !out.bottom ? [] : [out.bottom]));
  drawBars(s);
  $("content").scrollTop = y;
}

function drawBars(s) {
  const tabs = tabScreens();
  const inTab = s && (s.tab !== null || st.stack.length > 0);
  const bar = $("tabbar");
  bar.hidden = !inTab || tabs.length === 0;
  const current = s?.tab ?? st.stack[0]?.id;
  bar.replaceChildren(
    ...tabs.map((t) =>
      el(
        "button.tab",
        {
          type: "button",
          // dom.js writes true as an empty attribute, so the current tab names its kind.
          "aria-current":
            t.screen.id === current || t.tab === current ? "page" : undefined,
          onclick: () => {
            haptic(st.tg, "select");
            st.stack = [];
            go(t.screen.id);
          },
        },
        icon(ICONS[t.tab]),
        t.word,
      ),
    ),
  );
  $("bottom").hidden =
    $("bottom-extra").childElementCount === 0 && $("main-btn").hidden;
  setBackButton(st.tg, st.stack.length ? back : null);
}

// ---- start

async function begin() {
  // A plain browser (a local look at the page on the PC) has no Telegram key store to read: it shows pairing.
  if (!hasHost()) {
    st.view = { id: "pairing", params: { restorable: false } };
    return draw();
  }
  let p;
  try {
    p = await loadPairing(st.tg);
  } catch (e) {
    return fatal(`Could not read the key: ${e.message}. Pair again.`);
  }
  if (!p || p.restorable) {
    st.view = { id: "pairing", params: { restorable: Boolean(p) } };
    return draw();
  }
  st.pairing = p;
  goFirst();
  connect();
}

async function main() {
  try {
    st.tg = startTelegram();
  } catch (e) {
    return fatal(e.message);
  }
  if (!(await x25519Works()))
    return fatal(
      "Telegram here is too old for the sealed channel (needs iOS 18.4 or newer).",
    );
  // SecureStorage and DeviceStorage both came with Telegram 9.0; without them the key cannot be kept.
  if (hasHost() && !st.tg.isVersionAtLeast("9.0"))
    return fatal(
      "This Telegram is too old to keep the key: update Telegram, then open the app again.",
    );
  document.addEventListener("visibilitychange", () =>
    document.hidden ? sleep() : wake(),
  );
  if (st.tg.isVersionAtLeast("8.0")) {
    st.tg.onEvent("deactivated", sleep);
    st.tg.onEvent("activated", wake);
  }
  if (hasScreen("checks")) {
    st.view = { id: "checks", params: {} };
    return draw();
  }
  await begin();
}

main().catch((e) => fatal(`The app stopped: ${e.message}`));
