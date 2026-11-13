#!/usr/bin/env node
// usage-dashboard-hook (UserPromptSubmit): when the whole prompt is just "usage"
// (or "usage dashboard"), build and open the usage dashboard and stop the prompt,
// so no model call is made and no tokens are spent. Anything else passes through untouched.
// Inside Nimbalyst it never opens a browser: it refreshes the data and names the click (Usage icon, Full dashboard).
// USAGE_DASH_NO_OPEN=1 builds without opening the browser (for tests).
import { crashLog } from "./crash-log.mjs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

if ((process.env.USAGE_DASHBOARD || "").toLowerCase() === "off") process.exit(0);

try {
let input = "";
for await (const chunk of process.stdin) input += chunk;
let prompt = "";
try { prompt = String(JSON.parse(input).prompt ?? ""); } catch {}
if (!/^\/?usage( dashboard)?[.!]?$/i.test(prompt.trim()) || prompt.trim().toLowerCase() === "/usage") process.exit(0);

const script = path.join(os.homedir(), ".claude", "skills", "setup-audit", "scripts", "usage-dashboard.mjs");
let reason;
try {
  // A year of chats takes about a minute to read, more on a busy machine
  // No variable names Nimbalyst for a hook; the entry point is "sdk-..." in an app, "cli" in the terminal (as in board-nudge)
  const inNimbalyst = /^sdk/i.test(process.env.CLAUDE_CODE_ENTRYPOINT ?? "");
  const args = process.env.USAGE_DASH_NO_OPEN || inNimbalyst ? [script, "--no-open"] : [script];
  execFileSync(process.execPath, args, { encoding: "utf8", timeout: 180000 });
  reason = inNimbalyst
    ? "Usage dashboard data refreshed. Open it from the Usage icon on the left, then Full dashboard. No tokens were used."
    : "Usage dashboard opened in your browser. No tokens were used.";
} catch (e) {
  reason = `The usage dashboard could not be built: ${String(e.stderr || e.message).trim().split("\n").pop()}`;
}
console.log(JSON.stringify({ decision: "block", reason }));
} catch (err) {
  crashLog("usage-dashboard-hook", err);
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
}
