#!/usr/bin/env node
// plan-usage-logger (UserPromptSubmit, PostToolUse, Stop): at most once every 5 minutes,
// saves the account-wide Claude plan percentages (5-hour and weekly, the numbers the
// Nimbalyst dials show) to ~/.claude/usage-log/plan-usage.jsonl. The usage dashboard
// compares them with this computer's own tokens to estimate "other use" (other devices,
// other devices or apps on the same account). No model call, no tokens.
//
// The hook itself only checks a timestamp and exits; the request to Anthropic runs in a
// detached copy of this script (--fetch), so sessions never wait for it.
// The saved login is sent to api.anthropic.com only, and is never written to the log.
//
// For tests: PLAN_USAGE_DIR (log folder), PLAN_USAGE_CREDS (login file), PLAN_USAGE_URL
// (endpoint; ignored unless PLAN_USAGE_CREDS is set too, so the real login can't go elsewhere).
import { crashLog } from "./lib/crash-log.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if ((process.env.PLAN_USAGE_LOGGER || "").toLowerCase() === "off")
  process.exit(0);

const dir =
  process.env.PLAN_USAGE_DIR || path.join(os.homedir(), ".claude", "usage-log");
const stamp = path.join(dir, "plan-usage.stamp");
const log = path.join(dir, "plan-usage.jsonl");
const status = path.join(dir, "plan-usage.status.json");

// Every 5 minutes, but every 30 seconds once either window is at 70% or more, so the status
// line and the dashboard show a fresh number as the limit gets close.
function everyMs() {
  try {
    const fd = fs.openSync(log, "r");
    const size = fs.fstatSync(fd).size,
      len = Math.min(size, 16384),
      buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf
      .toString("utf8")
      .split("\n")
      .filter((l) => l.trim().startsWith("{"));
    const r = JSON.parse(lines[lines.length - 1]);
    if ((r.five?.u ?? 0) >= 70 || (r.week?.u ?? 0) >= 70) return 30000;
  } catch {}
  return 5 * 60000;
}

if (!process.argv.includes("--fetch")) {
  try {
    if (Date.now() - fs.statSync(stamp).mtimeMs < everyMs()) process.exit(0);
  } catch {}
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stamp, ""); // written first, so parallel sessions don't all fetch
    spawn(process.execPath, [fileURLToPath(import.meta.url), "--fetch"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } catch {}
  process.exit(0);
}

const note = (ok, text) => {
  try {
    fs.writeFileSync(
      status,
      JSON.stringify({ t: new Date().toISOString(), ok, note: text }) + "\n",
    );
  } catch {}
};

const testCreds = process.env.PLAN_USAGE_CREDS;
const url =
  (testCreds && process.env.PLAN_USAGE_URL) ||
  "https://api.anthropic.com/api/oauth/usage";
let oauth;
try {
  oauth = JSON.parse(
    fs.readFileSync(
      testCreds || path.join(os.homedir(), ".claude", ".credentials.json"),
      "utf8",
    ),
  ).claudeAiOauth;
} catch {}
if (!oauth?.accessToken) {
  note(false, "no Claude login found");
  process.exit(0);
}
// Claude Code renews the login while a session runs; this script never renews it itself
if (oauth.expiresAt && oauth.expiresAt < Date.now()) {
  note(false, "login expired; waiting for Claude Code to renew it");
  process.exit(0);
}

try {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${oauth.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    note(false, `HTTP ${res.status}`);
    process.exit(0);
  }
  const j = await res.json();
  const win = (w) =>
    w && typeof w.utilization === "number"
      ? { u: w.utilization, r: w.resets_at ?? null }
      : null;
  const rec = {
    t: new Date().toISOString(),
    five: win(j.five_hour),
    week: win(j.seven_day),
  };
  if (!rec.five && !rec.week) {
    note(false, "reply had no plan percentages");
    process.exit(0);
  }
  // Some accounts have no 5-hour limit: the reply then has five_hour: null and a `limits` list with weekly limits only
  // (five stays null). Any limit outside the weekly group is kept, so a new one shows up.
  const other = (Array.isArray(j.limits) ? j.limits : []).filter(
    (l) => l.group !== "weekly",
  );
  if (other.length)
    rec.limits = other.map((l) => ({
      kind: l.kind,
      group: l.group,
      u: l.percent,
      r: l.resets_at ?? null,
    }));
  // Per-model weekly limits (kind "weekly_scoped" with scope.model, e.g. Fable), the ones Nimbalyst's Claude ring lists
  const models = (Array.isArray(j.limits) ? j.limits : []).filter(
    (l) =>
      l.kind === "weekly_scoped" &&
      l.scope?.model?.display_name &&
      typeof l.percent === "number",
  );
  if (models.length)
    rec.models = models.map((l) => ({
      model: l.scope.model.display_name,
      u: l.percent,
      r: l.resets_at ?? null,
    }));
  // Any other meters the account has (per-model weekly limits, credit balances), kept as they come
  const more = {};
  for (const [k, w] of Object.entries(j)) {
    if (["five_hour", "seven_day", "extra_usage"].includes(k) || !win(w))
      continue;
    more[k] = {
      ...win(w),
      ...(w.used_dollars != null
        ? { usd: w.used_dollars, cap: w.limit_dollars ?? null }
        : {}),
    };
  }
  if (Object.keys(more).length) rec.more = more;
  fs.appendFileSync(log, JSON.stringify(rec) + "\n");
  note(
    true,
    `${rec.five ? `5-hour ${rec.five.u}%` : "no 5-hour limit"}, week ${rec.week?.u ?? "?"}%` +
      (other.length
        ? `; other limits: ${other.map((l) => `${l.kind} ${l.percent}%`).join(", ")}`
        : ""),
  );
} catch (e) {
  note(false, String(e.message ?? e));
  // no network and a slow answer are the status file's business, not a crash
  if (e?.message !== "fetch failed" && e?.name !== "TimeoutError")
    crashLog("plan-usage-logger", e);
}
