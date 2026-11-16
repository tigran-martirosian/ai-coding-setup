// ~/.phone-app/pc.log: one line per connect, pairing, page check, refused action, alert kind or error.
// Never a secret, a key, the relay address, session text or a prompt. 1 MB per file, two files kept.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX = 1024 * 1024;

export function logPath() {
  return path.join(os.homedir(), ".phone-app", "pc.log");
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
