#!/usr/bin/env node
// opencli-readonly: a PreToolUse hook for Bash and PowerShell. OpenCLI drives the user's own
// signed-in Chrome (Reddit, X, Facebook, Instagram, Amazon). The user allowed searching and reading
// with their accounts, never posting, liking, following, deleting or logging in. OpenCLI tags every
// site command [read] or [write] in `opencli <site> --help`; this hook asks OpenCLI itself and lets
// only [read] commands through, so new commands are covered without a list here.
// It fails open, so any error or odd input lets the call through. OPENCLI_READONLY=off disables it.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Not site commands: they don't act on an account.
const OWN = new Set(["doctor", "list", "daemon", "help", "update", "completion"]);

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `opencli-readonly: ${reason}` },
  }));
  process.exit(0);
}

try {
  if ((process.env.OPENCLI_READONLY || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(readFileSync(0, "utf8"));
  if (!["Bash", "PowerShell"].includes(event.tool_name)) process.exit(0);
  const command = String((event.tool_input || {}).command || "");
  if (!/\bopencli\b/i.test(command)) process.exit(0);

  const helpCache = new Map();
  const calls = command.matchAll(/\bopencli(?:\.cmd|\.exe)?["']?\s+([A-Za-z0-9-]+)(?:\s+([A-Za-z0-9-]+))?/g);
  for (const [, site, sub] of calls) {
    if (site.startsWith("-") || OWN.has(site.toLowerCase())) continue;
    if (!sub || sub.startsWith("-")) continue;                     // `opencli reddit --help`
    if (!helpCache.has(site)) {
      const r = spawnSync(`opencli ${site} --help`, { shell: true, encoding: "utf8", timeout: 8000, windowsHide: true });
      helpCache.set(site, r.status === 0 ? r.stdout : null);
    }
    const help = helpCache.get(site);
    if (help === null) process.exit(0);                              // OpenCLI not answering: fail open
    const line = help.split(/\r?\n/).find((l) => new RegExp(`^\\s+${sub}(\\s|$)`).test(l));
    const tag = line && (line.match(/\[(read|write)\]/) || [])[1];
    if (tag === "read") continue;
    deny(tag === "write"
      ? `\`opencli ${site} ${sub}\` is a [write] command. The user's accounts are for searching and reading only: never post, comment, like, follow, save, delete or log in. Use a [read] command (see \`opencli ${site} --help\`), or tell the user what you wanted to do.`
      : `\`opencli ${site} ${sub}\` is not listed as a [read] command in \`opencli ${site} --help\`, so it is not allowed. Only [read] commands may be run on the user's accounts.`);
  }
} catch {
  process.exit(0);
}
