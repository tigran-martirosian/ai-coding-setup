#!/usr/bin/env node
// browser-visible-gate: PreToolUse on mcp__nimbalyst-browser__browser_open_session. Refuses headless:false:
// the Nimbalyst browser's tab never shows in a window of its own, so you could not see the page or type a sign-in.
// Sign-ins go through the site-login skill (a real Chromium window). Test: tests/test-browser-visible-gate.mjs
import { runHook, isMain, emit } from "./lib/hook-io.mjs";

export function verdict(input) {
  if (input?.headless !== false) return null;
  return "browser-visible-gate: the Nimbalyst browser's headless:false tab does not show a window you can see. " +
    "For a sign-in, use the site-login skill (python ~/.claude/skills/site-login/login.py <name> <url> <signed-in-url-prefix>): " +
    "a real window you can type in, which closes itself once you are signed in. For anything else, keep the session headless.";
}

if (isMain(import.meta.url)) {
  runHook("browser-visible-gate", (event) => {
    const why = verdict(event.tool_input);
    if (why) emit.deny(why);
  });
}
