// The script door: how a script on this PC (a nightly run whose mail is refused, say) asks for a "needs you" alert
// in the bot chat without a Nimbalyst session. The script calls askAlert({ project, title }), which writes one
// <app folder>/alert-in/<random>.json file { project, title } (a temp name renamed into place, so a half-written
// file is never read). The PC program's alert watcher (actions/alerts.mjs sendScriptAlerts) reads the folder every
// second, sends "<project> · <title>: needs you" by the user's needs-you choice, and removes the file once the relay
// socket took it. Only this module's own imports (node and mode.mjs), so a script can load it alone.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appDir } from "./mode.mjs";

export const scriptAlertDir = () => path.join(appDir(), "alert-in");

// Writes one ask; returns its file. Throws when project or title is empty: an ask must say what needs the user.
export function askAlert({ project, title }) {
  for (const [k, v] of Object.entries({ project, title }))
    if (typeof v !== "string" || !v.trim())
      throw new Error(`askAlert: ${k} must be a non-empty string`);
  const dir = scriptAlertDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `${Date.now()}-${randomBytes(4).toString("hex")}.json`,
  );
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ project, title }), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

// The waiting asks, oldest first: [{ file, ask }] or [{ file, error }] for a file that is not a valid ask.
export function waitingAlerts() {
  const dir = scriptAlertDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const file = path.join(dir, f);
      try {
        const a = JSON.parse(fs.readFileSync(file, "utf8"));
        for (const k of ["project", "title"])
          if (typeof a?.[k] !== "string" || !a[k].trim())
            throw new Error(`no ${k}`);
        return { file, ask: { project: a.project, title: a.title } };
      } catch (e) {
        return { file, error: e.message };
      }
    });
}
