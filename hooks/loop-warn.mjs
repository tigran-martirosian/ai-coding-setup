#!/usr/bin/env node
// loop-warn: a PreToolUse hook for every tool. When the same call (same tool, same input) comes
// up LOOP_WARN_COUNT times (default 5) within a session's last 20 tool calls, it adds a note
// telling Claude it is repeating itself. The call still runs: the hook never blocks. After a
// warning the count for that call starts again, so the note returns only after 5 more repeats.
// Idea from ECC's ecc-context-monitor.js (LOOP_THRESHOLD = 5 over a ring buffer of recent calls).
// A browser call counts as the same only on the same page (2026-10-02).
// Silent otherwise. Added 2026-10-01.
// It fails open, so any error or odd input lets the call through. LOOP_WARN=off disables it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const COUNT = Number(process.env.LOOP_WARN_COUNT) || 5;
const WINDOW = 20; // recent tool calls remembered per session

try {
  if ((process.env.LOOP_WARN || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(readFileSync(0, "utf8"));
  if (!event.tool_name) process.exit(0);
  // One list per session, and per subagent inside it
  const dir = join(tmpdir(), "loop-warn");
  const id = `${event.session_id || "none"}${event.agent_id ? `-${event.agent_id}` : ""}`.replace(/[^\w-]/g, "");
  const file = join(dir, `${id}.json`);

  // A browser tool that reads or acts on a page (evaluate, get_page_info, screenshot, click...) is the
  // same call only on the same page: the same script on five different pages is not a loop. So the
  // page each browser session was last sent to is remembered and counted into the call.
  let page = "";
  const browser = /^browser_([a-z_]+)$/.exec(event.tool_name.split("__").pop()); // mcp__nimbalyst-browser__browser_navigate
  if (browser) {
    const pagesFile = join(dir, `${id}-pages.json`);
    let pages = {};
    try { pages = JSON.parse(readFileSync(pagesFile, "utf8")) || {}; } catch {}
    const tab = event.tool_input?.sessionId || "tab";
    if (/^(navigate|open_session)$/.test(browser[1]) && event.tool_input?.url) {
      pages[tab] = pages.last = event.tool_input.url;
      mkdirSync(dir, { recursive: true });
      writeFileSync(pagesFile, JSON.stringify(pages));
    } else page = pages[tab] ?? pages.last ?? "";
  }
  const key = createHash("sha1").update(event.tool_name + JSON.stringify(event.tool_input ?? {}) + page).digest("hex").slice(0, 16);
  let recent = [];
  try { recent = JSON.parse(readFileSync(file, "utf8")); } catch {}
  if (!Array.isArray(recent)) recent = [];
  recent = [...recent, key].slice(-WINDOW);
  const repeats = recent.filter((k) => k === key).length;
  if (repeats >= COUNT) recent = recent.filter((k) => k !== key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(recent));
  if (repeats < COUNT) process.exit(0);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext:
        `[loop-warn] This is the ${repeats}th identical ${event.tool_name} call (same input) in the last ${WINDOW} tool calls. ` +
        `Running it again will give the same result. Stop and change something: read the last output or error closely, ` +
        `try a different approach, or tell the user what is blocking you. If you are waiting for something to finish, ` +
        `use one longer wait instead of repeating this call.`,
    },
  }));
} catch {
  // Fail open
}
process.exit(0);
