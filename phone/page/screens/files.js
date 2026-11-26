// The Files tab (files screens design, docs/2026-11-17-phone-files-screens-design.md): the files and folders in
// phone-inbox on the PC. Folders are made, entered, renamed and removed here; files come in by drop (Desktop) or the
// file picker, each as one stream to the PC (folder.put), and go out by Send to chat (folder.send). The top level is
// kept on the phone (cache.js "files") and drawn marked until the PC answers. The tab greys with its own update line
// when the PC does not offer the folder actions.
// Out to the device by the drag-out route of the files design (docs/2026-11-17-phone-files-design.md, section 10)
// that the recorded Checks pick (docs/research/2026-11-17-phone-checks-results.md): see DOWNLOAD_PLATFORMS. On
// Telegram Desktop the file menu also has Copy file and Show in folder, which act on the PC's own screen.
import { keep, kept as keptOnPhone } from "../frame/cache.js";
import { FILES_STREAM_MAX } from "../frame/channel.js";
import { el, ICONS, icon } from "../frame/dom.js";
import { registerScreen } from "../frame/screens.js";

const ACTIONS = [
  "folder.list",
  "folder.make",
  "folder.rename",
  "folder.remove",
  "folder.put",
  "folder.send",
];
export const UPDATE_LINE =
  "Files needs an update on your PC. On the PC, run /update-setup in Claude Code.";
const OFF_LINE = "Files can be added when your PC is on.";
const POPUP_MISSING = "Telegram cannot ask here: open the app in Telegram.";
const REMOVED_TEXT = "in phone-inbox on your PC and";
const NEW_FOLDER_DEPTH = 4; // no New folder at the fourth level: the PC takes at most five path parts
const DONE_MS = 2000;
const SENT_MS = 4000;
const DRAG_IDLE_MS = 1000;
const SEND_WAIT_MS = 5 * 60 * 1000; // folder.send: the page waits up to 5 minutes (files design, section 6.2)
const TREE_DEPTH = 4; // folders go 4 deep, so the Move sheet's tree has at most 4 levels under Files
// The drag-out route per platform, by the Checks (files design, section 10):
// - Telegram Desktop: DownloadURL "no", picture drag "yes", download box "yes": the second row, a Download item
//   (Telegram's download box with a one-time folder.link), then drag from Explorer. Its picture route (drag the
//   picture out of the page) needs the picture's bytes in the page, and no Files action reads them: not built.
// - iPhone: the download box was not tried ("not answered"), so the table's floor: Send to chat.
// Send to chat stays on every file whatever the route.
const DOWNLOAD_PLATFORMS = new Set(["tdesktop"]);

const GLYPHS = {
  upload: [
    "M12 15V4M7.5 8.5 12 4l4.5 4.5",
    "M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  ],
  folderPlus: [
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
    "M12 10v6M9 13h6",
  ],
  more: ["M6 12h.01M12 12h.01M18 12h.01"],
  x: ["M6 6l12 12M18 6 6 18"],
  check: ["M5 12.5 10 17l9-10"],
  chevron: ["M9 6l6 6-6 6"],
};

// ---- words
export function sizeText(b) {
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
const wholeMb = (b) => `${Math.round(b / (1024 * 1024))} MB`;
// A size over the limit, rounded up, so it never reads as the limit itself ("51 MB", not "50 MB")
const overMb = (b) => `${Math.ceil(b / (1024 * 1024))} MB`;
const LIMIT_MB = wholeMb(FILES_STREAM_MAX);

function dayText(t, now = new Date()) {
  const d = new Date(t);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days === 0) return `today ${hm}`;
  if (days === 1) return `yesterday ${hm}`;
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
}

const RULE_WORDS = {
  "path form": "that path is not allowed",
  "bad name": "that name is not allowed",
  hidden: "hidden names are not allowed",
  "secret file name": "that looks like a secret file",
  "secret folder": "that looks like a secret folder",
  link: "links are not followed",
  "outside the folder": "it is outside phone-inbox",
};
const CAUSE_WORDS = {
  offline: "your PC is off",
  "too-big": `the limit is ${LIMIT_MB}`,
  "stream-gone": "the PC lost the upload",
  "disk-full": "the PC's disk is full",
  "folder-full": "this folder is full",
  "not-found": "it is no longer on your PC",
  exists: "that name is already there",
  // The PC's answer for a name it can't take: over 120 characters, or with / or \ in it.
  "bad-input": "a name can have at most 120 characters and no / or \\",
  "relay-too-old": "your relay needs an update for this",
  rate: "too many files this hour, try again later",
  "unknown-action": "Files needs an update on your PC",
  "not-offered": "Files needs an update on your PC",
  timeout: "the PC did not answer in time",
};
// One cause in words, from a PC answer ({err, rule, why}) or a thrown channel error ({code})
export function causeWords(r) {
  const code = r?.err ?? r?.code ?? r?.message ?? "unknown";
  if (code === "folder-refused")
    return RULE_WORDS[r.rule] ?? `the PC refused it (${r.rule})`;
  if (code === "relay-failed")
    return `the relay failed (${r.why ?? "no reason given"})`;
  if (code === "telegram-refused")
    return `Telegram refused it (${r.why ?? "no reason given"})`;
  if (code === "copy-failed")
    return `the PC couldn't put it on its clipboard (${r.why ?? "no reason given"})`;
  if (code === "show-failed")
    return `the PC couldn't open its folder (${r.why ?? "no reason given"})`;
  if (code === "failed") return r.message ?? "the PC failed";
  return CAUSE_WORDS[code] ?? code;
}
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name);
const partsOf = (dir) => (dir ? dir.split("/") : []);
const extOf = (name) => {
  const i = name.lastIndexOf(".");
  return i > 0 && name.length - i <= 5
    ? name.slice(i + 1).toUpperCase()
    : "FILE";
};
// A long name is cut in the middle, so its end (and its type) stays readable
function nameCut(name) {
  const keep = Math.min(10, Math.max(0, name.length - 12));
  return el(
    "span.name.cut",
    { title: name },
    el("span.cut-start", {}, keep ? name.slice(0, -keep) : name),
    keep ? el("span.cut-end", {}, name.slice(-keep)) : null,
  );
}
// Popup text is at most 256 characters: a name in it is cut to fit
const popupName = (name) =>
  name.length > 60 ? `${name.slice(0, 40)}…${name.slice(-12)}` : name;

// ---- state that outlives a draw (uploads go on while the screen is drawn again)
const lists = new Map(); // dir -> { items, more } fresh from the PC
const asked = new Map(); // dir -> pending folder.list promise
const listErr = new Map(); // dir -> words
const uploads = []; // { id, dir, name, size, file, phase: waiting|uploading|done|failed|too-big, sent, cause }
const sending = new Map(); // path -> "sending" | "sent"
let toast = null; // { title, text, error }
let view = null; // the drawn screen: { ctx, dir, root }
let sheet = null; // the open sheet: { kind: "file", item } | { kind: "name", mode, name, err } | { kind: "folder" }
let dragOver = false;
let dragTimer = 0;
let nextId = 1;
const dropBoxes = new WeakSet();

const desktop = (ctx) => ctx.tg?.platform === "tdesktop";
const redraw = () => {
  if (view?.root.isConnected) view.draw();
};

// ---- the skeleton (comfort design, section 2), built here so the shell needs no Files markup: the frame shows
// #sk-files while nothing is kept and the first answer is not in
function skeleton() {
  const row = (name, meta) =>
    el(
      "div.sk-row",
      {},
      el("span.sk-tile"),
      el(
        "div.sk-lines",
        {},
        el(`span.sk-bar.sk-w${name}`),
        el(`span.sk-bar.sk-w${meta}`),
      ),
    );
  const rowsWith = (pairs) =>
    el("div.sk-block", {}, ...pairs.map(([n, m]) => row(n, m)));
  return el(
    "section.sk-tab",
    { "data-tab": "files", hidden: true },
    el("div.title-row", {}, el("h1.large-title", {}, "Files")),
    el(
      "div.sk-body",
      { id: "sk-files", "aria-hidden": "true" },
      el(
        "div.sk-tools",
        {},
        el("button.sk-tool", { disabled: true, tabindex: "-1" }, "Add files"),
        el("button.sk-tool", { disabled: true, tabindex: "-1" }, "New folder"),
      ),
      el("p.sk-head", {}, "Folders"),
      rowsWith([
        [62, 38],
        [48, 30],
      ]),
      el("p.sk-head", {}, "Files"),
      rowsWith([
        [70, 44],
        [55, 38],
        [62, 30],
        [48, 44],
      ]),
    ),
  );
}
const shellContent =
  typeof document !== "undefined"
    ? document.querySelector?.("#shell .sk-content")
    : null;
if (shellContent && !document.getElementById("sk-files"))
  shellContent.append(skeleton());

// ---- asking the PC
function load(ctx, dir) {
  if (asked.has(dir)) return asked.get(dir);
  const done = (r) => {
    if (r?.ok) {
      const list = { items: r.d.items, more: r.d.more };
      lists.set(dir, list);
      listErr.delete(dir);
      if (dir === "") keep("files", list);
    } else listErr.set(dir, causeWords(r));
  };
  const p = ctx
    .ask("folder.list", { dir })
    .then(done, (e) => listErr.set(dir, causeWords(e)))
    .finally(() => {
      asked.delete(dir);
      redraw();
    });
  asked.set(dir, p);
  return p;
}
// One ask whose failure shows in words: on the toast, or `onErr` when the caller shows it in place. `ms` is the
// wait for the answer; none keeps the frame's.
async function act(action, data, onErr, ms) {
  let r;
  try {
    r = await view.ctx.ask(action, data, ms);
  } catch (e) {
    r = { ok: false, err: e.code ?? e.message };
  }
  if (!r?.ok) {
    if (onErr) onErr(r);
    else
      toast = {
        title: `Couldn't ${ACT_WORDS[action]}: ${causeWords(r)}.`,
        error: true,
      };
    redraw();
  }
  return r;
}
const ACT_WORDS = {
  "folder.make": "make the folder",
  "folder.rename": "rename it",
  "folder.remove": "remove it",
  "folder.send": "send to chat",
  "folder.link": "download it",
  "folder.copy": "copy the file",
  "folder.show": "show it in its folder",
  "folder.move": "move it",
};
const changed = (dir) => {
  lists.delete(dir);
  return load(view.ctx, dir);
};

// ---- uploads
function addFiles(files) {
  const { ctx, dir } = view;
  if (!ctx.connected || ctx.updating) {
    toast = { title: OFF_LINE, error: true };
    return redraw();
  }
  for (const file of files) {
    const u = {
      id: nextId++,
      dir,
      name: file.name,
      size: file.size,
      file,
      phase: "waiting",
      sent: 0,
    };
    uploads.push(u);
    // Over the limit is refused here, in words, before the file is even read
    if (file.size > FILES_STREAM_MAX) u.phase = "too-big";
    else upload(u);
  }
  redraw();
}
// Files are read and streamed one at a time, in the order dropped: a drop of many files holds one in memory, not
// all of them. A file waits its turn as "Waiting", as it does in the channel's stream line.
let turn = Promise.resolve();
function inTurn(fn) {
  const run = turn.then(fn);
  turn = run.catch(() => {});
  return run;
}
async function upload(u) {
  Object.assign(u, {
    phase: "uploading",
    sent: 0,
    waiting: true,
    cause: null,
  });
  redraw();
  let r;
  try {
    r = await inTurn(async () => {
      const ctx = view.ctx;
      u.waiting = false;
      redraw();
      const bytes = new Uint8Array(await u.file.arrayBuffer());
      return ctx.sendStream(
        bytes,
        u.file.type || "application/octet-stream",
        (part) => {
          u.sent = part;
          redraw();
        },
        FILES_STREAM_MAX,
        (waiting) => {
          u.waiting = waiting;
          redraw();
        },
      );
    });
    const ctx = view.ctx;
    if (r?.ok)
      r = await ctx.ask("folder.put", {
        dir: u.dir,
        name: u.name,
        stream: r.d.stream,
      });
  } catch (e) {
    r = { ok: false, err: e.code ?? e.message };
  }
  if (!r?.ok) {
    Object.assign(u, { phase: "failed", cause: causeWords(r), waiting: false });
    return redraw();
  }
  Object.assign(u, { phase: "done", waiting: false });
  const list = lists.get(u.dir);
  if (list) {
    const item = {
      name: r.d.name,
      kind: "file",
      size: r.d.size,
      at: new Date().toISOString(),
    };
    list.items = [...list.items.filter((i) => i.name !== item.name), item];
    if (u.dir === "") keep("files", list);
  }
  redraw();
  setTimeout(() => {
    dropUpload(u);
    redraw();
  }, DONE_MS);
}
const dropUpload = (u) => {
  const i = uploads.indexOf(u);
  if (i >= 0) uploads.splice(i, 1);
};

// ---- folders
function nameSheet(mode, name = "") {
  sheet = { kind: "name", mode, name, err: null };
  redraw();
}
async function saveName(text) {
  const { dir } = view;
  const name = text.trim();
  if (!name) return;
  const mode = sheet.mode;
  // A name with / or \ would be a path: said here, without asking the PC.
  if (/[\\/]/.test(name)) {
    sheet.err = "That name can't have / or \\ in it.";
    return redraw();
  }
  const there = (r) => {
    sheet.err =
      r?.err === "exists"
        ? `There is already a folder called ${name}.`
        : `${sentence(causeWords(r))}.`;
  };
  if (mode === "new") {
    const r = await act("folder.make", { dir, name }, there);
    if (!r?.ok) return;
    sheet = null;
    return changed(dir);
  }
  const r = await act("folder.rename", { path: dir, name }, there);
  if (!r?.ok) return;
  sheet = null;
  const parent = partsOf(dir).slice(0, -1).join("/");
  lists.delete(dir);
  lists.delete(parent);
  view.ctx.params.dir = joinPath(parent, r.d.name);
  view.ctx.redraw();
}
// Remove asks first in Telegram's own popup; what is removed goes to .removed on the PC for 7 days
function confirmRemove(ctx, title, message, then) {
  if (typeof ctx.tg?.showPopup !== "function") {
    toast = { title: POPUP_MISSING, error: true };
    return redraw();
  }
  ctx.tg.showPopup(
    {
      title,
      message,
      buttons: [
        { id: "remove", type: "destructive", text: "Remove" },
        { id: "cancel", type: "cancel" },
      ],
    },
    (id) => {
      if (id === "remove") then();
    },
  );
}
function removeFolder() {
  const { ctx, dir } = view;
  const name = popupName(partsOf(dir).at(-1));
  const n = lists.get(dir)?.items.length ?? 0;
  const what = n
    ? `the folder ${name} and its ${n === 1 ? "1 item" : `${n} items`}`
    : `the folder ${name}`;
  const they = n ? "They go" : "It goes";
  confirmRemove(
    ctx,
    "Remove folder?",
    `Remove ${what}? ${they} to the .removed folder ${REMOVED_TEXT} are deleted after 7 days.`,
    async () => {
      const r = await act("folder.remove", { path: dir });
      if (!r?.ok) return;
      lists.delete(dir);
      lists.delete(partsOf(dir).slice(0, -1).join("/"));
      ctx.back();
    },
  );
}
function removeFile(ctx, dir, item) {
  const name = popupName(item.name);
  confirmRemove(
    ctx,
    "Remove file?",
    `Remove ${name}? It goes to the .removed folder ${REMOVED_TEXT} is deleted after 7 days.`,
    async () => {
      const r = await act("folder.remove", { path: joinPath(dir, item.name) });
      if (r?.ok) changed(dir);
    },
  );
}

// ---- Send to chat: the PC sends the file to the Files topic of the chat
async function sendToChat(ctx, dir, item) {
  const path = joinPath(dir, item.name);
  sending.set(path, "sending");
  redraw();
  let failed = null;
  const r = await act(
    "folder.send",
    { path },
    (x) => {
      failed = x;
    },
    SEND_WAIT_MS,
  );
  if (!r?.ok) {
    sending.delete(path);
    toast = {
      title: `Couldn't send to chat: ${causeWords(failed)}.`,
      error: true,
      stays: true,
    };
    return redraw();
  }
  sending.set(path, "sent");
  toast = { title: "Sent to the Files topic.", text: sentWhere(ctx) };
  redraw();
  setTimeout(() => {
    if (sending.get(path) === "sent") sending.delete(path);
    redraw();
  }, SENT_MS);
}
function sentWhere(ctx) {
  if (!desktop(ctx)) return "Open it there, then Share or Save.";
  if (ctx.tg?.isFullscreen)
    return "Leave full screen, then drag it out of the Files topic to save it.";
  return "Drag it out of the Files topic to save it.";
}

// A done toast leaves after 4 s, unless another took its place
function flash(t) {
  toast = t;
  redraw();
  setTimeout(() => {
    if (toast !== t) return;
    toast = null;
    redraw();
  }, SENT_MS);
}

// ---- Download (the Download route): the PC makes a one-time link (2 minutes, one use, files design section 6.3)
// and Telegram's own download box fetches it; the user then drags the file from the folder it saved to.
const downloadRoute = (ctx) =>
  DOWNLOAD_PLATFORMS.has(ctx.tg?.platform) && ctx.offered("folder.link");
async function download(ctx, dir, item) {
  const tg = ctx.tg;
  if (typeof tg?.downloadFile !== "function" || !tg.isVersionAtLeast?.("8.0")) {
    toast = {
      title: `Couldn't download it: Telegram ${tg?.version ?? ""} here has no download box (it needs 8.0).`,
      error: true,
    };
    return redraw();
  }
  const r = await act("folder.link", { path: joinPath(dir, item.name) });
  if (!r?.ok) return;
  try {
    tg.downloadFile({ url: r.d.url, file_name: r.d.name }, (going) =>
      flash(
        going
          ? {
              title: "Download started.",
              text: "Then drag it from the folder it saved to.",
            }
          : { title: "Download cancelled." },
      ),
    );
  } catch (e) {
    toast = {
      title: `Couldn't download it: Telegram refused it (${e.message}).`,
      error: true,
    };
    redraw();
  }
}

// ---- Copy file and Show in folder (Telegram Desktop): the PC puts the file on its clipboard, or opens Explorer with
// the file selected
async function onPc(action, dir, item, done) {
  const r = await act(action, { path: joinPath(dir, item.name) });
  if (r?.ok) flash(done);
}

// ---- Move to folder: a sheet with the folder tree (Files first, the folder it is in now greyed "Here now")
function openMove(ctx, dir, item) {
  sheet = { kind: "move", item };
  redraw();
  loadTree(ctx, "", 0);
}
async function loadTree(ctx, d, depth) {
  if (!lists.has(d)) await load(ctx, d);
  if (depth + 1 >= TREE_DEPTH) return; // folders at the last level hold files only
  const subs = (lists.get(d)?.items ?? []).filter((i) => i.kind === "folder");
  await Promise.all(
    subs.map((f) => loadTree(ctx, joinPath(d, f.name), depth + 1)),
  );
}
async function moveTo(from, item, to) {
  const toName = to ? partsOf(to).at(-1) : "Files";
  const r = await act(
    "folder.move",
    { path: joinPath(from, item.name), to },
    (x) => {
      const gone = x?.err === "not-found";
      const words =
        x?.err === "exists"
          ? `There is already a file called ${item.name} in ${toName}.`
          : gone
            ? "It is no longer there. The list is updated."
            : `Couldn't move it: ${causeWords(x)}.`;
      toast = { title: words, error: true };
      if (gone) changed(from);
    },
  );
  if (!r?.ok) return;
  lists.delete(to);
  changed(from);
  flash({ title: `Moved to ${toName}.` });
}

// The file menu's items, in order (screens design, section 3, with the user's Desktop items of 2026-11-17). Each
// item: { id, label, danger?, run() }; Cancel is the sheet's own. Copy file and Show in folder show only on Telegram
// Desktop with a PC that offers them.
export function fileMenuItems(ctx, dir, item) {
  const desk = desktop(ctx);
  const items = [
    {
      id: "send",
      label: "Send to chat",
      run: () => sendToChat(ctx, dir, item),
    },
  ];
  if (downloadRoute(ctx))
    items.push({
      id: "download",
      label: "Download",
      run: () => download(ctx, dir, item),
    });
  if (desk && ctx.offered("folder.copy"))
    items.push({
      id: "copy",
      label: "Copy file",
      run: () =>
        onPc("folder.copy", dir, item, {
          title: "Copied on your PC.",
          text: "Paste it anywhere: a folder, a chat or a mail.",
        }),
    });
  if (desk && ctx.offered("folder.show"))
    items.push({
      id: "show",
      label: "Show in folder",
      run: () =>
        onPc("folder.show", dir, item, {
          title: "Its folder is open on your PC.",
        }),
    });
  if (ctx.offered("folder.move"))
    items.push({
      id: "move",
      label: "Move to folder…",
      run: () => openMove(ctx, dir, item),
    });
  items.push({
    id: "remove",
    label: "Remove",
    danger: true,
    run: () => removeFile(ctx, dir, item),
  });
  return items;
}

// ---- drop in (Desktop): one set of listeners on the frame's scroll box, acting only while a Files screen is drawn
function watchDrops(ctx) {
  const box = ctx.scrollBox;
  if (!box || dropBoxes.has(box)) return;
  dropBoxes.add(box);
  const mine = () => view?.root.isConnected;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  const end = () => {
    clearTimeout(dragTimer);
    if (!dragOver) return;
    dragOver = false;
    redraw();
  };
  box.addEventListener("dragover", (e) => {
    if (!mine() || !hasFiles(e)) return;
    e.preventDefault();
    clearTimeout(dragTimer);
    dragTimer = setTimeout(end, DRAG_IDLE_MS);
    if (dragOver) return;
    dragOver = true;
    redraw();
  });
  box.addEventListener("dragleave", (e) => {
    if (mine() && !e.relatedTarget) end();
  });
  box.addEventListener("drop", (e) => {
    if (!mine() || !hasFiles(e)) return;
    e.preventDefault();
    end();
    addFiles([...e.dataTransfer.files]);
  });
}

// ---- drawing
function progressText(u) {
  if (u.waiting) return `Waiting · ${sizeText(u.size)}`;
  if (u.phase === "uploading") {
    const mb = u.size >= 1024 * 1024;
    const of = (b) =>
      mb ? (b / (1024 * 1024)).toFixed(1) : String(Math.round(b / 1024));
    return `Uploading · ${of(u.sent * u.size)} of ${of(u.size)} ${mb ? "MB" : "KB"}`;
  }
  if (u.phase === "failed") return `Didn't upload: ${u.cause}.`;
  if (u.phase === "too-big")
    return `Too big: ${overMb(u.size)}. The limit is ${LIMIT_MB}.`;
  if (u.phase === "done") return "Added";
  return `Waiting · ${sizeText(u.size)}`;
}
const typeTile = (name, mark) =>
  el(
    "span.ftile",
    {},
    extOf(name),
    mark ? el("span.ftile-mark", {}, "!") : null,
  );
const iconBtn = (cls, label, glyph, onclick, disabled) =>
  el(
    `button.${cls}`,
    {
      type: "button",
      "aria-label": label,
      title: label,
      onclick,
      disabled: !!disabled,
    },
    icon(glyph, 20),
  );

function uploadRow(u) {
  const bad = u.phase === "failed" || u.phase === "too-big";
  const right = el("div.right");
  if (u.phase === "failed")
    right.append(
      el(
        "button.btn-quiet.files-retry",
        { type: "button", onclick: () => upload(u) },
        "Try again",
      ),
    );
  if (bad)
    right.append(
      iconBtn("files-x", `Close ${u.name}`, GLYPHS.x, () => {
        dropUpload(u);
        redraw();
      }),
    );
  if (u.phase === "done")
    right.append(el("span.files-done", {}, icon(GLYPHS.check, 20)));
  const meta = el(`span.meta${bad ? ".files-bad" : ""}`, {}, progressText(u));
  // The page's CSP (style-src 'self') drops a style attribute; a property set through the style object stands
  let bar = null;
  if (u.phase === "uploading" && !u.waiting) {
    bar = el("span.files-bar", {}, el("span"));
    bar.style.setProperty("--sent", String(u.sent));
  }
  return el(
    "div.row.file-row.files-up",
    { "data-upload": u.phase },
    typeTile(u.name, bad),
    el("div.row-text", {}, nameCut(u.name), meta, bar),
    right,
  );
}

function fileRow(ctx, dir, item, live) {
  const path = joinPath(dir, item.name);
  const state = sending.get(path);
  const meta =
    state === "sending"
      ? el("span.meta", {}, "Sending to chat…")
      : state === "sent"
        ? el("span.meta.files-sent", {}, icon(GLYPHS.check, 14), "Sent to chat")
        : el(
            "span.meta",
            {},
            `${sizeText(item.size)} · `,
            el("span.age", {}, dayText(item.at)),
          );
  return el(
    "div.row.file-row",
    { "data-file": item.name },
    typeTile(item.name),
    el("div.row-text", {}, nameCut(item.name), meta),
    el(
      "div.right",
      {},
      // The card's button is the route's (screens design, section 3): Download on the Download route
      downloadRoute(ctx)
        ? el(
            "button.btn-quiet.files-download",
            {
              type: "button",
              disabled: !live,
              onclick: () => download(ctx, dir, item),
            },
            "Download",
          )
        : el(
            "button.btn-quiet.files-send",
            {
              type: "button",
              disabled: !live || !!state,
              onclick: () => sendToChat(ctx, dir, item),
            },
            "Send to chat",
          ),
      iconBtn("files-more", `More for ${item.name}`, GLYPHS.more, () => {
        sheet = { kind: "file", item };
        redraw();
      }),
    ),
  );
}

function folderRow(ctx, dir, item) {
  const meta =
    item.count == null
      ? "Folder"
      : item.count
        ? `${item.count} ${item.count === 1 ? "file" : "files"}`
        : "Empty";
  return el(
    "button.row.files-folder",
    {
      type: "button",
      "data-folder": item.name,
      onclick: () => ctx.go("files-folder", { dir: joinPath(dir, item.name) }),
    },
    el("span.tile", {}, icon(ICONS.folder, 22)),
    el(
      "div.row-text",
      {},
      el("span.name", {}, item.name),
      el("span.meta", {}, meta),
    ),
    el("span.chev", {}, icon(GLYPHS.chevron, 18)),
  );
}

// The Move sheet's folder tree from the lists asked so far, each folder under its parent, indented by its depth
function moveRows(dir, item, close) {
  const rows = [];
  let loading = false;
  let err = null;
  const add = (d, depth) => {
    const here = d === dir;
    rows.push(
      el(
        `button.files-move-to.files-depth-${depth}`,
        {
          type: "button",
          "data-to": d,
          disabled: here,
          onclick: () => (close(), moveTo(dir, item, d)),
        },
        el("span.name", {}, d ? partsOf(d).at(-1) : "Files"),
        here ? el("span.meta", {}, "Here now") : null,
      ),
    );
    if (depth >= TREE_DEPTH) return;
    const list = lists.get(d);
    if (!list) {
      if (listErr.has(d)) err ??= listErr.get(d);
      else loading = true;
      return;
    }
    for (const f of list.items.filter((i) => i.kind === "folder"))
      add(joinPath(d, f.name), depth + 1);
  };
  add("", 0);
  if (err)
    rows.push(
      el(
        "p.files-sheet-err",
        { role: "alert" },
        `Couldn't load the folders: ${err}.`,
      ),
    );
  else if (loading) rows.push(el("p.empty", {}, "Loading folders…"));
  return rows;
}

function sheetEl(ctx, dir) {
  const close = () => {
    sheet = null;
    redraw();
  };
  const choice = (label, run, danger) =>
    el(
      `button.files-choice${danger ? ".danger" : ""}`,
      { type: "button", onclick: () => (close(), run()) },
      label,
    );
  const cancel = el(
    "button.files-choice.files-cancel",
    { type: "button", onclick: close },
    "Cancel",
  );
  let body;
  if (sheet.kind === "file") {
    const it = sheet.item;
    body = [
      el(
        "div.files-sheet-head",
        {},
        typeTile(it.name),
        el(
          "div.row-text",
          {},
          nameCut(it.name),
          el("span.meta", {}, `${sizeText(it.size)} · ${dayText(it.at)}`),
        ),
      ),
      ...fileMenuItems(ctx, dir, it).map((m) =>
        choice(m.label, m.run, m.danger),
      ),
      cancel,
    ];
  } else if (sheet.kind === "move") {
    const it = sheet.item;
    body = [
      el("p.files-sheet-title", {}, `Move ${it.name}`),
      el("p.meta.files-move-sub", {}, "Choose a folder"),
      el("div.files-move-list", {}, ...moveRows(dir, it, close)),
      cancel,
    ];
  } else if (sheet.kind === "folder") {
    body = [
      choice("Rename folder", () => nameSheet("rename", partsOf(dir).at(-1))),
      choice("Remove folder", removeFolder, true),
      cancel,
    ];
  } else {
    const field = el("input.files-name", {
      type: "text",
      placeholder: "Folder name",
      value: sheet.name,
      maxlength: "120",
      "aria-label": "Folder name",
      oninput: (e) => {
        sheet.name = e.target.value;
      },
      onkeydown: (e) => {
        if (e.key === "Enter") saveName(sheet.name);
      },
    });
    const word = sheet.mode === "new" ? "Create" : "Rename";
    body = [
      el(
        "p.files-sheet-title",
        {},
        sheet.mode === "new" ? "New folder" : "Rename folder",
      ),
      field,
      sheet.err ? el("p.files-sheet-err", { role: "alert" }, sheet.err) : null,
      el(
        "div.btnrow",
        {},
        el("button.btn", { type: "button", onclick: close }, "Cancel"),
        el(
          "button.btn.fill.files-save",
          { type: "button", onclick: () => saveName(sheet.name) },
          word,
        ),
      ),
    ];
  }
  return [
    el("div.files-veil", { onclick: close }),
    el("div.files-sheet", { role: "dialog", "aria-modal": "true" }, ...body),
  ];
}

function toastEl() {
  const t = toast;
  return el(
    `div.files-toast${t.error ? ".error" : ""}`,
    { role: t.error ? "alert" : "status" },
    el(
      "div.row-text",
      {},
      el("span.name", {}, t.title),
      t.text ? el("span.meta", {}, t.text) : null,
    ),
    iconBtn("files-x", "Close", GLYPHS.x, () => {
      toast = null;
      redraw();
    }),
  );
}

const addBtn = (cls, live, pick) =>
  el(
    `button.${cls}.files-add`,
    { type: "button", disabled: !live, onclick: pick },
    icon(ICONS.plus, 20),
    "Add files",
  );
const newBtn = (live) =>
  el(
    "button.btn-quiet.files-new",
    { type: "button", disabled: !live, onclick: () => nameSheet("new") },
    icon(GLYPHS.folderPlus, 20),
    "New folder",
  );

function paint(v) {
  const { ctx, dir, root } = v;
  const list = lists.get(dir) ?? v.keptList;
  const err = listErr.get(dir);
  const ups = uploads.filter((u) => u.dir === dir);
  const live = ctx.connected && !ctx.updating;
  const desk = desktop(ctx);
  const folderName = partsOf(dir).at(-1);
  // One input for the view's life: one made on each draw would drop a pick made while an upload redraws
  v.picker ??= el("input.files-picker", {
    type: "file",
    multiple: true,
    hidden: true,
    onchange: (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      addFiles(files);
    },
  });
  const picker = v.picker;
  const pick = () => picker.click();
  const folders = (list?.items ?? []).filter((i) => i.kind === "folder");
  const files = (list?.items ?? [])
    .filter((i) => i.kind === "file")
    .sort((a, b) => new Date(b.at) - new Date(a.at)); // the PC sends ISO times
  const empty = list && !folders.length && !files.length && !ups.length;
  const out = [picker];

  if (err)
    out.push(
      el(
        "p.frame-line.warn",
        { role: "alert" },
        `Couldn't load the files: ${err}.`,
      ),
    );
  if (empty && dir === "") {
    // The first time: one card says what the tab is for, with the button that starts it
    out.push(
      desk
        ? el(
            "div.files-drop-big",
            {},
            icon(GLYPHS.upload, 48),
            el(
              "p",
              {},
              "Drop files here, or ",
              el(
                "button.files-link",
                { type: "button", disabled: !live, onclick: pick },
                "add them",
              ),
              ".",
            ),
            el(
              "p.meta",
              {},
              `They are saved in phone-inbox on your PC. Up to ${LIMIT_MB} each.`,
            ),
          )
        : el(
            "div.block.empty-hero",
            {},
            el("span.hero-icon", {}, icon(ICONS.files, 28)),
            el("p.hero-title", {}, "No files yet"),
            el(
              "p.hero-text",
              {},
              `Files you add here are saved in phone-inbox on your PC. Up to ${LIMIT_MB} each.`,
            ),
            addBtn("btn.fill.wide", live, pick),
          ),
      newBtn(live),
    );
  } else {
    const menu = () => {
      sheet = { kind: "folder" };
      redraw();
    };
    out.push(
      el(
        "div.files-tools",
        {},
        addBtn("btn-quiet", live, pick),
        partsOf(dir).length < NEW_FOLDER_DEPTH ? newBtn(live) : null,
        dir
          ? iconBtn(
              "files-folder-menu",
              `Menu for ${folderName}`,
              GLYPHS.more,
              menu,
              !live,
            )
          : null,
      ),
    );
    if (desk) {
      const add = el(
        "button.files-link",
        { type: "button", onclick: pick },
        "add files",
      );
      const words = live
        ? el("span", {}, "Drop files here or ", add)
        : el("span", {}, OFF_LINE);
      out.push(el("div.files-strip", {}, icon(GLYPHS.upload, 22), words));
    }
    if (!list && !err) out.push(el("p.empty", {}, "Loading files…"));
    if (folders.length)
      out.push(
        el(
          "div.group.files-folders-group",
          {},
          el(
            "p.g-head",
            {},
            "Folders ",
            el("span.n", {}, String(folders.length)),
          ),
          el(
            "div.block.files-folders",
            {},
            ...folders.map((f) => folderRow(ctx, dir, f)),
          ),
        ),
      );
    if (files.length || ups.length)
      out.push(
        el(
          "div.group.files-files-group",
          {},
          el(
            "p.g-head",
            {},
            dir ? "In this folder " : "Files ",
            el("span.n", {}, String(files.length)),
          ),
          el(
            "div.block.files-files",
            {},
            ...ups.map(uploadRow),
            ...files.map((f) => fileRow(ctx, dir, f, live)),
          ),
        ),
      );
    if (empty) {
      const words = desk
        ? "This folder is empty. Drop files here or add them."
        : "This folder is empty. Add files to it.";
      out.push(el("p.empty", {}, words));
    }
    if (desk && (files.length || ups.length)) {
      const leave = ctx.tg?.isFullscreen ? "leave full screen, " : "";
      const [narrow, wide] = downloadRoute(ctx)
        ? [
            "open its ⋯ menu, choose Download, then drag it from the folder it saved to.",
            "Download, then drag it from the folder it saved to.",
          ]
        : [
            "open its ⋯ menu, choose Send to chat, then drag it out of the Files topic.",
            `Send to chat, ${leave}then drag it out of the Files topic.`,
          ];
      out.push(
        el(
          "p.files-hint",
          {},
          "To save a file on this PC: ",
          el("span.hint-narrow", {}, narrow),
          el("span.hint-wide", {}, wide),
        ),
      );
    }
  }
  if (dragOver)
    out.push(
      el(
        "div.files-drop-over",
        { "aria-hidden": "true" },
        icon(GLYPHS.upload, 48),
        el(
          "p.files-drop-title",
          {},
          dir ? `Drop to add to ${folderName}` : "Drop to add to Files",
        ),
        el("p.meta", {}, `Up to ${LIMIT_MB} each`),
      ),
    );
  if (toast) out.push(toastEl());
  if (sheet) out.push(...sheetEl(ctx, dir));
  root.replaceChildren(...out);
}

function render(ctx, dir) {
  // A PC without the folder actions: the frame greys the tab and shows UPDATE_LINE; nothing is asked or drawn
  if (ctx.connected && !ctx.offered("folder.list")) return el("div.files");
  const keptList = dir === "" ? (keptOnPhone("files")?.data ?? null) : null;
  if (ctx.updating && dir === "" && !keptList)
    throw new Error("Files is drawn as kept, but nothing is kept on the phone");
  if (view?.dir !== dir) sheet = null;
  const root = el("div.files");
  view = { ctx, dir, root, keptList };
  view.draw = () => paint(view);
  watchDrops(ctx);
  paint(view);
  if (ctx.connected) load(ctx, dir);
  return root;
}

registerScreen({
  id: "files",
  tab: "files",
  title: "Files",
  render: (ctx) => render(ctx, ""),
  actions: ACTIONS,
  updateLine: UPDATE_LINE,
  keep: "files",
});

registerScreen({
  id: "files-folder",
  tab: null,
  title: (params) => partsOf(params.dir).at(-1) ?? "Folder",
  render: (ctx) => render(ctx, ctx.params.dir),
  actions: ACTIONS,
  updateLine: UPDATE_LINE,
});
