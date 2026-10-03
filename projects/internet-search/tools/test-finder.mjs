// Tests for the link gate (.claude/hooks/link-gate.mjs), tools/links.mjs and tools/limits.mjs.
// Run: node tools/test-finder.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { key, notAnItemPage, isSaveLabel, linksIn } from "./links.mjs";
import { check } from "./limits.mjs";
import { scan, problems } from "../.claude/hooks/link-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, "..", ".claude", "hooks", "link-gate.mjs");
const ROOT = path.resolve(HERE, "..");
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

// ---- links.mjs
ok("eBay item with and without the name is one page", key("https://www.ebay.com/itm/Some-Name/389249533658?hash=x"), key("https://ebay.com/itm/389249533658"));
ok("AliExpress .us and .com are one page", key("https://www.aliexpress.us/item/3256809398359770.html"), key("https://aliexpress.com/item/3256809398359770.html?spm=1"));
ok("r.jina.ai in front is the same page", key("https://r.jina.ai/https://shop.example.org/p/1"), key("https://shop.example.org/p/1/"));
ok("two different items differ", key("https://www.ebay.com/itm/1111111111") === key("https://www.ebay.com/itm/2222222222"), false);
for (const u of ["https://www.ebay.com/sch/i.html?_nkw=kettle", "https://www.amazon.com/s?k=kettle", "https://market.example.org/search?q=kettle",
  "https://shop.example.org/category/kettles", "https://shop.example.org/", "https://www.ebay.com/b/Kettles/20677"]) {
  ok(`not an item page: ${u.slice(0, 60)}`, !!notAnItemPage(u));
}
for (const u of ["https://www.ebay.com/itm/389249533658", "https://market.example.org/item/detail/92199f00-d3f1",
  "https://shop.example.org/product/steel-kettle-2l/", "https://www.youtube.com/watch?v=abc123", "https://shop.example.org/collections/kettles/products/steel-kettle"]) {
  ok(`item page: ${u.slice(0, 60)}`, notAnItemPage(u), "");
}
ok("save label", [isSaveLabel("These are search pages to save, not products:"), isSaveLabel("Save this search for email alerts"), isSaveLabel("Here is a good one")], [true, true, false]);
ok("links carry their list intro and table header",
  linksIn("These are search pages to save:\n\n- eBay: `https://www.ebay.com/sch/i.html?_nkw=x`\n\n| What | What breaks |\n|---|---|\n| [A](https://a.example.org/p/1) | heavy |")
    .map((l) => [l.intro.slice(0, 12), l.thead.slice(0, 8)]), [["These are se", ""], ["These are se", "| What |"]]);

// ---- labels.json: the two marker phrases in another language
const copy = fs.mkdtempSync(path.join(os.tmpdir(), "links-labels-"));
fs.copyFileSync(path.join(HERE, "links.mjs"), path.join(copy, "links.mjs"));
fs.writeFileSync(path.join(copy, "labels.json"), JSON.stringify({ save: ["recherches à garder"], breaks: ["écarté"] }));
const other = await import(pathToFileURL(path.join(copy, "links.mjs")).href);
ok("labels.json: a save label in another language is recognised", [other.isSaveLabel("Recherches à garder :"), other.isSaveLabel("Voici le meilleur")], [true, false]);
ok("labels.json: a ruled-out label in another language is recognised", [other.saysItBreaks("Écarté : trop lourd"), other.saysItBreaks("Le meilleur choix")], [true, false]);
ok("labels.json: the English labels still work", [other.isSaveLabel("Searches to save:"), other.saysItBreaks("Ruled out:")], [true, true]);
fs.rmSync(copy, { recursive: true, force: true });

// ---- the gate's judgement
const opened = new Set([key("https://www.ebay.com/itm/389249533658"), key("https://www.ebay.com/itm/158336145345")]);
const why = (text, extra = {}) => problems(text, { opened, ...extra }).map((p) => p.why.split(",")[0].split(" (")[0]);
ok("an opened item link passes", why("[Kettle](https://www.ebay.com/itm/389249533658) 89.90"), []);
ok("an unopened item link fails", why("[Kettle](https://www.ebay.com/itm/999999999999)"), ["was never opened in this session"]);
ok("a search link fails", why("See [eBay](https://www.ebay.com/sch/i.html?_nkw=steel+kettle)"), ["is a search page"]);
ok("a search link labelled as a search to save passes", why("These are search pages to save, not products:\n- eBay: https://www.ebay.com/sch/i.html?_nkw=kettle"), []);
ok("a front page fails", why("Buy at https://shop.example.org/"), ["is a site's front page"]);
ok("a link the user typed is not questioned", why("About https://www.ebay.com/itm/999999999999", { typed: new Set([key("https://www.ebay.com/itm/999999999999")]) }), []);
const checked = { [key("https://www.ebay.com/itm/158336145345")]: { ok: false, reasons: ["30 kg is over 20 kg"] } };
ok("a listing that failed the limits check fails in a plain list", why("- [Big one](https://www.ebay.com/itm/158336145345) 125", { checked }), ["breaks a limit"]);
ok("the same listing passes under 'ruled out'", why("Ruled out:\n- [Big one](https://www.ebay.com/itm/158336145345) 125", { checked }), []);
ok("and in a table with a 'what breaks' column", why("| What | What breaks |\n|---|---|\n| [Big one](https://www.ebay.com/itm/158336145345) | Heavy |", { checked }), []);
ok("the same link twice is reported once", why("https://www.ebay.com/itm/999999999999 and https://www.ebay.com/itm/999999999999").length, 1);

// ---- scan: what counts as opened
const tu = (id, name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const tr = (id, text, is_error) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: text, is_error }] } });
const say = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const s = scan([
  { type: "user", message: { content: "find a kettle, like https://typed.example.org/p/9" } },
  tu("1", "mcp__nimbalyst-browser__browser_navigate", { url: "https://nav.example.org/p/1" }), tr("1", "Navigating"),
  tu("2", "WebFetch", { url: "https://fetch.example.org/p/2" }), tr("2", "text"),
  tu("3", "Bash", { command: "node tools/peek.mjs https://dead.example.org/p/3" }), tr("3", "DEAD https://dead.example.org/p/3 (x)"),
  tu("3b", "Bash", { command: "node tools/peek.mjs https://live.example.org/p/4" }), tr("3b", "OPENED https://live.example.org/p/4\nnow at: https://live.example.org/p/4"),
  tu("4", "Bash", { command: "curl -s https://r.jina.ai/https://jina.example.org/p/5" }), tr("4", "text"),
  tu("5", "mcp__nimbalyst-browser__browser_navigate", { url: "https://failed.example.org/p/6" }), tr("5", "error", true),
  tu("7", "mcp__nimbalyst-browser__browser_evaluate", { script: "fetch('https://script.example.org/p/7').then(r=>r.text())" }), tr("7", "text"),
  tu("6", "Write", { file_path: path.join(ROOT, "finds", "sources", "x", "limits.json"), content: "{}" }), tr("6", "ok"),
  say("first part"), say("second part"),
]);
const has = (u) => s.opened.has(key(u));
ok("browser_navigate counts as opened", has("https://nav.example.org/p/1"));
ok("WebFetch counts as opened", has("https://fetch.example.org/p/2"));
ok("peek.mjs: an OPENED line counts", has("https://live.example.org/p/4"));
ok("peek.mjs: a DEAD page does not count", has("https://dead.example.org/p/3"), false);
ok("a fetch in Bash counts", has("https://jina.example.org/p/5"));
ok("an address fetched in a browser script counts", has("https://script.example.org/p/7"));
ok("a failed navigation does not count", has("https://failed.example.org/p/6"), false);
ok("a link typed by the user is remembered", s.typed.has(key("https://typed.example.org/p/9")));
ok("the reply is the text after the last tool call", s.reply, "first part\nsecond part");
ok("limits.json written and limits.mjs not run is noticed", [s.limitsWritten, s.limitsRun], [true, false]);

// ---- the hook is registered, and at a path that exists (a renamed or moved folder breaks it silently)
let registered = [];
try {
  registered = (JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "settings.json"), "utf8")).hooks?.Stop || [])
    .flatMap((g) => g.hooks || []).map((h) => (h.command.match(/"([^"]*link-gate\.mjs)"/) || [])[1]).filter(Boolean);
} catch {}
ok("settings.json registers the link gate as a Stop hook", registered.length, 1);
ok("and the registered path is this folder's hook", !!registered[0] && fs.existsSync(registered[0]) && fs.realpathSync(registered[0]) === fs.realpathSync(HOOK), true);

// ---- the hook as a process
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "link-gate-test-"));
const transcript = path.join(tmp, "t.jsonl");
const run = (entries, extra = {}, env = {}) => {
  fs.writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join("\n"));
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: "test-" + path.basename(tmp), transcript_path: transcript, checked: {}, ...extra }),
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, LINK_GATE: "", ...env },
  });
  const out = r.stdout.toString();
  return r.status !== 0 ? `exit ${r.status}` : !out ? "pass" : JSON.parse(out).decision;
};
const badReply = [{ type: "user", message: { content: "find one" } }, say("Best: [Kettle](https://www.ebay.com/itm/999999999999)")];
ok("hook blocks a reply with an unopened link", run(badReply), "block");
ok("hook blocks it again while Claude keeps answering the same way (2, 3)", [run(badReply, { stop_hook_active: true }), run(badReply, { stop_hook_active: true })], ["block", "block"]);
ok("after 3 blocks it lets the reply through", run(badReply, { stop_hook_active: true }), "pass");
ok("a new reply starts the count again", run(badReply), "block");
ok("LINK_GATE=off passes", run(badReply, {}, { LINK_GATE: "off" }), "pass");
ok("hook passes a reply whose link was opened", run([badReply[0], tu("1", "WebFetch", { url: "https://www.ebay.com/itm/999999999999" }), tr("1", "t"), badReply[1]]), "pass");
ok("hook passes a reply with no links", run([badReply[0], say("Nothing today.")]), "pass");
ok("hook uses last_assistant_message when it is given", run([badReply[0], say("Nothing today.")], { last_assistant_message: "See https://www.ebay.com/sch/i.html?_nkw=x" }), "block");
const threeLinks = say("A https://a.example.org/p/1 B https://a.example.org/p/2 C https://a.example.org/p/3");
const openAll = [1, 2, 3].flatMap((n) => [tu("w" + n, "WebFetch", { url: `https://a.example.org/p/${n}` }), tr("w" + n, "t")]);
const limitsWrite = [tu("L", "Write", { file_path: "C:/Work/internet-search/finds/sources/x/limits.json", content: "{}" }), tr("L", "ok")];
ok("limits.json written, limits.mjs never run, three links: blocked", run([badReply[0], ...limitsWrite, ...openAll, threeLinks]), "block");
ok("the same after limits.mjs ran: passes", run([badReply[0], ...limitsWrite, ...openAll, tu("R", "Bash", { command: "node tools/limits.mjs finds/sources/x" }), tr("R", "ok"), threeLinks]), "pass");
ok("bad input is ignored", spawnSync(process.execPath, [HOOK], { input: "not json" }).status, 0);
fs.rmSync(tmp, { recursive: true, force: true });

// ---- limits.mjs
const limits = { max_price: 150, max_weight: 20, weight_unit: "kg", quantity: 1, max_distance: 40, distance_unit: "km", banned: ["electric", "plastic body", "électrique"] };
const res = check(limits, [
  { name: "Steel kettle 2 l", url: "https://www.ebay.com/itm/336798138953", price: 62.5, weight: null, kind: "stovetop", state: "live" },
  { name: "Big one", url: "https://www.ebay.com/itm/158336145345", price: 125, weight: 30, distance: 62, kind: "stovetop", state: "live" },
  { name: "Dear one", url: "https://www.aliexpress.us/item/3256809398359770.html", price: 575.29, weight: 3, state: "live" },
  { name: "Wholesale lot", url: "https://shop.example.org/product/lot-1.html", price: 90, weight: 5, min_order: 50, state: "live" },
  { name: "Kettle", url: "https://market.example.org/item/1/", price: 75, weight: 2, kind: "electric kettle", state: "live" },
  { name: "Kettle with Plastic-Body", url: "https://market.example.org/item/2/", price: 20, weight: 1, state: "live" },
  { name: "Bouilloire électrique", url: "https://market.example.org/item/4/", price: 20, weight: 1, state: "live" },
  { name: "Sold one", url: "https://market.example.org/item/detail/3591", price: 50, weight: 4, state: "gone" },
  { name: "Search row", url: "https://www.ebay.com/sch/i.html?_nkw=kettle", price: 50, weight: 1, state: "live" },
  { name: "Not opened", price: 50, weight: 1 },
]);
ok("limits: only the one that meets every limit is kept", res.kept.map((r) => r.name), ["Steel kettle 2 l"]);
ok("limits: an unknown weight is flagged, not guessed", res.kept[0].unknown, ["weight not found"]);
ok("limits: dropped for weight and distance, with the units", res.rows[1].reasons, ["30 kg is over 20 kg", "62 km is over 40 km"]);
ok("limits: wholesale lot dropped", res.rows[3].reasons, ["minimum order is 50, wanted 1"]);
ok("limits: banned kinds dropped, also a word with an accent", [res.rows[4].ok, res.rows[5].ok, res.rows[6].ok], [false, false, false]);
ok("limits: sold, search page and unopened rows dropped", [res.rows[7].ok, res.rows[8].ok, res.rows[9].ok], [false, false, false]);
ok("limits: the Dropped line counts by reason", res.line.startsWith("Dropped: "), true);

console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
