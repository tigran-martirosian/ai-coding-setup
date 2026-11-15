// Where the scanners write their reports and digests: ~/.claude/reports/<kind>/<date>, one file per project.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { day } from "./days.mjs";

export const reportDir = (kind, ...sub) =>
  path.join(os.homedir(), ".claude", "reports", kind, day(Date.now()), ...sub);

export function writeReport(dir, name, text) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
}
