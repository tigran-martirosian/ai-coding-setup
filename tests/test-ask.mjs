// Tests for workers/ask.mjs (the worker chain). Run: node tests/test-ask.mjs
// Fake `codex` and `agy` programs; nothing real is called.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, delimiter } from "node:path";

const script = fileURLToPath(new URL("../workers/ask.mjs", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "test-ask-"));
const isWorker = (d, n) => ["", ".cmd", ".exe", ".ps1"].some((e) => existsSync(join(d, n + e)));
const cleanPath = (process.env.PATH || "").split(delimiter).filter((d) => d && !isWorker(d, "codex") && !isWorker(d, "agy"));

// A fake worker: what it does is set by FAKE_<NAME> (ok, limit, fail)
const fake = (name) => `#!/usr/bin/env bash
case "$FAKE_${name.toUpperCase()}" in
  ok) echo "${name} answer: $*" ;;
  limit) echo "ERROR: You've hit your usage limit. Try again later." >&2; exit 1 ;;
  away) echo "FAILED_PRECONDITION (code 400): User location is not supported for the API use" >&2; exit 1 ;;
  *) echo "${name} broke" >&2; exit 1 ;;
esac
`;

let n = 0;
// have: which fake programs exist; files: extra files in the workers folder; env: extra environment
function ask(args, { have = [], files = {}, env = {} } = {}) {
  const dir = join(root, `case${++n}`), bin = join(dir, "bin"), home = join(dir, "workers");
  mkdirSync(bin, { recursive: true }); mkdirSync(home);
  for (const name of have) writeFileSync(join(bin, name), fake(name), { mode: 0o755 });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(home, name), text);
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", cwd: dir,
    env: { ...process.env, ...env, ASK_HOME: home, PATH: [bin, ...cleanPath].join(delimiter) } });
  return { code: r.status, out: r.stdout, err: r.stderr, home };
}

let fail = 0;
const check = (name, ok, detail = "") => { if (!ok) fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${detail}`}`); };
const show = (r) => JSON.stringify({ code: r.code, out: r.out.slice(0, 300), err: r.err.slice(0, 400) });

let r = ask(["--web", "who won"], { have: ["codex", "agy"], env: { FAKE_CODEX: "ok", FAKE_AGY: "ok" } });
check("web: Codex answers, with its search flag", r.code === 0 && r.out.includes("codex answer") && r.out.includes("--search") && r.err.includes("answered by Codex"), show(r));

r = ask(["--web", "who won"], { have: ["codex", "agy"], env: { FAKE_CODEX: "limit", FAKE_AGY: "ok" } });
check("web: Codex out of usage: exit 3, the reason is named, Claude is pointed to, Antigravity is not tried",
  r.code === 3 && r.out === "" && /codex failed \(out of usage\)/.test(r.err) && r.err.includes('"worker" subagent') && !r.err.includes("agy"), show(r));
check("web: Codex gets a cooldown", existsSync(join(r.home, "cooldown.json")) && "codex" in JSON.parse(readFileSync(join(r.home, "cooldown.json"), "utf8")));

r = ask(["--web", "who won"], { have: ["codex"], env: { FAKE_CODEX: "ok" }, files: { "cooldown.json": JSON.stringify({ codex: Date.now() + 60000 }) } });
check("web: a worker in cooldown is skipped", r.code === 3 && /codex skipped: out of usage/.test(r.err), show(r));
r = ask(["--web", "who won"], { have: ["codex"], env: { FAKE_CODEX: "ok" }, files: { "cooldown.json": JSON.stringify({ codex: Date.now() - 1000 }) } });
check("web: a cooldown that is over no longer counts", r.code === 0 && r.out.includes("codex answer"), show(r));

r = ask(["--web", "who won"], { have: ["codex"], env: { FAKE_CODEX: "ok" }, files: { "codex.off": "off" } });
check("web: codex.off skips Codex", r.code === 3 && r.err.includes("codex skipped: switched off"), show(r));
r = ask(["--web", "who won"]);
check("web: nothing set up: exit 3, the skip explained", r.code === 3 && r.err.includes("codex skipped: not installed") && r.err.includes("WebSearch"), show(r));

r = ask(["read big.txt"], { have: ["codex", "agy"], env: { FAKE_CODEX: "ok", FAKE_AGY: "ok" } });
check("local: Codex first when it works", r.code === 0 && r.out.includes("codex answer") && !r.out.includes("--search"), show(r));
r = ask(["read big.txt"], { have: ["codex", "agy"], env: { FAKE_CODEX: "fail", FAKE_AGY: "ok" } });
check("local: Codex fails, Antigravity takes over and both are named", r.code === 0 && r.out.includes("agy answer: -p read big.txt --mode plan --model")
  && r.err.includes("codex failed: codex broke") && r.err.includes("answered by Antigravity") && !existsSync(join(r.home, "cooldown.json")), show(r));
r = ask(["read big.txt"], { have: ["agy"], env: { FAKE_AGY: "fail" } });
check("local: no worker answers: exit 3 and Claude is pointed to", r.code === 3 && r.out === "" && r.err.includes("Grep and Read"), show(r));
r = ask(["read big.txt"], { have: ["agy"], env: { FAKE_AGY: "ok" }, files: { "agy.off": "off" } });
check("local: agy.off skips Antigravity", r.code === 3 && r.err.includes("agy skipped: switched off"), show(r));
r = ask(["read big.txt"], { have: ["agy"], env: { FAKE_AGY: "away" } });
check("local: a worker refused for this location is named and gets a cooldown", r.code === 3 && /agy failed \(not available from this location\)/.test(r.err)
  && "agy" in JSON.parse(readFileSync(join(r.home, "cooldown.json"), "utf8")), show(r));
r = ask(["--think", "hard one"], { have: ["codex"], env: { FAKE_CODEX: "ok" } });
check("--think drops Codex's low effort setting", r.code === 0 && !r.out.includes("model_reasoning_effort"), show(r));

const taskFile = join(root, "task.txt"); writeFileSync(taskFile, "task from a file\n");
r = ask([taskFile], { have: ["agy"], env: { FAKE_AGY: "ok" } });
check("a task file is read", r.code === 0 && r.out.includes("-p task from a file --mode"), show(r));
r = ask(['say "hi" $HOME `x`'], { have: ["agy"], env: { FAKE_AGY: "ok" } });
check("quotes and $ in the task arrive unchanged", r.out.includes('-p say "hi" $HOME `x` --mode'), show(r));

r = ask([]);
check("no task: exit 2", r.code === 2, show(r));
r = ask(["--nope", "x"]);
check("unknown option: exit 2", r.code === 2, show(r));
r = ask(["--status"], { have: ["agy"], files: { "codex.off": "off" } });
check("--status lists each worker", r.code === 0 && /codex: switched off/.test(r.out) && /agy: ready/.test(r.out) && !r.out.includes("gemini-key"), show(r));

rmSync(root, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
