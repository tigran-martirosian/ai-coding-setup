#!/usr/bin/env node
// usage-dashboard-hook (UserPromptSubmit): when the whole prompt is just "usage"
// (or "usage dashboard"), build and open the usage dashboard and stop the prompt,
// so no model call is made and no tokens are spent. Anything else passes through untouched.
// USAGE_DASH_NO_OPEN=1 builds without opening the browser (for tests).
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;
let prompt = "";
try { prompt = String(JSON.parse(input).prompt ?? ""); } catch {}
if (!/^\/?usage( dashboard)?[.!]?$/i.test(prompt.trim()) || prompt.trim().toLowerCase() === "/usage") process.exit(0);

const script = path.join(os.homedir(), ".claude", "skills", "usage-report", "usage-dashboard.mjs");
let reason;
try {
  const args = process.env.USAGE_DASH_NO_OPEN ? [script, "--no-open"] : [script];
  execFileSync(process.execPath, args, { encoding: "utf8", timeout: 60000 });
  reason = "Usage dashboard opened in your browser. No tokens were used.";
} catch (e) {
  reason = `The usage dashboard could not be built: ${String(e.stderr || e.message).trim().split("\n").pop()}`;
}
console.log(JSON.stringify({ decision: "block", reason }));
