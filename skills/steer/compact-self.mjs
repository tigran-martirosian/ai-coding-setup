#!/usr/bin/env node
// compact-self: queue "/compact <focus>" onto THIS Nimbalyst session. The focus text comes on stdin.
//   echo "keep the user's quotes, open asks, child ids, next step" | node compact-self.mjs
// It finds its own Nimbalyst session id from CLAUDE_CODE_SESSION_ID (the Claude id) through
// Nimbalyst's database, then appends one entry to ~/.claude/steer/outbox.jsonl. The Commands
// extension (NoteBridge) hands it to ai:createQueuedPrompt, which waits until this session's turn
// has ended, so /compact never lands in a busy session. Needs Nimbalyst restarted since the bridge
// was installed. Fails with exit 1 and a clear message when the id or the text is missing.
import fs from "fs";
import path from "path";
import os from "os";

const fail = (m) => { console.error(`compact-self: ${m}`); process.exit(1); };
const HOME = os.homedir();
const OUTBOX = path.join(HOME, ".claude", "steer", "outbox.jsonl");
const DB = process.env.STEER_NIMBALYST_DB ||
  path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "@nimbalyst", "electron", "sqlite-db", "nimbalyst.sqlite");

const claudeId = process.env.CLAUDE_CODE_SESSION_ID;
if (!claudeId) fail("CLAUDE_CODE_SESSION_ID is not set, so this session's id is unknown. Run it from inside the session's own Bash tool.");
if (process.stdin.isTTY) fail("the focus text must come on stdin (echo \"<focus>\" | node compact-self.mjs).");
const focus = await new Promise((r) => { let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => r(s)); });
const text = focus.replace(/\s+/g, " ").trim();
if (!text) fail("the focus text on stdin is empty.");
if (!fs.existsSync(DB)) fail(`Nimbalyst's database not found at ${DB}.`);

process.removeAllListeners("warning");
const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(DB, { readOnly: true });
const row = db.prepare("SELECT id FROM ai_sessions WHERE provider_session_id = ? ORDER BY updated_at DESC").get(claudeId);
db.close();
if (!row?.id) fail(`session ${claudeId} is not in Nimbalyst's database, so there is no Nimbalyst session to queue the command on.`);

const now = Date.now();
let keep = [];
try {
  // A line that does not parse is skipped, so one bad line does not wipe the queued entries.
  for (const l of fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean)) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (now - e.ts < 2 * 3600e3) keep.push(e);
  }
} catch (e) {
  if (e.code !== "ENOENT") fail(`could not read ${OUTBOX}: ${e.message}`);
}
// A /compact for this session that the Commands extension has not delivered yet: a second one would
// compact twice. outbox-done.json (written by the extension) lists the delivered ids.
let done = [];
try { done = JSON.parse(fs.readFileSync(path.join(path.dirname(OUTBOX), "outbox-done.json"), "utf8")); } catch {}
const queued = keep.find((e) => e.session === row.id && String(e.prompt).startsWith("/compact") && !done.includes(e.id));
if (queued) {
  console.log(`Already queued: ${String(queued.prompt).slice(0, 80)} (for Nimbalyst session ${row.id}, entry ${queued.id}). It runs when this turn ends; nothing added.`);
  process.exit(0);
}
const entry = { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, ts: now, session: row.id, prompt: `/compact ${text}` };
keep.push(entry);
fs.mkdirSync(path.dirname(OUTBOX), { recursive: true });
// Written to a temp file and renamed over, so a reader never sees a half-written outbox.
const tmpFile = `${OUTBOX}.${process.pid}.tmp`;
fs.writeFileSync(tmpFile, keep.map((e) => JSON.stringify(e)).join("\n") + "\n");
fs.renameSync(tmpFile, OUTBOX);
console.log(`Queued "/compact ..." for Nimbalyst session ${row.id}. It runs when this turn ends (needs the Commands extension loaded: restart Nimbalyst after installing it).`);
