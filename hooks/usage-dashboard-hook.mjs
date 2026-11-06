#!/usr/bin/env node
// usage-dashboard-hook (UserPromptSubmit): when the whole prompt is just "usage"
// (or "usage dashboard"), build and open the usage dashboard and stop the prompt,
// so no model call is made and no tokens are spent. Anything else passes through untouched.
// Inside Nimbalyst it never opens a browser: it refreshes the data and names the click (Usage icon, Full dashboard).
// USAGE_DASH_NO_OPEN=1 builds without opening the browser (for tests).
// Fails open: on any error the prompt goes through. USAGE_DASHBOARD=off disables it.
import { inNimbalyst, runHook } from "./lib/hook-io.mjs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

runHook("usage-dashboard-hook", (event) => {
  const prompt = String(event.prompt ?? "");
  if (!/^\/?usage( dashboard)?[.!]?$/i.test(prompt.trim()) || prompt.trim().toLowerCase() === "/usage") return;

  const script = path.join(os.homedir(), ".claude", "skills", "setup-audit", "scripts", "usage-dashboard.mjs");
  let reason;
  try {
    // A year of chats takes about a minute to read, more on a busy machine
    const nimbalyst = inNimbalyst();
    const args = process.env.USAGE_DASH_NO_OPEN || nimbalyst ? [script, "--no-open"] : [script];
    execFileSync(process.execPath, args, { encoding: "utf8", timeout: 180000 });
    reason = nimbalyst
      ? "Usage dashboard data refreshed. Open it from the Usage icon on the left, then Full dashboard. No tokens were used."
      : "Usage dashboard opened in your browser. No tokens were used.";
  } catch (e) {
    reason = `The usage dashboard could not be built: ${String(e.stderr || e.message).trim().split("\n").pop()}`;
  }
  console.log(JSON.stringify({ decision: "block", reason })); // with a newline, so not emit.block
}, { off: "USAGE_DASHBOARD" });
