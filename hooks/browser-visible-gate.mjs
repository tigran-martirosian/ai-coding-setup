#!/usr/bin/env node
// browser-visible-gate: PreToolUse on mcp__nimbalyst-browser__browser_open_session. Refuses headless:false:
// the Nimbalyst browser's tab never shows in a window of its own, so you could not see the page or type a sign-in.
// Sign-ins go through the site-login skill (a real Chromium window). Test: tests/test-browser-visible-gate.mjs
import { crashLog } from "./crash-log.mjs";

export function verdict(input) {
  if (input?.headless !== false) return null;
  return "browser-visible-gate: the Nimbalyst browser's headless:false tab does not show a window you can see. " +
    "For a sign-in, use the site-login skill (python ~/.claude/skills/site-login/login.py <name> <url> <signed-in-url-prefix>): " +
    "a real window you can type in, which closes itself once you are signed in. For anything else, keep the session headless.";
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/browser-visible-gate.mjs")) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      const why = verdict(JSON.parse(raw || "{}").tool_input);
      if (why) process.stdout.write(JSON.stringify({ hookSpecificOutput: {
        hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } }));
    } catch (err) {
      crashLog("browser-visible-gate", err);
    }
    process.exit(0);
  });
}
