// ~/.phone-app/pc-state.json: the user's choices (alerts, pins, hidden sessions) and open handles.
// No file yet means nothing has been chosen yet.
import fs from "node:fs";
import path from "node:path";
import { appDir, checkPath, writeText } from "./files.mjs";

const statePath = () => path.join(appDir(), "pc-state.json");

export function readState() {
  const real = checkPath(statePath());
  if (!fs.existsSync(real)) return {};
  try {
    return JSON.parse(fs.readFileSync(real, "utf8"));
  } catch (e) {
    throw new Error(`${statePath()} is not valid JSON: ${e.message}`);
  }
}

// `change` gets the state and changes it in place; the whole file is then written again.
export function updateState(change) {
  const state = readState();
  change(state);
  writeText(statePath(), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}
