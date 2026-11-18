// The Checks screen: only in the test build (node phone/page/build.mjs --checks), opened first, for the check on a
// real phone. It shows what this Telegram can do: microphone, recording formats, dictation, storage and crypto,
// and the device probes for Telegram Desktop and the iPhone with a "Copy results" button.
// "Go on to the app" then starts the page as usual.
import { el } from "../frame/dom.js";
import { registerScreen } from "../frame/screens.js";

const FORMATS = [
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
];

async function mic() {
  if (!navigator.mediaDevices?.getUserMedia) return [false, "no getUserMedia"];
  const s = await navigator.mediaDevices.getUserMedia({ audio: true });
  const label = s.getAudioTracks()[0]?.label || "a track";
  for (const t of s.getTracks()) t.stop();
  return [true, label];
}

function formats() {
  if (typeof MediaRecorder === "undefined") return [false, "no MediaRecorder"];
  const yes = FORMATS.filter((f) => MediaRecorder.isTypeSupported(f));
  return [yes.length > 0, yes.join(", ") || "none"];
}

function tgStore(store, name) {
  return new Promise((resolve, reject) => {
    const key = "phone-app-check";
    const value = String(Date.now());
    store.setItem(key, value, (err) => {
      if (err) return reject(new Error(`${name} write: ${err}`));
      store.getItem(key, (err2, got) => {
        if (err2) return reject(new Error(`${name} read: ${err2}`));
        store.removeItem(key, () =>
          resolve([got === value, "written, read back"]),
        );
      });
    });
  });
}

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("phone-app-check", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("s");
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction("s", "readwrite");
      tx.objectStore("s").put(1, "k");
      tx.oncomplete = () => {
        r.result.close();
        indexedDB.deleteDatabase("phone-app-check");
        resolve([true, "written"]);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

async function algo(name, usages) {
  const params = name === "AES-KW" ? { name, length: 256 } : { name };
  await crypto.subtle.generateKey(params, false, usages);
  return [true, "works"];
}

// The screen insets from each source the page reads (page.css --p-safe-bottom): the browser's own, Telegram's
// safe area and Telegram's content safe area, top and bottom. The real phone's numbers show which one carries
// the home bar. Telegram's two arrive by event, so these rows are read again when one comes.
function envInset(side) {
  const probe = el("div");
  probe.style.paddingTop = `env(safe-area-inset-${side})`;
  document.body.append(probe);
  const value = getComputedStyle(probe).paddingTop;
  probe.remove();
  return [true, value];
}

function tgInset(tg, field, side) {
  if (!tg.isVersionAtLeast("8.0"))
    return [false, `not given before Telegram 8.0 (this is ${tg.version})`];
  return [true, `${tg[field][side]}px`];
}

function insets(tg) {
  return ["top", "bottom"].flatMap((side) => [
    [`Safe area ${side} (browser)`, async () => envInset(side)],
    [
      `Safe area ${side} (Telegram)`,
      async () => tgInset(tg, "safeAreaInset", side),
    ],
    [
      `Content safe area ${side} (Telegram)`,
      async () => tgInset(tg, "contentSafeAreaInset", side),
    ],
  ]);
}

function checks(tg) {
  return [
    ["Telegram", async () => [true, `${tg.platform} ${tg.version}`]],
    ["Microphone", mic],
    ["Recording formats", async () => formats()],
    ["SecureStorage", () => tgStore(tg.SecureStorage, "SecureStorage")],
    ["DeviceStorage", () => tgStore(tg.DeviceStorage, "DeviceStorage")],
    ["IndexedDB", idb],
    ["X25519", () => algo("X25519", ["deriveBits"])],
    ["Ed25519", () => algo("Ed25519", ["sign", "verify"])],
    ["AES-KW", () => algo("AES-KW", ["wrapKey", "unwrapKey"])],
  ];
}

function row(name) {
  const out = el("span", "…");
  const node = el("div.check", el("span", name), out);
  return { node, out };
}

function show(r, run) {
  Promise.resolve()
    .then(run)
    .then(([ok, text]) => {
      r.out.className = ok ? "ok" : "bad";
      r.out.textContent = text;
    })
    .catch((e) => {
      r.out.className = "bad";
      r.out.textContent = e.message || String(e);
    });
}

// The dictation probe: the same dictation into a fixed box (A) and into a box that rewrites its rows on every
// input as the session screen's typing box does (B), so the iPhone shows which one glitches; and one picker with
// no accept list, to see what iOS offers and what a pick hands the page. Nothing here goes over the network.
function probe() {
  const fixed = el("textarea.probe-field.fixed", {
    rows: "4",
    "aria-label": "Field A",
  });
  const growing = el("textarea.probe-field", {
    rows: "1",
    "aria-label": "Field B",
    oninput: () =>
      growing.setAttribute(
        "rows",
        String(Math.min(6, Math.max(1, growing.value.split("\n").length))),
      ),
  });
  const picked = el("p.field-hint", "Nothing picked yet");
  const picker = el("input.probe-pick", {
    type: "file",
    "aria-label": "Photo or file picker",
    onchange: () => {
      const f = picker.files?.[0];
      picked.textContent = f
        ? `Name: ${f.name} · Type: ${f.type || "(none)"} · Size: ${f.size} bytes`
        : "Nothing picked";
    },
    oncancel: () => {
      picked.textContent = "Picker closed without a pick";
    },
  });
  return el(
    "div.group.probe",
    el("div.g-head", "Dictation probe"),
    el(
      "p.field-hint",
      "Dictate about ten seconds into each field, then tap the picker once.",
    ),
    el("p.probe-label", "Field A: fixed height"),
    fixed,
    el("p.probe-label", "Field B: grows as you type, like the message box"),
    growing,
    el("p.probe-label", "Photo or file picker"),
    picker,
    picked,
  );
}

// The device probes (phone polish plan, row C1): what Telegram Desktop and the iPhone let the page do with drag
// out, drop in, pickers, downloads, full screen, the clipboard, kept storage and text selection. Their results
// pick the drag-out route and the long-press design, so each line says what was tried and what happened. Where
// the page cannot see the outcome (a file on the desktop, a menu iOS draws, a pasted text) the line asks for a
// yes or no. "Copy results" puts every line on the clipboard for the chat.
const NOT_TRIED = "Not tried yet";
const PROBE_FILE = "probe.json";
const KEPT_KEY = "phone-app-check.kept";
const DEVICE_KEY = "phone_app_check_kept";
const SAMPLE =
  "Press and hold on this sentence, then pick Copy from the iPhone's own menu. It stands in for a message from Claude.";

// Rules this screen needs and page.css lacks. The selection rule is the one the session screen would ship: it
// must beat the `-webkit-user-select: none` that Telegram iOS injects into every Mini App.
const PROBE_CSS = `
.probe-select { -webkit-user-select: text !important; user-select: text !important; }
.probe-line { padding: 12px 0; }
.probe-line + .probe-line { border-top: 1px solid var(--p-sep); }
.probe-line .check > span:last-child { text-align: right; }
.probe-tick { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.probe-tick .q { flex: 1; font: var(--p-sub-text); }
.probe-tick .btn[aria-pressed="true"] { background: var(--nim-primary); color: var(--nim-on-primary); }
.probe-drag, .probe-zone { margin-top: 8px; padding: 14px; border: 1px dashed var(--nim-text-muted); border-radius: 10px; text-align: center; cursor: grab; }
.probe-zone.over { border-color: var(--nim-primary); }
.probe-drag img { display: block; margin: 0 auto; }
.probe-menu { margin-top: 8px; font: var(--p-sub-text); color: var(--nim-primary); }
.probe-line .btn { margin-top: 8px; }
`;

// One probe line: the name, what happened, how to try it, its controls and, when the page cannot see the
// outcome, the question with Yes and No.
function probeLine(device, name, how, ask) {
  const out = el("span", NOT_TRIED);
  const controls = el("div");
  const l = { device, name, ask, ok: null, text: NOT_TRIED, said: null, out };
  l.add = (...kids) => controls.append(...kids);
  l.node = el(
    "div.probe-line",
    el("div.check", el("span", name), out),
    el("p.field-hint", how),
    controls,
  );
  if (ask) {
    const tick = (said) => () => {
      l.said = said;
      yes.setAttribute("aria-pressed", String(said === "yes"));
      no.setAttribute("aria-pressed", String(said === "no"));
    };
    const yes = el(
      "button.btn.sb",
      { type: "button", "aria-pressed": "false", onclick: tick("yes") },
      "Yes",
    );
    const no = el(
      "button.btn.sb",
      { type: "button", "aria-pressed": "false", onclick: tick("no") },
      "No",
    );
    l.node.append(el("div.probe-tick", el("span.q", ask), yes, no));
  }
  return l;
}

// ok: true (worked), false (failed) or null (the page cannot tell; the question says).
function set(l, ok, text) {
  l.ok = ok;
  l.text = text;
  l.out.className = ok === true ? "ok" : ok === false ? "bad" : "";
  l.out.textContent = text;
}

const types = (e) => [...(e.dataTransfer?.types ?? [])].join(", ") || "nothing";
const probeUrl = () => new URL("version.json", document.baseURI).href;
const short = (text) => (text.length > 40 ? `${text.slice(0, 40)}…` : text);

function dragEnded(e) {
  const effect = e.dataTransfer?.dropEffect ?? "none";
  return effect === "none"
    ? `Drag ended with drop effect "none": nothing took the drop`
    : `Drag ended with drop effect "${effect}": the place it was dropped on took it`;
}

// Drag out by DownloadURL (Chromium only): the drop asks the browser to download the address. The served
// version.json comes as an attachment named probe.json in a --checks test deploy; the line first says how the
// address answers, so a missing header is seen before the drag.
function dragFile(l) {
  const url = probeUrl();
  fetch(url, { method: "HEAD", cache: "no-store" }).then(
    (r) => {
      const d = r.headers.get("content-disposition");
      if (l.text === NOT_TRIED)
        set(
          l,
          null,
          `${NOT_TRIED}. The address sends version.json ${d ? `with "${d}"` : "with no attachment header"}`,
        );
    },
    (e) => set(l, false, `version.json did not load: ${e.message}`),
  );
  l.add(
    el(
      "div.probe-drag",
      {
        draggable: "true",
        ondragstart: (e) => {
          e.dataTransfer.setData(
            "DownloadURL",
            `application/json:${PROBE_FILE}:${url}`,
          );
          e.dataTransfer.effectAllowed = "copy";
          set(l, null, `Drag started, carrying ${types(e)} (${url})`);
        },
        ondragend: (e) => set(l, null, `${dragEnded(e)}. DownloadURL ${url}`),
      },
      `${PROBE_FILE}: drag this box onto the desktop`,
    ),
  );
}

// Drag out an image: Chromium puts the picture's bytes into the drag itself, without a download.
function dragImage(l) {
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 96;
  const g = c.getContext("2d");
  g.fillStyle = "#3b82f6";
  g.fillRect(0, 0, 96, 96);
  g.fillStyle = "#ffffff";
  g.font = "bold 22px sans-serif";
  g.textAlign = "center";
  g.fillText("PNG", 48, 56);
  const img = el("img", {
    src: c.toDataURL("image/png"),
    alt: "probe picture",
    title: "probe.png",
    width: "96",
    height: "96",
    draggable: "true",
    ondragstart: (e) => set(l, null, `Drag started, carrying ${types(e)}`),
    ondragend: (e) => set(l, null, dragEnded(e)),
  });
  l.add(el("div.probe-drag", img));
}

function readDrop(l, e, where) {
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!files.length)
    return set(
      l,
      false,
      `A drop ${where} arrived with no file (it carried ${types(e)})`,
    );
  const f = files[0];
  f.arrayBuffer().then(
    (b) =>
      set(
        l,
        true,
        `Got ${files.length} file(s) ${where}: ${f.name} (${f.type || "no type"}, ${f.size} bytes), read ${b.byteLength} bytes`,
      ),
    (err) =>
      set(
        l,
        false,
        `Got ${f.name} ${where}, reading it failed: ${err.message}`,
      ),
  );
}

function dropIn(l) {
  const zone = el("div.probe-zone", "Drop a file from the desktop here");
  const take = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  zone.addEventListener("dragenter", (e) => {
    take(e);
    zone.classList.add("over");
    if (l.text === NOT_TRIED)
      set(l, null, `A drag came over the box, carrying ${types(e)}`);
  });
  zone.addEventListener("dragover", take);
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove("over");
    readDrop(l, e, "in the box");
  });
  // A drop beside the box would open the file in place of the page: this keeps the page and says it arrived.
  const beside = (e) => {
    if (!zone.isConnected) return;
    e.preventDefault();
    if (e.type === "drop") readDrop(l, e, "beside the box");
  };
  window.addEventListener("dragover", beside);
  window.addEventListener("drop", beside);
  l.add(zone);
}

// The file picker, timed: Telegram Desktop on Windows has been seen to close it at once (tdesktop #31601).
function picker(l) {
  const input = el("input", { type: "file", hidden: true });
  let t0 = 0;
  const ms = () => Math.round(performance.now() - t0);
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    set(
      l,
      Boolean(f),
      f
        ? `Picked ${f.name} (${f.type || "no type"}, ${f.size} bytes) after ${ms()} ms`
        : `The picker closed with nothing after ${ms()} ms`,
    );
    input.value = "";
  });
  input.addEventListener("cancel", () => {
    const n = ms();
    if (n < 1000)
      set(
        l,
        false,
        `The picker closed by itself after ${n} ms: it did not open`,
      );
    else set(l, null, `The picker closed without a pick after ${n} ms`);
  });
  l.add(
    input,
    el(
      "button.btn",
      {
        type: "button",
        onclick: () => {
          t0 = performance.now();
          set(l, null, "Asked the picker to open, no answer yet");
          input.click();
        },
      },
      "Open the file picker",
    ),
  );
}

// Telegram's own download box (Bot API 8.0): the callback says whether the user confirmed it.
function download(l, tg) {
  const url = probeUrl();
  l.add(
    el(
      "button.btn",
      {
        type: "button",
        onclick: () => {
          if (!tg.isVersionAtLeast("8.0"))
            return set(
              l,
              false,
              `downloadFile needs Telegram 8.0, this is ${tg.version}`,
            );
          set(
            l,
            null,
            `Asked Telegram to download ${url} as ${PROBE_FILE}, no answer yet`,
          );
          try {
            tg.downloadFile({ url, file_name: PROBE_FILE }, (going) =>
              set(
                l,
                going ? null : false,
                going
                  ? "Telegram's box was confirmed: Telegram says the download started"
                  : "Telegram's box was closed or refused: no download",
              ),
            );
          } catch (e) {
            set(l, false, `downloadFile refused the call: ${e.message}`);
          }
        },
      },
      `Download ${PROBE_FILE}`,
    ),
  );
}

function fullScreen(l, tg) {
  const seen = { in: "not tried", out: "not tried" };
  const say = () => {
    const failed = Object.values(seen).some((s) => s.startsWith("failed"));
    const both = seen.in === "yes" && seen.out === "yes";
    set(
      l,
      failed ? false : both ? true : null,
      `Into full screen: ${seen.in}; back out: ${seen.out}`,
    );
  };
  const btn = el(
    "button.btn",
    {
      type: "button",
      onclick: () => {
        if (!tg.isVersionAtLeast("8.0"))
          return set(
            l,
            false,
            `Full screen needs Telegram 8.0, this is ${tg.version}`,
          );
        if (tg.isFullscreen) tg.exitFullscreen();
        else tg.requestFullscreen();
      },
    },
    "Go full screen",
  );
  tg.onEvent("fullscreenChanged", () => {
    seen[tg.isFullscreen ? "in" : "out"] = "yes";
    btn.textContent = tg.isFullscreen ? "Leave full screen" : "Go full screen";
    say();
  });
  tg.onEvent("fullscreenFailed", (e) => {
    seen[tg.isFullscreen ? "out" : "in"] = `failed (${e?.error})`;
    say();
  });
  l.add(btn);
}

// A clipboard write inside the tap, with nothing awaited before it (WebKit needs the tap's activation).
function clip(l) {
  l.add(
    el(
      "button.btn",
      {
        type: "button",
        onclick: () => {
          const text = `Phone app clipboard probe ${new Date().toISOString()}`;
          if (!navigator.clipboard?.writeText)
            return set(
              l,
              false,
              "This page has no navigator.clipboard.writeText",
            );
          navigator.clipboard.writeText(text).then(
            () => set(l, null, `writeText said done for "${text}"`),
            (e) => set(l, false, `writeText refused: ${e.name}: ${e.message}`),
          );
        },
      },
      "Copy a test text",
    ),
  );
}

function ago(at) {
  const s = Math.round((Date.now() - Number(at)) / 1000);
  if (s < 120) return `${s} s ago`;
  if (s < 7200) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

// Read once per open and then written, so a reopen shows what the last open left.
function keptLocal() {
  let before;
  try {
    before = localStorage.getItem(KEPT_KEY);
    localStorage.setItem(KEPT_KEY, String(Date.now()));
  } catch (e) {
    return [false, `localStorage failed: ${e.message}`];
  }
  return before
    ? [true, `localStorage kept the mark of an earlier open, ${ago(before)}`]
    : [
        null,
        "No mark from an earlier open yet: close the app, open it again and look here",
      ];
}

function keptDevice(tg) {
  if (!tg.isVersionAtLeast("9.0"))
    return Promise.resolve([
      false,
      `DeviceStorage needs Telegram 9.0, this is ${tg.version}`,
    ]);
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve([false, "Telegram did not answer within 5 s"]),
      5000,
    );
    const done = (r) => {
      clearTimeout(timer);
      resolve(r);
    };
    tg.DeviceStorage.getItem(DEVICE_KEY, (err, before) => {
      if (err) return done([false, `DeviceStorage read failed: ${err}`]);
      tg.DeviceStorage.setItem(DEVICE_KEY, String(Date.now()), (err2) => {
        if (err2) return done([false, `DeviceStorage write failed: ${err2}`]);
        done(
          before
            ? [
                true,
                `DeviceStorage kept the mark of an earlier open, ${ago(before)}`,
              ]
            : [
                null,
                "No mark from an earlier open yet: close the app, open it again and look here",
              ],
        );
      });
    });
  });
}

function windowSize(l, tg) {
  const say = () =>
    set(
      l,
      true,
      `${innerWidth}x${innerHeight} page px at scale ${devicePixelRatio}; screen ${screen.width}x${screen.height}; Telegram's view ${Math.round(tg.viewportStableHeight)} px high${tg.isFullscreen ? "; full screen" : ""}`,
    );
  addEventListener("resize", say);
  tg.onEvent("viewportChanged", say);
  say();
}

function selectInPlace(l) {
  const p = el("p.probe-select", SAMPLE);
  document.addEventListener("selectionchange", () => {
    const s = getSelection();
    if (s && !s.isCollapsed && p.contains(s.anchorNode))
      set(l, true, `Text selected in place: "${short(s.toString())}"`);
  });
  l.add(p);
}

function readOnlyBox(l) {
  const ta = el("textarea.probe-field", {
    readonly: true,
    rows: "3",
    "aria-label": "Read-only text box",
  });
  ta.value = SAMPLE;
  const look = () => {
    if (ta.selectionEnd > ta.selectionStart)
      set(
        l,
        true,
        `${ta.selectionEnd - ta.selectionStart} characters selected in the read-only box`,
      );
  };
  ta.addEventListener("select", look);
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === ta) look();
  });
  l.add(ta);
}

// The press the session screen would use when selection in place fails: a 300 ms timer from the finger going
// down, given up when the finger moves over 10 px or lifts first. The text under it is selectable, so the
// iPhone's own press competes; the line says whether iOS took the touch over (pointercancel) or selected text.
function longPress(l, tg) {
  const target = el(
    "p.probe-select",
    "Press and hold here for about half a second, then lift.",
  );
  const menu = el(
    "div.probe-menu",
    { hidden: true },
    "The page's menu: Copy · Select text",
  );
  let press = null;
  const selected = () => {
    const s = getSelection();
    return Boolean(s && !s.isCollapsed && target.contains(s.anchorNode));
  };
  const end = (how) => {
    if (!press) return;
    clearTimeout(press.timer);
    const p = press;
    press = null;
    const n = Math.round(performance.now() - p.t0);
    if (!p.fired)
      return set(
        l,
        null,
        `The finger ${how} after ${n} ms, before 300 ms: no menu`,
      );
    set(
      l,
      null,
      `The page's menu opened at ${p.firedAt} ms; the finger ${how} at ${n} ms; iPhone selection: ${selected() ? "yes" : "no"}${p.context ? "; a context menu event came" : ""}`,
    );
  };
  target.addEventListener("pointerdown", (e) => {
    menu.hidden = true;
    const p = {
      t0: performance.now(),
      x: e.clientX,
      y: e.clientY,
      fired: false,
    };
    p.timer = setTimeout(() => {
      p.fired = true;
      p.firedAt = Math.round(performance.now() - p.t0);
      menu.hidden = false;
      tg.HapticFeedback?.impactOccurred("medium");
    }, 300);
    press = p;
  });
  target.addEventListener("pointermove", (e) => {
    if (
      press &&
      !press.fired &&
      Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10
    )
      end("moved");
  });
  target.addEventListener("pointerup", () => end("lifted"));
  target.addEventListener("pointercancel", () => end("was taken over by iOS"));
  target.addEventListener("contextmenu", (e) => {
    if (press) press.context = true;
    e.preventDefault();
  });
  l.add(target, menu);
}

// The 17 probes, 9 for Telegram Desktop and 8 for the iPhone. Lines that share a probe (clipboard, picker,
// download box, storage) are listed on both, as each device answers for itself.
function deviceProbes(tg) {
  const kept = keptLocal();
  const D = "Telegram Desktop";
  const I = "iPhone";
  const fixed = (r) => (l) => set(l, ...r);
  const desktop = [
    [
      D,
      "Drag out a file (DownloadURL)",
      "Drag the probe.json box onto the desktop.",
      "Did probe.json appear on the desktop, holding a version number?",
      dragFile,
    ],
    [
      D,
      "Drag out a picture",
      "Drag the blue picture onto the desktop.",
      "Did a picture file appear on the desktop?",
      dragImage,
    ],
    [
      D,
      "Drop a file in",
      "Drag any file from the desktop into the box.",
      null,
      dropIn,
    ],
    [D, "File picker", "Tap the button and pick any file.", null, picker],
    [
      D,
      "Telegram's download box (downloadFile)",
      "Tap the button and confirm Telegram's box.",
      "Did probe.json arrive in your downloads?",
      (l) => download(l, tg),
    ],
    [
      D,
      "Full screen in and out",
      "Tap the button twice: in, then out.",
      null,
      (l) => fullScreen(l, tg),
    ],
    [
      D,
      "Clipboard write",
      "Tap the button, then paste into any text field.",
      'Did the pasted text start with "Phone app clipboard probe"?',
      clip,
    ],
    [
      D,
      "Storage kept across a reopen (localStorage)",
      "Close the app and open it again; this line then shows the earlier open.",
      null,
      fixed(kept),
    ],
    [
      D,
      "Window size",
      "Resize the window: this line follows it.",
      null,
      (l) => windowSize(l, tg),
    ],
  ];
  const iphone = [
    [
      I,
      "Selection in place (user-select: text !important)",
      "Press and hold on the sentence below.",
      "Did the iPhone's own Copy menu show over the selected words?",
      selectInPlace,
    ],
    [
      I,
      "Selection in a read-only text box",
      "Press and hold on the words in the box.",
      "Could you select the words and pick Copy?",
      readOnlyBox,
    ],
    [
      I,
      "A 300 ms press beats the system menu",
      "Press and hold the sentence below for about half a second.",
      "Did only the page's menu show, with no iPhone menu or selection?",
      (l) => longPress(l, tg),
    ],
    [
      I,
      "Clipboard write",
      "Tap the button, then paste into any text field.",
      'Did the pasted text start with "Phone app clipboard probe"?',
      clip,
    ],
    [
      I,
      "File picker",
      "Tap the button and pick any file or photo.",
      null,
      picker,
    ],
    [
      I,
      "Telegram's download box (downloadFile)",
      "Tap the button and confirm Telegram's box.",
      "Did probe.json arrive in Files?",
      (l) => download(l, tg),
    ],
    [
      I,
      "Storage kept across a reopen (localStorage)",
      "Close the app and open it again; this line then shows the earlier open.",
      null,
      fixed(kept),
    ],
    [
      I,
      "DeviceStorage kept across a reopen",
      "Close the app and open it again; this line then shows the earlier open.",
      null,
      (l) => keptDevice(tg).then(([ok, text]) => set(l, ok, text)),
    ],
  ];
  const lines = [];
  const group = (title, specs) =>
    el(
      "div.group",
      el("div.g-head", title),
      el(
        "div.block",
        specs.map(([device, name, how, ask, start]) => {
          const l = probeLine(device, name, how, ask);
          start(l);
          lines.push(l);
          return l.node;
        }),
      ),
    );
  const groups = [group(D, desktop), group(I, iphone)];
  // This device's own lines first.
  if (tg.platform === "ios") groups.reverse();
  return { lines, groups };
}

function report(tg, older, lines) {
  const head = `Phone app checks, ${new Date().toISOString()}, Telegram ${tg.platform} ${tg.version}, window ${innerWidth}x${innerHeight}`;
  const old = older.map(([name, r]) => `${name}: ${r.out.textContent}`);
  const probes = lines.map(
    (l) =>
      `[${l.device}] ${l.name}: ${l.text}${l.ask ? `. ${l.ask} ${l.said ?? "not answered"}` : ""}`,
  );
  return [head, "", ...old, "", ...probes].join("\n");
}

// The copy is written inside the tap. When the clipboard refuses, the text stands in a box to copy by hand.
function copyResults(make) {
  const status = el("p.field-hint");
  const box = el("textarea.probe-field", {
    readonly: true,
    rows: "8",
    hidden: true,
    "aria-label": "Results",
  });
  const fallback = (text, why) => {
    box.value = text;
    box.hidden = false;
    box.focus();
    box.select();
    status.textContent = `The clipboard refused (${why}). The results are in the box: select them and copy.`;
  };
  const btn = el(
    "button.btn.fill.wide",
    {
      type: "button",
      onclick: () => {
        const text = make();
        if (!navigator.clipboard?.writeText)
          return fallback(text, "no clipboard on this page");
        navigator.clipboard.writeText(text).then(
          () => {
            status.textContent = `Copied ${text.split("\n").length} lines. Paste them into the chat.`;
          },
          (e) => fallback(text, `${e.name}: ${e.message}`),
        );
      },
    },
    "Copy results",
  );
  return el("div.group", btn, status, box);
}

function render(ctx) {
  if (!document.getElementById("probe-css"))
    document.head.append(el("style", { id: "probe-css" }, PROBE_CSS));
  const list = el("div.block");
  const older = [];
  for (const [name, run] of checks(ctx.tg)) {
    const r = row(name);
    list.append(r.node);
    show(r, run);
    older.push([name, r]);
  }
  const insetRows = insets(ctx.tg).map(([name, run]) => {
    const r = row(name);
    list.append(r.node);
    show(r, run);
    older.push([name, r]);
    return [r, run];
  });
  const probes = deviceProbes(ctx.tg);
  const again = () => {
    for (const [r, run] of insetRows) show(r, run);
  };
  ctx.tg.onEvent("safeAreaChanged", again);
  ctx.tg.onEvent("contentSafeAreaChanged", again);
  const dictation = el("input.code-field", {
    type: "text",
    placeholder: "Tap, then use the keyboard's microphone",
    "aria-label": "Dictation",
  });
  queueMicrotask(() =>
    ctx.mainButton({ text: "Go on to the app", onClick: () => ctx.startApp() }),
  );
  return el(
    "div",
    el(
      "p.lead",
      "Test build. Each line is what this Telegram can do. Try the lines for this device, answer each Yes or No, then tap Copy results and paste them into the chat.",
    ),
    list,
    ...probes.groups,
    copyResults(() => report(ctx.tg, older, probes.lines)),
    el("div.group", el("div.g-head", "Dictation"), dictation),
    probe(),
  );
}

registerScreen({
  id: "checks",
  tab: null,
  title: "Checks",
  render,
  actions: [],
});
