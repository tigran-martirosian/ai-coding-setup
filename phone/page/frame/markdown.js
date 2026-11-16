// Markdown to elements for the conversation (DS2, "Conversation"). Built with el() and text nodes only, so text
// from a session never becomes markup: raw HTML in a reply shows as the text it is. Covers what replies use:
// headings, paragraphs, lists (nested by indent), block quotes, fenced code, tables and rules; inline code, bold,
// italic, strikethrough and links. A web link opens only for http and https. A link with no URL scheme is a file
// link (files design, "File link in an answer"): when `files.links` (the PC's links of this text) has its target,
// it draws as a link and a tap calls files.open(link); any other link stays plain text.
import { el } from "./dom.js";

// The file links of the text being drawn: { links, open } while markdown() runs, else null.
let files = null;

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_LINE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const isTableStart = (lines, i) =>
  lines[i].includes("|") &&
  i + 1 < lines.length &&
  TABLE_LINE.test(lines[i + 1]) &&
  lines[i + 1].includes("-");

const startsBlock = (lines, i) =>
  FENCE.test(lines[i]) ||
  HEADING.test(lines[i]) ||
  RULE.test(lines[i]) ||
  QUOTE.test(lines[i]) ||
  ITEM.test(lines[i]) ||
  isTableStart(lines, i);

export function markdown(text, fileLinks = null) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  files = fileLinks;
  try {
    return el("div.md", blocks(lines));
  } finally {
    files = null;
  }
}

function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(FENCE);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) {
        body.push(lines[i]);
        i++;
      }
      i++;
      out.push(el("pre.md-pre", el("code", body.join("\n"))));
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      out.push(el(h[1].length <= 2 ? "h3.md-h" : "h4.md-h", inline(h[2])));
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push(el("hr.md-hr"));
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && QUOTE.test(lines[i]))
        inner.push(lines[i++].replace(QUOTE, ""));
      out.push(el("blockquote.md-quote", blocks(inner)));
      continue;
    }
    if (ITEM.test(line)) {
      const [list, next] = listAt(lines, i);
      out.push(list);
      i = next;
      continue;
    }
    if (isTableStart(lines, i)) {
      const rows = [lines[i]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim())
        rows.push(lines[i++]);
      out.push(table(rows));
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i))
      para.push(lines[i++].trim());
    out.push(el("p", inline(para.join(" "))));
  }
  return out;
}

// One list from line i: items at its indent, deeper lines belong to the item above them.
function listAt(lines, i) {
  const first = lines[i].match(ITEM);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  while (i < lines.length) {
    const m = lines[i].match(ITEM);
    if (!m || m[1].length > indent + 1 || /\d/.test(m[2]) !== ordered) break;
    if (m[1].length < indent) break;
    const rest = [];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        const next = lines[i + 1];
        if (next && /^\s+/.test(next) && next.search(/\S/) > indent) {
          rest.push("");
          i++;
          continue;
        }
        break;
      }
      const lead = l.search(/\S/);
      const sub = l.match(ITEM);
      if (lead > indent + 1 || (!sub && lead > indent)) rest.push(l);
      else if (!sub && !startsBlock(lines, i)) rest.push(l);
      else break;
      i++;
    }
    const cut = Math.min(
      ...rest.filter((r) => r.trim()).map((r) => r.search(/\S/)),
    );
    const deeper = rest.map((r) => r.slice(Number.isFinite(cut) ? cut : 0));
    items.push(
      el(
        "li",
        inline(m[3]),
        deeper.some((r) => r.trim()) ? blocks(deeper) : null,
      ),
    );
  }
  const start = ordered ? Number.parseInt(first[2], 10) : 1;
  return [
    el(
      ordered ? "ol.md-list" : "ul.md-list",
      start !== 1 ? { start } : {},
      items,
    ),
    i,
  ];
}

const cells = (row) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

function table(rows) {
  const [head, ...body] = rows.map(cells);
  return el(
    "div.md-table",
    el(
      "table",
      el(
        "thead",
        el(
          "tr",
          head.map((c) => el("th", inline(c))),
        ),
      ),
      el(
        "tbody",
        body.map((r) =>
          el(
            "tr",
            r.map((c) => el("td", inline(c))),
          ),
        ),
      ),
    ),
  );
}

// Inline marks, leftmost first; the text between them stays text.
const INLINE =
  /`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*([^*\s](?:[^*]*?[^*\s])?)\*|(?<![\w])_([^_\s](?:[^_]*?[^_\s])?)_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/;

export function inline(text) {
  const out = [];
  let rest = text;
  for (;;) {
    const m = rest.match(INLINE);
    if (!m) break;
    if (m.index) out.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
    if (m[1] !== undefined) out.push(el("code.md-code", m[1]));
    else if (m[2] !== undefined || m[3] !== undefined)
      out.push(el("strong", inline(m[2] ?? m[3])));
    else if (m[4] !== undefined) out.push(el("s", inline(m[4])));
    else if (m[5] !== undefined || m[6] !== undefined)
      out.push(el("em", inline(m[5] ?? m[6])));
    else if (m[7] !== undefined) out.push(link(m[8], inline(m[7])));
    else out.push(link(m[9], m[9]));
  }
  if (rest) out.push(rest);
  return out;
}

// A scheme has two letters or more, so a drive letter ("C:/x.md") is a path, not a scheme.
const SCHEME = /^[a-z][a-z0-9+.-]+:/i;

function link(href, kids) {
  if (!SCHEME.test(href)) {
    const file = files?.links?.find((l) => l.target === href);
    if (!file) return el("span", kids);
    const open = files.open;
    return el(
      "button.md-a.md-file",
      { type: "button", onclick: () => open(file) },
      kids,
    );
  }
  if (!/^https?:\/\//i.test(href)) return el("span", kids);
  return el(
    "a.md-a",
    { href, target: "_blank", rel: "noopener noreferrer" },
    kids,
  );
}
