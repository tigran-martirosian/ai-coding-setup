// Turns Nimbalyst's own updater off: Nimbalyst versions come through the setup, which checks a version
// before it hands it out, then installs it when Nimbalyst closes and patches it again.
// Six edits in the 0.83.0 main bundle, all or none:
//   1. boot: no timed checks; instead a will-quit listener that starts the setup's delivery script when a
//      version is staged (see below);
//   2. AutoUpdaterService: no download and no install on quit, even when a check slips through;
//   3. the menu's "Check for Updates" says where updates come from instead of checking;
//   4. the renderer's check-for-updates IPC checks nothing;
//   5. the quit word: a second launch `Nimbalyst.exe <QUIT_WORD>` hands its argv to the running app's
//      second-instance handler, which then quits through app.quit(), the same path as the tray Quit
//      (the second launch exits by itself). The setup's restart script uses it to close Nimbalyst cleanly;
//   6. before-quit: a quit by the word skips only the "AI Session in Progress" dialog. It sets its own
//      flag, never isAppQuitting, so the cleanup that follows the dialog still runs.
// The listener reads staged.json from NIMBALYST_DELIVER_DATA when set, else %LOCALAPPDATA%/ai-coding-setup/nimbalyst.
// Only when that file names a Node binary and a delivery script does it start `<node> <deliver> --after-quit`,
// detached and hidden, with the data folder as working folder (the app's install folder must stay free for
// the installer). It never runs process.execPath: that is Nimbalyst.exe. Errors, and each quit by the word, go
// to quit-hook.log in the data folder; the app's quit is never held up. The patch holds no path to the user's
// own setup folder.
// `upstream: null`: this patch never retires. `requiredFirst`: applied before all others, and when it is
// skipped no patch is applied at all (without it, the next Nimbalyst update would wipe every fix).

// A lowercase switch: never a file or folder path, never a nimbalyst:// deep link. restart.mjs imports it.
export const QUIT_WORD = "--ai-coding-setup-quit";

export default {
  id: "updater-block",
  files: /^out\/main\/index\.js$/,
  upstream: null,
  requiredFirst: true,
  edits: [
    // boot (the app.isPackaged branch): the log line names the logger, so a renamed logger is an anchor change
    {
      anchor: `    logger$p.main.info("Starting auto-updater service");
    autoUpdaterService.startAutoUpdateCheck(60);
`,
      replace: `    logger$p.main.info("Auto-updater off: Nimbalyst updates come through the Claude Code setup");
    require("electron").app.once("will-quit", () => {
      const fs2 = require("fs"), path2 = require("path");
      const dir = process.env.NIMBALYST_DELIVER_DATA || (process.env.LOCALAPPDATA && path2.join(process.env.LOCALAPPDATA, "ai-coding-setup", "nimbalyst"));
      if (!dir) return;
      const log2 = (line) => { try { fs2.appendFileSync(path2.join(dir, "quit-hook.log"), new Date().toISOString() + " " + line + "\\n"); } catch {} };
      try {
        const file = path2.join(dir, "staged.json");
        if (!fs2.existsSync(file)) return;
        const staged = JSON.parse(fs2.readFileSync(file, "utf8"));
        if (typeof staged.node !== "string" || !staged.node || typeof staged.deliver !== "string" || !staged.deliver) throw new Error(file + " names no node and deliver script");
        const child = require("child_process").spawn(staged.node, [staged.deliver, "--after-quit"], { cwd: dir, detached: true, stdio: "ignore", windowsHide: true });
        child.on("error", (e) => log2("could not start " + staged.deliver + ": " + e.message));
        child.unref();
        log2("started " + staged.deliver + " --after-quit for Nimbalyst " + staged.version);
      } catch (e) { log2("failed: " + (e && e.message)); }
    });
`,
    },
    // AutoUpdaterService constructor
    {
      anchor: `    mainExports.autoUpdater.autoDownload = true;
    mainExports.autoUpdater.autoInstallOnAppQuit = true;
`,
      replace: `    mainExports.autoUpdater.autoDownload = false;
    mainExports.autoUpdater.autoInstallOnAppQuit = false;
`,
    },
    // checkForUpdatesWithUI (the menu's "Check for Updates")
    {
      anchor: `await mainExports.autoUpdater.checkForUpdates();`,
      replace: `this.isManualCheck = false; this.sendToFrontmostWindow("update-toast:error", { message: "Nimbalyst updates come through the Claude Code setup: run /update-setup" });`,
    },
    // the check-for-updates IPC handler
    {
      anchor: `const result2 = await mainExports.autoUpdater.checkForUpdatesAndNotify();`,
      replace: `const result2 = null;`,
    },
    // the second-instance handler of the running app: the word is matched before any launch target is read
    {
      anchor: `    require$$1$2.app.on("second-instance", (_event, argv, workingDirectory) => {
      logger$p.main.info("[SingleInstance] second-instance event, argv:", argv);
`,
      replace: `    require$$1$2.app.on("second-instance", (_event, argv, workingDirectory) => {
      logger$p.main.info("[SingleInstance] second-instance event, argv:", argv);
      if (argv.includes(${JSON.stringify(QUIT_WORD)})) {
        try {
          const fs2 = require("fs"), path2 = require("path");
          const dir = process.env.NIMBALYST_DELIVER_DATA || (process.env.LOCALAPPDATA && path2.join(process.env.LOCALAPPDATA, "ai-coding-setup", "nimbalyst"));
          if (dir) fs2.appendFileSync(path2.join(dir, "quit-hook.log"), new Date().toISOString() + " quit word received, quitting\\n");
        } catch {}
        globalThis.__claudeSetupQuitWord = true;
        require$$1$2.app.quit();
        return;
      }
`,
    },
    // before-quit: a quit by the word skips the "AI Session in Progress" dialog, nothing else
    {
      anchor: `  if (hasActiveStreamingSessions() && !process.env.PLAYWRIGHT) {`,
      replace: `  if (hasActiveStreamingSessions() && !process.env.PLAYWRIGHT && !globalThis.__claudeSetupQuitWord) {`,
    },
  ],
};
