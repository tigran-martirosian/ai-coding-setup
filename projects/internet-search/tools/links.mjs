// links.mjs: what counts as "the same page", "a search page" and "a search to save".
// Shared by the link gate (.claude/hooks/link-gate.mjs) and the limits check (tools/limits.mjs).
import fs from "node:fs";

// The marker phrases below are English. When the answers are written in another language, the same
// phrases in that language go into tools/labels.json (written once, by the finder skill):
//   { "save": ["phrases that introduce searches to save"], "breaks": ["phrases that mark a listing as ruled out"] }
let LABELS = {};
try { LABELS = JSON.parse(fs.readFileSync(new URL("./labels.json", import.meta.url), "utf8")); } catch {}
const own = (list, text) => (Array.isArray(list) ? list : []).some((p) => p && String(text || "").toLowerCase().includes(String(p).toLowerCase()));

// The same listing under its different addresses (with or without the name in the path, .com or .us)
const ITEM_IDS = [
  [/(^|\.)ebay\.[a-z.]+$/, /\/itm\/(?:[^/]+\/)?(\d{9,})/, "ebay/itm/"],
  [/(^|\.)walmart\.com$/, /\/ip\/(?:[^/]+\/)?(\d+)$/, "walmart/ip/"],
  [/(^|\.)amazon\.[a-z.]+$/, /\/(?:dp|gp\/product)\/([a-z0-9]{10})/, "amazon/dp/"],
  [/(^|\.)aliexpress\.(com|us)$/, /\/item\/(\d+)\.html/, "aliexpress/item/"],
  [/(^|\.)mercari\.com$/, /\/item\/(m\d+)/, "mercari/item/"],
  [/(^|\.)facebook\.com$/, /\/marketplace\/item\/(\d+)/, "facebook/item/"],
  [/(^|\.)reddit\.com$/, /\/comments\/([a-z0-9]{5,10})(\/|$)/, "reddit/comments/"],
  [/^redd\.it$/, /^\/([a-z0-9]{5,10})$/, "reddit/comments/"],
];

// A Reddit thread's id from an id, a thread address or a redd.it address
export const threadId = (s) => (/(?:\/comments\/|redd\.it\/)([a-z0-9]{5,10})/i.exec(s) || /^([a-z0-9]{5,10})$/i.exec(s) || [])[1]?.toLowerCase() || "";

function parse(url) {
  try {
    const x = new URL(String(url).replace(/^https?:\/\/r\.jina\.ai\/(?=https?:)/i, ""));
    if (!/^https?:$/.test(x.protocol)) return null;
    return { x, host: x.hostname.toLowerCase().replace(/^(www|m|mobile)\./, ""), path: x.pathname.replace(/\/+$/, "").toLowerCase() };
  } catch { return null; }
}

// One key per page: host and path, or the listing number on the big shops. The query is ignored
// (tracking), except on a bare home page address where it is all there is.
export function key(url) {
  const p = parse(url);
  if (!p) return "";
  for (const [host, re, prefix] of ITEM_IDS) {
    const m = host.test(p.host) && re.exec(p.path);
    if (m) return prefix + m[1];
  }
  return p.host + p.path + (p.path ? "" : p.x.search);
}

// Returns why this address is not one item's own page, or "" when it could be one
export function notAnItemPage(url) {
  const p = parse(url);
  if (!p) return "";
  const q = p.x.searchParams;
  if (/\/(sch|search[^/]*|searchresults?)(\/|$)/.test(p.path) || /^\/s$/.test(p.path)) return "a search page";
  for (const name of ["q", "query", "keyword", "keywords", "_nkw", "_ssn", "searchterm", "searchtext", "search", "search_query"]) {
    if ([...q.keys()].some((k) => k.toLowerCase() === name)) return "a search page";
  }
  if (/\/(category|categories|browse|collections|showroom|brands?|shop-all|departments?)(\/|$)/.test(p.path) && !/\/products?\//.test(p.path)) return "a category or brand page";
  if (/(^|\.)ebay\./.test(p.host) && /^\/(b|str|usr)\//.test(p.path)) return "a category or shop page";
  if (!p.path && !p.x.search) return "a site's front page";
  return "";
}

// "search to save", "save this search", "saved search", "search pages to watch"
export const isSaveLabel = (text) => own(LABELS.save, text) ||
  /\bsearch(es)?\b[^.\n]{0,40}\b(to save|to watch|alerts?)\b|\bsave (this|the|these|that|a) search|\bsaved search|\bsearch(es)? (page|link)s? to (save|watch)/i.test(text || "");

// A line that says the thing on it breaks a limit
export const saysItBreaks = (text) => own(LABELS.breaks, text) ||
  /\bbreaks?\b|\bover (budget|the (limit|budget|price|weight))|\btoo (heavy|far|dear|expensive|big|large)\b|\bdropped\b|\bruled out\b|\boutside (the )?limits?\b|\bnot within\b|\bover the\b/i.test(text || "");

// Every http(s) link in a text, with the line it is on, the paragraph or heading above its list or
// table ("intro"), and the header row of its table ("thead")
export function linksIn(text) {
  const out = [];
  let intro = "", thead = "", inTable = false, fenced = false;
  for (const line of String(text || "").split("\n")) {
    const t = line.trim();
    if (/^```/.test(t)) { fenced = !fenced; continue; }
    const isRow = t.startsWith("|"), isItem = /^([-*+]|\d+[.)])\s/.test(t);
    if (isRow && !inTable) thead = t;
    if (!isRow) thead = "";
    inTable = isRow;
    if (t && !isRow && !isItem && !fenced) intro = t;
    for (const m of line.matchAll(/https?:\/\/[^\s<>"'`)\]|]+/g)) {
      const url = m[0].replace(/[.,;:!?*]+$/, "");
      if (parse(url) && !/[{}]|example\.com/.test(url)) out.push({ url, line: t, intro, thead });
    }
  }
  return out;
}
