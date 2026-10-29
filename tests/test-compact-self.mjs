// Test for skills/steer/compact-self.mjs: temp HOME and temp Nimbalyst database, never the real outbox.
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = fileURLToPath(new URL("../skills/steer/compact-self.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "compact-self-"));
const dbPath = path.join(tmp, "n.sqlite");
const db = new DatabaseSync(dbPath);
db.exec("CREATE TABLE ai_sessions (id TEXT, provider_session_id TEXT, updated_at INTEGER)");
db.prepare("INSERT INTO ai_sessions VALUES (?,?,?)").run("nim-111", "claude-aaa", 1);
db.prepare("INSERT INTO ai_sessions VALUES (?,?,?)").run("nim-222", "claude-bbb", 1);
db.close();
const outbox = path.join(tmp, ".claude", "steer", "outbox.jsonl");

const run = (input, env = {}) => {
  const e = { ...process.env, HOME: tmp, USERPROFILE: tmp, STEER_NIMBALYST_DB: dbPath };
  delete e.CLAUDE_CODE_SESSION_ID;
  return spawnSync(process.execPath, [SCRIPT], { input, env: { ...e, ...env }, encoding: "utf8" });
};
let pass = 0, failed = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : failed++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " " + extra}`); };
const lines = () => (fs.existsSync(outbox) ? fs.readFileSync(outbox, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

let r = run("keep the user's messages\nwith quotes, open asks\n", { CLAUDE_CODE_SESSION_ID: "claude-bbb" });
check("exit 0", r.status === 0, r.stderr);
let es = lines();
check("one entry", es.length === 1);
check("target is the Nimbalyst id mapped from the Claude id", es[0]?.session === "nim-222", JSON.stringify(es[0]));
check("prompt is /compact + stdin focus, whitespace collapsed", es[0]?.prompt === "/compact keep the user's messages with quotes, open asks", es[0]?.prompt);
check("entry has id and numeric ts", typeof es[0]?.id === "string" && es[0].id && typeof es[0]?.ts === "number");

r = run("second", { CLAUDE_CODE_SESSION_ID: "claude-aaa" });
es = lines();
check("second call appends, first entry kept", es.length === 2 && es[0].session === "nim-222" && es[1].session === "nim-111" && es[1].prompt === "/compact second");

fs.writeFileSync(outbox, JSON.stringify({ id: "old", ts: Date.now() - 3 * 3600e3, session: "x", prompt: "old" }) + "\n");
run("fresh", { CLAUDE_CODE_SESSION_ID: "claude-aaa" });
check("entries older than 2 hours are pruned", lines().length === 1 && lines()[0].prompt === "/compact fresh");

const before = fs.readFileSync(outbox, "utf8");
r = run("focus");
check("missing session id fails with a clear error", r.status === 1 && /CLAUDE_CODE_SESSION_ID is not set/.test(r.stderr), r.stderr);
r = run("focus", { CLAUDE_CODE_SESSION_ID: "claude-zzz" });
check("unknown session id fails with a clear error", r.status === 1 && /not in Nimbalyst's database/.test(r.stderr), r.stderr);
r = run("   \n", { CLAUDE_CODE_SESSION_ID: "claude-aaa" });
check("empty focus fails with a clear error", r.status === 1 && /empty/.test(r.stderr), r.stderr);
check("failed runs wrote nothing", fs.readFileSync(outbox, "utf8") === before);

// A bad line is skipped (good entries kept); a pending /compact for the same session is not queued twice.
fs.writeFileSync(outbox, JSON.stringify({ id: "keep-me", ts: Date.now(), session: "other", prompt: "x" }) + "\nnot json\n");
r = run("first", { CLAUDE_CODE_SESSION_ID: "claude-aaa" });
check("a bad outbox line is skipped, good entries kept, new one added", r.status === 0 && lines().length === 2 && lines()[0].id === "keep-me" && lines()[1].prompt === "/compact first", r.stderr);
const afterFirst = fs.readFileSync(outbox, "utf8");
r = run("again", { CLAUDE_CODE_SESSION_ID: "claude-aaa" });
check("a second /compact for the same session says Already queued and adds nothing", r.status === 0 && /^Already queued: /.test(r.stdout) && fs.readFileSync(outbox, "utf8") === afterFirst, r.stdout + r.stderr);
r = run("other session", { CLAUDE_CODE_SESSION_ID: "claude-bbb" });
check("another session is still queued", r.status === 0 && lines().length === 3);
fs.writeFileSync(path.join(tmp, ".claude", "steer", "outbox-done.json"), JSON.stringify([lines()[1].id]));
r = run("after delivery", { CLAUDE_CODE_SESSION_ID: "claude-aaa" });
check("a delivered /compact (listed in outbox-done.json) does not block a new one", r.status === 0 && lines().length === 4 && lines()[3].prompt === "/compact after delivery", r.stdout + r.stderr);
check("no temp file is left", !fs.readdirSync(path.join(tmp, ".claude", "steer")).some((n) => n.endsWith(".tmp")));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
