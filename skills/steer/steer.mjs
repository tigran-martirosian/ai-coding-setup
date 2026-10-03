#!/usr/bin/env node
// steer: talk to a Claude session that is busy in the same folder, without waiting for its reply
// to end (Nimbalyst queues messages until then). Used by the /btw and /ask skills.
//   list                     sessions in this folder active in the last 10 min (not this one)
//   send [--to <id>] <note>  queue a note for one session (the only active one, or --to);
//                            with several active and no --to, lists them and queues nothing
//   --hook                   PreToolUse, PostToolUse and Stop hook: hand this session the notes
//                            addressed to it at the first chance. Before a tool call the call is
//                            held (denied once) so the note is read first; after a tool call the
//                            note rides along with the result; at the end of a reply the session
//                            is kept going. Notes older than 20 min are dropped.
//   btw [--to <id>] <q>      print the recent part of that session's live transcript for /ask
// Fails open: any hook error means no output.
import fs from "fs";
import path from "path";
import os from "os";

const HOME = os.homedir();
const DIR = path.join(HOME, ".claude", "steer");
const key = (c) => String(c || process.cwd()).replace(/[^a-zA-Z0-9]/g, "-");
const inboxOf = (c) => path.join(DIR, `${key(c)}.jsonl`);
const MAX_AGE = 20 * 60e3;
const ACTIVE = 10 * 60e3;
// Tool calls made in the same step reach the hook within this time: all of them are held, not
// only the first one that picked the note up.
const HOLD = 1500;
const RULES = "It is an addition or a correction to the current task, not a new task. First ask yourself whether it touches what you are doing right now or are about to do: if it does, stop or change course before going on. Keep doing everything you were already asked, except exactly what this note changes: if it says to skip, stop, drop or replace something (a step, a style, a technique), do that from now on, and keep the rest. If it only adds something, add it and change nothing else. If it belongs to a later step, act on it at the point it names (if you keep a task list, update it so it isn't forgotten). In your final reply, confirm what you did about it.";
const read = (f) => {
  try {
    return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
const write = (f, a) =>
  a.length ? fs.writeFileSync(f, a.map((e) => JSON.stringify(e)).join("\n") + "\n") : fs.rmSync(f, { force: true });
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
    .map((f) => {
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
    });
};
// What to call a session when talking to the user: its tab name, else its last request, else its id.
const label = (f) => (f.name ? `"${f.name}"` : f.first !== "?" ? `the session last asked "${f.first}"` : `session ${f.id.slice(0, 8)}`);
const pickTarget = (args) => {
  const i = args.indexOf("--to");
  const to = i >= 0 ? args.splice(i, 2)[1] : null;
  const list = others();
  // An unknown id (for example Nimbalyst's own tab id) must not be queued: it would never arrive.
  if (to) return { t: list.find((f) => f.id.startsWith(to)) || null, list, bad: to };
  return { t: list.length === 1 ? list[0] : null, list };
};
const show = (list) => list.map((f) => `- ${f.id.slice(0, 8)}  ${f.name ? `"${f.name}"  ` : ""}${f.done ? "finished its reply" : "busy"}, active ${f.ago}s ago  last request: "${f.first}"  last said: "${f.said}"`).join("\n");

const [mode, ...rest] = process.argv.slice(2);

if (mode === "list") {
  const list = others();
  console.log(list.length ? show(list) : "No other session was active in this folder in the last 10 minutes.");
} else if (mode === "send") {
  const { t, list, bad } = pickTarget(rest);
  const msg = (rest[0] === "-" ? await stdin() : rest.join(" ")).trim();
  if (!msg) { console.log("usage: steer.mjs send [--to <id>] <note>"); process.exit(1); }
  if (!t) {
    console.log(bad ? `NOT SENT: "${bad}" is not one of the active sessions (use an id from this list, not the tab id):
${show(list)}` : list.length
      ? `NOT SENT: ${list.length} sessions are active in this folder. Don't ask the user: pick the one the note means (else a busy one, else the most recent) and rerun with --to <id>:\n${show(list)}`
      : "NOT SENT: no other session was active in this folder in the last 10 minutes.");
    process.exit(2);
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(inboxOf(), JSON.stringify({ ts: Date.now(), to: t.id, msg }) + "\n");
  console.log(t.done
    ? `Left for ${label(t)}. It is idle, so it reads the note with your next message there (within ${MAX_AGE / 60e3} minutes).`
    : `Sent to ${label(t)}. It reads the note before its next step.`);
} else if (mode === "--hook") {
  try {
    const inp = JSON.parse(await stdin());
    // Inside a subagent the hook carries the parent's session id: leave the note for the parent.
    if (inp.agent_id) process.exit(0);
    const ev = inp.hook_event_name, now = Date.now(), fresh = [], held = [];
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
    const notes = fresh.map((e) => `- ${e.msg}`).join("\n");
    const out = (o) => process.stdout.write(JSON.stringify(o));
    if (ev === "PreToolUse" && (fresh.length || held.length)) {
      out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: fresh.length
        ? `[btw] The user sent this while you were working, so this tool call was held (not refused) until you have read it. ${RULES}\n${notes}\nNow decide about the held call: if the note changes it, do the changed thing instead; if it doesn't, make the same call again.`
        : "[btw] Held together with your other tool call: the user's note is in that call's message. Read it first, then make this call again if it still applies." } });
    } else if (ev === "Stop" && fresh.length) {
      out({ decision: "block", reason: `[btw] The user sent this just as you were finishing, so don't stop yet. ${RULES}\n${notes}\nDeal with it now, then finish. If it changes nothing, say so in one line.` });
    } else if (fresh.length) {
      out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `[btw] The user sent this while you were working. ${RULES}\n${notes}` } });
    }
  } catch {}
} else if (mode === "btw") {
  const { t, list } = pickTarget(rest);
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
