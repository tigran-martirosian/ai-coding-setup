#!/usr/bin/env node
// browser-visible-gate: PreToolUse on mcp__nimbalyst-browser__browser_open_session. Refuses headless:false:
// the Nimbalyst browser's tab never shows in a window of its own, so you could not see the page or type a sign-in.
// Sign-ins go through the site-login skill (a real Chromium window). Test: tests/test-browser-visible-gate.mjs
import { emit, isMain, runHook } from "./lib/hook-io.mjs";

// The command that opens a page (or a local file) in the user's own default browser, in a window they see.
export function showCommand(platform = process.platform) {
  if (platform === "win32")
    return 'cmd //c start "" "<url>" (Bash) or Start-Process "<url>" (PowerShell)';
  return platform === "darwin" ? 'open "<url>"' : 'xdg-open "<url>"';
}

export function verdict(input, platform = process.platform) {
  if (input?.headless !== false) return null;
  return (
    "browser-visible-gate: Refused: headless: false. The Nimbalyst browser never shows the user a window, so keep it headless and report a page as read by you, not as shown. " +
    `To really show the user a page, open it in their own browser: ${showCommand(platform)} (a local file too). ` +
    "For a sign-in, use the site-login skill (python ~/.claude/skills/site-login/login.py <name> <url> <signed-in-url-prefix>): " +
    "a real window you can type in, which closes itself once you are signed in. For your own reading, keep the session headless."
  );
}

if (isMain(import.meta.url)) {
  runHook("browser-visible-gate", (event) => {
    const why = verdict(event.tool_input);
    if (why) emit.deny(why);
  });
}
