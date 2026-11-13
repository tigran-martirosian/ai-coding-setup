// Where Nimbalyst keeps its data: @nimbalyst/electron under the app-data folder of this computer
// (Application Support on a Mac, APPDATA on Windows), and the folder name of each extension in it.
import os from "node:os";
import path from "node:path";

export const appDataDir = () =>
  process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support")
    : process.env.APPDATA || "";
export const nimbalystHome = (appData = appDataDir()) =>
  path.join(appData, "@nimbalyst", "electron");
// The folder each extension (named as in the repo) has in Nimbalyst's extensions folder
export const EXT_FOLDER = {
  "ink-themes": "inktheme",
  "agents-panel": "agentspanel",
  "board-tidy": "boardtidy",
  "usage-plan": "usageplan",
  commands: "commandbuttons",
  "read-aloud": "readaloud",
  "systems-map": "systemsmap",
};
