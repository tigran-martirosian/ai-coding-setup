#!/usr/bin/env node
// model-check: did each helper run on the model it should have? Reads helper runs
// (<home>/projects/<folder>/<chat>/subagents/agent-*.meta.json and the .jsonl log beside it) and compares the
// models the log's assistant lines name (`message.model`) with the expected model: the agent file's `model:`
// (<home>/agents/<agentType>.md) for a run launched with the agent's defaults, else the .meta.json `model` field.
// `pickedEffortModel` is never read: it always names the session's model, not the helper's.
// A short name (sonnet, opus, fable, haiku) matches any full id of that family (claude-sonnet-5-5); a full id
// matches only itself. A run with no expected model (no field, no agent file: built-in agents) is skipped.
// Prints one line per mismatch and the counts; exit 1 on any mismatch, 0 otherwise, 2 when the home cannot be read.
//
// Options:
//   --days N      helper runs whose log changed in the last N days (default 30)
//   --sample M    read at most the M newest of them (default 50)
//   --home DIR    the Claude Code folder (default ~/.claude)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DAY_MS } from "./lib/days.mjs";
import { opt } from "./lib/opt.mjs";

const days = Number(opt("days", 30));
const sample = Number(opt("sample", 50));
const home = opt("home", path.join(os.homedir(), ".claude"));
for (const [name, n] of [
  ["days", days],
  ["sample", sample],
])
  if (!(n > 0)) {
    console.error(`model-check: --${name} must be a number above 0`);
    process.exit(2);
  }
const projects = path.join(home, "projects");
if (!fs.existsSync(projects)) {
  console.error(`model-check: no projects folder at ${projects}`);
  process.exit(2);
}
const since = Date.now() - days * DAY_MS;

// Every helper log in the window, newest first: { log, meta, name, mtime }
const runs = [];
for (const folder of fs.readdirSync(projects, { withFileTypes: true })) {
  if (!folder.isDirectory()) continue;
  const fdir = path.join(projects, folder.name);
  for (const chat of fs.readdirSync(fdir, { withFileTypes: true })) {
    if (!chat.isDirectory()) continue;
    const sdir = path.join(fdir, chat.name, "subagents");
    if (!fs.existsSync(sdir)) continue;
    for (const f of fs.readdirSync(sdir)) {
      if (!/^agent-.*\.jsonl$/.test(f)) continue;
      const log = path.join(sdir, f);
      const mtime = fs.statSync(log).mtimeMs;
      const meta = log.replace(/\.jsonl$/, ".meta.json");
      if (mtime < since || !fs.existsSync(meta)) continue;
      const name = `${folder.name}/${chat.name}/${f.replace(/\.jsonl$/, "")}`;
      runs.push({ log, meta, name, mtime });
    }
  }
}
runs.sort((a, b) => b.mtime - a.mtime);
const picked = runs.slice(0, sample);

// The `model:` line of an agent file's frontmatter, or undefined when there is no file or no line
function agentModel(type) {
  const file = path.join(home, "agents", `${type}.md`);
  if (!type || !fs.existsSync(file)) return undefined;
  const front = fs
    .readFileSync(file, "utf8")
    .match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const m = front?.[1].match(/^model:\s*["']?([^"'\r\n]+?)["']?\s*$/m);
  return m?.[1];
}

// A short name matches its family's full ids; a full id matches only itself
const matches = (expected, actual) =>
  expected.startsWith("claude-")
    ? actual === expected
    : actual.startsWith(`claude-${expected}-`);

let matched = 0,
  mismatched = 0,
  noExpected = 0,
  noModel = 0;
for (const r of picked) {
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(r.meta, "utf8"));
  } catch (e) {
    console.error(`model-check: cannot read ${r.meta}: ${e.message}`);
    process.exit(2);
  }
  // "inherit" names no model: the helper runs on the session's, which only the meta field records
  const fromAgent = meta.launchedWithDefaults
    ? agentModel(meta.agentType)
    : undefined;
  const expected =
    fromAgent && fromAgent !== "inherit" ? fromAgent : meta.model;
  if (!expected) {
    noExpected++;
    continue;
  }
  const models = new Set();
  for (const line of fs.readFileSync(r.log, "utf8").split("\n")) {
    if (!line.includes('"assistant"')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // a running helper's last line may be half written
    }
    // "<synthetic>" is Claude Code's own stand-in message (an API error, a stop), not a model that ran
    const m = o.type === "assistant" && o.message?.model;
    if (m && m !== "<synthetic>") models.add(m);
  }
  if (!models.size) {
    noModel++;
    continue;
  }
  const wrong = [...models].filter((m) => !matches(expected, m));
  if (wrong.length) {
    mismatched++;
    console.log(
      `MISMATCH ${r.name} (${meta.agentType}): expected ${expected} (${fromAgent && fromAgent !== "inherit" ? "agent file" : "launch"}), log has ${[...models].join(", ")}`,
    );
  } else matched++;
}

if (!picked.length) console.log(`0 runs in the last ${days} days`);
else
  console.log(
    `${runs.length} helper runs in the last ${days} days, the newest ${picked.length} read: ` +
      `checked ${matched + mismatched}, matched ${matched}, mismatched ${mismatched}, ` +
      `skipped ${noExpected + noModel} (no expected model ${noExpected}, no model in the log ${noModel})`,
  );
process.exit(mismatched ? 1 : 0);
