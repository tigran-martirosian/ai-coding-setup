// Where hooks keep what they remember between calls: ~/.claude/hooks/state/<hook>/<key>.json.
// The home folder is os.homedir(), which follows HOME / USERPROFILE (the tests point those at a temp folder).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crashLog } from "./crash-log.mjs";

export const STATE_DIR = path.join(os.homedir(), ".claude", "hooks", "state");

export const stateFile = (hook, key) => path.join(STATE_DIR, hook, `${key}.json`);

// The JSON in a file; `missing` when there is no such file. Any other failure (unreadable, not JSON) is crash-logged
// and gives `missing` too, so the hook goes on with no memory instead of failing.
export function readJson(file, { missing = null } = {}) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (err) {
    if (err.code === "ENOENT") return missing;
    crashLog("state", err);
    return missing;
  }
  try { return JSON.parse(text); } catch (err) {
    crashLog("state", new Error(`${file} is not valid JSON: ${err.message}`));
    return missing;
  }
}

// Writes a .part file of its own (one per process, so two hooks saving at once never share one) and renames
// it over the old one, so a reader never sees half a file
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = `${file}.${process.pid}.part`;
  fs.writeFileSync(part, JSON.stringify(value));
  fs.renameSync(part, file);
}

// Removes the hook's state files not touched for `days` days
export function sweep(hook, days) {
  const dir = path.join(STATE_DIR, hook);
  let names;
  try { names = fs.readdirSync(dir); } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  const cutoff = Date.now() - days * 86400000;
  for (const n of names) {
    const f = path.join(dir, n);
    if (fs.statSync(f).mtimeMs < cutoff) fs.rmSync(f, { force: true });
  }
}
