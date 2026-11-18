// Attach in the typing box (screens-2 design, "Attach"). The paperclip opens the system picker (on the iPhone one
// sheet offers Photo Library, Take Photo and Choose File). Each picked file shows as a chip above the field and goes
// to the PC at once, as a stream of sealed pieces (ctx.sendStream, as voice does), then attach.put saves it and
// answers its id. Send, Queue and a new session carry the ids in `attachments`; the PC names the saved files in the
// prompt. The main button is off while a file uploads or has failed, and the line under the chips says why. Too
// big, a kind the PC can't take and a ninth file are refused here before any upload. The chip's X calls
// attach.drop. What the files are doing lives here, one list per session, not in the view: the page draws the
// session view again on a new channel session, and an upload in progress carries on into the new view.
import { el, icon } from "../frame/dom.js";

const MB = 1024 * 1024;
const MAX_FILES = 8;
const MAX_ALL = 25 * MB; // the stream cap: all files of one message together
// The PC's caps per kind (actions/attach.mjs).
const CAP = { picture: 20 * MB, pdf: 10 * MB, text: 10 * MB };
const PICTURES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const PICTURE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
// The PC's fixed text list, and the kinds it takes as text but saves as .txt (design "The PC's fixed text list").
const TEXT_EXT = new Set(
  "log json yaml yml toml xml csv ini cfg conf env properties md markdown txt rst css ts tsx py rb rs go java kt swift c cpp h hpp cs php lua r scala clj ex exs erl hs ml sql graphql gql proto sh bash zsh fish dockerfile js mjs cjs jsx ps1 bat cmd html htm".split(
    " ",
  ),
);
const HEIC = /\.(heic|heif)$/i;
// iOS makes no canvas over about 16.7 million pixels; a 24 or 48 MP photo is drawn smaller to stay under this.
const MAX_PIXELS = 16_000_000;
// A file of no known kind is read this far: UTF-8 with no NUL byte is text, as the PC decides (design "Attach").
const SNIFF_BYTES = 8 * 1024;
const UNTYPED = new Set(["", "application/octet-stream"]);
// What the picker offers: the four pictures, HEIC (turned into JPEG here), PDF and the text list.
const ACCEPT = [
  ...PICTURES,
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/*",
  ".pdf",
  ...[...TEXT_EXT].map((x) => `.${x}`),
].join(",");

const GLYPHS = {
  clip: [
    "M16.5 6.5v10a4.5 4.5 0 0 1-9 0V5.5a3 3 0 0 1 6 0V16a1.5 1.5 0 0 1-3 0V7",
  ],
  doc: ["M7 3h7l5 5v13H7z", "M14 3v5h5"],
  x: ["M7 7l10 10M17 7L7 17"],
};

// Channel failures and PC refusals, in words.
const SAY = {
  timeout: "the PC did not answer in time",
  "not-connected": "no link to the PC right now",
  closed: "the link to the PC closed",
  "pc-offline": "the PC is off or asleep",
  "stream-broken": "it did not arrive whole",
  "no-stream": "it did not arrive whole",
  "attachment-unknown": "the PC no longer has it",
  "attach-place": "the PC's folder for files is not safe to write",
};

const ext = (name) => {
  const m = /\.([^./\\]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
};

// The kind the PC will find, from the phone's name and type (a hint only: the PC checks the bytes).
function kindOf(file) {
  const x = ext(file.name);
  if (PICTURES.has(file.type) || PICTURE_EXT.has(x)) return "picture";
  if (/^image\/hei[cf]$/.test(file.type) || HEIC.test(file.name)) return "heic";
  if (file.type === "application/pdf" || x === "pdf") return "pdf";
  if (file.type.startsWith("text/") || TEXT_EXT.has(x)) return "text";
  return null;
}

export function sizeWords(b) {
  if (b < 1024) return `${b} B`;
  if (b < MB) return `${Math.round(b / 1024)} KB`;
  const m = b / MB;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)} MB`;
}

// The chip's name in two parts: the start gives way with "…", the last 10 characters always stay.
const nameParts = (name) => [name.slice(0, -10), name.slice(-10)];

// The session's files: { files, notice, view } where a file is { file, name, size, kind, phase, sent, id, line,
// retry, thumb, run, removed } and phase is "uploading" | "done" | "failed" | "refused".
const states = new Map();
function stateFor(key) {
  let s = states.get(key);
  if (!s) {
    s = { files: [], notice: null, view: null };
    states.set(key, s);
  }
  return s;
}

function redraw(s) {
  s.view?.draw();
  s.view?.changed();
}

// The attach parts of one typing box: the paperclip `button` for the button row, the `chips` row and the `lines`
// under it. target() names where the files go ({ session } or { project }); changed() runs after the files change.
export function attachParts(ctx, { key, target, changed }) {
  const s = stateFor(key);
  const input = el("input.attach-pick", {
    type: "file",
    multiple: true,
    accept: ACCEPT,
    hidden: true,
    onchange: () => {
      const picked = [...(input.files ?? [])];
      input.value = "";
      pick(s, picked);
    },
  });
  const button = el(
    "button.clip",
    {
      type: "button",
      "aria-label": "Attach a file or photo",
      "data-action": "attach.put",
      onclick: () => input.click(),
    },
    icon(GLYPHS.clip, 22),
  );
  const chips = el("div.chips", {
    onscroll: () => fadeStart(),
  });
  const lines = el("div.chiplines");
  let off = false;
  let newest = false; // a pick just happened: the row scrolls to the newest chip

  function fadeStart() {
    const cls = `chips${chips.scrollLeft > 0 ? " end" : ""}`;
    if (chips.className !== cls) chips.className = cls;
  }

  function chip(f) {
    const words = {
      uploading: `${Math.round(f.sent * 100)}%`,
      done: sizeWords(f.size),
      failed: "Not sent",
      refused: f.tooBig ? "Too big" : "Can't send",
    }[f.phase];
    const [a, z] = nameParts(f.name);
    const bad = f.phase === "failed" || f.phase === "refused";
    const c = el(
      `div.chip${bad ? ".bad" : ""}`,
      f.thumb
        ? el("img.th.pic", { src: f.thumb, alt: "" })
        : el("span.th.doc", icon(GLYPHS.doc, 20)),
      el(
        "span.nm",
        el("b", el("span.a", a), el("span.z", z)),
        el("small", words),
      ),
      el(
        "button.rm",
        {
          type: "button",
          "aria-label": `Remove ${f.name}`,
          "data-action": "attach.drop",
          onclick: () => remove(s, f),
        },
        icon(GLYPHS.x, 16),
      ),
    );
    if (f.phase === "uploading") {
      // The bar's look comes from page.css (.chip .bar); only how much went, 0 to 1, is set here.
      const bar = el("i.bar");
      bar.style.setProperty("--sent", f.sent.toFixed(2));
      c.append(bar);
    }
    return c;
  }

  function draw() {
    button.hidden = off || !ctx.offered("attach.put");
    chips.hidden = !s.files.length;
    chips.replaceChildren(...s.files.map(chip));
    if (newest) {
      newest = false;
      chips.scrollLeft = chips.scrollWidth;
    }
    fadeStart();
    const going = s.files.filter((f) => f.phase === "uploading").length;
    const out = [];
    if (going)
      out.push(
        el(
          "p.chipline.wait",
          going === 1
            ? "Uploading 1 file… Send waits for it."
            : `Uploading ${going} files… Send waits for them.`,
        ),
      );
    for (const f of s.files)
      if (f.line)
        out.push(
          el(
            "div.chipline",
            el("span", f.line),
            f.retry
              ? el(
                  "button.retry",
                  {
                    type: "button",
                    "aria-label": `Retry ${f.name}`,
                    onclick: () => upload(s, f),
                  },
                  "Retry",
                )
              : null,
          ),
        );
    if (s.notice) out.push(el("div.chipline", el("span", s.notice)));
    lines.hidden = !out.length;
    lines.replaceChildren(...out);
  }

  // The newest view is the one on screen: a new channel session's view takes over the files.
  s.view = { ctx, target, changed, draw };
  s.pickNow = () => {
    newest = true;
  };
  draw();

  return {
    button,
    input, // the hidden picker, anywhere in the box
    chips,
    lines,
    // Off on a card's "Type instead" box, which sends words only.
    update(isOff) {
      off = isOff;
      draw();
    },
    has: () => s.files.length > 0,
    // Send waits while a file uploads, and stays off while one failed or was refused.
    waits: () => s.files.some((f) => f.phase !== "done"),
    ids: () => s.files.map((f) => f.id),
    // After a send: the files went with the message (the PC used their ids).
    clear() {
      for (const f of s.files) if (f.thumb) URL.revokeObjectURL(f.thumb);
      s.files = [];
      s.notice = null;
      draw();
    },
    // The PC refused the send with attachment-unknown: each file goes up again with Retry.
    lost() {
      for (const f of s.files) {
        f.id = null;
        f.phase = "failed";
        f.retry = true;
        f.line = `${f.name} did not reach the PC: ${SAY["attachment-unknown"]}. Retry, or remove it to send.`;
      }
      draw();
    },
  };
}

function pick(s, picked) {
  s.notice = null;
  for (const file of picked) {
    if (s.files.length >= MAX_FILES) {
      s.notice = "8 files at most in one message.";
      break;
    }
    const f = {
      file,
      name: file.name || "file",
      size: file.size,
      kind: kindOf(file),
      phase: "uploading",
      sent: 0,
      id: null,
      line: null,
      retry: false,
      tooBig: false,
      thumb: null,
      run: 0,
      removed: false,
    };
    s.files.push(f);
    begin(s, f);
  }
  s.pickNow?.();
  redraw(s);
}

// Checks a new file's kind and size, turns a HEIC photo into JPEG, then sends it.
async function begin(s, f) {
  if (f.kind === "heic") {
    try {
      f.file = await toJpeg(f.file);
    } catch (e) {
      return refuse(
        s,
        f,
        `${f.name}: this photo could not be turned into JPEG (${e.message}). Remove it to send.`,
      );
    }
    f.kind = "picture";
    f.name = f.file.name;
    f.size = f.file.size;
  }
  // No type, or the browser's word for "unknown": its first bytes decide. A named type (a zip, a video) does not.
  if (
    !f.kind &&
    UNTYPED.has(f.file.type) &&
    f.size <= CAP.text &&
    (await looksLikeText(f.file))
  )
    f.kind = "text";
  if (!f.kind) {
    const x = ext(f.name);
    return refuse(
      s,
      f,
      `${f.name}: ${x ? `a .${x}` : "a file of this kind"} can't be sent. Pictures, PDFs and text files can. Remove it to send.`,
    );
  }
  if (f.size > CAP[f.kind]) {
    f.tooBig = true;
    return refuse(
      s,
      f,
      `${f.name} is ${sizeWords(f.size)}. The limit is ${sizeWords(CAP[f.kind])}. Remove it to send.`,
    );
  }
  const all = s.files
    .filter((o) => o.phase !== "refused")
    .reduce((n, o) => n + o.size, 0);
  if (all > MAX_ALL) {
    f.tooBig = true;
    return refuse(
      s,
      f,
      `${f.name} would take this message over 25 MB. Remove it to send.`,
    );
  }
  if (f.kind === "picture") f.thumb = URL.createObjectURL(f.file);
  upload(s, f);
}

function refuse(s, f, line) {
  f.phase = "refused";
  f.line = line;
  f.retry = false;
  redraw(s);
}

// The first SNIFF_BYTES decode as UTF-8 (a character cut at the end is allowed) and hold no NUL byte.
async function looksLikeText(file) {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  if (head.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

// The photo's size in pixels, made smaller with its shape kept when it is over MAX_PIXELS.
export function jpegSize(width, height) {
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

async function toJpeg(file) {
  const pic = await createImageBitmap(file);
  const { width, height } = jpegSize(pic.width, pic.height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d");
  if (!g) {
    pic.close();
    throw new Error(`no ${width}×${height} canvas on this phone`);
  }
  g.drawImage(pic, 0, 0, width, height);
  pic.close();
  const blob = await new Promise((ok, no) =>
    c.toBlob(
      (b) => (b ? ok(b) : no(new Error("no JPEG made"))),
      "image/jpeg",
      0.9,
    ),
  );
  return new File([blob], file.name.replace(HEIC, ".jpg"), {
    type: "image/jpeg",
  });
}

// Sends one file and keeps its id; Retry runs it once more. The channel's stream line keeps at most 2 streams
// going at once; the others wait their turn there, the chip still "uploading".
async function upload(s, f) {
  const run = ++f.run;
  f.phase = "uploading";
  f.sent = 0;
  f.line = null;
  f.retry = false;
  redraw(s);
  let r;
  try {
    const bytes = new Uint8Array(await f.file.arrayBuffer());
    if (f.removed || run !== f.run) return;
    const { ctx, target } = s.view;
    r = await ctx.sendStream(bytes, f.file.type || "text/plain", (part) => {
      if (run !== f.run || f.removed) return;
      f.sent = part;
      redraw(s);
    });
    if (r?.ok)
      r = await ctx.ask("attach.put", {
        stream: r.d.stream,
        ...target(),
        name: f.name,
      });
  } catch (e) {
    r = e;
  }
  if (run !== f.run) return;
  if (f.removed) {
    // Removed while it went up: the PC's copy goes too.
    if (r?.ok) drop(s, r.d.id);
    return;
  }
  if (r?.ok) {
    f.phase = "done";
    f.id = r.d.id;
  } else failed(f, r);
  redraw(s);
}

// A failed upload: the chip stays with "Not sent" (or what the PC refused) and its line says why.
function failed(f, r) {
  const w = r?.err ?? r?.code ?? "no answer";
  f.phase = "failed";
  f.retry = true;
  if (w === "too-big" || w === "kind-not-allowed") {
    f.phase = "refused";
    f.retry = false;
    f.tooBig = w === "too-big";
    f.line =
      w === "too-big"
        ? `${f.name} is ${sizeWords(f.size)}. The PC's limit for it is lower. Remove it to send.`
        : `${f.name}: the PC found it is not a picture, PDF or text file. Remove it to send.`;
  } else if (w === "disk-full")
    f.line = `${f.name}: the PC has no room for files now. Send without it, or try later.`;
  else if (w === "too-many")
    f.line = `${f.name}: the PC already holds 8 files or 25 MB not yet sent. Remove one, then Retry.`;
  else {
    const told =
      r instanceof Error ? (r.code ? r.extra?.message : r.message) : r?.message;
    f.line = `${f.name} did not reach the PC: ${told ?? SAY[w] ?? `the PC answered "${w}"`}. Retry, or remove it to send.`;
  }
}

function remove(s, f) {
  f.removed = true;
  s.files = s.files.filter((o) => o !== f);
  s.notice = null;
  if (f.thumb) URL.revokeObjectURL(f.thumb);
  if (f.id) drop(s, f.id);
  redraw(s);
}

// The PC deletes an unused file after 24 hours anyway, so a drop that fails is not shown.
function drop(s, id) {
  Promise.resolve(s.view.ctx.ask("attach.drop", { id })).catch(() => {});
}
