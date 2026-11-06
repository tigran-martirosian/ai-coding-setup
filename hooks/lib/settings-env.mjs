// A hook switch can sit in a project's settings "env": settings env may not reach a hook process, so the files are
// read directly. The value comes from the process env first, then from settings.local.json and settings.json of
// the project folder (CLAUDE_PROJECT_DIR, else the working folder) and each folder above it. "" when nowhere.
// A settings file that is not valid JSON is crash-logged and skipped, so one half-edited file cannot stop a hook.
import fs from "node:fs";
import path from "node:path";
import { crashLog } from "./crash-log.mjs";

export function setting(name, startDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  if (process.env[name]) return process.env[name];
  for (let d = path.resolve(startDir); ; d = path.dirname(d)) {
    for (const f of ["settings.local.json", "settings.json"]) {
      let text;
      try { text = fs.readFileSync(path.join(d, ".claude", f), "utf8"); } catch (e) { if (e.code === "ENOENT" || e.code === "ENOTDIR") continue; throw e; }
      let json;
      try { json = JSON.parse(text); } catch (e) { crashLog("settings-env", new Error(`${path.join(d, ".claude", f)} is not valid JSON, skipped: ${e.message}`)); continue; }
      const value = json?.env?.[name];
      if (value !== undefined && value !== null && value !== "") return String(value);
    }
    if (path.dirname(d) === d) return "";
  }
}
