// The Nimbalyst extensions: each one under extensions/ is built from source and installed into Nimbalyst's
// own extensions folder, when Nimbalyst is there. One whose source is as at the last run is left alone.
// sourceText is the extension's source as one text; the updater compares two versions by it too.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fwd, read, sha, sourceOf } from "./files.mjs";
import { EXT_FOLDER } from "./nimbalyst-paths.mjs";

export const sourceText = (dir) =>
  sourceOf(dir)
    .sort()
    .map((f) => f + "\n" + read(path.join(dir, f)))
    .join("\n");

// read-aloud needs a speech program of its own, so it is only built with --with read-aloud or where it is installed already.
export function extensions(ctx) {
  const { REPO, DRY, LANG, state, nextState, say, onPath, withNames, extHome } =
    ctx;
  const extDir = path.join(REPO, "extensions");
  const names = fs.existsSync(extDir)
    ? fs
        .readdirSync(extDir)
        .filter((n) => fs.existsSync(path.join(extDir, n, "package.json")))
    : [];
  // The extensions are built in the language (SETUP_LANGUAGE), so it is part of what is compared
  const EXT_LANG = LANG || "english";
  const printOf = (dir) => sha(sourceText(dir) + `\nlanguage:${EXT_LANG}`);
  const builtExt = { ...(state.extensions || {}) };
  if (names.length && ctx.wantExt && ctx.appData && fs.existsSync(extHome)) {
    const only = (process.env.SETUP_EXTENSIONS || "")
      .split(",")
      .filter(Boolean); // the tests build one
    for (const name of names.filter((n) => !only.length || only.includes(n))) {
      const dir = path.join(extDir, name);
      const target = path.join(extHome, "extensions", EXT_FOLDER[name] || name);
      if (
        name === "read-aloud" &&
        !withNames.includes("read-aloud") &&
        !fs.existsSync(target)
      ) {
        say(
          `extension left out: read-aloud (it needs its own speech program; see ${fwd(path.join(dir, "README.md"))}; add it with --with read-aloud)`,
        );
        continue;
      }
      if (builtExt[name] === printOf(dir) && fs.existsSync(target)) {
        say(`extension unchanged: ${name}`);
        continue;
      }
      const plain = ["ink-themes", "agents-panel", "board-tidy"].includes(name); // build with Node alone
      if (!plain && !onPath("npm")) {
        say(
          `extension not built: ${name} (npm is not on the PATH; install Node.js with npm and run this again)`,
        );
        continue;
      }
      if (DRY) {
        say(`extension would be built and installed: ${name}`);
        continue;
      }
      const steps = plain
        ? [
            [process.execPath, ["build.mjs"]],
            [process.execPath, ["build.mjs", "--install"]],
          ]
        : [
            ["npm", ["ci"]],
            ["npm", ["run", "build"]],
            ["npm", ["run", "install-ext"]],
          ];
      let failed = "";
      for (const [cmd, a] of steps) {
        const run = {
          cwd: dir,
          encoding: "utf8",
          timeout: 600000,
          env: { ...process.env, SETUP_LANGUAGE: EXT_LANG },
        };
        const r =
          cmd === "npm"
            ? spawnSync(`npm ${a.join(" ")}`, { ...run, shell: true })
            : spawnSync(cmd, a, run);
        if (r.status === 0) continue;
        failed = `${path.basename(cmd)} ${a.join(" ")}: ${(`${r.stderr || ""}${r.stdout || ""}`.trim() || String(r.error || "no output")).split("\n").slice(-4).join(" | ")}`;
        break;
      }
      if (failed) {
        say(
          `extension failed: ${name} (${failed}). Everything else was installed; run this again to retry.`,
        );
        continue;
      }
      builtExt[name] = printOf(dir);
      say(
        `extension installed: ${name}${name === "read-aloud" ? ` (it needs its own speech program; see ${fwd(path.join(dir, "README.md"))})` : ""} (quit Nimbalyst and open it again to load it)`,
      );
    }
    if (
      !DRY &&
      JSON.stringify(builtExt) !== JSON.stringify(state.extensions || {})
    )
      nextState.extensions = builtExt;
  } else if (names.length) {
    say(
      `Nimbalyst extensions are not installed by this script: ${names.join(", ")}. For each one, in ${fwd(path.join(REPO, "extensions"))}/<name>: npm ci, npm run build, npm run install-ext, then restart Nimbalyst.`,
    );
  }
}
