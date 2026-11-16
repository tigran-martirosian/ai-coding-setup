// Pictures of the page for a look against the mock-ups, dark and light, into %TEMP%/phone-app-shots/:
//   pairing  the pairing screen at 390 px (iPhone) and 900 px (Telegram Desktop): pairing-<width>-<scheme>.png
//   home     Home at 390 px against a fake PC: Nimbalyst open (one session waiting on you, two working, an
//            update, three jobs, usage at 42%), Nimbalyst closed and the PC off, both with the "Last known" list:
//            home-<state>-<scheme>.png
//   job      the job page of the job with a step that needs the user, opened from Home: job-<scheme>.png
//   settings Settings at 390 px against the same fake PC, with a linked Telegram account: settings-<scheme>.png; the
//            whole screen with the devices list and Remove's question open: settings-devices-<scheme>.png; Unpair
//            tapped, with Telegram's popup drawn by the fake host: unpair-confirm-<scheme>.png
//   projects the Projects tab and one project's sessions at 390 px: projects-<scheme>.png, project-<scheme>.png
//   pins     a project's sessions with three pinned in Nimbalyst, in the Pinned group on top: pins-<scheme>.png; a
//            row held, its menu open with Pin: pins-menu-<scheme>.png; without the door patch, Unpin greyed with
//            the reason: pins-nopatch-<scheme>.png
//   files    a finished answer that edited two files (/?o=files), one sheet open: an Edit step's diff
//            (files-diff-<scheme>.png), an answer's Markdown link (files-preview-md-<scheme>.png), a code link at its
//            line (files-preview-code-<scheme>.png) and the changed-files list (files-changed-<scheme>.png)
//   sessionthe session view at 390 px, opened as an alert's Open button opens it (/?o=<handle>): a working
//            session's conversation and a session waiting on a question: session-<what>-<scheme>.png; the card of
//            three questions open and folded with its Hide: fold-<open|folded>-<scheme>.png
//   live     a session the PC follows live: steps, thinking, helpers, context use and a queued message: live-<scheme>.png;
//            the helpers sheet opened from it: live-helpers-<scheme>.png; a session thinking, with the bar's turn time,
//            a Thought row opened to its text and a live Thinking row: live-thinking-<scheme>.png
//   chat     a conversation with lines the system wrote: a helper's notice as one short row (opened and live), a
//            message that quotes a tag shown whole, a reminder and a hook's note left out: chat-system-rows-<scheme>.png
//   form     a session waiting on a form of three fields, with the form's sheet open: form-<scheme>.png; its
//            pick-one field's "Other" picked, with the own-answer box: form-other-<scheme>.png
//   voice    the working session's typing box with the record button, a recording in progress (Chromium's
//            stand-in microphone) and the text back in the box after Stop: voice-<box|recording|text>-<scheme>.png
//   attach   the message box with a typed message and two files at 390 px: a photo sent and a log half way up
//            (attach-chips-<scheme>.png); a photo whose upload failed and a PDF too big (attach-failed-<scheme>.png)
//   scroll   Home, a project with 60 sessions and a long conversation, scrolled 400 px and to the end: the page itself
//            never scrolls, the session bar stays at the top and the dock on the inset line, "Earlier messages" keeps
//            the place, a pushed row keeps the end: scroll-<home|project>-<scheme>.png, bar-<top|scrolled>-<scheme>.png
//   join     a device join with a 34 px bottom inset: the new device's "Waiting for OK" (join-wait-<scheme>.png) and
//            the request card over Home on a paired device (join-card-<scheme>.png)
// It builds the page into a temp folder, serves it with the local relay and takes each picture with Playwright's
// headless Chromium shell (no npm package; the browser must be installed, e.g. by
// `npx playwright install chromium-headless-shell`, or named in PHONE_PAGE_BROWSER). For Home the temp build
// swaps in a fake Telegram host, a stored pairing and a channel that answers from the fixtures below; the
// frame, the screens and the styles are the real ones. For Settings the fake host also taps the Settings tab.
//   node phone/page/pictures.mjs [pairing] [home] [job] [settings] [projects] [pins] [files] [session] [live] [chat] [form] [voice] [attach] [edges] [scroll]   (no word: all)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startLocalRelay } from "../relay/local/server.mjs";
import { buildPage, writePage } from "./build.mjs";

// Telegram's own theme colours for iOS, as Telegram hands them to a Mini App (the mock-up's samples).
const THEMES = {
  dark: {
    bg_color: "#1c1c1d",
    secondary_bg_color: "#000000",
    text_color: "#ffffff",
    hint_color: "#98989e",
    link_color: "#3e88f7",
    button_color: "#3e88f7",
    button_text_color: "#ffffff",
    section_bg_color: "#1c1c1d",
    section_header_text_color: "#8d8e93",
    subtitle_text_color: "#98989e",
    destructive_text_color: "#eb5545",
    section_separator_color: "#545458",
    bottom_bar_bg_color: "#1d1d1d",
  },
  light: {
    bg_color: "#ffffff",
    secondary_bg_color: "#efeff4",
    text_color: "#000000",
    hint_color: "#8e8e93",
    link_color: "#007aff",
    button_color: "#007aff",
    button_text_color: "#ffffff",
    section_bg_color: "#ffffff",
    section_header_text_color: "#6d6d72",
    subtitle_text_color: "#8e8e93",
    destructive_text_color: "#ff3b30",
    section_separator_color: "#c8c7cc",
    bottom_bar_bg_color: "#f2f2f2",
  },
};
const SIZES = [
  { width: 390, height: 844, platform: "ios" },
  { width: 900, height: 760, platform: "tdesktop" },
];
// Home and the job page at the phone's width, tall enough to hold the whole page in one picture (the headless
// shell takes the window only, not the scrolled length)
const TALL = { width: 390, height: 1600, platform: "ios" };
const HOME_STATES = ["open", "closed", "pc-off"];

// ---- the Home stand-ins, written into the temp build only

// Before Telegram's script: a host to talk to, so the frame takes the in-Telegram path. pictureTab in the
// address hash: the tab it taps once the tab bar is drawn; pictureClick: what it taps after that (a selector);
// pictureClick2: what it taps pictureWait ms after that (Stop after the record button); pictureTgInset: a bottom
// inset in px that Telegram's script gets as its safe-area event once the page has loaded.
// Telegram draws showPopup itself, outside the page; here a stand-in draws it over the page in Telegram's iOS
// alert shape, so unpair-confirm shows what the user sees.
const FAKE_HOST = `globalThis.TelegramWebviewProxy = {
  postEvent(type, data) {
    if (type !== "web_app_open_popup") return;
    const p = JSON.parse(data);
    const layer = document.createElement("div");
    layer.style.cssText = "position:fixed;inset:0;z-index:99;display:grid;place-items:center;background:rgba(0,0,0,.4)";
    const box = document.createElement("div");
    box.style.cssText = "width:270px;border-radius:14px;overflow:hidden;text-align:center;font:13px -apple-system,system-ui,sans-serif;background:var(--p-raised);box-shadow:0 0 0 1px var(--p-raised-edge);color:var(--tg-theme-text-color)";
    const text = document.createElement("div");
    text.style.cssText = "padding:19px 16px 18px";
    const title = document.createElement("div");
    title.style.cssText = "font-weight:600;font-size:17px;margin-bottom:4px";
    title.textContent = p.title;
    const msg = document.createElement("div");
    msg.textContent = p.message;
    text.append(title, msg);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;border-top:1px solid var(--tg-theme-section-separator-color)";
    for (const b of p.buttons) {
      const btn = document.createElement("div");
      btn.style.cssText = "flex:1;padding:11px 0;font-size:17px" + (b.type === "destructive" ? ";color:var(--tg-theme-destructive-text-color)" : ";color:var(--tg-theme-link-color)") + (b.type === "cancel" ? ";font-weight:600;border-right:1px solid var(--tg-theme-section-separator-color)" : "");
      btn.textContent = b.text || (b.type === "cancel" ? "Cancel" : b.type);
      row.append(btn);
    }
    box.append(text, row);
    layer.append(box);
    document.body.append(layer);
  },
};
const hashWords = new URLSearchParams(location.hash.slice(1));
if (hashWords.get("pictureTgInset"))
  addEventListener("load", () =>
    Telegram.WebView.receiveEvent("safe_area_changed", {
      top: 0,
      bottom: Number(hashWords.get("pictureTgInset")),
      left: 0,
      right: 0,
    }),
  );
const taps = [];
if (hashWords.get("pictureTab"))
  taps.push(() => [...document.querySelectorAll(".tab")].find((x) => x.textContent === hashWords.get("pictureTab")));
if (hashWords.get("pictureClick")) taps.push(() => document.querySelector(hashWords.get("pictureClick")));
if (hashWords.get("pictureClick2")) taps.push(() => document.querySelector(hashWords.get("pictureClick2")));
// pictureHold: a row it holds after the taps (a pointer pressed and left down), so its hold menu opens.
if (hashWords.get("pictureHold"))
  taps.push(() => {
    const n = document.querySelector(hashWords.get("pictureHold"));
    return n && { click: () => n.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })) };
  });
let notBefore = 0;
if (taps.length) {
  const t = setInterval(() => {
    if (Date.now() < notBefore) return;
    const b = taps[0]();
    if (!b) return;
    b.click();
    taps.shift();
    notBefore = Date.now() + Number(hashWords.get("pictureWait"));
    if (!taps.length) clearInterval(t);
  }, 50);
}
`;

// A stored pairing, so the frame skips pairing and connects; pictureState "join-wait" has none, so it pairs.
const FAKE_KEYSTORE = `export * from "./keystore-real.js";
export async function loadPairing() {
  if (new URLSearchParams(location.hash.slice(1)).get("pictureState") === "join-wait") return null;
  return { K: new Uint8Array(32), pcId: "pc", dev: "phone", where: "secure" };
}
`;

// A PC that answers Home's actions. pictureState in the address hash: "open"; "closed" (open first, then
// Nimbalyst closes, so Home keeps the last sessions); "pc-off" (open first, then the PC drops off).
const FAKE_CHANNEL = `import { ChannelError } from "./channel-real.js";
export * from "./channel-real.js";
const STATE = new URLSearchParams(location.hash.slice(1)).get("pictureState");
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const status = {
  nimbalyst: "open",
  pcName: "Home PC",
  sessionsOpen: 3,
  setupVersion: "26.2",
  nimbalystVersion: "0.83.0",
  update: { version: "26.3" },
};
// The pins states: "pins" with the door patch's set_session_pinned, "pins-nopatch" without it.
const PINS = STATE === "pins" || STATE === "pins-nopatch";
const door = {
  answerForm: true,
  stopSession: true,
  removeQueuedPrompt: true,
  answerPlan: true,
  setSessionPinned: STATE === "pins",
};
const ANSWERS = {
  "pc.status": () => ({ ...status, ...(PINS ? { door } : {}), asOf: new Date().toISOString() }),
  "home.sessions": () => ({
    needsYou: [
      { session: "s1", project: "p1", title: "Sign-in page fix", kind: "question", since: ago(4) },
    ],
    working: [
      { session: "s2", project: "p1", title: "Release notes draft", doing: "a command (Bash)", since: ago(3), helpers: 1 },
      { session: "s3", project: "p2", title: "Search speed-up", doing: "reading files", since: ago(1), helpers: 0 },
    ],
    finishedToday: 3,
  }),
  "projects.list": () => [
    { project: "p1", name: "website", pinned: true, lastUsed: ago(1), needsYou: 1, working: 1 },
    { project: "p2", name: "shop-api", pinned: false, lastUsed: ago(1), needsYou: 0, working: 1 },
    { project: "p3", name: "notes", pinned: false, lastUsed: ago(1500), needsYou: 0, working: 0 },
  ],
  "alerts.get": () => [
    { kind: "session-needs-you", mode: "buzz" },
    { kind: "session-finished", mode: "silent" },
  ],
  // This phone (the stored pairing's "phone") and Telegram Desktop, paired later the same day.
  "devices.list": () => [
    { device: "phone", client: "iphone", pairedAt: "2026-11-14T09:12:00Z", lastSeen: ago(0), thisOne: true },
    { device: "desk", client: "desktop", pairedAt: "2026-11-14T18:40:00Z", lastSeen: ago(95), thisOne: false },
  ],
  // A project's sessions: the first 20 of 34; in the long state 60, by pages of 20; in the pins states three
  // sessions pinned in Nimbalyst come first.
  "sessions.list": (d) => PINS ? {
    total: 9,
    items: [
      { session: "n1", title: "Release checklist", state: "waiting", kind: "question", updatedAt: ago(6), pinned: true },
      { session: "n2", title: "Design notes", state: "idle", updatedAt: ago(200), pinned: true },
      { session: "n3", title: "Weekly tidy", state: "idle", updatedAt: ago(3000), pinned: true },
      { session: "s2", title: "Release notes draft", state: "running", updatedAt: ago(3), pinned: false },
      ...["Footer links", "Cookie banner text", "Image sizes", "404 page", "Contact form"].map((title, i) => ({
        session: "e" + i,
        title,
        state: "idle",
        updatedAt: ago(90 + i * 300),
        pinned: false,
      })),
    ],
  } : STATE === "long" ? {
    total: 60,
    items: Array.from({ length: 20 }, (_, i) => (d.page - 1) * 20 + i).map((n) => ({
      session: "m" + n,
      title: "Session " + (n + 1),
      state: "idle",
      updatedAt: ago(10 + n * 60),
    })),
  } : ({
    total: 34,
    items: [
      { session: "s1", title: "Sign-in page fix", state: "waiting", kind: "question", updatedAt: ago(4) },
      { session: "s2", title: "Release notes draft", state: "running", updatedAt: ago(3) },
      ...Array.from({ length: 18 }, (_, i) => ({
        session: "e" + i,
        title: ["Footer links", "Cookie banner text", "Image sizes", "404 page"][i % 4] + (i > 3 ? " " + i : ""),
        state: "idle",
        updatedAt: ago(90 + i * 300),
      })),
    ],
  }),
  // An alert's Open button: o=ask opens the session waiting on a question, o=talk the working one, o=live the one
  // the PC follows live, o=form the one waiting on a form, o=ask3 the one waiting on a card with three questions.
  "alerts.resolve": (d) => ({ project: "p1", session: HANDLES[d.handle] }),
  "session.open": (d) => SESSIONS[d.session === "s5" ? "s1" : d.session],
  "session.pending": (d) => ({ s1: QUESTION, s4: FORM, s5: QUESTIONS3 })[d.session] ?? null,
  // Attach: each file the PC takes gets a new id.
  "attach.put": () => ({ id: Math.random().toString(16).slice(2, 10).padEnd(16, "0") }),
  "attach.drop": () => ({ dropped: true }),
  // Voice: the transcriber is ready and the text is back at the first ask.
  "voice.warm": () => ({ ready: true }),
  "voice.transcribe": () => ({ job: "j1" }),
  "voice.result": () => ({
    done: true,
    text: "Okay so next, the session list on the phone feels slow when a project has a lot of sessions. Load the first twenty, and the rest only when I scroll down.",
  }),
  "queue.list": () => [],
  // The watch's first state; for the live session the steps come as a pushed event right after.
  "session.watch": (d) => {
    if (d.session === "s7") {
      setTimeout(() => push({ k: "evt", e: "live", d: { session: "s7", rows: SYSTEM_ROWS() } }), 300);
      return { state: "running", queue: [], helpers: [], context: null, turnAt: secs(40), tail: { at: secs(40), open: false } };
    }
    if (d.session === "s6") {
      setTimeout(() => push({ k: "evt", e: "live", d: { session: "s6", rows: THINK_ROWS() } }), 300);
      return { state: "running", queue: [], helpers: [], context: null, turnAt: secs(134), tail: { at: secs(130), open: false } };
    }
    if (d.session !== "s3")
      return { state: SESSIONS[d.session].state, queue: [], helpers: [], context: null };
    setTimeout(() => push({ k: "evt", e: "live", d: { session: "s3", rows: LIVE_ROWS() } }), 300);
    return { state: "running", queue: LIVE_QUEUE, helpers: HELPERS(), context: { used: 172000, window: 200000, percent: 86 } };
  },
  "session.unwatch": () => ({}),
  "jobs.list": () => ({ projects: JOB_PROJECTS }),
  "usage.get": () => ({
    weekPercent: 42,
    today: 6,
    resetsAt: new Date(Date.now() + 3 * 86400000 + 5 * 3600000).toISOString(),
    asOf: new Date().toISOString(),
  }),
};
const SESSIONS = {
  s1: {
    title: "Sign-in page fix",
    project: "p1",
    state: "waiting",
    model: "claude-code:opus",
    before: null,
    items: [
      { role: "user", text: "The sign-in page breaks on small phones. Fix it." },
      { role: "assistant", text: "", tools: ["Read", "Grep", "Read"] },
      {
        role: "assistant",
        text: "The form overflows below **360 px**: the two fields sit side by side. There are two ways to fix it.",
        tools: [],
      },
    ],
  },
  s2: {
    title: "Release notes draft",
    project: "p1",
    state: "running",
    model: "claude-code:opus",
    before: null,
    items: [
      { role: "user", text: "Draft the release notes for 26.3 from the merged changes." },
      { role: "assistant", text: "I'll read the changelog and the merged changes first.", tools: ["Read", "Grep", "Bash", "Read", "Read"] },
      {
        role: "assistant",
        text: "Here is the draft:\\n\\n### 26.3\\n\\n- **Faster search** in the project list\\n- The sign-in page fits small screens\\n- Messages typed while a session works wait in the \`queue\`\\n\\nShall I add the upgrade steps?",
        tools: [],
      },
      { role: "user", text: "Yes, add them at the end." },
      { role: "assistant", text: "", tools: ["Edit", "Bash"] },
    ],
  },
  s3: {
    title: "Search speed-up",
    project: "p1",
    state: "running",
    model: "claude-code:opus",
    before: null,
    items: [{ role: "user", text: "Search is slow on big projects. Find out why and make it faster." }],
  },
  s6: {
    title: "Search speed-up",
    project: "p1",
    state: "running",
    model: "claude-code:opus",
    before: null,
    items: [{ role: "user", text: "Search is slow on big projects. Find out why and make it faster." }],
  },
  // What the PC sends for a transcript with lines the system wrote: the helper's notice comes marked, the reminder and
  // the hook's note do not come at all.
  s7: {
    title: "Search speed-up",
    project: "p1",
    state: "running",
    model: "claude-code:opus",
    before: null,
    items: [
      { role: "user", text: "Search is slow on big projects. Find out why and make it faster." },
      { role: "assistant", text: "I'll send a helper to look for other cache users.", tools: ["Agent"] },
      { role: "user", system: "helper", text: 'Agent "Look for other cache users" completed', status: "completed" },
      { role: "user", text: "Why does its report end with <usage>total_tokens: 18400</usage>?" },
      { role: "assistant", text: "That block is the helper's token count; the report is above it.", tools: [] },
    ],
  },
  s4: {
    title: "Release 26.3",
    project: "p1",
    state: "waiting",
    model: "claude-code:opus",
    before: null,
    items: [
      { role: "user", text: "Get release 26.3 ready." },
      { role: "assistant", text: "The build passes. I need a few details before I tag it.", tools: ["Bash"] },
    ],
  },
};
// A finished session (o=done), so the message box shows Send.
SESSIONS.s9 = { ...SESSIONS.s2, title: "Release notes", state: "idle" };
const HANDLES = { ask: "s1", talk: "s2", live: "s3", form: "s4", ask3: "s5", think: "s6", system: "s7", long: "s8", done: "s9" };
// A long conversation (o=long): 40 turns shown and 10 more behind "Earlier messages"; picturePush() pushes a live
// row as the PC does.
const TURNS = (from, n) =>
  Array.from({ length: n }, (_, i) => from + i).map((i) =>
    i % 2
      ? { role: "assistant", text: "Part " + i + ": read the next part of the search code and noted what it costs.", tools: ["Read"] }
      : { role: "user", text: "Go on with part " + i + "." },
  );
SESSIONS.s8 = { title: "Search speed-up", project: "p1", state: "running", model: "claude-code:opus", before: "c10", items: TURNS(10, 40) };
ANSWERS["session.older"] = () => ({ items: TURNS(0, 10), before: null });
// A finished answer that edited two files (o=files): its steps and file links open the files sheets.
SESSIONS.s10 = {
  title: "Search cache",
  project: "p1",
  state: "idle",
  model: "claude-code:opus",
  before: null,
  items: [
    { role: "user", text: "Make the search cache expire after a minute and note it in the docs.", pos: 10 },
    { role: "assistant", text: "I'll change the cache first.", tools: ["Edit"], steps: [{ id: "e1", tool: "Edit", label: "src/search/cache.ts" }], pos: 200 },
    { role: "assistant", text: "", tools: ["Write"], steps: [{ id: "w1", tool: "Write", label: "docs/cache.md" }], pos: 400 },
    {
      role: "assistant",
      text: "Done. Entries now expire after 60 s. See [the notes](docs/cache.md) and [the cache](src/search/cache.ts:12).",
      tools: [],
      pos: 600,
      links: [
        { target: "docs/cache.md", file: "h-md" },
        { target: "src/search/cache.ts:12", file: "h-ts", line: 12 },
      ],
    },
  ],
};
HANDLES.files = "s10";
const CACHE_TS = [
  "// The search cache: results by query, dropped after a minute.",
  'import { clock } from "../core/clock";',
  "",
  "const TTL_MS = 60_000;",
  "",
  "export class SearchCache {",
  "  #entries = new Map();",
  "",
  "  get(query) {",
  "    const hit = this.#entries.get(query);",
  "    if (!hit) return null;",
  "    if (clock.now() - hit.at > TTL_MS) {",
  "      this.#entries.delete(query);",
  "      return null;",
  "    }",
  "    return hit.results;",
  "  }",
  "",
  "  set(query, results) {",
  "    this.#entries.set(query, { at: clock.now(), results, size: results.reduce((n, r) => n + r.bytes, 0) });",
  "  }",
  "}",
].join("\\n");
const CACHE_MD = "# Search cache\\n\\nSearch keeps the results of each query for **one minute**, then asks again.\\n\\n- A hit is served from memory\\n- An entry older than \`TTL_MS\` is dropped on the next read\\n\\nThe code is in [cache.ts](../src/search/cache.ts).\\n";
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
ANSWERS["step.detail"] = (d) =>
  d.step === "e1"
    ? {
        kind: "diff", name: "cache.ts", path: "src/search/cache.ts", file: "h-ts", add: 5, del: 1, created: false, cut: false,
        hunks: [{ oldStart: 9, newStart: 9, lines: [
          "   get(query) {",
          "     const hit = this.#entries.get(query);",
          "-    return hit ? hit.results : null;",
          "+    if (!hit) return null;",
          "+    if (clock.now() - hit.at > TTL_MS) {",
          "+      this.#entries.delete(query);",
          "+      return null;",
          "+    }",
          "+    return hit.results;",
          "   }",
        ] }, { oldStart: 15, newStart: 20, lines: [
          "   set(query, results) {",
          "-    this.#entries.set(query, { results });",
          "+    this.#entries.set(query, { at: clock.now(), results, size: results.reduce((n, r) => n + r.bytes, 0) });",
          "   }",
        ] }],
      }
    : {
        kind: "diff", name: "cache.md", path: "docs/cache.md", file: "h-md", add: 8, del: 0, created: true, cut: false,
        hunks: [{ oldStart: 0, newStart: 1, lines: CACHE_MD.split("\\n").slice(0, 8).map((l) => "+" + l) }],
      };
ANSWERS["session.changes"] = () => ({
  add: 14, del: 2, cut: false,
  files: [
    { name: "cache.ts", path: "src/search/cache.ts", file: "h-ts", why: null, add: 6, del: 2, created: false, steps: ["e1"] },
    { name: "cache.md", path: "docs/cache.md", file: "h-md", why: null, add: 8, del: 0, created: true, steps: ["w1"] },
  ],
});
ANSWERS["file.open"] = (d) => {
  const modified = new Date(Date.now() - 4 * 60000).toISOString();
  if (d.file === "h-md")
    return { name: "cache.md", path: "docs/cache.md", kind: "markdown", size: CACHE_MD.length, modified, offset: 0, bytes: b64(CACHE_MD), next: null, mime: "text/markdown", links: [{ target: "../src/search/cache.ts", file: "h-ts" }] };
  const lines = CACHE_TS.split("\\n");
  const from = Math.max(1, d.line ?? 1);
  const part = lines.slice(from - 1, from - 1 + (d.count ?? 400));
  return { name: "cache.ts", path: "src/search/cache.ts", kind: "text", size: CACHE_TS.length, modified, bytes: b64(part.join("\\n")), firstLine: from, lineCount: part.length, lines: lines.length, mime: "text/plain" };
};
globalThis.picturePush = () =>
  push({ k: "evt", e: "live", d: { session: "s8", rows: [{ kind: "tool", id: "p" + Date.now(), tool: "Read", label: "src/search/cache.ts", at: new Date().toISOString() }] } });
const secs = (s) => new Date(Date.now() - s * 1000).toISOString();
// The live session's steps: a run of six (three fold away, one of them failed), thinking, a reply, a running command.
const LIVE_ROWS = () => [
  { kind: "tool", id: "r1", tool: "Read", label: "src/search/index.ts", at: secs(95) },
  { kind: "result", id: "r1", error: false, at: secs(94) },
  { kind: "tool", id: "r2", tool: "Grep", label: "searchQuery", at: secs(90) },
  { kind: "result", id: "r2", error: false, at: secs(88) },
  { kind: "tool", id: "r3", tool: "Read", label: "src/search/cache.ts", at: secs(85) },
  { kind: "result", id: "r3", error: false, at: secs(84) },
  { kind: "tool", id: "r4", tool: "Bash", label: "npm test -- search --reporter=dot --run-in-band", at: secs(80) },
  { kind: "result", id: "r4", error: true, at: secs(62) },
  { kind: "thinking", at: secs(60) },
  { kind: "tool", id: "r5", tool: "Edit", label: "src/search/cache.ts", at: secs(41) },
  { kind: "result", id: "r5", error: false, at: secs(40) },
  { kind: "text", role: "assistant", text: "The cache key left out the project, so every search **missed** it. Fixed; running the tests again.", at: secs(38) },
  { kind: "tool", id: "r6", tool: "Bash", label: "npm test -- search", at: secs(36) },
];
// The system rows session's live part: a second helper's notice, failed, and a step after it.
const SYSTEM_ROWS = () => [
  { kind: "text", role: "user", system: "helper", text: 'Agent "Check the docs" failed', status: "failed", at: secs(30) },
  { kind: "tool", id: "y1", tool: "Read", label: "docs/cache.md", at: secs(20) },
  { kind: "result", id: "y1", error: false, at: secs(19) },
];
// The thinking session's steps: a read, a thought with its text, a search; the live Thinking row counts after them.
const THINK_ROWS = () => [
  { kind: "tool", id: "k1", tool: "Read", label: "src/search/cache.ts", at: secs(108) },
  { kind: "result", id: "k1", error: false, at: secs(107) },
  {
    kind: "thinking",
    at: secs(80),
    text: "The slow part is likely the index rebuild on every search. Two ways to check: time the rebuild alone, or read where the cache is filled. Reading first is cheaper; if the cache key leaves out the project, every search misses it and rebuilds.",
  },
  { kind: "tool", id: "k2", tool: "Grep", label: "cacheKey", at: secs(78) },
  { kind: "result", id: "k2", error: false, at: secs(77) },
];
const HELPERS = () => [
  { id: "h1", name: "Look for other cache users", type: "Explore", state: "running", since: secs(70), ms: null, tokens: 18400, tools: 7, step: { tool: "Grep", label: "cacheKey" }, summary: null },
  { id: "h2", name: "Check the docs", type: "general-purpose", state: "done", since: secs(200), ms: 42000, tokens: 9100, tools: 4, step: null, summary: "The setup page names the cache once." },
];
const LIVE_QUEUE = [{ queueId: "q1", text: "Then update the changelog too", createdAt: secs(20) }];
// A form with three fields: pick one (with "Other"), pick several, and a text.
const FORM = {
  kind: "form",
  promptId: "form-1",
  body: {
    title: "Release details",
    intro: "Answer these and I will tag the release.",
    fields: [
      { id: "where", type: "singleSelect", label: "Where does it go?", allowOther: true, options: [
        { id: "stage", label: "Staging", description: "Only the team sees it." },
        { id: "prod", label: "Production" },
      ] },
      { id: "parts", type: "multiSelect", label: "Which parts?", minSelected: 1, items: [
        { id: "page", title: "Page" },
        { id: "relay", title: "Relay", subtitle: "Needs a restart" },
        { id: "pc", title: "PC program" },
      ] },
      { id: "note", type: "editText", label: "Release note", description: "One line for the changelog.", initialText: "Faster search", minLength: 1 },
    ],
  },
};
const QUESTION = {
  kind: "question",
  promptId: "prompt-1",
  body: {
    questions: [
      {
        question: "Which fix should I use?",
        options: [
          { label: "Stack the fields (Recommended)", description: "One column under 400 px; nothing else changes." },
          { label: "Shrink the fonts", description: "Keeps the layout; the text gets smaller." },
        ],
      },
    ],
  },
};
// Tracker items in jobs.list's shape (slimItem): a job is a release; its steps hold it in customFields.collection.
const step = (id, job, title, status, code, more = {}) => ({
  id, type: "task", title, status, archived: false, updated: ago(Number(id.slice(1)) * 7),
  ...more, customFields: { step: code, collection: [{ itemId: job }], ...more.customFields },
});
const job = (id, title, m) => ({ id, type: "release", title, status: "to-do", archived: false, updated: ago(m), customFields: {} });
const JOB_PROJECTS = [
  {
    project: "p1",
    name: "website",
    items: [
      job("j1", "Checkout redesign", 2),
      step("t1", "j1", "Map the current checkout", "done", "A1"),
      step("t2", "j1", "Draft the new layout", "done", "A2"),
      step("t3", "j1", "Your OK on the layout", "in-review", "A3"),
      step("t4", "j1", "Build the payment form", "in-progress", "B1"),
      step("t5", "j1", "Card errors show no message", "to-do", "B2", { type: "bug" }),
      step("t6", "j1", "Write the release notes", "to-do", "C1", { customFields: { waitsOn: "B1" } }),
      step("t7", "j1", "Old coupon box", "wont-do", "A4"),
      job("j2", "Faster search results", 30),
      step("t8", "j2", "Measure the slow queries", "done", "S1"),
      step("t9", "j2", "Add an index to the search table", "in-progress", "S2"),
      step("t10", "j2", "Cache the top results", "to-do", "S3"),
    ],
    sessions: [{ id: "s2", linkedTrackerItemIds: ["t4"] }],
  },
  {
    project: "p2",
    name: "shop-api",
    items: [
      job("j3", "Move the orders service to the new database", 90),
      step("t11", "j3", "Copy the order tables", "to-do", "M1"),
      step("t12", "j3", "Switch reads to the new database", "to-do", "M2"),
    ],
    sessions: [],
  },
];
// The job mode opens the first job row (the one with a step that needs the user) once Home has drawn it.
if (STATE === "job") {
  const open = () => {
    const row = document.querySelector("[data-job]");
    if (row) row.click();
    else setTimeout(open, 50);
  };
  setTimeout(open, 50);
}
const QUESTIONS3 = {
  kind: "question",
  promptId: "prompt-3",
  body: {
    questions: [
      {
        question: "Which fix should I use?",
        options: [
          { label: "Stack the fields (Recommended)", description: "One column under 400 px; nothing else changes." },
          { label: "Shrink the fonts", description: "Keeps the layout; the text gets smaller." },
          { label: "Scroll sideways", description: "The form keeps its width and scrolls." },
        ],
      },
      {
        question: "Which pages get it?",
        options: [
          { label: "Sign-in only", description: "The page the report was about." },
          { label: "Every form", description: "Sign-up and the account page too." },
        ],
      },
      {
        question: "What should I check after?",
        multiSelect: true,
        options: [
          { label: "iPhone SE width", description: "320 px, the narrowest." },
          { label: "Landscape", description: "The keyboard covers half the screen." },
          { label: "Dark mode", description: "The error colours on a dark page." },
        ],
      },
    ],
  },
};
let opened = 0;
let push = null;
export const socketUrl = () => "ws://pictures.invalid/";
export async function openLink() {
  return { listen() {}, close() {} };
}
// A device join (pictureState "join-wait"): the PC waits for an OK that never comes.
export async function join() {
  return { dev: "new", pcId: "pc", word: "482913", open: 1, done: new Promise(() => {}), cancel() {} };
}
export async function openSession(_link, { onEvent }) {
  if (opened++) throw new ChannelError("pc-offline", { lastSeen: new Date().toISOString() });
  push = onEvent;
  let end;
  const ended = new Promise((r) => (end = r));
  // pictureState "join-card": Telegram Desktop asks to join while Home is open.
  if (STATE === "join-card")
    setTimeout(() => onEvent({ k: "evt", e: "device.ask", d: { rid: "r1", kind: "desktop", word: "482913", until: Date.now() + 180000 } }), 300);
  if (STATE === "closed")
    setTimeout(() => {
      Object.assign(status, { nimbalyst: "closed", sessionsOpen: null, update: null });
      onEvent({ e: "status" });
    }, 500);
  if (STATE === "pc-off")
    setTimeout(() => end(new ChannelError("pc-offline", { lastSeen: new Date().toISOString() })), 500);
  return {
    hello: { pcVersion: status.setupVersion, page: "ok" },
    ask: async (action, data) => {
      if (!ANSWERS[action]) throw new ChannelError("unknown-action");
      return { ok: true, d: ANSWERS[action](data) };
    },
    sendStream: async (bytes, _mime, onProgress) => {
      // A shot may set its own stream (attach: one upload half way, one that fails).
      if (globalThis.pictureStream) return globalThis.pictureStream(bytes, onProgress);
      onProgress?.(1);
      return { ok: true, d: { stream: "s-1", bytes: bytes.length } };
    },
    bye: async () => {},
    ended,
  };
}
`;

function writeHomeStandIns(dir) {
  const frame = path.join(dir, "page", "frame");
  for (const name of ["channel", "keystore"])
    fs.renameSync(
      path.join(frame, `${name}.js`),
      path.join(frame, `${name}-real.js`),
    );
  fs.writeFileSync(path.join(frame, "channel.js"), FAKE_CHANNEL);
  fs.writeFileSync(path.join(frame, "keystore.js"), FAKE_KEYSTORE);
  fs.writeFileSync(path.join(dir, "page", "picture-host.js"), FAKE_HOST);
  const index = path.join(dir, "index.html");
  const html = fs.readFileSync(index, "utf8");
  const tg = '<script src="page/telegram-web-app.js"></script>';
  if (!html.includes(tg))
    throw new Error(`pictures: ${index} does not load ${tg}`);
  fs.writeFileSync(
    index,
    html.replace(tg, `<script src="page/picture-host.js"></script>\n    ${tg}`),
  );
}

function findBrowser() {
  if (process.env.PHONE_PAGE_BROWSER) {
    if (!fs.existsSync(process.env.PHONE_PAGE_BROWSER))
      throw new Error(
        `PHONE_PAGE_BROWSER: ${process.env.PHONE_PAGE_BROWSER} does not exist`,
      );
    return process.env.PHONE_PAGE_BROWSER;
  }
  const base = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), ".cache"),
    "ms-playwright",
  );
  const found = (fs.existsSync(base) ? fs.readdirSync(base) : [])
    .filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
    .map((d) =>
      path.join(
        base,
        d,
        "chrome-headless-shell-win64",
        "chrome-headless-shell.exe",
      ),
    )
    .find((f) => fs.existsSync(f));
  if (!found)
    throw new Error(
      `no headless Chromium shell under ${base}: run "npx playwright install chromium-headless-shell" or set PHONE_PAGE_BROWSER`,
    );
  return found;
}

// Opens `url` in the browser, waits `settleMs` for the page and the fake PC, and writes a picture of what is on
// screen to `file`. The picture comes over the DevTools protocol: the shell's own --screenshot paints a scrolled
// page from its top while the sticky session bar and dock sit where the scroll put them, so a session view
// (which scrolls to its end) came out with a gap above the bar and the dock cut off.
// before: DevTools calls ({ method, params }) made before the shot, e.g. a safe-area inset for env().
async function capture(
  exe,
  args,
  url,
  file,
  settleMs,
  probe = null,
  before = [],
) {
  const c = spawn(exe, [...args, "--remote-debugging-port=0", url], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = "";
  c.stdout.on("data", (d) => (text += d));
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`pictures: no DevTools port: ${text}`)),
        30000,
      );
      c.stderr.on("data", (d) => {
        text += d;
        const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(text);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      c.on("exit", () =>
        reject(new Error(`pictures: the browser ended: ${text}`)),
      );
    });
    await new Promise((r) => setTimeout(r, settleMs));
    const list = await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    const target = list.find((t) => t.type === "page");
    if (!target)
      throw new Error(`pictures: no page in ${JSON.stringify(list)}`);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("pictures: no DevTools link"));
    });
    for (const [i, b] of before.entries())
      await new Promise((resolve, reject) => {
        ws.onmessage = (m) => {
          const r = JSON.parse(m.data);
          if (r.id !== 10 + i) return;
          if (r.error)
            reject(new Error(`pictures: ${b.method}: ${r.error.message}`));
          else resolve();
        };
        ws.send(JSON.stringify({ id: 10 + i, ...b }));
      });
    if (before.length) await new Promise((r) => setTimeout(r, 500));
    const shot = await new Promise((resolve, reject) => {
      ws.onmessage = (m) => {
        const r = JSON.parse(m.data);
        if (r.id !== 1) return;
        if (r.error) reject(new Error(`pictures: ${r.error.message}`));
        else resolve(r.result.data);
      };
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Page.captureScreenshot",
          params: { format: "png" },
        }),
      );
    });
    fs.writeFileSync(file, Buffer.from(shot, "base64"));
    let probed = null;
    if (probe)
      probed = await new Promise((resolve, reject) => {
        ws.onmessage = (m) => {
          const r = JSON.parse(m.data);
          if (r.id !== 2) return;
          if (r.error || r.result.exceptionDetails)
            reject(
              new Error(
                `pictures: probe: ${JSON.stringify(r.error ?? r.result.exceptionDetails)}`,
              ),
            );
          else resolve(r.result.result.value);
        };
        ws.send(
          JSON.stringify({
            id: 2,
            method: "Runtime.evaluate",
            params: {
              expression: probe,
              awaitPromise: true,
              returnByValue: true,
            },
          }),
        );
      });
    ws.close();
    return probed;
  } finally {
    const ended = new Promise((r) =>
      c.exitCode === null ? c.on("exit", r) : r(),
    );
    c.kill();
    await ended;
  }
}

// Measures the three-question card: where Send ends against the screen, then scrolls the list to its end, taps the
// last question's first option and reads the scroll again.
const FORM_PROBE = `(async () => {
  const list = () => document.querySelector(".qform .qlist");
  const send = document.querySelector('.qform [data-action="send-answers"]');
  const m = {
    innerHeight,
    sendBottom: Math.round(send.getBoundingClientRect().bottom),
    scrolls: list().scrollHeight > list().clientHeight + 1,
  };
  list().scrollTop = list().scrollHeight;
  m.before = Math.round(list().scrollTop);
  const items = list().querySelectorAll(".qitem");
  items[items.length - 1].querySelector(".opt").click();
  await new Promise((r) => setTimeout(r, 200));
  m.after = Math.round(list().scrollTop);
  return m;
})()`;

// Measures a bottom-docked part against the inset line (the window's height less the bottom inset given by
// hand): the question card's edge, the typing box's edge, the tabs' lowest edge, or where the helpers sheet's
// scrolled rows stop. space: the page's own bottom space (--p-safe-bottom), to show which inset it took.
const edgesProbe = (part, inset) => `(() => {
  const find = (sel) => {
    const x = document.querySelector(sel);
    if (!x) throw new Error("edges: no " + sel);
    return x;
  };
  const tenth = (n) => Math.round(n * 10) / 10;
  const probe = document.createElement("div");
  probe.style.paddingBottom = "var(--p-safe-bottom)";
  document.body.append(probe);
  const space = parseFloat(getComputedStyle(probe).paddingBottom);
  probe.remove();
  let bottom;
  if ("${part}" === "card") bottom = find(".bottom .qcard, .bottom .pc-card").getBoundingClientRect().bottom;
  if ("${part}" === "box") bottom = find(".bottom .compose").getBoundingClientRect().bottom;
  if ("${part}" === "tabs") {
    const tabs = [...document.querySelectorAll(".tabbar .tab")];
    if (!tabs.length) throw new Error("edges: no .tabbar .tab");
    bottom = Math.max(...tabs.map((t) => t.getBoundingClientRect().bottom));
  }
  if ("${part}" === "sheet") {
    const body = find(".hsheet .hbody");
    const cs = getComputedStyle(body);
    bottom = body.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
  }
  const line = innerHeight - ${inset};
  return { innerHeight, space, line, bottom: tenth(bottom), gap: tenth(line - bottom) };
})()`;

// Reads where the page and the scroll box stand after the shot (the wheel before it scrolled 400 px), then scrolls the
// box to its end (a project's list loads its next pages as its end comes into view) and reads again. In the
// conversation it also taps "Earlier messages" and reads where the first message shown before went, then pushes a
// live row at the end. windowY and docH: the page's own scroll and height, which must stay 0 and the window's.
const scrollProbe = (where) => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tenth = (n) => Math.round(n * 10) / 10;
  const box = document.getElementById("content");
  const read = () => {
    const bar = document.querySelector(".s-bar");
    const docks = [...document.querySelectorAll("#bottom, #tabbar")].filter(
      (x) => !x.hidden && x.getBoundingClientRect().height > 0,
    );
    return {
      windowY: scrollY,
      docH: document.documentElement.scrollHeight,
      innerHeight,
      box: Math.round(box.scrollTop),
      barTop: bar ? tenth(bar.getBoundingClientRect().top) : null,
      dockBottom: docks.length ? tenth(Math.max(...docks.map((x) => x.getBoundingClientRect().bottom))) : null,
    };
  };
  const m = { where: "${where}", at400: read() };
  for (let i = 0; i < 4; i++) {
    box.scrollTop = box.scrollHeight;
    scrollTo(0, document.documentElement.scrollHeight);
    await wait(500);
  }
  m.atEnd = read();
  m.rows = document.querySelectorAll("[data-session]").length;
  if ("${where}" !== "conversation") return m;
  box.scrollTop = 0;
  await wait(200);
  const older = document.querySelector(".older");
  const convo = older.parentElement;
  const first = [...convo.children].find((k) => k !== older && !k.classList.contains("convo-note"));
  const text = first.textContent;
  const before = first.getBoundingClientRect().top;
  older.click();
  await wait(800);
  const again = [...convo.children].find((k) => k.textContent === text);
  m.older = { text, before: tenth(before), after: again ? tenth(again.getBoundingClientRect().top) : null };
  box.scrollTop = box.scrollHeight;
  await wait(300);
  const endBefore = box.scrollHeight;
  picturePush();
  await wait(500);
  m.pushed = {
    grew: box.scrollHeight - endBefore,
    atEnd: box.scrollTop + box.clientHeight >= box.scrollHeight - 1,
    windowY: scrollY,
  };
  return m;
})()`;
// The user's wheel: 400 px down over the middle of the screen, scrolling whatever scrolls there.
const WHEEL_400 = {
  method: "Input.dispatchMouseEvent",
  params: { type: "mouseWheel", x: 195, y: 400, deltaX: 0, deltaY: 400 },
};
// The conversation opens at its end; this puts it (the box, or the page before the fix) at its top first.
const TO_TOP = {
  method: "Runtime.evaluate",
  params: {
    expression:
      'document.getElementById("content").scrollTop = 0; scrollTo(0, 0);',
  },
};

const SETS = [
  "pairing",
  "home",
  "job",
  "settings",
  "projects",
  "pins",
  "files",
  "session",
  "live",
  "chat",
  "form",
  "voice",
  "compose",
  "attach",
  "edges",
  "scroll",
  "join",
];

// Types into the message box as the keyboard does (the value, then an input event); `middle` then scrolls the
// field to the middle of its text.
const typeInBox = (text, middle = false) => ({
  method: "Runtime.evaluate",
  params: {
    expression: `(() => {
  const f = document.querySelector(".compose .field");
  f.focus();
  f.value = ${JSON.stringify(text)};
  f.dispatchEvent(new Event("input", { bubbles: true }));
  if (${middle}) {
    f.scrollTop = (f.scrollHeight - f.clientHeight) / 2;
    f.dispatchEvent(new Event("scroll"));
  }
})()`,
  },
});
// Measures the message box: each shown button's size and centre line, the field's height and scroll, the
// session bar's top, the box's bottom and the page's own scroll.
const COMPOSE_PROBE = `(() => {
  const tenth = (n) => Math.round(n * 10) / 10;
  const box = document.querySelector(".compose-box");
  if (!box) throw new Error("compose: no .compose-box");
  const f = box.querySelector(".field");
  const at = (x) => x.getBoundingClientRect();
  const buttons = [...box.querySelectorAll(".btnrow > button")]
    .filter((b) => at(b).width > 0)
    .map((b) => ({ is: b.className, w: tenth(at(b).width), h: tenth(at(b).height), mid: tenth(at(b).top + at(b).height / 2) }));
  const bar = document.querySelector(".s-bar");
  return {
    innerWidth,
    innerHeight,
    windowY: scrollY,
    buttons,
    field: { w: tenth(at(f).width), h: tenth(at(f).height), scrolls: f.scrollHeight > f.clientHeight, cls: f.className },
    barTop: bar ? tenth(at(bar).top) : null,
    boxBottom: tenth(at(box).bottom),
  };
})()`;
const LONG_PROMPT = Array.from(
  { length: 60 },
  (_, i) => `Line ${i + 1} of a long prompt read back before it goes.`,
).join("\n");
const asked = process.argv.slice(2);
for (const a of asked)
  if (!SETS.includes(a))
    throw new Error(`pictures: unknown set "${a}" (${SETS.join(", ")})`);
const sets = asked.length ? asked : SETS;

const browser = findBrowser();
const out = path.join(os.tmpdir(), "phone-app-shots");
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-page-pictures-"));
const offline = async () => {
  throw new Error("the picture relay does not reach Telegram");
};

// Serves the page in `pageDir` and takes each shot: { name, size, theme, extra (hash words), query (optional),
// flags (more browser switches, optional), settleMs (optional, 3000 when left out), probe and check (optional),
// before (DevTools calls before the shot, optional) }.
async function shoot(pageDir, shots) {
  const relay = await startLocalRelay({
    port: 0,
    pageDir,
    botId: 1,
    ownerTgId: 1,
    telegramKey: "00".repeat(32),
    telegram: offline,
    download: offline,
    now: Date.now,
    log: () => {},
    bot: null,
  });
  try {
    for (const s of shots) {
      const hash = new URLSearchParams({
        tgWebAppVersion: "9.1",
        tgWebAppPlatform: s.size.platform,
        tgWebAppThemeParams: JSON.stringify(s.theme),
        ...s.extra,
      });
      const file = path.join(out, `${s.name}.png`);
      fs.rmSync(file, { force: true });
      // An async run: the relay serving the page lives in this same process. A fresh profile per shot, so
      // nothing one shot stored reaches the next.
      const probed = await capture(
        browser,
        [
          "--mute-audio",
          "--hide-scrollbars",
          "--force-device-scale-factor=2",
          `--window-size=${s.size.width},${s.size.height}`,
          `--user-data-dir=${fs.mkdtempSync(path.join(tmp, "profile-"))}`,
          ...(s.flags ?? []),
        ],
        `${relay.url}/${s.query ?? ""}#${hash}`,
        file,
        s.settleMs ?? 3000,
        s.probe,
        s.before,
      );
      console.log(file);
      if (s.check) s.check(probed);
    }
  } finally {
    await relay.close();
  }
}

try {
  if (sets.includes("pairing")) {
    const pageDir = path.join(tmp, "pairing-page");
    writePage(pageDir, buildPage());
    await shoot(
      pageDir,
      SIZES.flatMap((size) =>
        Object.entries(THEMES).map(([scheme, theme]) => ({
          name: `pairing-${size.width}-${scheme}`,
          size,
          theme,
          extra: {},
        })),
      ),
    );
  }
  // A device join at the phone's size with a 34 px bottom inset from Telegram: the waiting screen on the new device
  // (the pairing screen's "OK it on my other device" tapped) and the request card over Home on a paired one.
  if (sets.includes("join")) {
    const pageDir = path.join(tmp, "join-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    await shoot(
      pageDir,
      [
        ["join-wait", { pictureClick: ".join-ok-btn" }],
        ["join-card", {}],
      ].flatMap(([state, taps]) =>
        Object.entries(THEMES).map(([scheme, theme]) => ({
          name: `${state}-${scheme}`,
          size: SIZES[0],
          theme,
          extra: { pictureState: state, pictureTgInset: "34", ...taps },
        })),
      ),
    );
  }
  const states = [
    ...(sets.includes("home") ? HOME_STATES.map((s) => [`home-${s}`, s]) : []),
    ...(sets.includes("job") ? [["job", "job"]] : []),
  ];
  if (states.length) {
    const pageDir = path.join(tmp, "home-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    await shoot(
      pageDir,
      states.flatMap(([name, state]) =>
        Object.entries(THEMES).map(([scheme, theme]) => ({
          name: `${name}-${scheme}`,
          size: TALL,
          theme,
          extra: { pictureState: state },
        })),
      ),
    );
  }
  if (sets.includes("settings")) {
    const pageDir = path.join(tmp, "settings-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    // Telegram's start data with the account that opened the page (no signature: the fake PC does not check it).
    const tgWebAppData = new URLSearchParams({
      user: JSON.stringify({ id: 1, first_name: "Alex", username: "alex" }),
      auth_date: "1",
      hash: "0",
    }).toString();
    await shoot(
      pageDir,
      Object.entries(THEMES).flatMap(([scheme, theme]) => [
        {
          name: `settings-${scheme}`,
          size: SIZES[0],
          theme,
          extra: { pictureState: "open", pictureTab: "Settings", tgWebAppData },
        },
        // The whole screen, with Remove's one-line question open on the other device.
        {
          name: `settings-devices-${scheme}`,
          size: TALL,
          theme,
          extra: {
            pictureState: "open",
            pictureTab: "Settings",
            pictureClick: ".dev-remove",
            tgWebAppData,
          },
        },
        // Unpair tapped: Telegram's popup (drawn by the fake host) over Settings.
        {
          name: `unpair-confirm-${scheme}`,
          size: SIZES[0],
          theme,
          extra: {
            pictureState: "open",
            pictureTab: "Settings",
            pictureClick: ".set-row.unpair:not(:disabled)",
            tgWebAppData,
          },
        },
      ]),
    );
  }
  if (sets.includes("projects")) {
    const pageDir = path.join(tmp, "projects-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    await shoot(
      pageDir,
      Object.entries(THEMES).flatMap(([scheme, theme]) => [
        {
          name: `projects-${scheme}`,
          size: SIZES[0],
          theme,
          extra: { pictureState: "open", pictureTab: "Projects" },
        },
        {
          name: `project-${scheme}`,
          size: SIZES[0],
          theme,
          extra: {
            pictureState: "open",
            pictureTab: "Projects",
            pictureClick: '[data-project="p1"]',
          },
        },
      ]),
    );
  }
  if (sets.includes("pins")) {
    const pageDir = path.join(tmp, "pins-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    const open = {
      pictureTab: "Projects",
      pictureClick: '[data-project="p1"]',
    };
    await shoot(
      pageDir,
      Object.entries(THEMES).flatMap(([scheme, theme]) =>
        [
          ["pins", "pins", {}],
          ["pins-menu", "pins", { pictureHold: '[data-session="e0"]' }],
          [
            "pins-nopatch",
            "pins-nopatch",
            { pictureHold: '[data-session="n2"]' },
          ],
        ].map(([name, state, more]) => ({
          name: `${name}-${scheme}`,
          size: SIZES[0],
          theme,
          extra: { pictureState: state, ...open, ...more },
        })),
      ),
    );
  }
  if (sets.includes("files")) {
    const pageDir = path.join(tmp, "files-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    await shoot(
      pageDir,
      Object.entries(THEMES).flatMap(([scheme, theme]) =>
        [
          ["files-diff", ".work-sum", '[data-step="e1"]'],
          ["files-preview-md", ".md-file"],
          ["files-preview-code", ".md-file:last-of-type"],
          ["files-changed", '[data-action="files.changes"]'],
        ].map(([name, tap, tap2]) => ({
          name: `${name}-${scheme}`,
          size: SIZES[0],
          theme,
          extra: {
            pictureState: "open",
            pictureClick: tap,
            ...(tap2 ? { pictureClick2: tap2, pictureWait: "500" } : {}),
          },
          query: "?o=files",
        })),
      ),
    );
  }
  if (sets.includes("session")) {
    const pageDir = path.join(tmp, "session-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    // Opened the way an alert's Open button opens it: /?o=<handle>.
    await shoot(
      pageDir,
      Object.entries(THEMES).flatMap(([scheme, theme]) =>
        [
          ["session-conversation", "talk", {}],
          ["session-question", "ask", {}],
          ["fold-open", "ask3", {}],
          ["fold-folded", "ask3", { pictureClick: '[data-action="fold"]' }],
        ].map(([what, handle, taps]) => ({
          name: `${what}-${scheme}`,
          size: SIZES[0],
          theme,
          extra: { pictureState: "open", ...taps },
          query: `?o=${handle}`,
        })),
      ),
    );
    // A card with three questions (FQ1), full and half height: Send stays on screen, and a tap on the last
    // question keeps the list where it was scrolled to.
    const halfHeight = { ...SIZES[0], height: Math.round(SIZES[0].height / 2) };
    await shoot(
      pageDir,
      Object.entries(THEMES).flatMap(([scheme, theme]) =>
        [
          ["full", SIZES[0]],
          ["half", halfHeight],
        ].map(([how, size]) => ({
          name: `session-questions3-${how}-${scheme}`,
          size,
          theme,
          extra: { pictureState: "open" },
          query: "?o=ask3",
          probe: FORM_PROBE,
          check: (m) => {
            console.log(`  ${JSON.stringify(m)}`);
            if (!(m.sendBottom <= m.innerHeight))
              throw new Error(
                `pictures: Send is below the screen at ${how} height in ${scheme}: ${JSON.stringify(m)}`,
              );
            if (
              m.scrolls &&
              !(m.before > 0 && Math.abs(m.after - m.before) <= 1)
            )
              throw new Error(
                `pictures: the list lost its scroll after a tap at ${how} height in ${scheme}: ${JSON.stringify(m)}`,
              );
          },
        })),
      ),
    );
  }
  // The live view (steps, thinking, helpers, context at 86 %, a queued message), its helpers sheet, and the
  // form's sheet, opened.
  const liveSets = [
    ...(sets.includes("live")
      ? [
          ["live", "live", {}],
          [
            "live-helpers",
            "live",
            { pictureClick: '[data-action="session.helpers"]' },
          ],
          ["live-thinking", "think", { pictureClick: ".wstep.has-text" }],
        ]
      : []),
    ...(sets.includes("chat") ? [["chat-system-rows", "system", {}]] : []),
    ...(sets.includes("form")
      ? [
          ["form", "form", { pictureClick: '[data-action="open-form"]' }],
          [
            "form-other",
            "form",
            {
              pictureClick: '[data-action="open-form"]',
              pictureClick2: '[data-field="where"] [data-option="__other__"]',
              pictureWait: "500",
            },
          ],
        ]
      : []),
  ];
  if (liveSets.length) {
    const pageDir = path.join(tmp, "live-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    await shoot(
      pageDir,
      Object.entries(THEMES).flatMap(([scheme, theme]) =>
        liveSets.map(([name, handle, extra]) => ({
          name: `${name}-${scheme}`,
          size: SIZES[0],
          theme,
          extra: { pictureState: "open", ...extra },
          query: `?o=${handle}`,
        })),
      ),
    );
  }
  if (sets.includes("voice")) {
    const pageDir = path.join(tmp, "voice-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    // Chromium's stand-in microphone (a beep) with no permission prompt; sound may start without a real tap,
    // so the level bars move.
    const flags = [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ];
    const record = '[data-action="voice.record"]';
    await shoot(
      pageDir,
      Object.entries(THEMES).flatMap(([scheme, theme]) =>
        [
          ["box", {}],
          ["recording", { pictureClick: record }],
          [
            "text",
            {
              pictureClick: record,
              pictureClick2: '[data-action="voice.stop"]',
              pictureWait: "2000",
            },
          ],
        ].map(([what, taps]) => ({
          name: `voice-${what}-${scheme}`,
          size: SIZES[0],
          theme,
          extra: { pictureState: "open", ...taps },
          query: "?o=talk",
          flags,
          settleMs: 4500,
        })),
      ),
    );
  }
  // The message box (design "The message box"): finished (Send), working (Queue), with text, and a 60-line prompt,
  // at 390 and 320 px with the iPhone's 34 px home bar. Every button is 44 px high on one centre line; with the
  // long prompt the field stops at 198 px and scrolls inside, the session bar stays at the top and the box ends
  // above the inset line.
  if (sets.includes("compose")) {
    const pageDir = path.join(tmp, "compose-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    const INSET = 34;
    const whats = [
      ["idle", "done", []],
      ["working", "talk", []],
      [
        "typed",
        "done",
        [typeInBox("Check the release notes against the changelog.")],
      ],
      ["long", "done", [typeInBox(LONG_PROMPT, true)]],
    ];
    const rows = [];
    const bad = [];
    await shoot(
      pageDir,
      [390, 320].flatMap((width) =>
        Object.entries(THEMES).flatMap(([scheme, theme]) =>
          whats.map(([what, handle, before]) => ({
            name: `compose-${what}${width === 390 ? "" : `-${width}`}-${scheme}`,
            size: { ...SIZES[0], width },
            theme,
            extra: { pictureState: "open", pictureTgInset: String(INSET) },
            query: `?o=${handle}`,
            before,
            probe: COMPOSE_PROBE,
            check: (m) => {
              const at = `compose-${what} at ${width} px, ${scheme}`;
              const mids = m.buttons.map((b) => b.mid);
              rows.push({
                at,
                buttons: m.buttons.map((b) => `${b.w}x${b.h}`).join(" "),
                centre: Math.max(...mids) - Math.min(...mids),
                field: `${m.field.w}x${m.field.h}`,
                barTop: m.barTop,
                boxBottom: m.boxBottom,
                line: m.innerHeight - INSET,
              });
              if (!m.buttons.length || m.buttons.some((b) => b.h !== 44))
                bad.push(
                  `${at}: buttons not all 44 px high: ${JSON.stringify(m.buttons)}`,
                );
              if (Math.max(...mids) - Math.min(...mids) > 0.5)
                bad.push(
                  `${at}: buttons on more than one centre line: ${mids}`,
                );
              if (m.windowY !== 0)
                bad.push(`${at}: the page scrolled ${m.windowY} px`);
              if (m.boxBottom > m.innerHeight - INSET)
                bad.push(
                  `${at}: the box ends at ${m.boxBottom}, under the inset line ${m.innerHeight - INSET}`,
                );
              if (what === "long") {
                if (m.barTop !== 0)
                  bad.push(`${at}: the session bar's top is ${m.barTop}`);
                if (m.field.h !== 198 || !m.field.scrolls)
                  bad.push(
                    `${at}: the field is ${m.field.h} px and ${m.field.scrolls ? "scrolls" : "does not scroll"}`,
                  );
              }
            },
          })),
        ),
      ),
    );
    console.table(rows);
    if (bad.length)
      throw new Error(
        `pictures: ${bad.length} message box measures fail:\n${bad.join("\n")}`,
      );
  }
  // Attach (design "Attach", mock-up shots 24 and 25): files picked into the message box at 390 px. The chips fit
  // in the 366 px box, and attach, record, Note and Send are 44 px high on one centre line.
  if (sets.includes("attach")) {
    const pageDir = path.join(tmp, "attach-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    const pick = (stream, files) => ({
      method: "Runtime.evaluate",
      params: {
        awaitPromise: true,
        expression: `(async () => {
  globalThis.pictureStream = ${stream};
  const photo = document.createElement("canvas");
  photo.width = 64;
  photo.height = 64;
  const g = photo.getContext("2d");
  const fill = g.createLinearGradient(0, 0, 64, 64);
  fill.addColorStop(0, "#6a8fbf");
  fill.addColorStop(0.6, "#c9a46a");
  fill.addColorStop(1, "#4f7a55");
  g.fillStyle = fill;
  g.fillRect(0, 0, 64, 64);
  const jpeg = await new Promise((ok) => photo.toBlob(ok, "image/jpeg"));
  const made = { photo: jpeg, text: new Blob(["x".repeat(2222)]), big: new Blob([new Uint8Array(14 * 1024 * 1024)]) };
  const list = new DataTransfer();
  for (const [name, kind, type] of ${JSON.stringify(files)})
    list.items.add(new File([made[kind]], name, { type }));
  const input = document.querySelector(".attach-pick");
  input.files = list.files;
  input.dispatchEvent(new Event("change"));
})()`,
      },
    });
    const whats = [
      [
        "chips",
        // The log stays half way up; the photo goes up at once.
        "(bytes, on) => bytes.length === 2222 ? (on(0.42), new Promise(() => {})) : (on(1), Promise.resolve({ ok: true, d: { stream: 's-1' } }))",
        [
          ["IMG_4021.jpg", "photo", "image/jpeg"],
          ["error-log-2026-11-14.txt", "text", "text/plain"],
        ],
      ],
      [
        "failed",
        // The link closes under the photo's upload.
        "() => Promise.reject(Object.assign(new Error('closed'), { code: 'closed' }))",
        [
          ["IMG_4021.jpg", "photo", "image/jpeg"],
          ["scan.pdf", "big", "application/pdf"],
        ],
      ],
    ];
    const bad = [];
    await shoot(
      pageDir,
      Object.entries(THEMES).flatMap(([scheme, theme]) =>
        whats.map(([what, stream, files]) => ({
          name: `attach-${what}-${scheme}`,
          size: SIZES[0],
          theme,
          extra: { pictureState: "open" },
          query: "?o=done",
          before: [
            typeInBox("Why does checkout fail? The log and a photo."),
            pick(stream, files),
          ],
          probe: `(() => {
  const m = ${COMPOSE_PROBE};
  const box = document.querySelector(".compose-box").getBoundingClientRect();
  m.box = { left: box.left, right: box.right, w: box.width };
  m.chips = [...document.querySelectorAll(".chip")].map((c) => {
    const r = c.getBoundingClientRect();
    return { left: r.left, right: r.right, w: r.width, h: r.height };
  });
  return m;
})()`,
          check: (m) => {
            const at = `attach-${what}, ${scheme}`;
            const mids = m.buttons.map((b) => b.mid);
            console.log(
              `${at}: box ${m.box.w} px, chips ${m.chips.map((c) => `${Math.round(c.w)}x${c.h}`).join(" ")}, buttons ${m.buttons.map((b) => `${b.w}x${b.h}`).join(" ")}`,
            );
            if (m.box.w !== 366) bad.push(`${at}: the box is ${m.box.w} px`);
            if (m.chips.length !== 2 || m.chips.some((c) => c.h !== 44))
              bad.push(`${at}: chips ${JSON.stringify(m.chips)}`);
            if (m.chips.some((c) => c.left < m.box.left || c.right > m.box.right))
              bad.push(`${at}: a chip is out of the box`);
            if (m.buttons.length !== 4 || m.buttons.some((b) => b.h !== 44))
              bad.push(`${at}: buttons ${JSON.stringify(m.buttons)}`);
            if (Math.max(...mids) - Math.min(...mids) > 0.5)
              bad.push(`${at}: buttons on more than one centre line: ${mids}`);
          },
        })),
      ),
    );
    if (bad.length)
      throw new Error(
        `pictures: ${bad.length} attach measures fail:\n${bad.join("\n")}`,
      );
  }
  // The bottom-docked parts with no inset and a 34 px bottom inset (the iPhone's home bar), given once through
  // Telegram's safe-area event and once through the browser's env(), at full and half height: each part ends
  // on or above the inset line, and the question card 12 px or more above it.
  if (sets.includes("edges")) {
    const pageDir = path.join(tmp, "edges-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    const halfHeight = { ...SIZES[0], height: Math.round(SIZES[0].height / 2) };
    const parts = [
      ["card", "?o=ask", {}, 12],
      ["box", "?o=talk", {}, 0],
      ["tabs", "", {}, 0],
      [
        "sheet",
        "?o=live",
        { pictureClick: '[data-action="session.helpers"]' },
        0,
      ],
    ];
    const insets = [
      ["none", 0, {}, []],
      ["tg34", 34, { pictureTgInset: "34" }, []],
      [
        "env34",
        34,
        {},
        [
          {
            method: "Emulation.setSafeAreaInsetsOverride",
            params: { insets: { bottom: 34, bottomMax: 34 } },
          },
        ],
      ],
    ];
    const rows = [];
    await shoot(
      pageDir,
      Object.entries(THEMES).flatMap(([scheme, theme]) =>
        parts.flatMap(([part, query, taps, gap]) =>
          insets.flatMap(([how, inset, words, before]) =>
            [
              ["full", SIZES[0]],
              ["half", halfHeight],
            ].map(([height, size]) => ({
              name: `edges-${part}-${how}-${height}-${scheme}`,
              size,
              theme,
              extra: { pictureState: "open", ...taps, ...words },
              query,
              before,
              probe: edgesProbe(part, inset),
              check: (m) => {
                const ok = m.space >= inset && m.gap >= gap;
                rows.push({ part, inset: how, height, scheme, ...m, ok });
                if (!ok)
                  console.log(
                    `  edges: ${part} at ${how}, ${height} height, ${scheme} needs a gap of ${gap} px and space of ${inset} px: ${JSON.stringify(m)}`,
                  );
              },
            })),
          ),
        ),
      ),
    );
    console.table(rows);
    const bad = rows.filter((r) => !r.ok);
    if (bad.length)
      throw new Error(
        `pictures: ${bad.length} edge measures fail (listed above)`,
      );
  }
  // The page never scrolls, only the box (#content): Telegram's iPhone header darkens as the page scrolls.
  if (sets.includes("scroll")) {
    const pageDir = path.join(tmp, "scroll-page");
    writePage(pageDir, buildPage());
    writeHomeStandIns(pageDir);
    const places = [
      ["scroll-home", "home", "", {}, [WHEEL_400]],
      [
        "scroll-project",
        "project",
        "",
        { pictureTab: "Projects", pictureClick: '[data-project="p1"]' },
        [WHEEL_400],
      ],
      ["bar-top", "conversation", "?o=long", {}, [TO_TOP]],
      ["bar-scrolled", "conversation", "?o=long", {}, [TO_TOP, WHEEL_400]],
    ];
    const bad = [];
    await shoot(
      pageDir,
      Object.entries(THEMES).flatMap(([scheme, theme]) =>
        places.map(([name, where, query, taps, before]) => ({
          name: `${name}-${scheme}`,
          size: SIZES[0],
          theme,
          extra: { pictureState: "long", ...taps },
          query,
          before,
          flags: ["--disable-smooth-scrolling"],
          probe: scrollProbe(where),
          check: (m) => {
            console.log(`  ${JSON.stringify(m)}`);
            const why = [];
            for (const at of ["at400", "atEnd"]) {
              const r = m[at];
              if (r.windowY !== 0)
                why.push(`${at}: the page scrolled ${r.windowY} px`);
              if (r.docH > r.innerHeight)
                why.push(
                  `${at}: the page is ${r.docH} px, taller than the window`,
                );
              if (Math.abs(r.dockBottom - r.innerHeight) > 1)
                why.push(
                  `${at}: the dock ends at ${r.dockBottom}, not on the inset line ${r.innerHeight}`,
                );
              if (where === "conversation" && r.barTop !== 0)
                why.push(`${at}: the session bar's top is ${r.barTop}`);
            }
            if (where === "project" && m.rows !== 60)
              why.push(`the project shows ${m.rows} of 60 sessions`);
            if (where === "conversation") {
              if (
                m.older.after === null ||
                Math.abs(m.older.after - m.older.before) > 2
              )
                why.push(
                  `"Earlier messages" moved the first message from ${m.older.before} to ${m.older.after}`,
                );
              if (
                !(m.pushed.grew > 0 && m.pushed.atEnd && m.pushed.windowY === 0)
              )
                why.push(
                  `a pushed row left the box off its end: ${JSON.stringify(m.pushed)}`,
                );
            }
            for (const w of why) bad.push(`${name}-${scheme}: ${w}`);
          },
        })),
      ),
    );
    if (bad.length)
      throw new Error(
        `pictures: ${bad.length} scroll measures fail:\n${bad.join("\n")}`,
      );
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}
