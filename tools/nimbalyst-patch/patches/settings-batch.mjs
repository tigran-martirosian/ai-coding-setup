// Our own change, not an upstream PR: Nimbalyst freezes while it saves settings. Its PrivateSettingsStore (main
// bundle, on top of electron-store's `conf`) writes on every single `set`: it re-reads and re-parses the whole
// file, takes a lock (four file operations), re-reads the file for the credential check, then rewrites it and
// fsyncs. workspace-settings.json is about 2 MB, and a project switch sets several keys in a row, so the main
// process stalls and every other request waits behind it.
// This keeps the newest value in memory and writes it once, 1 s after the last change (the same write, lock,
// credential check and fsync as before, once per burst). Reads during that second get a copy of the pending
// value. The pending writes are flushed on will-quit, process exit, a window losing focus, system suspend and
// shutdown, so only a crash or a forced kill within that second loses the last changes (Chromium's Preferences
// wait 10 s, VS Code's state 0.1 s plus 60 s for UI state). A failed write keeps the value pending, is logged
// and rethrown, so Nimbalyst's error handler shows it, and the next change or the quit tries again.
// Never retires: no upstream fix to wait for yet.
const TIMER_MS = 1000;

export default {
  id: "settings-batch",
  files: /^out\/main\/index\.js$/,
  upstream: null,
  edits: [
    {
      anchor: `class PrivateSettingsStore extends Store {
  // conf re-reads and re-parses the file on every access and, with
`,
      replace: `// settings-batch patch: settings writes are kept in memory and written once per burst.
const settingsBatchPending = /* @__PURE__ */ new Set();
let settingsBatchTimer = null;
let settingsBatchHooked = false;
function settingsBatchFlushAll() {
  if (settingsBatchTimer) {
    clearTimeout(settingsBatchTimer);
    settingsBatchTimer = null;
  }
  const stores = [...settingsBatchPending];
  settingsBatchPending.clear();
  let failed = null;
  for (const store2 of stores) {
    try {
      store2.__settingsBatchFlush();
    } catch (error2) {
      settingsBatchPending.add(store2);
      console.error("[settings-batch] write failed for", store2.path, error2);
      failed ??= error2;
    }
  }
  if (failed) throw failed;
}
function settingsBatchFlushOnExit() {
  try {
    settingsBatchFlushAll();
  } catch (error2) {
    console.error("[settings-batch] flush on quit failed:", error2);
  }
}
function settingsBatchSchedule(store2) {
  settingsBatchPending.add(store2);
  if (!settingsBatchHooked) {
    settingsBatchHooked = true;
    process.on("exit", settingsBatchFlushOnExit);
    require$$1$2.app.on("will-quit", settingsBatchFlushOnExit);
    require$$1$2.app.on("browser-window-blur", settingsBatchFlushOnExit);
    require$$1$2.app.whenReady().then(() => {
      require$$1$2.powerMonitor.on("suspend", settingsBatchFlushOnExit);
      require$$1$2.powerMonitor.on("shutdown", settingsBatchFlushOnExit);
    });
  }
  if (!settingsBatchTimer) {
    settingsBatchTimer = setTimeout(() => {
      settingsBatchTimer = null;
      settingsBatchFlushAll();
    }, ${TIMER_MS});
  }
}
class PrivateSettingsStore extends Store {
  // conf re-reads and re-parses the file on every access and, with
`,
    },
    {
      anchor: `  // whole file. An empty result is only trusted when the file is really empty.
  get store() {
`,
      replace: `  // whole file. An empty result is only trusted when the file is really empty.
  get store() {
    if (this.__settingsBatchValue !== void 0) return structuredClone(this.__settingsBatchValue);
`,
    },
    {
      anchor: `  set store(value2) {
    withCredentialLock(path$3.dirname(this.path), () => {
      super.store = value2;
    });
  }
`,
      replace: `  set store(value2) {
    this.__settingsBatchValue = value2;
    settingsBatchSchedule(this);
    this.events?.emit("change");
  }
  __settingsBatchFlush() {
    const value2 = this.__settingsBatchValue;
    if (value2 === void 0) return;
    withCredentialLock(path$3.dirname(this.path), () => {
      super.store = value2;
    });
    if (this.__settingsBatchValue === value2) this.__settingsBatchValue = void 0;
  }
`,
    },
  ],
};
