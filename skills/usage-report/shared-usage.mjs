#!/usr/bin/env node
// shared-usage: who used how much of a shared Claude subscription, read from the third-party
// command line tool ccpool (`ccpool status`). Nothing is asked from Anthropic; no number is made up.
//
//   parseStatus(text)   { setUp: false } when the output has no "members" block (ccpool is not
//                       set up), otherwise { setUp: true, members: [{ name, me, five, week, active }] }
//                       five and week are percentages, or null where ccpool prints a dash
//
// Run it directly for the JSON (ccpool missing: {"setUp":false}):
//   node shared-usage.mjs
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pct = (s) => (s === "—" ? null : Number(s.replace("%", "")));
const ROW = /^\s*\d+\s+(\S+)(\s+◂)?\s+[█░]+\s+(\d+%|—)\s+(\d+%|—)\s+(\S+)\s*$/;

export function parseStatus(text) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === "members");
  if (at < 0) return { setUp: false };
  const members = [];
  for (const line of lines.slice(at + 1)) {
    const m = ROW.exec(line);
    if (m) members.push({ name: m[1], me: !!m[2], five: pct(m[3]), week: pct(m[4]), active: m[5] === "active" });
  }
  if (!members.length) throw new Error("ccpool status: output not understood");
  return { setUp: true, members };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let out;
  try {
    out = execSync("ccpool status", { encoding: "utf8", timeout: 20000, stdio: "pipe" });
  } catch (e) {
    const err = String(e.stderr || "");
    // installed but not joined yet: ccpool points at `ccpool init`
    if (e.code === "ENOENT" || e.status === 127 || /not recognized|not found|ccpool init/i.test(err + String(e.stdout || ""))) {
      console.log(JSON.stringify({ setUp: false }));
      process.exit(0);
    }
    console.error((err.trim() || String(e.message)).split("\n").pop());
    process.exit(1);
  }
  try {
    console.log(JSON.stringify(parseStatus(out)));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
