// The Checks screen: only in the test build (node phone/page/build.mjs --checks), opened first, for the check on a
// real phone. It shows what this Telegram can do: microphone, recording formats, dictation, storage and crypto.
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

function render(ctx) {
  const list = el("div.block");
  for (const [name, run] of checks(ctx.tg)) {
    const r = row(name);
    list.append(r.node);
    show(r, run);
  }
  const insetRows = insets(ctx.tg).map(([name, run]) => {
    const r = row(name);
    list.append(r.node);
    show(r, run);
    return [r, run];
  });
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
    el("p.lead", "Test build. Each line is what this Telegram can do."),
    list,
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
