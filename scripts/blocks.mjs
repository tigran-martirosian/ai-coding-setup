// The carve's unit: a rules text cut into blocks (a heading, a list item with its indented and nested
// lines, a paragraph), each compared by a key of its whitespace-normal form. carve() sorts a person's
// CLAUDE.md into shipped text, old setup text (rules/history.json) and their own blocks; appendOwn() adds
// the own blocks to my-rules.md without touching what is already there.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HEADING = /^#{1,6}\s/;
const ITEM = /^([-*]|\d+\.)\s/;
const FENCE = /^\s*(```|~~~)/;

const headingName = (line) => line.replace(/^#+\s*/, "").trim();

// [{heading, text}] in file order; heading is the name of the nearest heading above (null before the
// first one), a heading block's own heading is itself. Blank lines end a block, except inside a fence.
export function splitBlocks(text) {
  const blocks = [];
  let heading = null;
  let cur = null; // {kind, lines}
  let fence = false;
  const close = () => {
    if (cur) blocks.push({ heading, text: cur.lines.join("\n") });
    cur = null;
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (fence) {
      cur.lines.push(line);
      if (FENCE.test(line)) fence = false;
      continue;
    }
    if (line.trim() === "") { close(); continue; }
    if (HEADING.test(line)) {
      close();
      heading = headingName(line);
      blocks.push({ heading, text: line });
      continue;
    }
    if (ITEM.test(line)) { close(); cur = { kind: "item", lines: [line] }; }
    else if (cur) cur.lines.push(line); // an indented line, a nested bullet or a re-wrapped line
    else cur = { kind: "para", lines: [line] };
    if (FENCE.test(line)) fence = true;
  }
  close();
  return blocks;
}

export function normal(text) {
  return text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).join(" ").replace(/\s+/g, " ").trim();
}

export function key(text) {
  return crypto.createHash("sha256").update(normal(text)).digest("hex").slice(0, 16);
}

// How a person names a block: its bold opening, else its first six words.
export function lead(text) {
  const t = normal(text).replace(/^(#+|[-*]|\d+\.)\s+/, "");
  const bold = t.match(/^\*\*(.+?)\*\*/);
  return bold ? bold[1].trim() : t.split(" ").slice(0, 6).join(" ");
}

// The reverse of repo.mjs fit(): the real projects folder back to <projects>. Off Windows also the folder
// separator back, so the text lines up with the history's non-Windows form (which went through this too).
export function unfit(text, projects, win) {
  let t = text.replaceAll(projects, "<projects>");
  if (!win) t = t.replaceAll("<projects>/", "<projects>\\");
  return t;
}

// Blocks of the person's text that are neither this version's shipped text nor old setup text. Headings
// are never own blocks: they only name the section an own block sat in. asShipped gives the form a block
// is keyed in (unfit() for an installed file), while an own block keeps the person's own text.
export function carve(personText, shippedKeys, historyKeys, asShipped = (t) => t) {
  const shipped = new Set(shippedKeys);
  const history = new Set(historyKeys);
  const own = [];
  let oldCount = 0;
  let shippedCount = 0;
  for (const b of splitBlocks(personText)) {
    const k = key(asShipped(b.text));
    if (shipped.has(k)) shippedCount++;
    else if (history.has(k)) oldCount++;
    else if (!HEADING.test(b.text)) own.push(b);
  }
  return { own, oldCount, shippedCount };
}

// my-rules.md with the own blocks appended under "## <heading>" in order; a block already there word for
// word is skipped. The existing text is kept byte for byte as the start of the result, and the new lines
// take its line endings (CRLF when it has them).
export function appendOwn(myRulesText, own) {
  const eol = myRulesText.includes("\r\n") ? "\r\n" : "\n";
  const lf = myRulesText.replace(/\r\n/g, "\n");
  return myRulesText + appendLf(lf, own).slice(lf.length).replace(/\n/g, eol);
}

function appendLf(myRulesText, own) {
  const have = new Set(splitBlocks(myRulesText).map((b) => key(b.text)));
  const existing = splitBlocks(myRulesText).filter((b) => HEADING.test(b.text));
  let section = existing.length ? existing[existing.length - 1].heading : undefined;
  let out = myRulesText;
  let lastItem = false; // the block just appended was a list item: the next one in its section joins the list
  for (const b of own) {
    const k = key(b.text);
    if (have.has(k)) continue;
    have.add(k);
    const name = b.heading ?? "My rules";
    const item = ITEM.test(b.text);
    if (out !== "" && !out.endsWith("\n")) out += "\n";
    if (out !== "" && !(lastItem && item && name === section)) out += "\n";
    if (name !== section) { out += `## ${name}\n\n`; section = name; }
    out += b.text.replace(/\r\n/g, "\n") + "\n";
    lastItem = item;
  }
  return out;
}

// rules/history.json: keys of every rules text the setup ever shipped ("shipped", rebuilt from git by
// scripts/rules-history.mjs --write) and of the friend patches' texts ("added", kept across --write).
export function historyKeys(REPO) {
  const file = path.join(REPO, "rules", "history.json");
  if (!fs.existsSync(file)) throw new Error(`no ${file}; run node scripts/rules-history.mjs --write`);
  const h = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(h.shipped) || !Array.isArray(h.added)) throw new Error(`${file} has no "shipped" and "added" lists`);
  return new Set([...h.shipped, ...h.added]);
}
