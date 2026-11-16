// This week's use of the Claude plan (PC program design, section 3, action 33; probe 6). The setup's
// plan-usage logger hook appends one line to ~/.claude/usage-log/plan-usage.jsonl at most every 5 minutes while
// sessions run: { t, five, week: { u, r }, models }, `u` the percent used and `r` the reset time. The last line is
// the answer; it comes from the PC's own file, so it works while Nimbalyst is closed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkPath } from "../core/files.mjs";
import { ActionError } from "../core/registry.mjs";

export const usageFile = () =>
  path.join(os.homedir(), ".claude", "usage-log", "plan-usage.jsonl");

const CHUNK = 256 * 1024;

function parse(line, n) {
  let r;
  try {
    r = JSON.parse(line);
  } catch {
    throw new Error(`plan-usage.jsonl: line ${n} from the end is not JSON`);
  }
  if (
    !Number.isFinite(Date.parse(r?.t)) ||
    !Number.isFinite(r?.week?.u) ||
    !Number.isFinite(Date.parse(r?.week?.r))
  )
    throw new Error(
      `plan-usage.jsonl: line ${n} from the end has no time, week percent or reset`,
    );
  return r;
}

// The file's records, newest first, read from the end in chunks until `enough(record)` is true or the file ends.
function newestFirst(file, enough) {
  const real = checkPath(file);
  if (!fs.existsSync(real))
    throw new ActionError("no-usage", {
      message:
        "No usage record on the PC yet: the setup's usage logger writes one while a session runs.",
    });
  const fd = fs.openSync(real, "r");
  const out = [];
  try {
    let end = fs.fstatSync(fd).size;
    let rest = "";
    while (end > 0) {
      const start = Math.max(0, end - CHUNK);
      const buf = Buffer.alloc(end - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const lines = (buf.toString("utf8") + rest).split("\n");
      rest = start > 0 ? lines.shift() : "";
      for (const line of lines.reverse()) {
        if (!line.trim()) continue;
        const r = parse(line, out.length + 1);
        out.push(r);
        if (enough(r)) return out;
      }
      end = start;
    }
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

// { weekPercent, resetsAt, today, asOf }. `today` is the week's percent now less its last value before the PC's
// midnight (the percent now when the week started again since); null when the file starts after midnight.
export function readUsage(file = usageFile(), now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const before = (r) => Date.parse(r.t) < midnight.getTime();
  const records = newestFirst(file, before);
  const last = records[0];
  if (!last)
    throw new ActionError("no-usage", {
      message: "The PC's usage record is empty.",
    });
  const prior = records.find(before);
  const today = !prior
    ? null
    : prior.week.u > last.week.u
      ? last.week.u
      : last.week.u - prior.week.u;
  return {
    weekPercent: last.week.u,
    resetsAt: new Date(Date.parse(last.week.r)).toISOString(),
    today,
    asOf: new Date(Date.parse(last.t)).toISOString(),
  };
}

export function register(registry) {
  registry.add({ name: "usage.get", run: () => readUsage() });
}
