// The frame (DS1 section 2): start-up, the screen in view, the tab bar, the main and back buttons, and the link
// to the PC. It closes the socket when the page is hidden and, when shown again, opens a new one with a new hello
// and draws the screen again, so every screen asks for fresh state (pipe design, section 9); a live session goes
// on from where it was instead. While the link is down it shows one calm connecting view (phone steady design,
// section 4).

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
import { lockGestures, setZoom } from "./zoom.js";

// The link's waits (phone steady design, section 2).
const RETRY_CAP_S = 30; // a retry waits a random time up to 2^n s, at most this
const UP_RESET_MS = 30_000; // a session up this long starts the retry waits over
const QUIET_MS = 2000; // after a drop the screen stays as it was this long
const OFFLINE_HOLD_MS = 20_000; // the relay's offline answers this long, with no good hello between: "PC off"
const LONG_MS = 30_000; // connecting this long without reaching the relay: the internet line
const RELOAD_GAP_MS = 5 * 60_000; // a page stuck before its socket opens reloads at most once in this time
const RELOAD_KEY = "steady-reload-at";
const TRY_BUSY_MS = 2000; // Try again stays busy at least this long, so a second tap does nothing extra
// The connecting view's words: "the app" is this page, "the PC program" the setup on the computer.
const CONNECTING = "Connecting to your PC…";
const LONG_LINE =
  "Still no connection. This phone's internet or the connection service may be down.";
const READ_ONLY =
  "You can look, not act. On the PC, run /update-setup in Claude Code.";
const between = (lo, hi) => lo + Math.random() * (hi - lo);
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
  stop: null, // the words of a close that stops the page until it is opened again
  update: false, // a newer app is ready: only a reload helps
  offline: null, // { since, lastSeen, shown }: the relay's offline answers since the last good hello
  connecting: false,
  attempt: 0, // counts connect attempts: a wake or a sleep drops the one under way
  asleep: false,
  retry: 0, // n of the retry wait
  stuck: 0, // attempts in a row whose socket never opened
  upAt: 0, // when the session in use said hello
  droppedAt: Date.now(), // when the link was last lost (at first: when the page opened)
  reachedAt: 0, // when a socket to the relay last opened
  liveAt: 0, // when the screen in view was last live: the "as of" time of a kept screen
  tryAt: 0, // when Try again was last tapped
  tryAttempt: 0, // the attempt Try again started
  ever: false, // a session was up since the page opened
  shown: null, // the key of the link state drawn now
  firstShown: false, // the first-open view stands in place of the screen
  slot: null, // the element the link state is drawn in
  body: null, // the element the screen is drawn in
  grey: false, // the screen in view needs actions the PC does not offer
  resume: null, // the screen's way to go on after a reconnect without being drawn again
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

// What a failed attempt or an ended session means: { stop } words, { update }, { offline } (the relay's word that
// the PC has no link) or { retry } with the code.
function problemOf(e) {
  const code = e instanceof ChannelError ? e.code : "failed";
  if (STOPS[code]) return { stop: STOPS[code] };
  if (code === "protocol") {
    // The relay's own answer has no numbers: it serves a newer page than this one, as does a PC that is newer.
    if (e.extra.pc === undefined || e.extra.pc > e.extra.page)
      return { update: true };
    return {
      stop: `The app (protocol ${e.extra.page}) and the PC program (protocol ${e.extra.pc}) cannot talk. On the PC, run /update-setup in Claude Code.`,
    };
  }
  if (code === "pc-offline") return { offline: e.extra };
  return { retry: code };
}

async function connect() {
  if (st.connecting || st.asleep || !st.pairing || st.session) return;
  if (st.stop || st.update) return;
  st.connecting = true;
  clearTimeout(st.timer);
  const attempt = ++st.attempt;
  const mine = () => attempt === st.attempt;
  // A socket the relay answered "offline" on stays: the hello goes again on it.
  let link = st.link && !st.link.closed ? st.link : null;
  try {
    if (!link) {
      link = await openLink({
        url: socketUrl(location.href),
        initData: st.tg.initData,
        WebSocket,
      });
      if (!mine()) return link.drop("dropped");
      st.link = link;
      st.stuck = 0;
      const mineLink = link;
      link.listen((f) => {
        if (f.t === "limit") st.limitAt = f.resetAt;
        // The PC is back: a page waiting on the relay's offline answers says hello at once.
        if (f.t === "pc-online" && st.link === mineLink && !st.session)
          connect();
      });
    }
    st.reachedAt = Date.now();
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
    // A wake meanwhile dropped this link: its session ends by itself, the new attempt goes on.
    if (!mine()) return;
    // The PC sends every open request again at hello, so the cards start afresh with each session.
    st.asks.clear();
    drawCards();
    const samePage = st.hello?.page === s.hello.page;
    st.session = s;
    st.hello = s.hello;
    st.offline = null;
    st.limitAt = null;
    st.upAt = Date.now();
    const first = !st.ever;
    st.ever = true;
    s.ended.then((e) => {
      if (st.session !== s) return;
      st.session = null;
      st.liveAt = Date.now();
      lost();
      if (Date.now() - st.upAt >= UP_RESET_MS) st.retry = 0;
      if (!st.asleep) later(e);
    });
    // A screen that can go on from where it was (a live session) keeps what it shows; others draw afresh.
    if (!first && samePage && st.resume?.() === true) drawStatus();
    else draw();
    if (st.alert) openAlert(s);
  } catch (e) {
    if (!mine()) return;
    later(e);
  } finally {
    if (mine()) st.connecting = false;
  }
}

// The link is gone: the quiet time and the "relay not reached" time count from here.
function lost() {
  st.droppedAt = Date.now();
}

function dropLink() {
  st.link?.drop("retry");
  st.link = null;
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

// The next attempt after a failed one. The relay's offline answer keeps the socket and says hello again on it
// (or at once on its pc-online); "PC off" shows only once those answers held 20 s, and stays until a good hello.
// Any other failure drops the socket and waits a random time up to 2^n s (Full Jitter).
function later(e) {
  const p = problemOf(e);
  if (p.stop || p.update) {
    st.stop = p.stop ?? null;
    st.update = Boolean(p.update);
    dropLink();
    return drawStatus();
  }
  let wait;
  if (p.offline) {
    const now = Date.now();
    st.offline ??= { since: now, shown: false };
    st.offline.lastSeen = p.offline.lastSeen ?? null;
    const held = now - st.offline.since;
    if (held >= OFFLINE_HOLD_MS) st.offline.shown = true;
    wait = held < OFFLINE_HOLD_MS ? between(3, 7) : between(10, 20);
  } else if (p.retry === "pc-online") {
    // The session ended because the PC linked again: the socket is fine, the hello goes again at once.
    wait = 0;
  } else {
    dropLink();
    if (p.retry === "stuck" && ++st.stuck >= 2 && reloadOnce()) return;
    wait = between(0.25, Math.min(RETRY_CAP_S, 2 ** st.retry++));
  }
  drawStatus();
  st.timer = setTimeout(connect, wait * 1000);
}

// Two attempts in a row whose socket never opened: the web view's network is stuck after a wake (WebKit bug
// 308073), and only a reload frees it. At most once in 5 minutes, kept across the reload.
function reloadOnce() {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
  if (Date.now() - last < RELOAD_GAP_MS) return false;
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  location.reload();
  return true;
}

// Back from sleep, a network change or a page shown from the cache: the old socket may be dead without a word, so
// it goes whatever its state, and a new one opens at once with the retry waits started over.
function reconnectNow() {
  if (st.asleep || !st.pairing) return;
  clearTimeout(st.timer);
  st.attempt++;
  st.connecting = false;
  if (st.session) {
    st.session = null;
    st.liveAt = Date.now();
    lost();
  }
  dropLink();
  st.retry = 0;
  connect();
}

// Try again while connecting: a new attempt at once. While it runs (at least 2 s) the button is busy and a tap on
// it does nothing.
const trying = (now = Date.now()) =>
  st.tryAt > 0 &&
  ((st.connecting && st.attempt === st.tryAttempt) ||
    now - st.tryAt < TRY_BUSY_MS);

function tryAgain() {
  if (trying()) return;
  haptic(st.tg, "light");
  st.tryAt = Date.now();
  reconnectNow();
  st.tryAttempt = st.attempt;
  drawStatus();
}

// The page is hidden: answers still in their Undo go out first (the user saw them as sent), then the bye.
async function sleep() {
  if (st.asleep) return;
  st.asleep = true;
  clearTimeout(st.timer);
  st.attempt++;
  st.connecting = false;
  const waiting = [...st.beforeSleep];
  st.beforeSleep.clear();
  if (waiting.length) {
    await Promise.allSettled(waiting.map((fn) => fn()));
    if (!st.asleep) return; // shown again meanwhile: the session stays
  }
  const s = st.session;
  const link = st.link;
  if (s) st.liveAt = Date.now();
  st.session = null;
  st.link = null;
  if (s) s.bye().finally(() => link?.close());
  else link?.close();
}

function wake() {
  if (!st.asleep) return;
  st.asleep = false;
  lost(); // the quiet 2 s count from the wake, not from when the page was hidden
  reconnectNow();
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

// Without the full set of actions the PC answers, a screen is drawn read-only: only a 26.3 PC still calls a page it
// was not built with "unverified" and answers it pc.status alone (phone steady design, section 6).
const offered = (action) => action === "pc.status" || st.hello?.page === "ok";

function ctx(params) {
  return {
    params,
    tg: st.tg,
    pageVersion: PAGE_VERSION,
    hello: st.hello,
    // Read when asked: a screen kept through a drop sees the link as it is now.
    get connected() {
      return Boolean(st.session);
    },
    pairing: st.pairing,
    // fn() runs after a reconnect in place of drawing the screen again; it returns true when it went on (a live
    // session asks for what it missed), anything else draws the screen afresh.
    onResume(fn) {
      st.resume = fn;
    },
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
      st.offline = null;
      st.ever = false;
      clearTimeout(st.timer);
      st.attempt++;
      st.connecting = false;
      dropLink();
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

// The link as the frame shows it (phone steady design, section 4), one state at a time: null (connected, or the
// quiet 2 s after a drop: the screen as it is), first (no screen yet), connecting (the screen kept, dimmed, with a
// strip on top), off (the relay said the PC is gone for 20 s), update, stop. "PC off" leaves only for a good hello.
// A kept screen stays as it was through Connecting, PC off and Update: only the top changes.
function linkState(now = Date.now()) {
  if (!st.pairing || st.view?.id === "checks") return null;
  if (st.stop) return { key: "stop", stop: st.stop };
  if (st.update) return { key: "update", update: true };
  if (st.session) return null;
  if (st.offline?.shown)
    return { key: `off ${st.offline.lastSeen}`, off: st.offline };
  // The relay not reached for 30 s: no socket open now, and none opened since 30 s ago.
  const long =
    !(st.link && !st.link.closed) &&
    now - Math.max(st.droppedAt, st.reachedAt) >= LONG_MS;
  const busy = long && trying(now);
  const limit = st.limitAt
    ? `The connection service is near its free daily limit. It works again at ${hhmm(st.limitAt)}.`
    : null;
  const key = `${long} ${busy} ${limit}`;
  if (!st.ever) return { key: `first ${key}`, first: true, long, busy, limit };
  if (now - st.droppedAt < QUIET_MS) return null;
  return { key: `connecting ${key}`, connecting: true, long, busy, limit };
}

// Try again under the long line; "Trying…" and off while its attempt runs.
const tryButton = (busy) =>
  el(
    "button.btn.try-btn",
    {
      type: "button",
      disabled: busy,
      "aria-busy": busy ? "true" : undefined,
      onclick: tryAgain,
    },
    busy ? "Trying…" : "Try again",
  );

// A block with a picture, a title and a line under it, as Home's PC block.
const stateBlock = (pic, title, meta, ...more) =>
  el(
    "div.group.frame-state",
    el(
      "div.block",
      el(
        "div.pc",
        el("span.pc-icon", icon(pic)),
        el("div", el("div.pc-title", title), el("div.pc-meta", meta)),
      ),
      ...more,
    ),
  );

// What goes in the slot above the screen for `link` (linkState); connected, the alert's notice if there is one.
function stateView(link) {
  if (!link) return st.notice ? [el("p.frame-line.warn", st.notice)] : [];
  if (link.stop) return [el("p.frame-line", link.stop)];
  if (link.update)
    return [
      stateBlock(
        ICONS.reload,
        "App update ready",
        "Reload to use the newer version of the app.",
        el(
          "button.btn.fill.wide.reload-btn",
          { type: "button", onclick: () => location.reload() },
          "Reload",
        ),
      ),
    ];
  if (link.off)
    return [
      stateBlock(
        ICONS.pc,
        "PC off or asleep",
        link.off.lastSeen
          ? `Last seen ${hhmm(link.off.lastSeen)}`
          : "Not seen yet",
        el(
          "p.frame-line.off-line",
          "It connects by itself when the PC is back.",
        ),
        st.ever
          ? el(
              "p.frame-line.as-of",
              `The screen below is as of ${hhmm(st.liveAt)}.`,
            )
          : null,
      ),
    ];
  return [
    el(
      "div.link-bar",
      { role: "status" },
      el(
        "div.link-bar-top",
        el("span.spinner"),
        el("span.link-bar-title", CONNECTING),
        el("span.link-bar-asof", `as of ${hhmm(st.liveAt)}`),
      ),
      link.limit ? el("div.link-bar-line", link.limit) : null,
      link.long ? el("div.link-bar-line", LONG_LINE) : null,
      link.long ? tryButton(link.busy) : null,
    ),
  ];
}

// Page just opened, no session yet: this stands in place of the screen.
const firstView = (link) =>
  el(
    "div.connect-view",
    { role: "status" },
    el("span.spinner.big"),
    el("h1.connect-title", CONNECTING),
    link.limit ? el("p.frame-line", link.limit) : null,
    link.long ? el("p.frame-line", LONG_LINE) : null,
    link.long ? tryButton(link.busy) : null,
  );

// A screen kept through a drop stays as it was, dimmed a little and taking no taps, while connecting, with the PC
// off or while only a reload helps; off and update put their own card in place of Home's PC card. Against a 26.3
// PC the screen shows at full strength and only its controls that act are off.
function bodyClass(link) {
  if (link?.connecting) return "kept";
  if (link?.off || link?.update) return "kept kept-off";
  return st.grey ? "read-only" : "";
}

// Draws the link state again when it changed, keeping the screen; going to or from the first-open view, or with no
// screen drawn, draws all. Runs every second, so the quiet time and the long line come by themselves.
function drawStatus() {
  const link = linkState();
  if ((link?.key ?? null) === st.shown) return;
  if (link?.first || st.firstShown || !st.slot) return draw();
  st.shown = link?.key ?? null;
  st.slot.replaceChildren(...stateView(link));
  if (st.body) st.body.className = bodyClass(link);
}

// y: where the box scrolls once the screen is drawn; a redraw of the same screen (a reconnect, a notice) keeps
// the place the user is at.
function draw(y = $("content").scrollTop) {
  st.listeners.clear();
  st.resume = null;
  setMainButton(st.tg, $("main-btn"), null);
  const bottom = $("bottom-extra");
  const link = linkState();
  st.shown = link?.key ?? null;
  st.firstShown = Boolean(link?.first);
  st.slot = el("div.link-state", ...stateView(link));
  st.body = null;
  st.grey = false;
  // Only the session's chat zooms (frame/zoom.js).
  setZoom(Boolean(st.view && !link?.first && st.view.id === "session"));
  if (!st.view || link?.first) {
    // The first-open view, or a build with no tab screens yet: the frame says where the link stands.
    $("content").replaceChildren(
      link?.first
        ? firstView(link)
        : el(
            "div",
            el("h1.large-title", "Nimbalyst"),
            st.slot,
            st.session ? el("p.frame-line", "Connected to your PC.") : null,
          ),
    );
    bottom.replaceChildren();
    bottom.className = "";
    drawBars(null);
    return;
  }
  const s = screen(st.view.id);
  const out = s.render(ctx(st.view.params));
  const isNode = out instanceof Node;
  const title =
    typeof s.title === "function" ? s.title(st.view.params) : s.title;
  st.grey = Boolean(s.actions.some((a) => !offered(a)) && st.session);
  st.body = el("div", isNode ? out : out.content);
  st.body.className = bodyClass(link);
  // One wrapping element, as el() skips the empty slots (replaceChildren would print them as "null").
  $("content").replaceChildren(
    el(
      "div",
      el("h1.large-title", title),
      st.slot,
      st.grey ? el("p.frame-line.warn", READ_ONLY) : null,
      st.body,
    ),
  );
  bottom.replaceChildren(...(isNode || !out.bottom ? [] : [out.bottom]));
  bottom.className = st.grey ? "read-only" : "";
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
    lockGestures();
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
  // A network change, or the page shown again from the browser's cache: the socket may be dead without a word.
  addEventListener("online", reconnectNow);
  addEventListener("pageshow", (e) => e.persisted && reconnectNow());
  setInterval(drawStatus, 1000);
  if (hasScreen("checks")) {
    st.view = { id: "checks", params: {} };
    return draw();
  }
  await begin();
}

main().catch((e) => fatal(`The app stopped: ${e.message}`));
