// Tests for tools/nimbalyst-patch/ext-swap.mjs on a temporary Nimbalyst folder (APPDATA on Windows, HOME on
// macOS moved into the temp folder). Nimbalyst's running state comes from the test switches, never from the
// real process list. Run: node tests/test-ext-swap.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SWAP = fileURLToPath(
  new URL("../tools/nimbalyst-patch/ext-swap.mjs", import.meta.url),
);
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ext-swap-test-"));
// Every file under a folder with its text, relative; [] for a missing folder
const snap = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => {
          const f = path.join(e.parentPath, e.name);
          return [path.relative(dir, f), fs.readFileSync(f, "utf8")];
        })
        .sort()
    : [];
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

// One Nimbalyst folder per case: the environment that points ext-swap.mjs at it
let n = 0;
function nimbalyst() {
  const root = path.join(tmp, `case-${++n}`);
  const env =
    process.platform === "darwin" ? { HOME: root } : { APPDATA: root };
  const data =
    process.platform === "darwin"
      ? path.join(
          root,
          "Library",
          "Application Support",
          "@nimbalyst",
          "electron",
        )
      : path.join(root, "@nimbalyst", "electron");
  const live = path.join(data, "extensions");
  const pending = path.join(data, "extensions-pending");
  write(path.join(live, "inktheme", "manifest.json"), "old ink");
  write(path.join(live, "inktheme", "dist", "theme.css"), "old css");
  write(path.join(live, "jobtracker", "manifest.json"), "tracker");
  write(path.join(pending, "inktheme", "manifest.json"), "new ink");
  write(path.join(pending, "inktheme", "dist", "theme.css"), "new css");
  return { env, data, live, pending };
}
const NO_SWITCH = {
  SETUP_NIMBALYST_OPEN: undefined,
  SETUP_NIMBALYST_OPEN_FILE: undefined,
};
const cli = (env, ...args) => {
  const r = spawnSync(process.execPath, [SWAP, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...NO_SWITCH, ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}`.trim() };
};
// The module reads its environment at each call, so a case sets it here
const ext = await import(pathToFileURL(SWAP).href);
const withEnv = (env, fn) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(process.env))
      if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
};

// ---- not running: the pending folder replaces the live one and the old one is gone
{
  const c = nimbalyst();
  const r = cli({ ...c.env, SETUP_NIMBALYST_OPEN: "no" }, "--swap");
  ok(
    "T9 not running: --swap puts the pending build in, the old one and the pending one are gone",
    [
      r.code,
      r.out,
      snap(path.join(c.live, "inktheme")),
      snap(path.join(c.live, "jobtracker")),
      fs.existsSync(path.join(c.pending, "inktheme")),
      snap(path.join(c.pending, ".old")),
    ],
    [
      0,
      "extensions: swapped in: inktheme",
      [
        [path.join("dist", "theme.css"), "new css"],
        ["manifest.json", "new ink"],
      ],
      [["manifest.json", "tracker"]],
      false,
      [],
    ],
  );
  ok(
    "T9 --status after it: nothing waiting",
    cli(c.env, "--status").out,
    "extensions: nothing waiting",
  );
}

// ---- running: nothing moves
{
  const c = nimbalyst();
  const before = [snap(c.live), snap(c.pending)];
  const status = cli(c.env, "--status").out;
  const r = cli({ ...c.env, SETUP_NIMBALYST_OPEN: "yes" }, "--swap");
  const fromModule = withEnv({ ...c.env, SETUP_NIMBALYST_OPEN: "yes" }, () =>
    ext.swapPending(),
  );
  ok(
    "T9 running: --swap and swapPending move nothing; --status names the waiting folder",
    [
      status,
      r.code,
      r.out,
      fromModule,
      // swap.log is the only new file
      [snap(c.live), snap(c.pending).filter(([f]) => f !== "swap.log")],
    ],
    [
      "extensions: waiting: inktheme",
      1,
      "extensions: Nimbalyst runs; waiting: inktheme",
      { running: true, swapped: [], failed: [] },
      before,
    ],
  );
}

// ---- a second rename that fails: the old folder is back, the pending one stays
{
  const c = nimbalyst();
  const before = [snap(c.live), snap(c.pending)];
  let calls = 0;
  const r = withEnv({ ...c.env, SETUP_NIMBALYST_OPEN: "no" }, () =>
    ext.swapPending({
      rename: (from, to) => {
        if (++calls === 2) throw new Error("rename refused on purpose");
        fs.renameSync(from, to);
      },
    }),
  );
  ok(
    "T9 failed second rename: the old live folder is back and the build stays pending",
    [r, calls, [snap(c.live), snap(c.pending)]],
    [
      {
        running: false,
        swapped: [],
        failed: [{ folder: "inktheme", error: "rename refused on purpose" }],
      },
      3,
      before,
    ],
  );
}

// ---- a .part folder is never swapped
{
  const c = nimbalyst();
  fs.rmSync(path.join(c.pending, "inktheme"), { recursive: true });
  write(path.join(c.pending, ".part", "inktheme", "manifest.json"), "half");
  write(path.join(c.pending, ".part", "boardtidy", "manifest.json"), "half");
  const before = snap(c.live);
  const r = cli({ ...c.env, SETUP_NIMBALYST_OPEN: "no" }, "--swap");
  ok(
    "T9 .part is never swapped: the live folders and the half builds stay as they are",
    [
      r.out,
      cli(c.env, "--status").out,
      snap(c.live),
      fs.readdirSync(c.live).sort(),
      snap(path.join(c.pending, ".part")).length,
    ],
    [
      "extensions: nothing waiting",
      "extensions: nothing waiting",
      before,
      ["inktheme", "jobtracker"],
      2,
    ],
  );
}

// ---- --after-quit returns at once, waits while Nimbalyst runs, and swaps once the running switch clears
{
  const c = nimbalyst();
  const open = path.join(tmp, "nimbalyst-open");
  write(open, "");
  const before = snap(c.live);
  const t0 = Date.now();
  const r = cli(
    { ...c.env, SETUP_NIMBALYST_OPEN_FILE: open, EXT_SWAP_WAIT_MS: "60000" },
    "--after-quit",
  );
  const returned = Date.now() - t0;
  // the detached run is waiting now; while the switch says open, the live folder must not change
  const deadline = Date.now() + 3000;
  let changed = false;
  while (Date.now() < deadline) {
    if (JSON.stringify(snap(c.live)) !== JSON.stringify(before)) changed = true;
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 200)"]);
  }
  fs.rmSync(open);
  const end = Date.now() + 30000;
  while (Date.now() < end && fs.existsSync(path.join(c.pending, "inktheme")))
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 250)"]);
  const log = fs.existsSync(path.join(c.pending, "swap.log"))
    ? fs.readFileSync(path.join(c.pending, "swap.log"), "utf8")
    : "";
  ok(
    "T9 --after-quit: returns at once, moves nothing while Nimbalyst runs, swaps once it has closed",
    [
      r.code,
      r.out,
      returned < 30000,
      changed,
      fs.existsSync(path.join(c.pending, "inktheme")),
      fs.existsSync(path.join(c.live, "inktheme", "manifest.json")) &&
        fs.readFileSync(path.join(c.live, "inktheme", "manifest.json"), "utf8"),
      /--after-quit: inktheme: swapped in/.test(log),
    ],
    [
      0,
      "extensions: they go in once Nimbalyst has closed (up to 2 minutes from now)",
      true,
      false,
      false,
      "new ink",
      true,
    ],
  );
}

ok("a bad flag is refused", cli({}, "--nope").code, 2);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
