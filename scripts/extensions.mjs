// The Nimbalyst extensions: each one under extensions/ is built from source when Nimbalyst is there. A running
// Nimbalyst reads its extension folders mid-session, so a build never goes into them: it is built into
// extensions-pending/.part/<folder>, renamed to extensions-pending/<folder> when its install script ended well,
// and swapped in by scripts/nimbalyst-patch/ext-swap.mjs only while Nimbalyst is closed (at once when it is closed
// now; else at its close or through /update-setup). One whose source is as at the last build and that is
// installed or pending is left alone. sourceText is the extension's source as one text; the updater compares two
// versions by it too.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fwd, read, sha, sourceOf } from "./files.mjs";
import {
  partDir,
  pendingDir,
  pendingNames,
  swapPending,
} from "./nimbalyst-patch/ext-swap.mjs";
import { EXT_FOLDER } from "./nimbalyst-paths.mjs";

export const sourceText = (dir) =>
  sourceOf(dir)
    .sort()
    .map((f) => f + "\n" + read(path.join(dir, f)))
    .join("\n");

const WAITING = "(goes in when Nimbalyst is closed)";

// read-aloud needs a speech program of its own, so it is only built with --with read-aloud or where it is installed already.
export function extensions(ctx) {
  const { REPO, DRY, state, nextState, say, onPath, withNames, extHome } = ctx;
  // SETUP_EXT_SOURCES: another folder of extension sources (the tests build a broken one)
  const extDir = process.env.SETUP_EXT_SOURCES
    ? path.resolve(process.env.SETUP_EXT_SOURCES)
    : path.join(REPO, "extensions");
  const names = fs.existsSync(extDir)
    ? fs
        .readdirSync(extDir)
        .filter((n) => fs.existsSync(path.join(extDir, n, "package.json")))
    : [];
  // The extensions are built in English whatever language Claude answers in: Nimbalyst itself is English, and a
  // Russian panel beside it read as half-translated (user, 2026-11-16: "Always English"). The language stays in the
  // print, so an install built in Russian before rebuilds once in English.
  const EXT_LANG = "english";
  const printOf = (dir) => sha(sourceText(dir) + `\nlanguage:${EXT_LANG}`);
  const builtExt = { ...(state.extensions || {}) };
  if (names.length && ctx.wantExt && ctx.appData && fs.existsSync(extHome)) {
    const only = (process.env.SETUP_EXTENSIONS || "")
      .split(",")
      .filter(Boolean); // the tests build one
    const pending = pendingDir(extHome);
    const part = partDir(extHome);
    const nameOf = (folder) =>
      Object.keys(EXT_FOLDER).find((n) => EXT_FOLDER[n] === folder) || folder;
    // npm beside the running Node counts when the PATH lacks it (a Mac started from the dock has a short PATH)
    const nodeDir = path.dirname(process.execPath);
    const npmBeside =
      !onPath("npm") &&
      ["npm", "npm.cmd"].some((f) => fs.existsSync(path.join(nodeDir, f)));
    for (const name of names.filter((n) => !only.length || only.includes(n))) {
      const dir = path.join(extDir, name);
      const folder = EXT_FOLDER[name] || name;
      const there =
        fs.existsSync(path.join(extHome, "extensions", folder)) ||
        fs.existsSync(path.join(pending, folder));
      if (
        name === "read-aloud" &&
        !withNames.includes("read-aloud") &&
        !there
      ) {
        say(
          `extension left out: read-aloud (it needs its own speech program; see ${fwd(path.join(dir, "README.md"))}; add it with --with read-aloud)`,
        );
        continue;
      }
      if (builtExt[name] === printOf(dir) && there) {
        // a pending one is named below, with the swap
        if (!fs.existsSync(path.join(pending, folder)))
          say(`extension unchanged: ${name}`);
        continue;
      }
      const plain = [
        "ink-themes",
        "agents-panel",
        "board-tidy",
        "job-tracker",
      ].includes(name); // build with Node alone
      if (!plain && !onPath("npm") && !npmBeside) {
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
            // install-ext builds first, then copies dist/
            ["npm", ["run", "install-ext"]],
          ];
      // the four plain build.mjs never empty their target, so the side folder is emptied here
      const built = path.join(part, folder);
      fs.rmSync(built, { recursive: true, force: true });
      const env = {
        ...process.env,
        SETUP_LANGUAGE: EXT_LANG,
        SETUP_EXT_STAGE: part,
      };
      if (npmBeside)
        for (const key of Object.keys(env).filter((k) => /^path$/i.test(k)))
          env[key] = `${nodeDir}${path.delimiter}${env[key]}`;
      let failed = "";
      for (const [cmd, a] of steps) {
        // windowsHide: a quiet run starts the installer hidden and detached; these runs open no window
        const run = {
          cwd: dir,
          encoding: "utf8",
          timeout: 600000,
          env,
          windowsHide: true,
        };
        const r =
          cmd === "npm"
            ? spawnSync(`npm ${a.join(" ")}`, { ...run, shell: true })
            : spawnSync(cmd, a, run);
        if (r.status === 0) continue;
        failed = `${path.basename(cmd)} ${a.join(" ")}: ${(`${r.stderr || ""}${r.stdout || ""}`.trim() || String(r.error || "no output")).split("\n").slice(-4).join(" | ")}`;
        break;
      }
      if (!failed && !fs.existsSync(path.join(built, "manifest.json")))
        failed = `its install script left no manifest.json in ${fwd(built)}`;
      if (failed) {
        fs.rmSync(built, { recursive: true, force: true });
        say(
          `extension failed: ${name} (${failed}). The installed one stays; everything else was installed; run this again to retry.`,
        );
        continue;
      }
      fs.rmSync(path.join(pending, folder), { recursive: true, force: true });
      fs.renameSync(built, path.join(pending, folder));
      // recorded when staged: the swap is the same build, whenever it happens
      builtExt[name] = printOf(dir);
    }
    if (!DRY) {
      // every pending folder, also one an earlier run left: in now when Nimbalyst is closed, else named as waiting
      const speech = (name) =>
        name === "read-aloud"
          ? ` (it needs its own speech program; see ${fwd(path.join(extDir, name, "README.md"))})`
          : "";
      const swap = swapPending({ data: extHome });
      for (const folder of swap.swapped)
        say(`extension installed: ${nameOf(folder)}${speech(nameOf(folder))}`);
      for (const { folder, error } of swap.failed)
        say(
          `extension waiting: ${nameOf(folder)} (goes in when Nimbalyst is closed; putting it in now failed: ${error})`,
        );
      if (swap.running)
        for (const folder of pendingNames(extHome))
          say(`extension waiting: ${nameOf(folder)} ${WAITING}`);
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
