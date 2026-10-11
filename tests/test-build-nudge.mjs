// Tests for hooks/build-nudge.mjs. Run: node test-build-nudge.mjs
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
const hook = fileURLToPath(new URL("../hooks/build-nudge.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "build-nudge-test-"));
let n = 0, fail = 0;

// A transcript: "U" is a message the user typed, an array is one step (one reply) with its tool calls
const user = (text) => ({ type: "user", uuid: `u${++n}`, message: { content: text } });
const step = (tools, model = "claude-opus-5-5") => ({
  type: "assistant", uuid: `a${++n}`,
  message: { id: `msg${n}`, model, content: tools.map(([name, input]) => ({ type: "tool_use", id: `t${++n}`, name, input })) },
});
const edit = (f = "src/a.js") => ["Edit", { file_path: f }];
const read = (f = "src/a.js") => ["Read", { file_path: f }];
const transcript = (entries) => {
  const file = join(dir, `t${++n}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return file;
};
const run = (ev, env = {}) => spawnSync(process.execPath, [hook], {
  input: typeof ev === "string" ? ev : JSON.stringify({ session_id: `test-${process.pid}-${n}`, ...ev }),
  env: { ...process.env, BUILD_NUDGE: "", ...env }, encoding: "utf8",
}).stdout;
const expect = (name, out, want) => {
  const ok = want === false ? out === "" : out.includes('"deny"') && out.includes(want);
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${out || "(allowed)"}`}`);
};
const call = (file, tool, extra = {}) => ({ transcript_path: file, tool_name: tool[0], tool_input: tool[1], ...extra });

// Build reminder
const two = transcript([user("go"), step([edit()]), step([edit()])]);
expect("2 edit steps so far: allow", run(call(two, edit())), false);
const three = transcript([user("go"), step([edit()]), step([edit(), edit("b.js")]), step([["Bash", { command: "node t" }]]), step([edit()])]);
const sid = { session_id: `build-${process.pid}` };
expect("3 edit steps so far: deny with the worker brief", run(call(three, edit(), sid)), 'subagent_type \\"worker\\"');
expect("a call sent together with it: deny too", run(call(three, edit("c.js"), sid)), "build-nudge");
expect("the repeated call: allow", run(call(three, edit(), sid), { BUILD_NUDGE_WINDOW_MS: "0" }), false);
const cut = transcript([step([edit()]), step([edit()]), step([edit()])]);
expect("the user's message no longer in the tail, after a reminder: allow", run(call(cut, edit(), sid), { BUILD_NUDGE_WINDOW_MS: "0" }), false);
const next = transcript([user("go"), step([edit()]), step([edit()]), step([edit()]), user("more"), step([edit()]), step([edit()]), step([edit()])]);
run(call(three, edit(), sid));
expect("a new turn with 3 edit steps: deny again", run(call(next, edit(), sid), { BUILD_NUDGE_WINDOW_MS: "0" }), "build-nudge");
const together = transcript([user("go"), step([edit(), edit("b.js"), edit("c.js")]), step([edit()])]);
expect("edits sent together count as one step: allow", run(call(together, edit())), false);
const records = transcript([user("go"), step([edit()]), step([edit("C:/p/HANDOFF.md")]), step([edit("D:\\work\\p\\memory\\a.md")])]);
expect("record files are not counted: allow", run(call(records, edit())), false);
expect("an edit to a record file is never denied", run(call(three, edit("C:/p/DECISIONS.md"))), false);
const old = transcript([user("one"), step([edit()]), step([edit()]), step([edit()]), user("two"), step([edit()])]);
expect("edit steps of an earlier turn don't count: allow", run(call(old, edit())), false);
const sonnet = transcript([user("go"), ...[1, 2, 3].map(() => step([edit()], "claude-sonnet-5-5"))]);
expect("a session on Sonnet: allow", run(call(sonnet, edit())), false);
const fable = transcript([user("go"), ...[1, 2, 3].map(() => step([edit()], "claude-fable-5-1"))]);
expect("a session on Fable: deny", run(call(fable, edit())), "build-nudge");
expect("inside a subagent: allow", run(call(three, edit(), { agent_id: "a1" })), false);
expect("BUILD_NUDGE_EDITS=5: allow", run(call(three, edit()), { BUILD_NUDGE_EDITS: "5" }), false);
expect("Bash after 3 edit steps: allow", run(call(three, ["Bash", { command: "node t" }])), false);

// Lookup reminder
const looks = transcript([user("find"), step([edit()]), step([read()]), step([["Grep", { pattern: "a" }], read("b")]), step([["Glob", { pattern: "*" }]]), step([["WebSearch", { query: "q" }]])]);
const lid = { session_id: `look-${process.pid}` };
expect("4 lookup steps in a row: deny with the Haiku pointer", run(call(looks, read("c"), lid)), 'model \\"haiku\\"');
expect("the repeated lookup: allow", run(call(looks, read("c"), lid), { BUILD_NUDGE_WINDOW_MS: "0" }), false);
const broken = transcript([user("find"), step([read()]), step([read()]), step([["Bash", { command: "ls" }]]), step([read()]), step([read()])]);
expect("a run broken by a shell step: allow", run(call(broken, read("c"))), false);
expect("an edit after 4 lookup steps: allow", run(call(looks, edit())), false);

// Requests reminder
const bash = () => ["Bash", { command: "x" }];
const bashes = (k, model) => Array.from({ length: k }, () => step([bash()], model));
const note = (name, out, want) => {
  const ok = want === false ? out === "" : out.includes("additionalContext") && out.includes(want) && !out.includes("permissionDecision");
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${out || "(allowed)"}`}`);
};
const fifteen = transcript([user("go"), ...bashes(15)]);
const rid = { session_id: `req-${process.pid}` };
note("15 steps, next Bash: note, no denial", run(call(fifteen, bash(), rid)), "requests on the main model");
note("the same call again in the turn: nothing", run(call(fifteen, bash(), rid)), false);
const fourteen = transcript([user("go"), ...bashes(14)]);
note("14 steps: nothing", run(call(fourteen, bash(), { session_id: `req14-${process.pid}` })), false);
const threeSteps = transcript([user("go"), ...bashes(3)]);
note("BUILD_NUDGE_REQUESTS=3 with 3 steps: note", run(call(threeSteps, bash(), { session_id: `req3-${process.pid}` }), { BUILD_NUDGE_REQUESTS: "3" }), "requests on the main model");
const fifteenSonnet = transcript([user("go"), ...bashes(15, "claude-sonnet-5-5")]);
note("15 steps on Sonnet: nothing", run(call(fifteenSonnet, bash(), { session_id: `reqs-${process.pid}` })), false);
note("15 steps inside a subagent: nothing", run(call(fifteen, bash(), { session_id: `reqa-${process.pid}`, agent_id: "a1" })), false);
const mixed = transcript([user("go"), step([edit()]), step([edit()]), step([edit()]), ...bashes(12)]);
const mid = { session_id: `reqm-${process.pid}` };
expect("15 steps with 3 edit steps, next Edit: the build deny, not the note", run(call(mixed, edit(), mid)), "build-nudge");
note("the repeated Edit after the window: the note", run(call(mixed, edit(), mid), { BUILD_NUDGE_WINDOW_MS: "0" }), "requests on the main model");
const reset = transcript([user("go"), ...bashes(15), user("next"), ...bashes(14)]);
note("a new user message resets the count: nothing", run(call(reset, bash(), { session_id: `reqr-${process.pid}` })), false);
const again = transcript([user("go"), ...bashes(15), user("next"), ...bashes(15)]);
note("15 steps in the next turn: the note again", run(call(again, bash(), rid)), "requests on the main model");

// A turn with pictures: 3 edit steps, then 3 MB of base64 lines (a fixed tail would not see the steps)
const pic = (n) => ({ type: "user", uuid: `p${n}`, message: { content: [{ type: "tool_result", content: [{ type: "image", source: { data: "A".repeat(1024 * 1024) } }] }] } });
const pictures = transcript([user("go"), step([edit()]), step([edit()]), step([edit()]), pic(1), pic(2), pic(3)]);
expect("3 edit steps, then 3 MB of pictures: deny", run(call(pictures, edit(), { session_id: `pic-${process.pid}` })), "build-nudge");

// Off switch and odd input
expect("BUILD_NUDGE=off: allow", run(call(three, edit()), { BUILD_NUDGE: "off" }), false);
expect("no transcript: allow", run({ tool_name: "Edit", tool_input: { file_path: "a" } }), false);
expect("bad input: allow", run("not json"), false);

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
