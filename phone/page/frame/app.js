// The frame (DS1 section 2): start-up, the screen in view, the tab bar, the main and back buttons, and the link
// to the PC. The socket stays while the page is hidden; when it is shown again one ping checks it (a dead one is
// replaced, with a new hello) and the screen is drawn again, so every screen asks for fresh state (pipe design,
// section 9); a live session goes on from where it was instead. Every new session sends the outbox's waiting
// messages again (frame/outbox.js). While the link is down it shows one calm connecting view (phone steady design,
// section 4). It opens at once (comfort design, sections 2 to 4): a tab screen kept on the phone is drawn before the
// first hello, marked "Updating" until fresh; where nothing is kept, the skeleton from index.html stands. Only the
// tab screens load first; the other screens load after the first draw.

import { askCard } from "../screens/device-join.js";
import { LATER, loadRest, PAGE_VERSION } from "../screens.generated.js";
import { shellTab, stylesLoaded, telegramLoaded } from "./boot.js";
import { forgetAll, kept } from "./cache.js";
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
import { offers } from "./offers.js";
import { outbox } from "./outbox.js";
import {
  hasScreen,
  isLoaded,
  laterScreens,
  screen,
  tabScreens,
} from "./screens.js";
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
// A session up this long starts the retry waits over: more than ping 20 s + pong wait 10 s, so a link that dies at
// its first ping keeps the waits growing.
const UP_RESET_MS = 45_000;
const QUIET_MS = 2000; // after a drop the screen stays as it was this long
const CHECK_MS = 3000; // the page shown again: its socket's pong comes in this long, or it is replaced
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
const UNPAIRED = "This device is no longer paired with your PC.";
// The first 3 s after opening, a kept screen stands at full strength with "Updating", and the skeleton without words;
// after that the connecting look takes over (comfort design, sections 2 and 3).
const OPEN_MARK_MS = 3000;
// The full-screen button's icon in full screen: four inward corners (files screens design, section 2).
const LEAVE_FULL = ["M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4"];
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
  firstShown: false, // the skeleton stands in place of the screen
  openedAt: Date.now(),
  booting: true, // the pairing is not read yet: a kept screen may already show
  keptAt: null, // before the first hello: when the screen in view was kept, or null when nothing is kept for it
  skeleton: false, // the last draw was the skeleton: the next screen fades in
  rest: null, // the later screens' loading
  slot: null, // the element the link state is drawn in
  mark: null, // the status mark at the right end of the title row
  body: null, // the element the screen is drawn in
  grey: false, // the screen in view needs actions the PC does not offer
  resume: null, // the screen's way to go on after a reconnect without being drawn again
  timer: null,
  view: null, // { id, params, y }: y is the box's scroll when the user left the screen
  stack: [],
  tabY: new Map(), // tab screen id -> its scroll when the user left it
  listeners: new Set(),
  beforeSleep: new Set(), // sends that must go out before the link closes
  linkWaits: [], // ctx.linked() calls waiting for a session with the PC
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
  $("shell").hidden = true;
  const f = $("fatal");
  f.hidden = false;
  f.replaceChildren(el("p", text));
}

const hhmm = (t) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// The "as of" of a kept screen: the time, and the day before it when it is not today ("12 Nov, 14:05"). Telegram
// Desktop under 600 wide has no room for the day beside the full-screen button.
function asOf(t) {
  const d = new Date(t);
  const narrow = st.tg?.platform === "tdesktop" && globalThis.innerWidth < 600;
  if (narrow || d.toDateString() === new Date().toDateString()) return hhmm(t);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${hhmm(t)}`;
}

// The later screens (all but the tab screens and Home's parts), loaded once after the first draw.
function restLoaded() {
  st.rest ??= loadRest();
  return st.rest;
}

// Runs `then` once screen `id` is in this page: at once for the first screens, after the later ones load otherwise.
function whenLoaded(id, then) {
  if (isLoaded(id)) return then();
  restLoaded().then(
    () => {
      if (!isLoaded(id)) return fatal(`The app has no screen "${id}".`);
      then();
    },
    (e) => fatal(`The app could not load its screens: ${e.message}`),
  );
}

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
// the PC has no link), { unpaired } (the PC no longer holds this device) or { retry } with the code.
function problemOf(e) {
  const code = e instanceof ChannelError ? e.code : "failed";
  if (STOPS[code]) return { stop: STOPS[code] };
  if (code === "unknown-device") return { unpaired: true };
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
    for (const go of st.linkWaits.splice(0)) go(s.hello);
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
    // Messages a dropped link left waiting go again; the PC answers a repeat with its first answer. A PC that takes
    // no ids (put back to an older version) gets none of them: without an id a repeat could run twice.
    if (s.hello.ids === true) outbox.flush((a, d) => s.ask(a, d));
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
  // Removed at the PC or from another device: no further attempt; Unpair's steps, and pairing says why.
  if (p.unpaired) {
    dropLink();
    forgetHere(UNPAIRED).catch((err) =>
      fatal(`${UNPAIRED} The app could not forget its key: ${err.message}`),
    );
    return;
  }
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

// The page is hidden: answers still in their Undo go out at once (the user saw them as sent). A live session and
// its socket stay (phone outbox approach, "The hang-up when hidden"); an attempt under way stops, and a socket with
// no session closes.
async function sleep() {
  if (st.asleep) return;
  st.asleep = true;
  clearTimeout(st.timer);
  st.attempt++;
  st.connecting = false;
  if (!st.session) dropLink();
  const waiting = [...st.beforeSleep];
  st.beforeSleep.clear();
  await Promise.allSettled(waiting.map((fn) => fn()));
}

// The page is shown again. iOS may have frozen it and the socket died meanwhile without a word: one ping checks a
// kept session; its pong keeps it and the screen is drawn again, no pong (or no session) connects anew.
async function wake() {
  if (!st.asleep) return;
  st.asleep = false;
  const s = st.session;
  if (s && st.link && !st.link.closed) {
    const alive = await st.link.check(CHECK_MS);
    if (st.asleep) return;
    if (alive) {
      if (st.session !== s) return;
      if (st.resume?.() === true) drawStatus();
      else draw();
      return;
    }
  }
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
// was not built with "unverified" and answers it pc.status alone (phone steady design, section 6). Before the first
// hello a kept screen is drawn as it was kept, with every action. The rest is offers.js.
const offered = (action) => !st.hello || offers(st.hello, action);

function ctx(params) {
  return {
    params,
    tg: st.tg,
    pageVersion: PAGE_VERSION,
    // Read when asked, as `connected`: a screen drawn from what it kept sees the hello once it comes.
    get hello() {
      return st.hello;
    },
    // Read when asked: a screen kept through a drop sees the link as it is now.
    get connected() {
      return Boolean(st.session);
    },
    // True while the screen is drawn from what it kept, before the first hello: it draws as if fresh, asks nothing,
    // and the frame marks it "Updating" (comfort design, section 3).
    get updating() {
      return !st.ever && st.keptAt !== null;
    },
    pairing: st.pairing,
    // fn() runs after a reconnect in place of drawing the screen again; it returns true when it went on (a live
    // session asks for what it missed), anything else draws the screen afresh.
    onResume(fn) {
      st.resume = fn;
    },
    // Resolves with the hello once a session with the PC is up (at once when one is): a Send made before the link
    // waits on it.
    linked: () =>
      st.session
        ? Promise.resolve(st.hello)
        : new Promise((go) => st.linkWaits.push(go)),
    // `ms` is how long to wait for the answer; none keeps the channel's 30 s.
    ask(action, data, ms) {
      if (!st.session) return Promise.reject(new ChannelError("not-connected"));
      return st.session.ask(action, data, ms);
    },
    // Bytes to the PC in sealed pieces (channel.js sendStream); the PC's answer names the stream. `max` is the
    // caller's size limit (FILES_STREAM_MAX for files and voice notes); none keeps 25 MB. onWait(waiting) tells the
    // caller its stream waits its turn in the channel's stream line.
    sendStream(bytes, mime, onProgress, max, onWait) {
      if (!st.session) return Promise.reject(new ChannelError("not-connected"));
      return st.session.sendStream(bytes, mime, onProgress, max, onWait);
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
    // A kept screen drawn before Telegram's script has run has no Telegram to call yet.
    mainButton: (spec) => st.tg && setMainButton(st.tg, $("main-btn"), spec),
    haptic: (kind) => st.tg && haptic(st.tg, kind),
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
    // After Settings' Unpair, once the PC forgot this device. A key store that cannot delete throws, and Settings
    // says so.
    unpaired: () => forgetHere(),
    // The Checks screen of the test build hands over to the normal start.
    startApp: () => begin(),
  };
}

// The Unpair steps, once the PC no longer holds this device: the stored key goes, the link closes and the pairing
// screen shows with no back step, `notice` above it. What the screens kept on the phone goes too. A key store that
// cannot delete throws.
async function forgetHere(notice = null) {
  await forgetPairing(st.tg);
  forgetAll();
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
  st.notice = notice;
  draw(0);
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
  if (!isLoaded(id)) return whenLoaded(id, () => go(id, params));
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

// The first tab, or the one the skeleton's tab bar was moved to before the frame ran.
function goFirst() {
  const tabs = tabScreens();
  const first = tabs.find((t) => t.tab === shellTab()) ?? tabs[0];
  st.view = first ? { id: first.screen.id, params: {}, y: 0 } : null;
  draw(0);
}

// The link as the frame shows it (phone steady design, section 4), one state at a time: null (connected, or the
// quiet 2 s after a drop: the screen as it is), updating (the first 3 s of a screen kept on the phone), first (the
// skeleton: nothing kept, no hello yet), connecting (the screen kept, dimmed, with a strip on top), off (the relay
// said the PC is gone for 20 s), update, stop. "PC off" leaves only for a good hello. A kept screen stays as it was
// through Connecting, PC off and Update: only the top changes.
function linkState(now = Date.now()) {
  if (st.view?.id === "checks") return null;
  if (!st.pairing && !st.booting) return null;
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
  if (!st.ever) {
    const late = now - st.openedAt >= OPEN_MARK_MS;
    if (st.keptAt === null)
      return {
        key: `first ${late} ${key}`,
        first: true,
        late,
        long,
        busy,
        limit,
      };
    if (!late) return { key: "updating", updating: true };
    return { key: `connecting ${key}`, connecting: true, long, busy, limit };
  }
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
  if (link.updating) return [];
  // Over the skeleton the status mark says "Connecting"; the long line and Try again come under the title.
  if (link.first)
    return [
      link.limit ? el("p.frame-line", link.limit) : null,
      link.long ? el("p.frame-line", LONG_LINE) : null,
      link.long ? tryButton(link.busy) : null,
    ].filter(Boolean);
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
        el(
          "span.link-bar-asof",
          `as of ${asOf(st.ever ? st.liveAt : st.keptAt)}`,
        ),
      ),
      link.limit ? el("div.link-bar-line", link.limit) : null,
      link.long ? el("div.link-bar-line", LONG_LINE) : null,
      link.long ? tryButton(link.busy) : null,
    ),
  ];
}

// The status mark at the right end of the title row; it takes no layout space, so nothing moves when it goes
// (comfort design, section 2).
function markView(link) {
  if (link?.updating)
    return [el("span.spinner"), `Updating · as of ${asOf(st.keptAt)}`];
  if (link?.first && link.late) return [el("span.spinner"), CONNECTING];
  return [];
}

// On Telegram Desktop the top screen of every tab has a full-screen button at the right end of the title row (files
// screens design, section 2). It never turns full screen on by itself.
function fullButton(s) {
  const tg = st.tg;
  if (!tg || s.tab === null || tg.platform !== "tdesktop") return null;
  if (!tg.isVersionAtLeast("8.0")) return null;
  const words = tg.isFullscreen ? "Leave full screen" : "Full screen";
  return el(
    "button.full-btn",
    {
      type: "button",
      "aria-label": words,
      title: words,
      onclick: () =>
        tg.isFullscreen ? tg.exitFullscreen() : tg.requestFullscreen(),
    },
    icon(tg.isFullscreen ? LEAVE_FULL : ICONS["full-screen"]),
  );
}

function titleRow(title, s, link) {
  st.mark = el("span.status-mark", { role: "status" }, ...markView(link));
  return el(
    "div.title-row",
    el("h1.large-title", title),
    st.mark,
    fullButton(s),
  );
}

// Before the first hello: when the screen in view was kept on the phone, or null when it keeps nothing.
function keptAt(view) {
  const s = screen(view.id);
  return s.keep ? (kept(s.keep)?.at ?? null) : null;
}

// A screen kept through a drop stays as it was, dimmed a little and taking no taps, while connecting, with the PC
// off or while only a reload helps; off and update put their own card in place of Home's PC card. Against a 26.3
// PC the screen shows at full strength and only its controls that act are off; so does a screen drawn from what it
// kept, until fresh.
function bodyClass(link) {
  if (link?.updating) return "updating read-only";
  if (link?.connecting) return "kept";
  if (link?.off || link?.update) return "kept kept-off";
  return st.grey ? "read-only" : "";
}

// Draws the link state again when it changed, keeping the screen; going to or from the skeleton, or with no
// screen drawn, draws all. Runs every second, so the quiet time, the 3 s marks and the long line come by themselves.
function drawStatus() {
  const link = linkState();
  if ((link?.key ?? null) === st.shown) return;
  if (Boolean(link?.first) !== st.firstShown || !st.slot) return draw();
  st.shown = link?.key ?? null;
  st.slot.replaceChildren(...stateView(link));
  st.mark?.replaceChildren(...markView(link));
  if (st.body) st.body.className = bodyClass(link);
}

// A tab's shapes from index.html (#sk-<tab>), found once with the shell section they came from: the frame moves them
// into #content while they stand for the screen and back into the shell when it draws again, so a tab drawn again
// before the first hello (the user moved away and back) finds them. A tab with no shapes in index.html maps to null.
const shapes = new Map();
function shapesOf(tab) {
  if (!shapes.has(tab)) {
    const found = document.getElementById(`sk-${tab}`);
    shapes.set(tab, found && { el: found, home: found.parentNode });
  }
  return shapes.get(tab)?.el ?? null;
}
function shapesBack() {
  for (const s of shapes.values()) if (s) s.home.append(s.el);
}

// y: where the box scrolls once the screen is drawn; a redraw of the same screen (a reconnect, a notice) keeps
// the place the user is at.
function draw(y = $("content").scrollTop) {
  // The shell from index.html stands until the frame knows what to draw.
  if (!st.view && st.booting) return;
  if (st.view && !isLoaded(st.view.id))
    return whenLoaded(st.view.id, () => draw(y));
  shapesBack();
  st.listeners.clear();
  st.resume = null;
  // Before Telegram's script has run (a kept screen drawn early) there are no Telegram buttons to set.
  if (st.tg) setMainButton(st.tg, $("main-btn"), null);
  const bottom = $("bottom-extra");
  st.keptAt = st.ever || !st.view ? null : keptAt(st.view);
  const link = linkState();
  st.shown = link?.key ?? null;
  st.firstShown = Boolean(link?.first);
  st.slot = el("div.link-state", ...stateView(link));
  st.body = null;
  st.grey = false;
  $("shell").hidden = true;
  $("app").hidden = false;
  // Only the session's chat zooms (frame/zoom.js).
  setZoom(Boolean(st.view && !link?.first && st.view.id === "session"));
  if (!st.view) {
    // A build with no tab screens yet: the frame says where the link stands.
    st.mark = null;
    $("content").replaceChildren(
      el(
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
  const title =
    typeof s.title === "function" ? s.title(st.view.params) : s.title;
  const swap = st.skeleton;
  st.skeleton = Boolean(link?.first);
  if (link?.first) {
    // Nothing kept and no hello yet: the tab's shapes from index.html stand in place of the screen (moved, not
    // copied). A tab whose shapes index.html lacks (Files: its own row draws them) shows its title alone.
    const tabShapes = s.tab !== null ? shapesOf(s.tab) : null;
    $("content").replaceChildren(
      el(
        "div",
        titleRow(title, s, link),
        st.slot,
        el(
          "div.sk-wrap",
          { "aria-busy": "true" },
          el("p.sk-label", "Loading"),
          tabShapes,
        ),
      ),
    );
    bottom.replaceChildren();
    bottom.className = "";
    drawBars(s);
    return;
  }
  const out = s.render(ctx(st.view.params));
  const isNode = out instanceof Node;
  st.grey = Boolean(s.actions.some((a) => !offered(a)) && st.session);
  st.body = el("div", isNode ? out : out.content);
  st.body.className = bodyClass(link);
  // One wrapping element, as el() skips the empty slots (replaceChildren would print them as "null"). A screen
  // that names its own update line shows it in place of the frame's general words.
  $("content").replaceChildren(
    el(
      swap ? "div.swap-in" : "div",
      titleRow(title, s, link),
      st.slot,
      st.grey ? el("p.frame-line.warn", s.updateLine ?? READ_ONLY) : null,
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
  if (st.tg) setBackButton(st.tg, st.stack.length ? back : null);
}

// ---- start

async function begin() {
  // A plain browser (a local look at the page on the PC) has no Telegram key store to read: it shows pairing.
  if (!hasHost()) {
    st.booting = false;
    st.view = { id: "pairing", params: { restorable: false } };
    return draw();
  }
  let p;
  try {
    p = await loadPairing(st.tg);
  } catch (e) {
    return fatal(`Could not read the key: ${e.message}. Pair again.`);
  }
  st.booting = false;
  if (!p || p.restorable) {
    // Kept screens belong to a pairing; without one they go.
    forgetAll();
    st.view = { id: "pairing", params: { restorable: Boolean(p) } };
    return draw();
  }
  st.pairing = p;
  // A kept screen drawn before the pairing was read stays in view (the user may have moved tabs meanwhile).
  if (st.view) draw();
  else goFirst();
  connect();
}

// A tab screen kept on the phone is drawn as soon as the style files are in, before Telegram's script and the
// pairing (comfort design, section 4): a kept screen means this phone was paired, as Unpair clears them.
function drawKeptEarly() {
  const tabs = tabScreens();
  const first = tabs.find((t) => t.tab === shellTab()) ?? tabs[0];
  if (!first || keptAt({ id: first.screen.id }) === null) return;
  st.view = { id: first.screen.id, params: {}, y: 0 };
  draw(0);
}

async function main() {
  laterScreens(LATER);
  await stylesLoaded;
  if (!hasScreen("checks")) drawKeptEarly();
  try {
    await telegramLoaded;
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
    // The full-screen button's icon and words, and the Files hints, follow Telegram's own state.
    st.tg.onEvent("fullscreenChanged", () => draw());
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
  await restLoaded();
}

main().catch((e) => fatal(`The app stopped: ${e.message}`));
