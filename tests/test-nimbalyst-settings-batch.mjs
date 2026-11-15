// settings-batch patch: runs the patched PrivateSettingsStore on a stand-in for conf's Store and Electron, and
// checks that a burst of changes is one write, reads see the pending value, quit and blur flush, and a failed
// write stays pending and is rethrown.
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PATCH = path.join(
  HERE,
  "..",
  "tools",
  "nimbalyst-patch",
  "patches",
  "settings-batch.mjs",
);
const patch = (await import(pathToFileURL(PATCH).href)).default;

let failed = 0,
  passed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${detail}`}`,
  );
}

// The class as 0.83.0 has it, cut to the parts the anchors touch.
const ORIGINAL = `class PrivateSettingsStore extends Store {
  // conf re-reads and re-parses the file on every access and, with
  // whole file. An empty result is only trusted when the file is really empty.
  get store() {
    let value2 = super.store;
    return value2;
  }
  set store(value2) {
    withCredentialLock(path$3.dirname(this.path), () => {
      super.store = value2;
    });
  }
}
`;
let text = ORIGINAL;
for (const e of patch.edits) {
  const n = text.split(e.anchor).length - 1;
  check(
    `anchor found once: ${JSON.stringify(e.anchor.slice(0, 40))}`,
    n === 1,
    `${n} times`,
  );
  text = text.replace(e.anchor, () => e.replace);
}

function world({ failWrites = 0 } = {}) {
  const disk = { value: { a: 1 }, writes: 0, fails: failWrites, locks: 0 };
  const app = new EventEmitter();
  app.whenReady = () => Promise.resolve();
  const powerMonitor = new EventEmitter();
  const proc = new EventEmitter();
  const timers = [];
  class Store {
    constructor() {
      this.path = "C:/x/workspace-settings.json";
      this.events = new EventEmitter();
    }
    get store() {
      return structuredClone(disk.value);
    }
    set store(v) {
      if (disk.fails > 0) {
        disk.fails--;
        throw new Error("disk full");
      }
      disk.value = structuredClone(v);
      disk.writes++;
      this.events.emit("change");
    }
    set(k, v) {
      const { store } = this;
      store[k] = v;
      this.store = store;
    }
    get(k) {
      return this.store[k];
    }
  }
  const ctx = vm.createContext({
    Store,
    structuredClone,
    console: { error() {} },
    path$3: path,
    withCredentialLock: (_d, op) => {
      disk.locks++;
      return op();
    },
    require$$1$2: { app, powerMonitor },
    process: proc,
    setTimeout: (fn, ms) => {
      const t = { fn, ms, done: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      if (t) t.done = true;
    },
  });
  vm.runInContext(
    `${text}\nthis.PrivateSettingsStore = PrivateSettingsStore; this.flushAll = settingsBatchFlushAll;`,
    ctx,
  );
  const fire = () => {
    for (const t of timers.splice(0))
      if (!t.done) {
        t.done = true;
        t.fn();
      }
  };
  return {
    disk,
    app,
    powerMonitor,
    proc,
    timers,
    fire,
    Store: ctx.PrivateSettingsStore,
  };
}

// 1. a burst of five changes: nothing written until the timer, then one write holding all five
{
  const w = world();
  const s = new w.Store();
  let changes = 0;
  s.events.on("change", () => changes++);
  for (let i = 0; i < 5; i++) s.set(`k${i}`, i);
  check(
    "burst: no write before the timer",
    w.disk.writes === 0,
    `${w.disk.writes} writes`,
  );
  check(
    "burst: reads see the pending value",
    s.get("k4") === 4 && s.get("a") === 1,
    JSON.stringify(s.store),
  );
  check(
    "burst: one timer of 1000 ms",
    w.timers.length === 1 && w.timers[0].ms === 1000,
    JSON.stringify(w.timers.map((t) => t.ms)),
  );
  check("burst: a change event per set", changes === 5, `${changes}`);
  w.fire();
  check(
    "burst: one write after the timer, with all five keys and the lock taken once",
    w.disk.writes === 1 &&
      w.disk.locks === 1 &&
      w.disk.value.k0 === 0 &&
      w.disk.value.k4 === 4 &&
      w.disk.value.a === 1,
    JSON.stringify(w.disk),
  );
  check(
    "burst: after the write, reads go to the file again",
    s.__settingsBatchValue === undefined && s.get("k4") === 4,
    "",
  );
}

// 2. a read's copy can't change the pending value
{
  const w = world();
  const s = new w.Store();
  s.set("x", { n: 1 });
  s.store.x.n = 99;
  check(
    "copy: mutating a read leaves the pending value",
    s.get("x").n === 1,
    JSON.stringify(s.get("x")),
  );
}

// 3. flushed on will-quit, process exit, window blur, suspend and shutdown
for (const [label, emit] of [
  ["will-quit", (w) => w.app.emit("will-quit")],
  ["process exit", (w) => w.proc.emit("exit")],
  ["window blur", (w) => w.app.emit("browser-window-blur")],
  ["suspend", (w) => w.powerMonitor.emit("suspend")],
  ["shutdown", (w) => w.powerMonitor.emit("shutdown")],
]) {
  const w = world();
  const s = new w.Store();
  await Promise.resolve();
  s.set("q", 1);
  await Promise.resolve();
  await Promise.resolve();
  emit(w);
  check(
    `flush on ${label}: written at once`,
    w.disk.writes === 1 && w.disk.value.q === 1,
    JSON.stringify(w.disk),
  );
}

// 4. two stores: both flushed by one timer
{
  const w = world();
  const s1 = new w.Store(),
    s2 = new w.Store();
  s1.set("one", 1);
  s2.set("two", 2);
  check(
    "two stores: one shared timer",
    w.timers.length === 1,
    `${w.timers.length}`,
  );
  w.fire();
  check("two stores: both written", w.disk.writes === 2, `${w.disk.writes}`);
}

// 5. a failed write: rethrown, kept pending, written by the next try
{
  const w = world({ failWrites: 1 });
  const s = new w.Store();
  s.set("f", 1);
  let thrown = null;
  try {
    w.fire();
  } catch (e) {
    thrown = e;
  }
  check(
    "failed write: rethrown",
    thrown?.message === "disk full",
    String(thrown),
  );
  check(
    "failed write: value still pending and readable",
    s.get("f") === 1 && w.disk.writes === 0,
    "",
  );
  w.app.emit("will-quit");
  check(
    "failed write: the quit flush writes it",
    w.disk.writes === 1 && w.disk.value.f === 1,
    JSON.stringify(w.disk),
  );
}

// 6. nothing pending: a flush writes nothing
{
  const w = world();
  new w.Store();
  w.app.emit("will-quit");
  check(
    "nothing pending: no write on quit",
    w.disk.writes === 0,
    `${w.disk.writes}`,
  );
}

console.log(`${failed} failed, ${passed} passed`);
process.exit(failed ? 1 : 0);
