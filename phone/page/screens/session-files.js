// File previews and diffs in a session (files design, "Sheets" and "States"). A tap on a work row opens its sheet:
// a command's output, an edit's diff, or the file a step read. A file link in an answer opens the file: Markdown
// rendered, code and text plain with line numbers, pictures as pictures. The changed-files line under a finished
// answer lists its files, and a file opens its diff for that answer. Everything comes from the PC's step.detail,
// session.changes and file.open: the phone sends only the PC's handles and step ids, never a path. Sheets stack:
// one opened from a sheet has Back, and Telegram's BackButton closes the top sheet first. Used by session.js and
// session-live.js; no code highlighting, no video, diffs only from the session's own edits.
import { el, icon } from "../frame/dom.js";
import { markdown } from "../frame/markdown.js";
import { setBackButton } from "../frame/telegram.js";
import { hhmm } from "./home.js";

const MB = 1024 * 1024;
const PIECE_LINES = 400; // the most lines one file.open asks (files design, "file.open")
const READ_MARK = 392; // a Read of more lines shows its first 392 marked
const EDITS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const MARKDOWN = /\.(md|markdown)$/i;
const PICTURE = /\.(png|jpe?g|gif|webp)$/i;

const GLYPHS = {
  x: ["M6 6l12 12M18 6L6 18"],
  back: ["M15 6l-6 6 6 6"],
  chev: ["M9 6l6 6-6 6"],
  edit: ["M4 20h4L19 9l-4-4L4 16z"],
  lock: ["M7 11V8a5 5 0 0 1 10 0v3", "M5 11h14v10H5z"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v4h4"],
  picture: ["M4 5h16v14H4z", "M4 16l5-5 4 4 3-3 4 4"],
  off: ["M4 6h16v10H4z", "M9 20h6", "M12 16v4"],
};

// replaceChildren writes an empty slot as the text "null": the empty slots are left out first.
const fill = (node, ...kids) =>
  node.replaceChildren(
    ...kids.flat().filter((k) => k !== null && k !== undefined && k !== false),
  );

// True when one of a turn's steps changed a file (so its answer may have a changed-files line).
export const changesFiles = (steps) =>
  Boolean(steps?.some((s) => EDITS.has(s.tool)));

// "840 B", "12 KB", "4.2 MB"
export function size(n) {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${Math.round(n / 1024)} KB`;
  return `${Math.round((n / MB) * 10) / 10} MB`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const base = (p) => String(p).split(/[\\/]/).pop();
// The shown folder of a shown path, ending in "/": "phone/page/" for "phone/page/page.css"; none for a bare name.
const folderOf = (p) => {
  const i = String(p).search(/[\\/][^\\/]*$/);
  return i < 0 ? "" : `${p.slice(0, i)}/`;
};
const meta = (...parts) => parts.filter(Boolean).join(" · ");
// "changed today 14:02", or the day before the time when it was not today
function changed(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()))
    throw new Error(`file.open answered a bad time "${iso}"`);
  const today = d.toDateString() === new Date().toDateString();
  const day = today
    ? "today"
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `changed ${day} ${hhmm(iso)}`;
}
// "+18 −4", each part in its tone with its sign
const counts = (add, del) => [
  el("span.xadd", `+${add ?? 0}`),
  " ",
  el("span.xdel", `−${del ?? 0}`),
];
// The bytes of base64 pieces as text (UTF-8; a piece may end inside a character, so the pieces are joined first).
function textOf(pieces) {
  const bin = atob(pieces.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// The refusal rules of the PC's file rule, in the phone's words (files design, "File rule").
const SECRET_PARTS = [
  ".git",
  ".ssh",
  ".gnupg",
  ".telegram-control",
  ".phone-app",
];
function refusedWords(rule, where, project) {
  const parts = String(where ?? "").split(/[\\/]/);
  const folder = parts.find((p) => SECRET_PARTS.includes(p)) ?? ".phone-app";
  switch (rule) {
    case "path form":
      return "This link is not a plain file path, so the phone does not open it.";
    case "outside the session's folders":
      return `Only files in this session's project folder, ${project}, open on the phone. This one is outside it.`;
    case "secret folder":
    case "app folder":
      return `Files inside a ${folder} folder never open on the phone.`;
    case "secret file name":
      return `Files named like a key or a secret never open on the phone. This file is “${base(where)}”.`;
    case "folder too wide":
      return "This project's folder is your whole home folder, so the phone opens no files from it.";
    case "not a file":
      return "This is a folder, not a file.";
    default:
      return `The PC refused it by its rule "${rule}".`;
  }
}

// v: the session view (ctx, params, why, projectName()). Returns the sheets' box (in the session view), and the
// openers the rows and links call.
export function filesPart(v) {
  const box = el("div.files-part");
  const stack = []; // the open sheets, the top one last
  let before = null; // Telegram's back handler before the first sheet opened
  const ask = (a, d) => v.ctx.ask(a, d).catch((e) => e);
  const session = () => v.params.session;

  // ---- the sheet stack
  // A sheet: { name, meta, body, short, whole (opens the whole file, or null), closed }.
  function sheet(name, metaLine) {
    return {
      name,
      meta: metaLine,
      body: el("div.xbody"),
      short: false,
      whole: null,
      closed: false,
    };
  }
  function push(s) {
    if (!stack.length) {
      before = setBackButton.handler ?? null;
      setBackButton(v.ctx.tg, back);
    }
    stack.push(s);
    draw();
    return s;
  }
  function back() {
    const s = stack.pop();
    if (s) s.closed = true;
    if (!stack.length) setBackButton(v.ctx.tg, before);
    draw();
  }
  function closeAll() {
    while (stack.length) back();
  }
  function draw() {
    const s = stack[stack.length - 1];
    if (!s) return fill(box);
    const deep = stack.length > 1;
    fill(
      box,
      el(
        "div.xwrap",
        { role: "dialog", "aria-modal": "true" },
        el("div.xshade", { onclick: closeAll }),
        el(
          `div.xsheet${s.short ? ".short" : ""}`,
          el(
            "div.xhead",
            el(
              "button.sb",
              {
                type: "button",
                "aria-label": deep ? "Back" : "Close",
                "data-action": deep ? "files.back" : "files.close",
                onclick: back,
              },
              icon(deep ? GLYPHS.back : GLYPHS.x, 20),
            ),
            el(
              "div.xtitle",
              el("div.xname", s.name),
              s.meta ? el("div.xmeta", s.meta) : null,
            ),
            s.whole
              ? el(
                  "button.sb",
                  {
                    type: "button",
                    "data-action": "files.whole",
                    onclick: s.whole,
                  },
                  "Whole file",
                )
              : null,
          ),
          s.body,
        ),
      ),
    );
  }
  // A sheet's head changed (its name, meta line or Whole file button).
  const redraw = (s) => {
    if (stack[stack.length - 1] === s) draw();
  };

  // ---- states (files design, "States")
  function state(s, { glyph, title, say, soft, button }) {
    s.short = true;
    fill(
      s.body,
      el(
        "div.xstate",
        glyph ? icon(GLYPHS[glyph], 28) : null,
        el("div.xst", title),
        say ? el("p.xsay", say) : null,
        soft ? el("p.xsoft", soft) : null,
        button
          ? el(
              "button.btn.xtry",
              { type: "button", onclick: button.run },
              button.word,
            )
          : null,
      ),
    );
    redraw(s);
  }
  function loading(s, got = null, of = null) {
    s.short = false;
    fill(
      s.body,
      el("div.xbar", { "aria-hidden": "true" }),
      el(
        "p.xgetting",
        got === null
          ? "Getting it from the PC"
          : `Getting it from the PC · ${size(got)} of ${size(of)}`,
      ),
      ...[78, 92, 64, 85].map((w) => el("div.xgrey", { style: `width:${w}%` })),
    );
    redraw(s);
  }
  function refused(s, rule, where) {
    state(s, {
      glyph: "lock",
      title: "Not shown on the phone",
      say: refusedWords(rule, where, v.projectName()),
      soft: "To see it, open it on the PC.",
    });
  }
  // A failed ask: its own state when the design names one, else what went wrong and Try again.
  function failed(s, r, again, where) {
    const code = r?.err ?? r?.code;
    if (code === "file-refused") {
      const rule = r.extra?.rule ?? r.rule;
      if (!rule)
        throw new Error("the PC refused a file without naming its rule");
      return refused(s, rule, where);
    }
    if (code === "file-gone")
      return state(s, {
        glyph: "file",
        title: "No longer on the PC",
        say: "This file was moved or deleted after the step.",
        soft: "The step's own changes still open from its row.",
      });
    if (code === "stale-handle")
      return state(s, {
        glyph: "file",
        title: "This link has expired",
        say: "Close and open the session again.",
      });
    if (code === "transcript-gone")
      return state(s, {
        glyph: "file",
        title: "This session's history is no longer on the PC",
      });
    const retry = { word: "Try again", run: again };
    if (!v.ctx.connected || code === "not-connected" || code === "pc-offline")
      return state(s, {
        glyph: "off",
        title: "The PC is not answering",
        say: "Files come from the PC. It is off or asleep.",
        button: retry,
      });
    state(s, {
      glyph: "off",
      title:
        code === "timeout"
          ? "The PC did not answer in 10 s"
          : "The PC did not send it",
      say: `It answered: ${v.why(r)}.`,
      button: retry,
    });
  }

  // ---- diff (an Edit or Write step, or one file of an answer)
  // One line: its number (the new file's for added and context lines, the old file's for removed lines), its sign
  // and its text. A wrapped row goes on at the line's own indent (--i: the leading spaces).
  function line(kind, n, sign, text) {
    const t = text.replace(/\t/g, "  ");
    const lead = t.length - t.trimStart().length;
    return el(
      `div.xl.${kind}`,
      el("span.xn", n === null ? "" : String(n)),
      el("span.xs", sign),
      el("span.xt", lead ? { style: `--i:${lead}` } : {}, t),
    );
  }
  function hunksOf(d) {
    const rows = [];
    let changedShown = 0;
    for (const h of d.hunks) {
      const last = h.newStart + h.lines.filter((l) => l[0] !== "-").length - 1;
      rows.push(
        el(
          "div.xhunk",
          last > h.newStart
            ? `Lines ${h.newStart}–${last}`
            : `Line ${h.newStart}`,
        ),
      );
      let o = h.oldStart;
      let n = h.newStart;
      for (const l of h.lines) {
        const text = l.slice(1);
        if (l[0] === "+") {
          rows.push(line("add", n++, "+", text));
          changedShown++;
        } else if (l[0] === "-") {
          rows.push(line("del", o++, "−", text));
          changedShown++;
        } else {
          rows.push(line("ctx", n++, " ", text));
          o++;
        }
      }
    }
    if (d.cut) {
      const more = (d.add ?? 0) + (d.del ?? 0) - changedShown;
      rows.push(
        el(
          "p.xlast",
          more > 0
            ? `${more.toLocaleString("en-US")} more lines · on the PC`
            : "More lines · on the PC",
        ),
      );
    }
    return el("div.xdiff", rows);
  }
  function showDiff(s, d, verb, renew) {
    s.name = d.name;
    s.meta = meta(
      folderOf(d.path),
      verb,
      d.created ? "New file" : null,
      d.refused ? null : `+${d.add ?? 0} −${d.del ?? 0}`,
    );
    // A secret-named file: the counts only.
    if (d.refused)
      return state(s, {
        glyph: "lock",
        title: "Changes not shown",
        say: `+${d.add ?? 0} −${d.del ?? 0} in ${d.name}. ${refusedWords(d.refused, d.path ?? d.name, v.projectName())}`,
      });
    s.short = false;
    s.whole = d.file
      ? () => openFile({ file: d.file, name: d.name, path: d.path, renew })
      : null;
    fill(s.body, hunksOf(d));
    redraw(s);
  }

  // ---- output (a command or another tool)
  function showOutput(s, d) {
    if (d.hidden)
      return state(s, {
        glyph: "lock",
        title: "Output hidden",
        say: `It names a secret file (${d.hidden}).`,
        soft: d.command ?? null,
      });
    s.short = false;
    const cmd = d.command ? el("pre.xcmd.fold", d.command) : null;
    const many = Boolean(d.command && d.command.split("\n").length > 6);
    fill(
      s.body,
      cmd,
      many
        ? el(
            "button.btn-quiet.xall",
            {
              type: "button",
              onclick: (e) => {
                cmd.className = "xcmd";
                e.target.hidden = true;
              },
            },
            "Show all",
          )
        : null,
      d.interrupted ? el("p.xbad", "Interrupted") : null,
      d.background
        ? el("p.xsoft", "Runs in the background; its output is on the PC.")
        : null,
      d.cut
        ? el("p.xlast", `Earlier output left out · ${size(d.bytes)} in all`)
        : null,
      el("pre.xout", d.out ?? ""),
    );
    redraw(s);
    requestAnimationFrame(() => {
      s.body.scrollTop = s.body.scrollHeight;
    });
  }

  // ---- file preview by the PC's handle
  // f: { file (handle), name, path, renew (optional: asks the handle's source again for a fresh handle) }; how:
  // { line (the first line to show), count, mark: [from, to] (the lines a Read step read, or a link's line), readAt
  // (that step's time) }.
  // A stale handle asks its source again once (files design, "Errors"); a second one shows "expired".
  async function renewed(s, f, r) {
    if ((r?.err ?? r?.code) !== "stale-handle" || !f.renew || f.renewed)
      return false;
    f.renewed = true;
    const h = await f.renew();
    if (s.closed || !h) return false;
    f.file = h;
    return true;
  }
  const fileSheet = (f) =>
    sheet(f.name ?? base(f.path ?? ""), folderOf(f.path ?? ""));
  function openFile(f, how = {}) {
    const s = push(fileSheet(f));
    showFile(s, f, how);
  }
  function showFile(s, f, how) {
    const name = f.name ?? f.path ?? "";
    if (MARKDOWN.test(name) || PICTURE.test(name)) return byPieces(s, f);
    return byLines(s, f, how);
  }
  const lastLine = (head) =>
    head.size > MB
      ? `Showing the first 1 MB of ${size(head.size)} · the rest is on the PC`
      : `${size(head.size)} · ${changed(head.modified)}`;
  const notText = (s, head) =>
    state(s, {
      glyph: "file",
      title: "This kind of file opens on the PC",
      say: `${head.name} · ${size(head.size)}`,
    });
  // Markdown and pictures: pieces from offset 0, one ask after the other while the sheet is open.
  async function byPieces(s, f) {
    loading(s);
    const pieces = [];
    let links = [];
    let offset = 0;
    let head = null;
    for (;;) {
      const r = await ask("file.open", {
        session: session(),
        file: f.file,
        offset,
      });
      if (s.closed) return;
      if (!r?.ok)
        return (await renewed(s, f, r))
          ? byPieces(s, f)
          : failed(s, r, () => byPieces(s, f), f.path);
      head = r.d;
      if (head.kind === "binary") return notText(s, head);
      if (head.kind === "text")
        return byLines(s, { ...f, name: head.name }, {});
      if (head.tooBig)
        return state(s, {
          glyph: "picture",
          title: "Too big for the phone",
          say: `This picture is ${size(head.size)}. The phone can show pictures up to 8 MB.`,
          soft: "To see it, open it on the PC.",
        });
      if (head.links) links = head.links;
      pieces.push(head.bytes);
      if (head.next === null) break;
      offset = head.next;
      const whole =
        head.kind === "picture" ? head.size : Math.min(head.size, MB);
      loading(s, offset, whole);
    }
    s.name = head.name;
    s.short = false;
    if (head.kind === "picture") return showPicture(s, head, pieces);
    s.meta = meta(folderOf(head.path), "Markdown");
    fill(
      s.body,
      el(
        "div.xmd",
        markdown(textOf(pieces), {
          links,
          open: (link) => openLink(link, () => linkAgain(f, link)),
        }),
      ),
      el("p.xlast", lastLine(head)),
    );
    redraw(s);
  }
  function showPicture(s, head, pieces) {
    s.meta = meta(folderOf(head.path), "Picture");
    const words = `${size(head.size)} · ${changed(head.modified)}`;
    const last = el("p.xlast", words);
    const img = el("img.xpic", {
      alt: head.name,
      src: `data:${head.mime};base64,${pieces.join("")}`,
    });
    img.onload = () =>
      fill(last, `${img.naturalWidth} x ${img.naturalHeight} · ${words}`);
    fill(s.body, el("div.xpicbox", img), last);
    redraw(s);
  }
  // Code and plain text: numbered lines, asked by line; the bands above and below ask the lines not here yet.
  async function byLines(s, f, how) {
    loading(s);
    const count = how.count ?? PIECE_LINES;
    const r = await ask("file.open", {
      session: session(),
      file: f.file,
      line: Math.max(1, how.line ?? 1),
      count,
    });
    if (s.closed) return;
    if (!r?.ok)
      return (await renewed(s, f, r))
        ? byLines(s, f, how)
        : failed(s, r, () => byLines(s, f, how), f.path);
    const d = r.d;
    if (d.kind === "binary") return notText(s, d);
    if (d.kind === "picture" || d.kind === "markdown")
      return byPieces(s, { ...f, name: d.name });
    if (how.mark && d.lineCount === 0 && d.lines === null)
      return state(s, {
        glyph: "file",
        title: "Not shown on the phone",
        say: "These lines are past the first 1 MB, so the phone does not show them.",
        soft: "To see them, open the file on the PC.",
      });
    s.name = d.name;
    s.meta = how.readAt
      ? meta(
          folderOf(d.path),
          `Read lines ${how.mark[0]}–${how.mark[1]}${d.lines === null ? "" : ` of ${d.lines}`}`,
        )
      : folderOf(d.path);
    s.short = false;
    const tail = how.readAt
      ? `Current version, not the one read at ${hhmm(how.readAt)} · ${size(d.size)}`
      : lastLine(d);
    const text = { from: d.firstLine, rows: splitLines(d), total: d.lines };
    drawLines(s, f, text, how.mark ?? null, tail, count);
  }
  const splitLines = (d) =>
    textOf([d.bytes]).replace(/\r\n?/g, "\n").split("\n").slice(0, d.lineCount);
  function drawLines(s, f, text, mark, tail, asked) {
    const end = text.from + text.rows.length - 1;
    // Lines left below: unknown (null) past the 1 MB count when the piece was full.
    const left =
      text.total === null
        ? text.rows.length >= asked
          ? null
          : 0
        : Math.max(0, text.total - end);
    const more = async (line, count, put) => {
      const r = await ask("file.open", {
        session: session(),
        file: f.file,
        line,
        count,
      });
      if (s.closed) return;
      if (!r?.ok) return failed(s, r, () => more(line, count, put), f.path);
      put(splitLines(r.d));
      drawLines(s, f, text, mark, tail, count);
    };
    const band = (words, run) =>
      el("button.xband", { type: "button", onclick: run }, words);
    fill(
      s.body,
      text.from > 1
        ? band(`${plural(text.from - 1, "line")} above`, () => {
            const from = Math.max(1, text.from - PIECE_LINES);
            more(from, text.from - from, (rows) => {
              text.rows = [...rows, ...text.rows];
              text.from = from;
            });
          })
        : null,
      el(
        "div.xcode",
        text.rows.map((t, i) => {
          const n = text.from + i;
          const marked = mark && n >= mark[0] && n <= mark[1];
          return line(marked ? "ctx.read" : "ctx", n, "", t);
        }),
      ),
      left !== 0
        ? band(
            left === null
              ? "More lines below"
              : `${plural(left, "line")} below`,
            () =>
              more(end + 1, PIECE_LINES, (rows) => {
                text.rows = [...text.rows, ...rows];
              }),
          )
        : null,
      el("p.xlast", tail),
    );
    redraw(s);
  }

  // ---- the openers
  // A step of a turn or a live row: { id, tool, label, at (its time, optional) }; `pos` is the byte offset of the
  // turn or row that holds the call.
  function openStep(step, pos) {
    const s = push(sheet(step.label || step.tool, step.tool));
    const detail = () =>
      ask("step.detail", { session: session(), step: step.id, at: pos });
    const renew = async () => {
      const r = await detail();
      return r?.ok ? (r.d.file ?? null) : null;
    };
    const get = async () => {
      loading(s);
      const r = await detail();
      if (s.closed) return;
      if (!r?.ok) return failed(s, r, get);
      const d = r.d;
      if (d.kind === "running")
        return state(s, {
          title: "Still running",
          say: "Its output is not on the PC yet. Open it again when the step ends.",
        });
      if (d.kind === "diff") return showDiff(s, d, step.tool, renew);
      if (d.kind === "output") return showOutput(s, d);
      if (d.kind !== "read")
        throw new Error(`step.detail answered an unknown kind "${d.kind}"`);
      s.name = d.name;
      s.meta = folderOf(d.path);
      if (!d.file) return refused(s, d.why, d.path);
      const from = d.startLine ?? 1;
      const n = Math.min(d.numLines ?? 1, READ_MARK);
      byLines(
        s,
        { ...d, renew },
        {
          line: from - 4,
          count: Math.min(PIECE_LINES, Math.max(20, n + 8)),
          mark: [from, from + n - 1],
          readAt: step.at ?? new Date().toISOString(),
        },
      );
    };
    get();
  }
  // A file link of an answer or of a Markdown file: { target, file, line, why }. renew asks the link's source
  // again: the session's turns for an answer's link, the Markdown file for a link inside it.
  function openLink(link, renew = () => answerLinkAgain(link)) {
    const where = link.target.replace(/[?#].*$/, "").replace(/:\d+$/, "");
    const f = { file: link.file, path: decodeURI(where), renew };
    const s = push(fileSheet(f));
    if (!link.file) return refused(s, link.why, f.path);
    showFile(
      s,
      f,
      link.line ? { line: link.line - 4, mark: [link.line, link.line] } : {},
    );
  }
  const sameLink = (links, link) =>
    (links ?? []).find((l) => l.target === link.target)?.file ?? null;
  async function answerLinkAgain(link) {
    const r = await ask("session.open", { session: session() });
    if (!r?.ok) return null;
    for (const t of r.d.items) {
      const h = sameLink(t.links, link);
      if (h) return h;
    }
    return null;
  }
  // The PC sends a Markdown file's links with its first piece.
  async function linkAgain(f, link) {
    const r = await ask("file.open", {
      session: session(),
      file: f.file,
      offset: 0,
    });
    return r?.ok ? sameLink(r.d.links, link) : null;
  }

  // ---- changed files of an answer
  // answer: { at (the pos of its last turn), from (the pos of its first turn) }. The line asks session.changes once
  // per answer (v.changes keeps the answers) and draws itself when the answer comes.
  function changesLine(answer) {
    const row = el("div.xchanged-box");
    v.changes ??= new Map();
    const draw = (r) => {
      if (!r?.ok)
        return fill(row, el("p.convo-note.bad", `Changed files: ${v.why(r)}`));
      const d = r.d;
      if (!d.files.length) return fill(row);
      fill(
        row,
        el(
          "div.wsteps",
          el(
            "button.wstep.xchanged",
            {
              type: "button",
              "data-action": "files.changes",
              onclick: () => openChanges(answer, d),
            },
            icon(GLYPHS.edit, 18),
            el(
              "span.obj",
              `${d.cut ? "At least " : ""}${plural(d.files.length, "file")} changed`,
            ),
            el("span.xcounts", counts(d.add, d.del)),
            icon(GLYPHS.chev, 16),
          ),
        ),
      );
    };
    const had = v.changes.get(answer.at);
    if (had) draw(had);
    else
      ask("session.changes", { session: session(), at: answer.at }).then(
        (r) => {
          if (r?.ok) v.changes.set(answer.at, r);
          draw(r);
        },
      );
    return row;
  }
  function openChanges(answer, d) {
    const s = push(sheet("Changed files", `This answer · +${d.add} −${d.del}`));
    s.short = true;
    const secret = d.files.filter((f) => f.refused);
    fill(
      s.body,
      el(
        "div.xfiles",
        d.files.map((f) => {
          const sub = meta(
            folderOf(f.path),
            f.refused ? null : plural(f.steps.length, "edit"),
            f.refused ? "not shown" : null,
          );
          const kids = [
            icon(f.refused ? GLYPHS.lock : GLYPHS.edit, 18),
            el("span.xfw", el("span.xfn", f.name), el("span.xfm", sub)),
            el("span.xcounts", counts(f.add, f.del)),
            f.refused ? el("span.xnoarrow") : icon(GLYPHS.chev, 16),
          ];
          if (f.refused) return el("div.xfile.locked", ...kids);
          return el(
            "button.xfile",
            {
              type: "button",
              "data-file": f.name,
              onclick: () => openEdits(answer, f),
            },
            ...kids,
          );
        }),
      ),
      secret.length
        ? el(
            "p.xsoft.xhint",
            `${secret.map((f) => f.name).join(", ")}: secret files such as .env, keys and tokens show only their counts.`,
          )
        : null,
    );
    redraw(s);
  }
  // One file's edits in this answer, stacked in order.
  async function openEdits(answer, f, again = null) {
    const s =
      again ??
      push(sheet(f.name, meta(folderOf(f.path), `+${f.add} −${f.del}`)));
    const renew = async () => {
      const r = await ask("session.changes", {
        session: session(),
        at: answer.at,
      });
      return r?.ok
        ? (r.d.files.find((x) => x.path === f.path)?.file ?? null)
        : null;
    };
    s.whole = f.file
      ? () => openFile({ file: f.file, name: f.name, path: f.path, renew })
      : null;
    loading(s);
    const parts = [];
    for (const [i, id] of f.steps.entries()) {
      const r = await ask("step.detail", {
        session: session(),
        step: id,
        at: answer.from,
      });
      if (s.closed) return;
      if (!r?.ok) return failed(s, r, () => openEdits(answer, f, s));
      if (r.d.kind !== "diff")
        throw new Error(`step.detail answered "${r.d.kind}" for an edit`);
      if (f.steps.length > 1)
        parts.push(el("div.xedit", `Edit ${i + 1} of ${f.steps.length}`));
      parts.push(hunksOf(r.d));
    }
    s.short = false;
    fill(s.body, parts);
    redraw(s);
  }

  return { box, openStep, openLink, changesLine };
}
