// patch-next: SessionStart hook. Parallel sessions of one project that ship in the same release share one list,
// docs/patches/next.md (what, files, session id, status per line), so each session knows what goes into the release.
// When the open project has that file, this tells every new session where it is, how many lines it has and the
// open ones (not yet shipped, deployed or released), each cut to its start, so the session adds its own line and the
// deploying session ships every line. The whole Items section is not shown: most sessions only add one line.
// Projects without the file: silent. Subagents skip it. Fails open. PATCH_NEXT=off disables it.

import fs from "node:fs";
import path from "node:path";
import { emit, isMain, runHook } from "./lib/hook-io.mjs";

const MAX_LINES = 10,
  LINE_CHARS = 160;
// A line's status is what follows its last "Status:": closed when it says shipped, deployed, released or done,
// not negated ("not deployed yet" stays open). A line without "Status:" is open unless it starts with "[x]".
const CLOSED = /\b(shipped|deployed|released|done)\b/i;
const NEGATED =
  /\b(not|never|yet to be)\s+(yet\s+|been\s+)?(shipped|deployed|released|done)\b|\bun(shipped|deployed|released|done)\b/i;
const closed = (status) => CLOSED.test(status) && !NEGATED.test(status);

// The Items section's lines ("- " starts one; an indented line continues it), each { text, open }
export function items(text) {
  const at = text.indexOf("## Items");
  const out = [];
  for (const line of (at >= 0 ? text.slice(at + 8) : text).split(/\r?\n/)) {
    if (/^#{1,2}\s/.test(line)) break;
    if (/^[-*]\s/.test(line)) out.push(line.replace(/^[-*]\s+/, "").trim());
    else if (/^\s+\S/.test(line) && out.length)
      out[out.length - 1] += " " + line.trim();
  }
  return out.map((t) => {
    const s = t.lastIndexOf("Status:");
    return { text: t, open: s >= 0 ? !closed(t.slice(s)) : !/^\[x\]/i.test(t) };
  });
}

export function note(text) {
  const all = items(text),
    open = all.filter((i) => i.open);
  const head =
    `[patch-next] The next release's shared list is docs/patches/next.md: ${all.length} line(s), ${open.length} open. ` +
    "Anything you build for the next release gets its line there when you start (what, files, session id, status) and is " +
    "updated when tested; don't keep it only in your reply or pass it to another session by message. Read the whole file before shipping.";
  const shown = open
    .slice(0, MAX_LINES)
    .map(
      (i) =>
        `- ${i.text.length > LINE_CHARS ? i.text.slice(0, LINE_CHARS) + " …" : i.text}`,
    );
  if (open.length > MAX_LINES)
    shown.push(`- and ${open.length - MAX_LINES} more`);
  return shown.length ? `${head}\nOpen lines:\n${shown.join("\n")}` : head;
}

if (isMain(import.meta.url)) {
  runHook("patch-next", (event) => {
    if (event.agent_id) return;
    const dir = process.env.CLAUDE_PROJECT_DIR || event.cwd;
    if (!dir) return;
    const file = path.join(dir, "docs", "patches", "next.md");
    if (!fs.existsSync(file)) return;
    emit.context("SessionStart", note(fs.readFileSync(file, "utf8")));
  });
}
