#!/usr/bin/env node
// loop-warn: a PreToolUse hook for every tool. When the same call (same tool, same input) comes
// up LOOP_WARN_COUNT times (default 5) within a session's last 20 tool calls, it adds a note
// telling Claude it is repeating itself. The call still runs: the hook never blocks. After a
// warning the count for that call starts again, so the note returns only after 5 more repeats.
// Idea from ECC's ecc-context-monitor.js (LOOP_THRESHOLD = 5 over a ring buffer of recent calls).
// A browser call counts as the same only on the same page.
// Silent otherwise. State: ~/.claude/hooks/state/loop-warn/, files older than 2 days are removed.
// It fails open, so any error or odd input lets the call through. LOOP_WARN=off disables it.
import { runHook, emit } from "./lib/hook-io.mjs";
import { sessionKey } from "./lib/paths.mjs";
import { stateFile, readJson, writeJson, sweep } from "./lib/state.mjs";
import { createHash } from "node:crypto";

const COUNT = Number(process.env.LOOP_WARN_COUNT) || 5;
const WINDOW = 20; // recent tool calls remembered per session

runHook("loop-warn", (event) => {
  if (!event.tool_name) return;
  sweep("loop-warn", 2);
  // One list per session, and per subagent inside it
  const id = sessionKey(`${event.session_id || "none"}${event.agent_id ? `-${event.agent_id}` : ""}`);
  const file = stateFile("loop-warn", id);

  // A browser tool that reads or acts on a page (evaluate, get_page_info, screenshot, click...) is the
  // same call only on the same page: the same script on five different pages is not a loop. So the
  // page each browser session was last sent to is remembered and counted into the call.
  let page = "";
  const browser = /^browser_([a-z_]+)$/.exec(event.tool_name.split("__").pop()); // mcp__nimbalyst-browser__browser_navigate
  if (browser) {
    const pagesFile = stateFile("loop-warn", `${id}-pages`);
    const pages = readJson(pagesFile) || {};
    const tab = event.tool_input?.sessionId || "tab";
    if (/^(navigate|open_session)$/.test(browser[1]) && event.tool_input?.url) {
      pages[tab] = pages.last = event.tool_input.url;
      writeJson(pagesFile, pages);
    } else page = pages[tab] ?? pages.last ?? "";
  }
  const key = createHash("sha1").update(event.tool_name + JSON.stringify(event.tool_input ?? {}) + page).digest("hex").slice(0, 16);
  let recent = readJson(file);
  if (!Array.isArray(recent)) recent = [];
  recent = [...recent, key].slice(-WINDOW);
  const repeats = recent.filter((k) => k === key).length;
  if (repeats >= COUNT) recent = recent.filter((k) => k !== key);
  writeJson(file, recent);
  if (repeats < COUNT) return;

  emit.context("PreToolUse",
    `[loop-warn] This is the ${repeats}th identical ${event.tool_name} call (same input) in the last ${WINDOW} tool calls. ` +
    `Running it again will give the same result. Stop and change something: read the last output or error closely, ` +
    `try a different approach, or tell the user what is blocking you. If you are waiting for something to finish, ` +
    `use one longer wait instead of repeating this call.`);
});
