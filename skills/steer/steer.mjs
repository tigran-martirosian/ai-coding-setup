#!/usr/bin/env node
// steer: talk to a Claude session that is busy in the same folder, without waiting for its reply
// to end (Nimbalyst queues messages until then). Used by the /btw and /ask skills.
//   list                     sessions in this folder active in the last 10 min (not this one)
//   send [--to <id>] <note>  queue a note for one session (the only active one, or --to);
//                            with several active and no --to: a busy one, else the most recent.
//                            --to also takes a Nimbalyst session id (a child or another tab, in
//                            any folder), looked up in Nimbalyst's database
//   --hook                   PreToolUse, PostToolUse and Stop hook: hand this session the notes
//                            addressed to it at the first chance. Before a tool call the call is
//                            held (denied once) so the note is read first; after a tool call the
//                            note rides along with the result; at the end of a reply the session
//                            is kept going. Notes older than 20 min are dropped. Also holds a
//                            send_prompt that carries a /btw note (the queue waits for the end of
//                            the target's turn) until steer.mjs send was tried this turn.
//   btw [--to <id>] <q>      print the recent part of that session's live transcript for /ask
//   moved --to <id>          this session handed its work to Nimbalyst session <id> (the handoff
//                            skill runs it): child reports that still arrive here, and messages
//                            the user types here, are forwarded
//   --hook on UserPromptSubmit: a child report ("[Child Session Update]") or a message the user typed
//                            (not a slash command; only within 24 h of the handoff) reaching a
//                            session that handed off is not run there; it goes to whoever leads now (following
//                            the chain) as a note, read before its next step. An idle lead is
//                            also woken through outbox.jsonl, which the Commands extension in
//                            Nimbalyst delivers with the app's own queue.
//   STEER_FORWARD=off        turns off forwarding of typed messages (kind "user") from a handed-off
//                            session, so the user can keep working in the old one; child reports
//                            are still forwarded.
// Fails open: any hook error means no output.
import fs from "fs";
import path from "path";
import os from "os";

const HOME = os.homedir();
const DIR = path.join(HOME, ".claude", "steer");
const key = (c) => String(c || process.cwd()).replace(/[^a-zA-Z0-9]/g, "-");
const inboxOf = (c) => path.join(DIR, `${key(c)}.jsonl`);
// A busy session can sit in one long tool call or wait for a background job for a long time; a
// note dropped at 20 minutes was lost without a word (2026-10-29).
const MAX_AGE = 2 * 3600e3;
const ACTIVE = 10 * 60e3;
// Tool calls made in the same step reach the hook within this time: all of them are held, not
// only the first one that picked the note up.
const HOLD = 1500;
const MOVED = path.join(DIR, "moved.json");
const OUTBOX = path.join(DIR, "outbox.jsonl");
const REPORT = "This is a child session's report, forwarded to you because you took over the work of the session that started that child. It is information, not a new request from the user: finish the step you are on, then judge it as the lead skill says (read the result, check it, route it).";
const TYPED = "This message reached the session you took over from and was forwarded to you. It was most likely typed there by the user: treat it as the user's request and answer or act on it as you would if they had typed it here, after the step you are on if it does not change that step. Only if it reads like one session writing to another (a lead's instruction, a status report) treat it as that instead.";
const RULES ="It is an addition or a correction to the current task, not a new task. First ask yourself whether it touches what you are doing right now or are about to do: if it does, stop or change course before going on. Keep doing everything you were already asked, except exactly what this note changes: if it says to skip, stop, drop or replace something (a step, a style, a technique), do that from now on, and keep the rest. If it only adds something, add it and change nothing else. If it belongs to a later step, act on it at the point it names (if you keep a task list, update it so it isn't forgotten). In your final reply, confirm what you did about it.";
// A line that does not parse is skipped: one bad line must not drop the good ones (the next write would wipe them).
const read = (f) => {
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { return []; }
  const out = [];
  for (const l of text.split("\n").filter(Boolean)) { try { out.push(JSON.parse(l)); } catch {} }
  return out;
};
// Written to a temp file in the same folder and renamed over, so a reader never sees a half-written file.
const write = (f, a) => {
  if (!a.length) return fs.rmSync(f, { force: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, a.map((e) => JSON.stringify(e)).join("\n") + "\n");
  fs.renameSync(tmp, f);
};
const stdin = () => new Promise((r) => { let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => r(s)); });
const chunk = (p, fromEnd, n) => {
  const size = fs.statSync(p).size, len = Math.min(size, n), b = Buffer.alloc(len);
  const fd = fs.openSync(p, "r"); fs.readSync(fd, b, 0, len, fromEnd ? size - len : 0); fs.closeSync(fd);
  const lines = b.toString("utf8").split("\n");
  if (len < size) fromEnd ? lines.shift() : lines.pop();
  return lines;
};
const texts = (lines, role) => {
  const out = [];
  for (const l of lines) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    const c = e.message?.content;
    if (e.type === "user" && role !== "assistant") {
      if (typeof c === "string") out.push(`USER: ${c}`);
      else if (Array.isArray(c)) c.filter((x) => x.type === "text").forEach((x) => out.push(`USER: ${x.text}`));
    } else if (e.type === "assistant" && role !== "user" && Array.isArray(c)) {
      for (const x of c) {
        if (x.type === "text" && x.text.trim()) out.push(`CLAUDE: ${x.text}`);
        if (x.type === "tool_use") out.push(`TOOL ${x.name}: ${JSON.stringify(x.input).slice(0, 200)}`);
      }
    }
  }
  return out;
};
// The name on the session's tab, so the user can tell which session is meant. Nimbalyst repeats it
// in every update_session_meta result; without one, Claude Code's own title is used. The whole
// transcript is scanned, but only the lines that can hold a name are parsed.
const nameOf = (p) => {
  let tab = "", title = "";
  const ids = [];
  try {
    for (const l of fs.readFileSync(p, "utf8").split("\n")) {
      if (!l.includes("update_session_meta") && !l.includes('"ai-title"') && !ids.some((id) => l.includes(id))) continue;
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e.type === "ai-title") { title = e.aiTitle || title; continue; }
      const c = e.message?.content;
      if (e.isSidechain || !Array.isArray(c)) continue;
      for (const x of c) {
        if (x.type === "tool_use" && /update_session_meta$/.test(x.name)) { ids.push(x.id); tab = x.input?.name || tab; }
        else if (x.type === "tool_result" && ids.includes(x.tool_use_id)) {
          const s = typeof x.content === "string" ? x.content : (x.content || []).map((y) => y.text || "").join("");
          try { tab = JSON.parse(s).after?.name || tab; } catch {}
        }
      }
    }
  } catch {}
  return String(tab || title).replace(/\s+/g, " ").trim().slice(0, 60);
};
// Other sessions in this folder that were active recently, newest first. The calling session is
// skipped: by its id when Claude Code gives it, else because its transcript already holds this
// very steer.mjs call.
const others = () => {
  const me = process.env.CLAUDE_CODE_SESSION_ID;
  const proj = path.join(HOME, ".claude", "projects", key(process.cwd()));
  let files = [];
  try {
    files = fs.readdirSync(proj).filter((n) => n.endsWith(".jsonl"))
      .map((n) => ({ id: n.slice(0, -6), p: path.join(proj, n), t: fs.statSync(path.join(proj, n)).mtimeMs }))
      .filter((f) => Date.now() - f.t < ACTIVE).sort((a, b) => b.t - a.t);
  } catch {}
  return files.filter((f) => f.id !== me && !/steer\.mjs\\?"?\s+(send|btw|list)\b/.test(chunk(f.p, true, 60000).slice(-40).join("\n")))
    .map(describe);
};
const describe = (f) => {
      // Label with the latest real user request (what the user remembers), not the first one.
      const lines = chunk(f.p, true, 3000000);
      const all = texts(lines);
      // Finished = its last message is Claude's closing reply, so no hook will run until the user
      // writes to it again.
      let last;
      for (let i = lines.length - 1; i >= 0 && !last; i--) {
        try { const e = JSON.parse(lines[i]); if ((e.type === "user" || e.type === "assistant") && !e.isSidechain) last = e; } catch {}
      }
      const done = last?.type === "assistant" && last.message?.stop_reason === "end_turn";
      const real = (a) => a.filter((s) => s.startsWith("USER: ") && !/^USER: [<[]/.test(s) && !s.includes("Base directory for this skill"));
      // A long run can push its only request out of the recent part: look at the start then.
      const users = real(all).length ? real(all) : real(texts(chunk(f.p, false, 1000000), "user"));
      const said = all.filter((s) => s.startsWith("CLAUDE: ")).at(-1) || "CLAUDE: ?";
      const cut = (x, n) => x.replace(/\s+/g, " ").slice(0, n);
      return { ...f, done, ago: Math.round((Date.now() - f.t) / 1000), name: nameOf(f.p),
        first: cut((users.at(-1) || "USER: ?").slice(6), 80), said: cut(said.slice(8), 80) };
};
// A Nimbalyst session id (what spawn_session and the tab give) -> that session's Claude transcript,
// in whatever folder it runs. Null when the id is not in Nimbalyst's database or has no transcript.
const NIMBALYST_DB = process.env.STEER_NIMBALYST_DB ||
  path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "@nimbalyst", "electron", "sqlite-db", "nimbalyst.sqlite");
// Nimbalyst's row for a session, by its Nimbalyst id (or the start of it) or by its Claude session id.
// Its status (running, waiting_for_input, idle, error) is what decides how a note gets there: the
// transcript alone can't tell, e.g. a session that ended its reply but waits for a background job
// looks finished there (2026-10-29: notes then waited for the end of the whole run).
const nimbalystRow = async (id) => {
  if (!id || !fs.existsSync(NIMBALYST_DB)) return null;
  process.removeAllListeners("warning");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(NIMBALYST_DB, { readOnly: true });
  const row = db.prepare("SELECT id, title, status, provider_session_id AS sid, workspace_id AS ws FROM ai_sessions WHERE (id LIKE ? OR provider_session_id LIKE ?) AND provider_session_id IS NOT NULL ORDER BY updated_at DESC").get(`${id}%`, `${id}%`);
  db.close();
  return row || null;
};
const fromNimbalyst = async (id) => {
  const row = await nimbalystRow(id);
  if (!row) return null;
  const p = path.join(HOME, ".claude", "projects", key(row.ws), `${row.sid}.jsonl`);
  if (!fs.existsSync(p)) return null;
  const f = describe({ id: row.sid, p, t: fs.statSync(p).mtimeMs });
  return { ...f, name: f.name || String(row.title || "").slice(0, 60), row };
};
// running and waiting_for_input: a note reaches it at its next step. idle and error: only a new
// message (send_prompt) starts it.
const BUSY = new Set(["running", "waiting_for_input"]);
// What to call a session when talking to the user: its tab name, else its last request, else its id.
const label = (f) => (f.name ? `"${f.name}"` : f.first !== "?" ? `the session last asked "${f.first}"` : `session ${f.id.slice(0, 8)}`);
const pickTarget = async (args) => {
  const i = args.indexOf("--to");
  const to = i >= 0 ? args.splice(i, 2)[1] : null;
  const list = others();
  // An unknown id must not be queued: it would never arrive.
  if (to) return { t: list.find((f) => f.id.startsWith(to)) || (await fromNimbalyst(to)), list, bad: to };
  return { t: list.length === 1 ? list[0] : null, list };
};
const show = (list) => list.map((f) => `- ${f.id.slice(0, 8)}  ${f.name ? `"${f.name}"  ` : ""}${f.done ? "finished its reply" : "busy"}, active ${f.ago}s ago  last request: "${f.first}"  last said: "${f.said}"`).join("\n");

const [mode, ...rest] = process.argv.slice(2);

if (mode === "list") {
  const list = others();
  console.log(list.length ? show(list) : "No other session was active in this folder in the last 10 minutes.");
} else if (mode === "send") {
  const { t: one, list, bad } = await pickTarget(rest);
  // Several active and none named: a busy one, else the most recent (the list is newest first).
  const t = one || (bad ? null : list.find((f) => !f.done) || list[0]);
  const msg = (rest[0] === "-" ? await stdin() : rest.join(" ")).trim();
  if (!msg) { console.log("usage: steer.mjs send [--to <id>] <note>"); process.exit(1); }
  if (!t) {
    console.log(bad ? `NOT SENT: "${bad}" is not one of the active sessions (use an id from this list, not the tab id):
${show(list)}` : "NOT SENT: no other session was active in this folder in the last 10 minutes.");
    process.exit(2);
  }
  // Nimbalyst's own status beats the transcript's guess. An idle Nimbalyst session is woken by a
  // normal message; a note left here would wait for one.
  const row = t.row || (await nimbalystRow(t.id));
  const busy = row ? BUSY.has(row.status) : !t.done;
  if (row && !busy) {
    console.log(`NOT SENT: ${label(t)} is ${row.status}, not busy. Send the note with send_prompt to session ${row.id} instead: it starts at once.`);
    process.exit(3);
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(inboxOf(), JSON.stringify({ ts: Date.now(), to: t.id, msg }) + "\n");
  console.log(!busy
    ? `Left for ${label(t)}. It is idle, so it reads the note with your next message there (within ${MAX_AGE / 3600e3} hours).`
    : row?.status === "waiting_for_input"
      ? `Sent to ${label(t)}. It is waiting for an answer in its tab; it reads the note right after that answer.`
      : `Sent to ${label(t)}. It reads the note before its next step.`);
} else if (mode === "moved") {
  const i = rest.indexOf("--to"), to = i >= 0 ? rest[i + 1] : null;
  const j = rest.indexOf("--from"), from = j >= 0 ? rest[j + 1] : process.env.CLAUDE_CODE_SESSION_ID;
  if (!to || !from) { console.log("usage: steer.mjs moved --to <new Nimbalyst session id> [--from <this session's Claude id>]"); process.exit(1); }
  let map = {};
  try { map = JSON.parse(fs.readFileSync(MOVED, "utf8")); } catch {}
  // Entries older than two weeks are dropped: no child runs that long.
  for (const [k, v] of Object.entries(map)) if (Date.now() - v.ts > 14 * 864e5) delete map[k];
  map[from] = { to, ts: Date.now() };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(MOVED, JSON.stringify(map, null, 1));
  console.log(`Child reports that reach this session from now on go to session ${to}.`);
} else if (mode === "--hook") {
  try {
    const inp = JSON.parse(await stdin());
    const ev = inp.hook_event_name, now = Date.now(), fresh = [], held = [];
    if (ev === "UserPromptSubmit") {
      // Nimbalyst sends a child's final reply to the session that started it, as a new turn. After a
      // handoff that session would wake at its old size and act on it (2026-10-29: four queued reports
      // ran in the old lead after it had handed off). Forward it instead, without a model call here.
      // A message the user types in the old session (they keep working there by habit) goes the same
      // way (user, 2026-10-29), unless it is a slash command, a system or hook injection, or the
      // handoff is over 24 hours old.
      const prompt = String(inp.prompt ?? "");
      const text = prompt.trim();
      const isReport = text.startsWith("[Child Session Update]");
      if (!isReport && (!text || text.startsWith("/") || text.startsWith("<") || /^\[(system|report)\b/i.test(text))) process.exit(0);
      if (!isReport && process.env.STEER_FORWARD === "off") process.exit(0);
      let map = {};
      try { map = JSON.parse(fs.readFileSync(MOVED, "utf8")); } catch {}
      if (!isReport && !(Date.now() - map[inp.session_id]?.ts <= 24 * 3600e3)) process.exit(0);
      const what = isReport ? "report" : "message";
      let hop = map[inp.session_id], row = null;
      for (let n = 0; hop && n < 10; n++) {
        row = await nimbalystRow(hop.to);
        hop = row?.sid ? map[row.sid] : null;
      }
      if (!map[inp.session_id]) process.exit(0);
      if (!row?.sid) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext:
          `[steer] This session handed its work to session ${map[inp.session_id].to}, but that session was not found in Nimbalyst, so the ${what} stays here. Deal with it here and tell the user it could not be forwarded.` } }));
        process.exit(0);
      }
      fs.mkdirSync(DIR, { recursive: true });
      fs.appendFileSync(inboxOf(inp.cwd), JSON.stringify({ ts: now, to: row.sid, msg: prompt, kind: isReport ? "report" : "user" }) + "\n");
      const busy = BUSY.has(row.status);
      if (!busy) {
        const keep = read(OUTBOX).filter((e) => now - e.ts < 2 * 3600e3);
        keep.push({ id: `${now}-${Math.random().toString(36).slice(2, 8)}`, ts: now, session: row.id,
          prompt: isReport ? "A child session's report was forwarded to you from the session you took over from. It reaches you as a note at your first step."
            : "A message that reached the session you took over from was forwarded to you; most likely the user typed it there. It reaches you as a note at your first step: treat it as the user's request unless it reads like one session writing to another." });
        write(OUTBOX, keep);
      }
      const name = row.title ? `"${String(row.title).slice(0, 60)}"` : `session ${row.id.slice(0, 8)}`;
      process.stdout.write(JSON.stringify({ decision: "block", reason: isReport
        ? `Forwarded to ${name}, which leads this work now; ${busy ? "it reads the report before its next step" : "it was idle and is being woken to read it"}. Nothing runs here.`
        : `Your message went to ${name}, which continues this work now; ${busy ? "it reads it before its next step" : "it was idle and is being woken to read it"}. Nothing runs here.` }));
      process.exit(0);
    }
    // Inside a subagent the hook carries the parent's session id. The note stays for the parent, but
    // a parent waiting on a long subagent would only read it when that ends, so the subagent gets a
    // copy after its tool calls (once each) and passes it on in its report.
    if (inp.agent_id) {
      if (ev !== "PostToolUse" || !fs.existsSync(DIR)) process.exit(0);
      const relay = [];
      for (const n of fs.readdirSync(DIR)) {
        if (!n.endsWith(".jsonl")) continue;
        const f = path.join(DIR, n), all = read(f);
        let changed = false;
        for (const e of all) {
          if (e.to !== inp.session_id || e.seen || e.kind === "report" || e.kind === "user" || now - e.ts > MAX_AGE || (e.relayed || []).includes(inp.agent_id)) continue;
          relay.push(e); e.relayed = [...(e.relayed || []), inp.agent_id]; changed = true;
        }
        if (changed) write(f, all);
      }
      if (relay.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext:
        `[btw] The user sent this note to the session that started you, while you were working. If it changes your task, follow it from now on and keep the rest. Either way, begin your final report with "User note received:" and what you did about it, so that session sees it too.\n${relay.map((e) => `- ${e.msg}`).join("\n")}` } }));
      process.exit(0);
    }
    // send_prompt to a busy session only waits in the queue until its turn ends, and interrupt throws
    // away the step it is on (2026-10-26: a lead queued a /btw note, then interrupted the child to
    // deliver it; 2026-10-29: the user had to press interrupt for queued notes to arrive). A steer note
    // reaches it before its next step, so a send_prompt to a running session is turned into one.
    if (ev === "PreToolUse" && /send_prompt$/.test(inp.tool_name || "") && !inp.tool_input?.interrupt) {
      let row = null;
      try { row = await nimbalystRow(inp.tool_input?.sessionId); } catch {}
      if (row && BUSY.has(row.status)) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason:
          `[steer] That session is ${row.status === "running" ? "busy" : "waiting for an answer in its tab"}: send_prompt would only queue until its whole turn ends. Send the same text as a steer note, which it reads before its next step:\nnode ~/.claude/skills/steer/steer.mjs send --to ${inp.tool_input.sessionId} - <<'EOF'\n<the same text>\nEOF\nIf it is a new task for after the current one, say so in the note.` } }));
        process.exit(0);
      }
    }
    // Not in Nimbalyst's database (or no status): the old check, which only catches a /btw note.
    if (ev === "PreToolUse" && /send_prompt$/.test(inp.tool_name || "") && !inp.tool_input?.interrupt && !(await nimbalystRow(inp.tool_input?.sessionId).catch(() => null))) {
      let typed = "", tried = false;
      try {
        for (const l of chunk(inp.transcript_path, true, 400000)) {
          let e; try { e = JSON.parse(l); } catch { continue; }
          const c = e.message?.content;
          if (e.type === "user" && !e.isSidechain && !e.isMeta) {
            const t = typeof c === "string" ? c : Array.isArray(c) ? c.filter((x) => x.type === "text").map((x) => x.text).join("\n") : "";
            if (t.trim() && !/^\s*</.test(t)) { typed = t; tried = false; }
          } else if (e.type === "assistant" && Array.isArray(c) &&
            c.some((x) => x.type === "tool_use" && /steer\.mjs\\?"?\s+send\b/.test(x.input?.command || ""))) tried = true;
        }
      } catch {}
      const btw = (s) => /(^|[\s/])btw\b/i.test(s || "");
      if (!tried && (/^\s*\/btw\b/i.test(inp.tool_input?.prompt || "") || btw(typed))) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason:
          `[btw] send_prompt only queues: a busy session reads it when its turn ends, and interrupt throws away the step it is on. A /btw note reaches it before its next step this way:\nnode ~/.claude/skills/steer/steer.mjs send --to ${inp.tool_input?.sessionId || "<session id>"} - <<'EOF'\n<the note>\nEOF\nIf that prints NOT SENT (the session is idle), make this send_prompt call again.` } }));
        process.exit(0);
      }
    }
    // Every folder's inbox is checked: the session may have changed folder since the note was sent.
    for (const n of fs.readdirSync(DIR)) {
      if (!n.endsWith(".jsonl")) continue;
      const f = path.join(DIR, n), before = read(f), keep = [];
      for (const e of before) {
        if (now - e.ts > MAX_AGE || (e.seen && now - e.seen > HOLD)) continue;
        if (e.to !== inp.session_id) keep.push(e);
        else if (e.seen) { if (ev === "PreToolUse") held.push(e); keep.push(e); }
        else { fresh.push(e); if (ev === "PreToolUse") keep.push({ ...e, seen: now }); }
      }
      if (JSON.stringify(keep) !== JSON.stringify(before)) write(f, keep);
    }
    const userNotes = fresh.filter((e) => e.kind !== "report" && e.kind !== "user"), reports = fresh.filter((e) => e.kind === "report");
    const typed = fresh.filter((e) => e.kind === "user");
    const notes = userNotes.map((e) => `- ${e.msg}`).join("\n");
    // A forwarded child report says what it is; it is not the user's note. A message the user typed in
    // the old session says so too, and is a request.
    const rep = (reports.length ? `\n[report] ${REPORT}\n${reports.map((e) => e.msg).join("\n\n")}` : "")
      + (typed.length ? `\n[user] ${TYPED}\n${typed.map((e) => e.msg).join("\n\n")}` : "");
    const out = (o) => process.stdout.write(JSON.stringify(o));
    if (ev === "PreToolUse" && (fresh.length || held.length)) {
      out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: !fresh.length
        ? "[btw] Held together with your other tool call: the note is in that call's message. Read it first, then make this call again if it still applies."
        : userNotes.length
          ? `[btw] The user sent this while you were working, so this tool call was held (not refused) until you have read it. ${RULES}\n${notes}${rep}\nNow decide about the held call: if the note changes it, do the changed thing instead; if it doesn't, make the same call again.`
          : `This tool call was held (not refused) so you read this first.${rep}\nThen make the same call again, unless the report changes it.` } });
    } else if (ev === "Stop" && fresh.length) {
      out({ decision: "block", reason: userNotes.length
        ? `[btw] The user sent this just as you were finishing, so don't stop yet. ${RULES}\n${notes}${rep}\nDeal with it now, then finish. If it changes nothing, say so in one line.`
        : `Don't stop yet: this arrived as you were finishing.${rep}` });
    } else if (fresh.length) {
      out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: userNotes.length
        ? `[btw] The user sent this while you were working. ${RULES}\n${notes}${rep}` : rep.trim() } });
    }
  } catch {}
} else if (mode === "btw") {
  const { t, list } = await pickTarget(rest);
  if (!t || !t.p) {
    console.log(list.length ? `Several sessions are active. Don't ask the user: pick the one the question means (else a busy one, else the most recent) and rerun with --to <id>:\n${show(list)}`
      : "No other session was active in this folder in the last 10 minutes.");
    process.exit(0);
  }
  const out = [];
  let len = 0;
  for (const s of texts(chunk(t.p, true, 400000)).reverse().map((s) => (s.length > 800 ? s.slice(0, 800) + " …" : s))) {
    if (len + s.length > 14000) break;
    out.unshift(s); len += s.length;
  }
  console.log(`# Session ${label(t)} (${t.id.slice(0, 8)}, last activity ${t.ago}s ago), most recent last\n`);
  console.log(out.join("\n\n"));
  console.log(`\n# Question\n${rest.join(" ").trim()}`);
}
