// Checks the agent definitions in the agents folder of this repository that the rules depend on. Run: node tests/test-agents.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const AGENTS = fileURLToPath(new URL("../agents/", import.meta.url));
const read = (name) => readFileSync(join(AGENTS, `${name}.md`), "utf8").replace(/\r\n/g, "\n");
const parts = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("no frontmatter");
  return { head: m[1], body: m[2].trim() };
};
const has = (head, key, value) => new RegExp(String.raw`^${key}:[ ]*${value}[ ]*$`, "m").test(head);
const tools = (head) => (head.match(/^tools:\s*(.*)$/m)?.[1] || "").split(/,\s*/);

const worker = parts(read("worker")), full = parts(read("worker-full")), rec = parts(read("rec-check"));
const SLIM = /\n\nYou start without the CLAUDE\.md files[\s\S]*?Commit or push only when the brief says to\./;
const checks = [
  ["worker is named worker and starts without CLAUDE.md", has(worker.head, "name", "worker") && has(worker.head, "omitClaudeMd", "true")],
  ["worker has no Agent tool and keeps Edit, Write, Bash", !tools(worker.head).includes("Agent") && ["Edit", "Write", "Bash"].every((t) => tools(worker.head).includes(t))],
  ["worker-full loads CLAUDE.md and has every tool", has(full.head, "name", "worker-full") && !/omitClaudeMd/.test(full.head) && !/^tools:/m.test(full.head)],
  ["the two workers differ only by the block for starting without CLAUDE.md", SLIM.test(worker.body) && worker.body.replace(SLIM, "") === full.body],
  ["the worker's own block carries the rules it no longer loads", ["WHAT THIS DOES", "no made-up defaults", "Commit or push only"].every((s) => worker.body.includes(s))],
  ["rec-check starts small and cannot change files", has(rec.head, "omitClaudeMd", "true") && !tools(rec.head).some((t) => ["Edit", "Write"].includes(t))],
  ["rec-check starts its answer with keep or change", /`keep`/.test(rec.body) && /`change:/.test(rec.body)],
];
let fail = 0;
for (const [name, ok] of checks) {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
console.log(fail ? `${fail} failed` : `all ${checks.length} passed`);
process.exit(fail ? 1 : 0);
