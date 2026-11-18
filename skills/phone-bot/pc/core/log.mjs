// pc.log in the app folder (~/.phone-app, or the second PC program's own folder): one line per connect, pairing,
// refused action, alert kind or error.
// Never a secret, a key, the relay address, session text or a prompt. 1 MB per file, two files kept.
import fs from "node:fs";
import path from "node:path";
import { appDir } from "./mode.mjs";

const MAX = 1024 * 1024;

export function logPath() {
  return path.join(appDir(), "pc.log");
}

export function log(kind, text = "") {
  const file = logPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size > MAX) fs.renameSync(file, `${file}.1`);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const line = `${new Date().toISOString()} ${kind}${text ? ` ${text}` : ""}`;
  fs.appendFileSync(file, `${line.replace(/[\r\n]+/g, " ")}\n`);
}
