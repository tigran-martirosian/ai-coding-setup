// Tests for hooks/link-gate.mjs. Run: node tests/test-link-gate.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { key, linksIn, scan, problems } from "../hooks/link-gate.mjs";

const HOOK = fileURLToPath(new URL("../hooks/link-gate.mjs", import.meta.url));
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

// ---- one key per page
ok("www, a trailing slash and the query don't make a new page", key("https://www.shop.org/p/1/?utm=x"), key("https://shop.org/p/1"));
ok("two different pages differ", key("https://shop.org/p/1") === key("https://shop.org/p/2"), false);
ok("a bare home page keeps its query", key("https://shop.org/?id=5") === key("https://shop.org/?id=6"), false);
ok("local, example and template addresses are not judged",
  linksIn("http://localhost:3000/a https://example.com/x https://a.test/b https://api.org/{id} https://real.org/p."), ["https://real.org/p"]);

// ---- what counts as opened
const tu = (id, name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const tr = (id, text, is_error) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: text, is_error }] } });
const say = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const s = scan([
  { type: "user", message: { content: "compare these, like https://typed.org/p/9" } },
  tu("1", "mcp__nimbalyst-browser__browser_navigate", { url: "https://nav.org/p/1" }), tr("1", "Navigating"),
  tu("2", "WebFetch", { url: "https://fetch.org/p/2" }), tr("2", "text"),
  tu("3", "Bash", { command: "curl -s https://curl.org/p/3" }), tr("3", "text"),
  tu("4", "mcp__nimbalyst-browser__browser_navigate", { url: "https://failed.org/p/4" }), tr("4", "error", true),
  tu("5", "mcp__nimbalyst-browser__browser_evaluate", { script: "fetch('https://script.org/p/5').then(r=>r.text())" }), tr("5", "text"),
  tu("6", "WebSearch", { query: "best press" }), tr("6", "1. https://search-hit.org/p/6"),
  { ...tu("7", "WebFetch", { url: "https://sub.org/p/7" }), isSidechain: true }, { ...tr("7", "text"), isSidechain: true },
  say("first part"), say("second part"),
]);
const has = (u) => s.opened.has(key(u));
ok("browser_navigate counts as opened", has("https://nav.org/p/1"));
ok("WebFetch counts as opened", has("https://fetch.org/p/2"));
ok("a fetch in the shell counts", has("https://curl.org/p/3"));
ok("an address fetched in a browser script counts", has("https://script.org/p/5"));
ok("a failed navigation does not count", has("https://failed.org/p/4"), false);
ok("a link seen only in search results does not count", has("https://search-hit.org/p/6"), false);
ok("a page a subagent opened does not count", has("https://sub.org/p/7"), false);
ok("a link the user typed is remembered", s.typed.has(key("https://typed.org/p/9")));
ok("the reply is the text after the last tool call", s.reply, "first part\nsecond part");

// ---- the judgement
const opened = new Set([key("https://shop.org/p/1")]);
ok("an opened link passes", problems("[Press](https://shop.org/p/1) $89", { opened }), []);
ok("an unopened link fails", problems("[Press](https://shop.org/p/2)", { opened }), ["https://shop.org/p/2"]);
ok("a link the user typed is not questioned", problems("About https://shop.org/p/2", { opened, typed: new Set([key("https://shop.org/p/2")]) }), []);
ok("the same link twice is reported once", problems("https://shop.org/p/2 and https://www.shop.org/p/2/", { opened }).length, 1);

// ---- the hook as a process
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "link-gate-test-"));
const transcript = path.join(tmp, "t.jsonl");
const run = (entries, extra = {}, env = {}) => {
  fs.writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join("\n"));
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: "test-" + path.basename(tmp), transcript_path: transcript, ...extra }),
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, LINK_GATE: "", ...env },
  });
  const out = r.stdout.toString();
  return r.status !== 0 ? `exit ${r.status}` : !out ? "pass" : JSON.parse(out).decision;
};
const ask = { type: "user", message: { content: "find one" } };
const badReply = [ask, say("Best: [Press](https://shop.org/p/2)")];
ok("hook blocks a reply with an unopened link", run(badReply), "block");
ok("it blocks again while the answer stays the same (2, 3)", [run(badReply, { stop_hook_active: true }), run(badReply, { stop_hook_active: true })], ["block", "block"]);
ok("after 3 blocks it lets the reply through", run(badReply, { stop_hook_active: true }), "pass");
ok("a new reply starts the count again", run(badReply), "block");
ok("LINK_GATE=off passes", run(badReply, {}, { LINK_GATE: "off" }), "pass");
ok("hook passes a reply whose link was opened", run([ask, tu("1", "WebFetch", { url: "https://shop.org/p/2" }), tr("1", "t"), badReply[1]]), "pass");
ok("hook passes a reply with no links", run([ask, say("Nothing today.")]), "pass");
ok("hook uses last_assistant_message when it is given", run([ask, say("Nothing today.")], { last_assistant_message: "See https://shop.org/p/3" }), "block");
ok("bad input is ignored", spawnSync(process.execPath, [HOOK], { input: "not json" }).status, 0);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
