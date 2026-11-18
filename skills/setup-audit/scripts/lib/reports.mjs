// Where the scanners write their reports and digests: ~/.claude/reports/<kind>/<date>, one file per project.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { maskKeys } from "../../../../hooks/push-key-scan.mjs";
import { day } from "./days.mjs";

export const reportDir = (kind, ...sub) =>
  path.join(os.homedir(), ".claude", "reports", kind, day(Date.now()), ...sub);

// Digests quote chats, and a chat may hold a key the user pasted: every key shape is hidden before the file is written
export function writeReport(dir, name, text) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), maskKeys(text));
}
