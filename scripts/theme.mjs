// The theme: Ink Cobalt for a Nimbalyst where nobody picked a theme yet (scripts/ink-default.mjs). A theme the
// person picked stays. Nimbalyst rewrites its settings file from memory, so the file is written only while it
// is closed; while it runs, the run names the one pick to make. --app-settings <file> is another settings file
// (the tests), written as it is. What changes goes into ctx.nextState.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fwd } from "./files.mjs";
import {
  pickedSincePending,
  PENDING_LINE,
  setInkDefault,
  themeAction,
} from "./ink-default.mjs";
import { EXT_FOLDER } from "./nimbalyst-paths.mjs";

export function theme(ctx) {
  const { DRY, state, nextState, say, opt, extHome } = ctx;
  const appFile =
    opt("app-settings") !== null
      ? path.resolve(opt("app-settings"))
      : path.join(extHome, "app-settings.json");
  const inkThere =
    opt("app-settings") !== null ||
    (ctx.wantExt &&
      fs.existsSync(
        path.join(extHome, "extensions", EXT_FOLDER["ink-themes"]),
      ));
  if (ctx.args.includes("--no-theme") || process.env.SETUP_THEME === "off")
    return say("theme: left as it is (--no-theme or SETUP_THEME=off)");
  if (!inkThere || !(ctx.appData || opt("app-settings") !== null)) return;
  let app = {};
  if (fs.existsSync(appFile)) {
    try {
      app = JSON.parse(fs.readFileSync(appFile, "utf8"));
    } catch (e) {
      app = null;
      say(
        `theme: left as it is (${fwd(appFile)} is not valid JSON: ${e.message})`,
      );
    }
  }
  if (!app) return;
  // a theme picked since an earlier run named the pending line wins over it (the file can be read while Nimbalyst runs)
  const pickedSince =
    state.themePending && pickedSincePending(app, state.themePendingFrom);
  if (pickedSince || themeAction(app, state.inkSwitched) === "keep") {
    say(`theme: left as it is (${app.theme})`);
    // an Ink theme already picked counts as the one switch made, so a theme picked later stays
    if (!DRY && (!state.inkSwitched || state.themePending)) {
      nextState.inkSwitched = true;
      delete nextState.themePending;
      delete nextState.themePendingFrom;
    }
    return;
  }
  // SETUP_NIMBALYST_OPEN=yes|no: the tests say whether Nimbalyst runs
  const running = process.env.SETUP_NIMBALYST_OPEN
    ? process.env.SETUP_NIMBALYST_OPEN === "yes"
    : opt("app-settings") === null &&
      (process.platform === "win32"
        ? /Nimbalyst\.exe/i.test(
            spawnSync(
              "tasklist",
              ["/FI", "IMAGENAME eq Nimbalyst.exe", "/NH"],
              { encoding: "utf8" },
            ).stdout || "",
          )
        : spawnSync("pgrep", ["-x", "Nimbalyst"]).status === 0);
  if (running) {
    // The file can't be written; /update-setup sets the theme through Nimbalyst itself (skills/update-setup/SKILL.md)
    // and then runs update.mjs --theme-done. Until then it stays pending and update.mjs names it again.
    say(PENDING_LINE);
    if (!DRY) {
      nextState.themePending = true;
      nextState.themePendingFrom = state.themePending
        ? state.themePendingFrom
        : (app.theme ?? null);
    }
    return;
  }
  setInkDefault(app);
  if (DRY) return say(`theme: would be set to Ink Cobalt in ${fwd(appFile)}`);
  const copy = fs.existsSync(appFile) ? ctx.keepCopy(appFile) : null;
  fs.writeFileSync(appFile, JSON.stringify(app, null, 2) + "\n");
  nextState.inkSwitched = true;
  delete nextState.themePending;
  delete nextState.themePendingFrom;
  say(
    `theme: set to Ink Cobalt in ${fwd(appFile)}${copy ? ` (old copy: ${ctx.short(copy)})` : ""}`,
  );
}
