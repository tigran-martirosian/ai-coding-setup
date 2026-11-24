// Checks every Mermaid block of the given pages against the diagram rule: a diagram is only for branching or
// structure, with at most 8 boxes and labels of 1-3 words; a straight sequence is a list.
// Run: node scripts/diagram-rule.mjs <page.md...>
// Exits 1 when a block has more than 8 boxes (nodes), a box label of more than 3 words, or a straight chain of
// more than 3 boxes (boxes joined one after another, each with at most one arrow in and one arrow out), and when
// a block is not a flowchart (only flowcharts can be read here, so another kind can not be shown to meet the rule).
// Exits 0 when every block meets the rule, or the pages hold none; exits 2 on a wrong call.
import { readFileSync } from "node:fs";

const MAX_BOXES = 8;
const MAX_WORDS = 3;
const MAX_CHAIN = 3;

// The ```mermaid blocks of a Markdown text: { line (1-based, of the opening fence), code }.
function mermaidBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})\s*mermaid\s*$/.exec(lines[i]);
    if (!open) continue;
    const fence = open[1];
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[j]);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length)
        break;
      body.push(lines[j]);
    }
    blocks.push({ line: i + 1, code: body.join("\n") });
    i = j;
  }
  return blocks;
}

const CLOSER = { "[": "]", "(": ")", "{": "}", ">": "]" };
const SKIP =
  /^(subgraph|end|classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/;
// An arrow between boxes: plain (-->, ---, -.->, ==>, ~~~, with o/x heads and a < at the start), with |text|
// after it, or with the text inside (-- text -->).
const LINK_TEXT =
  /\s*<?(?:--|==|-\.)\s+[^|]*?\s+(?:-{2,}|={2,}|\.+-)[>ox]?\s*/y;
const LINK = /\s*<?(?:-{2,}|={2,}|-\.+-?|~~~)[>ox]?(?:\s*\|[^|]*\|)?\s*/y;

// One box reference at pos: id, an optional shape with its label, an optional :::class.
function readNode(s, pos) {
  const id = /[\p{L}\p{N}_]+/uy;
  id.lastIndex = pos;
  const m = id.exec(s);
  if (!m) return null;
  let at = pos + m[0].length;
  let label = null;
  const opener = /[[({>][[({/\\]*/y;
  opener.lastIndex = at;
  const o = opener.exec(s);
  if (o) {
    at += o[0].length;
    const close = CLOSER[o[0][0]];
    if (s[at] === '"') {
      const end = s.indexOf('"', at + 1);
      if (end < 0) throw new Error(`a quoted label is not closed: ${s}`);
      label = s.slice(at + 1, end);
      at = end + 1;
      while (at < s.length && /[\])}/\\]/.test(s[at])) at++;
    } else {
      const end = s.indexOf(close, at);
      if (end < 0) throw new Error(`a box label is not closed: ${s}`);
      label = s.slice(at, end).replace(/[\])}/\\]+$/, "");
      at = end + 1;
      while (at < s.length && /[\])}/\\]/.test(s[at])) at++;
    }
  }
  const cls = /:::[\w-]+/y;
  cls.lastIndex = at;
  const c = cls.exec(s);
  if (c) at += c[0].length;
  return { id: m[0], label, end: at };
}

// The boxes (id -> label) and arrows ([from, to]) of a flowchart; throws on another diagram kind.
function readFlowchart(code) {
  const statements = code
    .split(/\r?\n/)
    .map((l) => l.replace(/%%.*$/, "").trim())
    .filter(Boolean);
  const head = statements.shift() ?? "";
  if (!/^(flowchart|graph)\b/.test(head))
    throw new Error(
      `not a flowchart ("${head.split(/\s/)[0]}"): only flowcharts can be checked against the diagram rule`,
    );
  const nodes = new Map();
  const edges = [];
  const see = (n) => {
    if (!nodes.has(n.id) || (nodes.get(n.id) === null && n.label !== null))
      nodes.set(n.id, n.label);
  };
  for (const line of statements.flatMap((l) => l.split(";"))) {
    const s = line.trim();
    if (!s || SKIP.test(s)) continue;
    let pos = 0;
    let prev = null;
    while (pos < s.length) {
      const group = [];
      for (;;) {
        while (s[pos] === " ") pos++;
        const n = readNode(s, pos);
        if (!n) throw new Error(`can not read a box at "${s.slice(pos)}"`);
        see(n);
        group.push(n.id);
        pos = n.end;
        const amp = /\s*&\s*/y;
        amp.lastIndex = pos;
        if (!amp.exec(s)) break;
        pos = amp.lastIndex;
      }
      if (prev) for (const a of prev) for (const b of group) edges.push([a, b]);
      prev = group;
      if (pos >= s.length) break;
      let link = null;
      for (const re of [LINK_TEXT, LINK]) {
        re.lastIndex = pos;
        if (re.exec(s)) {
          link = re.lastIndex;
          break;
        }
      }
      if (link === null)
        throw new Error(`can not read an arrow at "${s.slice(pos)}"`);
      pos = link;
    }
  }
  return { nodes, edges };
}

// The words a person reads in a label: <br> and spaces split, punctuation alone is no word.
const labelWords = (label) =>
  label
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));

// The straight chains: boxes with at most one arrow in and one out, joined to each other; the longest first.
function straightChains({ nodes, edges }) {
  const ins = new Map([...nodes.keys()].map((k) => [k, 0]));
  const outs = new Map(ins);
  for (const [a, b] of edges) {
    outs.set(a, outs.get(a) + 1);
    ins.set(b, ins.get(b) + 1);
  }
  const simple = new Set(
    [...nodes.keys()].filter((k) => ins.get(k) <= 1 && outs.get(k) <= 1),
  );
  const next = new Map();
  const hasPrev = new Set();
  for (const [a, b] of edges)
    if (a !== b && simple.has(a) && simple.has(b)) {
      next.set(a, b);
      hasPrev.add(b);
    }
  const chains = [];
  for (const start of simple) {
    if (hasPrev.has(start)) continue;
    const chain = [start];
    while (next.has(chain.at(-1))) chain.push(next.get(chain.at(-1)));
    chains.push(chain);
  }
  return chains.sort((a, b) => b.length - a.length);
}

// The rule's findings for one Mermaid block, as sentences; none when it meets the rule.
function blockProblems(code) {
  let chart;
  try {
    chart = readFlowchart(code);
  } catch (e) {
    return [e.message];
  }
  const problems = [];
  if (chart.nodes.size > MAX_BOXES)
    problems.push(`${chart.nodes.size} boxes, more than ${MAX_BOXES}`);
  for (const [id, label] of chart.nodes) {
    const words = labelWords(label ?? id);
    if (words.length > MAX_WORDS)
      problems.push(
        `box "${words.join(" ")}" has ${words.length} words, more than ${MAX_WORDS}`,
      );
  }
  for (const chain of straightChains(chart))
    if (chain.length > MAX_CHAIN)
      problems.push(
        `a straight chain of ${chain.length} boxes (${chain.join(" -> ")}), more than ${MAX_CHAIN}: a list says it better`,
      );
  return problems;
}

const pages = process.argv.slice(2);
if (pages.length === 0 || pages.some((p) => p.startsWith("-"))) {
  console.error("Run: node scripts/diagram-rule.mjs <page.md...>");
  process.exit(2);
}
let bad = 0;
for (const page of pages) {
  const blocks = mermaidBlocks(readFileSync(page, "utf8"));
  let pageBad = 0;
  for (const [i, b] of blocks.entries())
    for (const p of blockProblems(b.code)) {
      pageBad++;
      console.log(`FAIL ${page}:${b.line} diagram ${i + 1}: ${p}`);
    }
  if (pageBad === 0)
    console.log(
      `ok ${page}: ${blocks.length} diagram${blocks.length === 1 ? "" : "s"}, each meets the rule`,
    );
  bad += pageBad;
}
process.exit(bad ? 1 : 0);
