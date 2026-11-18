#!/usr/bin/env node
// observe-log: prints what hooks in log-only mode (HOOK_NAME=observe, hooks/lib/hook-io.mjs) would have refused,
// so a new gate can be tuned before it blocks. Reads ~/.claude/hooks/state/observe.jsonl and the older
// observe.1.jsonl beside it. No dependencies.
//
//   observe-log.mjs [--hook <name>] [--days 7] [--all]
//
// One block per hook (and arm), the hook with the newest line first: a count line, then its last 5 lines (--all:
// every line in the window, to judge each before a gate is turned on), newest first. Times are local. A line with fields of its hook's own (verify-gate's commit check: verdict, repository,
// files, times) shows its verdict and, on a second line, those fields. A line that is not JSON is counted and
// reported as `bad lines: N`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DAY = 24 * 60 * 60 * 1000;
const SHOWN = 5;

const args = process.argv.slice(2);
let hook = "";
let days = 7;
let shown = SHOWN;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--all") shown = Number.POSITIVE_INFINITY;
  else if (a === "--hook" && args[i + 1]) hook = args[++i];
  else if (a === "--days" && /^\d+(\.\d+)?$/.test(args[i + 1] || ""))
    days = Number(args[++i]);
  else {
    process.stderr.write(
      `observe-log: unknown or incomplete argument "${a}". Use: observe-log.mjs [--hook <name>] [--days 7] [--all]\n`,
    );
    process.exit(2);
  }
}

const dir = path.join(os.homedir(), ".claude", "hooks", "state");
const files = ["observe.1.jsonl", "observe.jsonl"]
  .map((f) => path.join(dir, f))
  .filter((f) => fs.existsSync(f));
if (!files.length) {
  console.log("no observe log yet (~/.claude/hooks/state/observe.jsonl)");
  process.exit(0);
}

let bad = 0;
const since = Date.now() - days * DAY;
const groups = new Map();
for (const f of files) {
  for (const text of fs.readFileSync(f, "utf8").split("\n")) {
    if (!text.trim()) continue;
    let line;
    try {
      line = JSON.parse(text);
    } catch {
      bad++;
      continue;
    }
    const t = Date.parse(line?.t);
    if (!line || typeof line.hook !== "string" || Number.isNaN(t)) {
      bad++;
      continue;
    }
    if (t < since || (hook && line.hook !== hook)) continue;
    const key = line.arm ? `${line.hook}/${line.arm}` : line.hook;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...line, time: t });
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pad = (n) => String(n).padStart(2, "0");
const stamp = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const short = (reason) => {
  const flat = String(reason ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > 80
    ? `${flat.slice(0, 80)} ... (${flat.length} chars)`
    : flat;
};

// A refusal is logged as deny or block; a hook that logs every check (observeLine) names its own verdict
const verdict = (would) =>
  would === "deny" || would === "block" ? `would-${would}` : String(would);
// The fields a hook added beyond the usual ones, as key=value
const BASE = new Set(
  "t hook arm session agent cwd would reason time".split(" "),
);
const extras = (l) =>
  Object.entries(l)
    .filter(([k]) => !BASE.has(k))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : v}`)
    .join(" ");

const blocks = [...groups.entries()]
  .map(([key, list]) => [key, list.sort((a, b) => b.time - a.time)])
  .sort((a, b) => b[1][0].time - a[1][0].time);
if (!blocks.length)
  console.log(
    `nothing logged${hook ? ` for ${hook}` : ""} in ${plural(days, "day")}`,
  );
for (const [key, list] of blocks) {
  const kinds = new Map();
  for (const l of list) kinds.set(l.would, (kinds.get(l.would) || 0) + 1);
  const counts = [...kinds].map(([w, n]) => `${n} ${verdict(w)}`).join(", ");
  const sessions = new Set(list.map((l) => l.session).filter(Boolean)).size;
  const projects = new Set(list.map((l) => l.cwd).filter(Boolean)).size;
  console.log(
    `${key}  ${counts} in ${plural(days, "day")}, ${plural(sessions, "session")}, ${plural(projects, "project")}`,
  );
  for (const l of list.slice(0, shown)) {
    const own = extras(l);
    console.log(
      `  ${stamp(l.time)}  ${l.cwd ? path.basename(l.cwd) : "-"}  ${own ? `${verdict(l.would)}  ` : ""}${short(l.reason)}`,
    );
    if (own) console.log(`      ${own}`);
  }
}
if (bad) console.log(`bad lines: ${bad}`);
