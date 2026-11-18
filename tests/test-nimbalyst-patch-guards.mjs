// node tests/test-nimbalyst-patch-guards.mjs
// The patcher's guards on a fake install (tests/lib/nimbalyst-patch-fixture.mjs): code that does not compile, the
// integrity fuse, a per-machine install, a running app, bad usage and patch files, the real patch files' shape, a
// requiredFirst patch, and runningFrom.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  check,
  cleanup,
  DEP,
  hashOf,
  LABEL,
  MAINP,
  makeApp,
  PATCHER,
  patchDir,
  R_CHUNKS,
  R_MAIN,
  run,
  summary,
  T,
} from "./lib/nimbalyst-patch-fixture.mjs";

try {
  let r, st;
  const ALL = patchDir("all", { label: LABEL, main: MAINP, dep: DEP });

  // 6. code that does not compile: nothing written
  const C = makeApp("compile"),
    cBefore = hashOf(C.asar);
  const CP = patchDir("compile", {
    badmain: `files: ${R_MAIN}, edits: [{ anchor: "return a;}", replace: "return a;}}" }], upstream: "UPSTREAM_BADMAIN"`,
    badchunk: `files: ${R_CHUNKS}, edits: [{ anchor: "export function f()", replace: "export function f(((" }], upstream: "UPSTREAM_BADCHUNK"`,
  });
  r = run(["--app", C.res, "--patches", CP]);
  check(
    "compile failure: exit 1, both files named, app.asar untouched, no backup, no tmp, no marker",
    r.code === 1 &&
      /does not compile, nothing written/.test(r.out) &&
      /out\/main\/index\.js \(changed by badmain\)/.test(r.out) &&
      /index-AAAA1111\.js \(changed by badchunk\)/.test(r.out) &&
      hashOf(C.asar) === cBefore &&
      !fs.existsSync(C.orig) &&
      !fs.existsSync(C.asar + ".patched-tmp") &&
      !fs.existsSync(C.marker),
    r.out,
  );

  // 7. fuse on, per-machine install: refused
  const F = makeApp("fuse", { fuse: "1" }),
    fBefore = hashOf(F.asar);
  r = run(["--app", F.res, "--patches", ALL]);
  check(
    "integrity fuse on: refused, nothing written",
    r.code === 1 &&
      /refused: .*EnableEmbeddedAsarIntegrityValidation fuse on/.test(r.out) &&
      hashOf(F.asar) === fBefore &&
      !fs.existsSync(F.orig),
    r.out,
  );
  st = run(["--status", "--app", F.res, "--patches", ALL]);
  check(
    "integrity fuse on: status says so",
    st.code === 0 && /IntegrityValidation: ON/.test(st.out),
    st.out,
  );
  const PF = path.join(T, "pf");
  const M = makeApp("machine", { under: PF }),
    mBefore = hashOf(M.asar);
  r = run(["--app", M.res, "--patches", ALL], {
    NIMBALYST_PATCH_PROGRAM_DIRS: PF,
  });
  check(
    "per-machine install: refused, nothing written",
    r.code === 1 &&
      /refused: .*per-machine install .*can't patch here/.test(r.out) &&
      hashOf(M.asar) === mBefore,
    r.out,
  );
  st = run(["--status", "--app", M.res, "--patches", ALL], {
    NIMBALYST_PATCH_PROGRAM_DIRS: PF,
  });
  check(
    "per-machine install: status says so",
    /install: per-machine/.test(st.out),
    st.out,
  );

  // 8. a running Nimbalyst.exe from the install dir: refused (Windows: a node.exe linked under that name)
  if (process.platform === "win32") {
    const W = makeApp("running"),
      wBefore = hashOf(W.asar),
      exe = path.join(W.install, "bin", "Nimbalyst.exe");
    fs.mkdirSync(path.dirname(exe));
    try {
      fs.linkSync(process.execPath, exe);
    } catch {
      fs.copyFileSync(process.execPath, exe);
    }
    const child = spawn(exe, ["-e", "setTimeout(() => {}, 60000)"], {
      stdio: "ignore",
    });
    await new Promise((res, rej) => {
      child.on("spawn", res);
      child.on("error", rej);
    });
    try {
      r = run(["--app", W.res, "--patches", ALL]);
      check(
        "running app: refused, nothing written",
        r.code === 1 &&
          /refused: Nimbalyst is running/.test(r.out) &&
          hashOf(W.asar) === wBefore,
        r.out,
      );
    } finally {
      child.kill();
      await new Promise((res) => child.on("exit", res));
    }
  }

  // 9. bad usage and bad patch files (on any install: --status only)
  const N = makeApp("usage");
  r = run(["--bogus"]);
  check(
    "unknown option: exit 2",
    r.code === 2 && /unknown or incomplete option --bogus/.test(r.out),
    r.out,
  );
  r = run([
    "--status",
    "--app",
    N.res,
    "--patches",
    patchDir("badid", {
      other: `id: "x", files: ${R_MAIN}, edits: [], upstream: "u"`,
    }),
  ]);
  check(
    "a patch file with a wrong shape: clear error, exit 1",
    r.code === 1 && /failed: .*other\.mjs: /.test(r.out),
    r.out,
  );
  r = run([
    "--status",
    "--app",
    N.res,
    "--patches",
    patchDir("needs", {
      lone: `files: ${R_MAIN}, requires: ["missing"], edits: [{ anchor: "a", replace: "b" }], upstream: "u"`,
    }),
  ]);
  check(
    "requires an unknown patch: clear error, exit 1",
    r.code === 1 && /lone requires missing, which is not in/.test(r.out),
    r.out,
  );

  // 10. the real patch files load, and no edit carries its own upstream marker (that would read as RETIRED)
  const { loadPatches } = await import(pathToFileURL(PATCHER).href);
  const real = await loadPatches(path.join(path.dirname(PATCHER), "patches"));
  const ids = real.map((p) => p.id).sort();
  check(
    "real patches: updater-block, 1558, 1758, 1792, 1836, 1867, 1944, ask-line, files-and-agents, right-panel-menu, settings-batch, settled-repeat, tool-rows-stay, files-chat-follows, wakeup-note, endpoint-keep load with the right shape",
    [
      "updater-block",
      "1558",
      "1758",
      "1792",
      "1836",
      "1867",
      "1944",
      "ask-line",
      "files-and-agents",
      "right-panel-menu",
      "settings-batch",
      "settled-repeat",
      "tool-rows-stay",
      "files-chat-follows",
      "wakeup-note",
      "endpoint-keep",
    ].every((id) => ids.includes(id)),
    ids.join(", "),
  );
  check(
    "real patches: 1944 requires 1558",
    real.find((p) => p.id === "1944")?.requires.includes("1558"),
    "",
  );
  check(
    "real patches: settled-repeat requires 1944 and is sorted after it",
    real.find((p) => p.id === "settled-repeat")?.requires.includes("1944") &&
      ids.length === real.length &&
      real.findIndex((p) => p.id === "settled-repeat") >
        real.findIndex((p) => p.id === "1944"),
    real.map((p) => p.id).join(", "),
  );
  const block = real.find((p) => p.id === "updater-block");
  check(
    "real patches: updater-block never retires, is required, and is sorted first",
    block?.upstream === null &&
      block.requiredFirst &&
      real[0].id === "updater-block" &&
      real.filter((p) => p.requiredFirst).length === 1,
    real.map((p) => p.id).join(", "),
  );
  check(
    "real patches: updater-block holds no path to the user's own setup folder",
    block && !block.edits.some((e) => /\.claude\b/.test(e.replace)),
    "",
  );
  const selfRetiring = real
    .filter(
      (p) =>
        p.upstream !== null &&
        p.edits.some(
          (e) =>
            e.replace.includes(p.upstream) || e.anchor.includes(p.upstream),
        ),
    )
    .map((p) => p.id);
  check(
    "real patches: no edit holds its upstream marker",
    !selfRetiring.length,
    selfRetiring.join(", "),
  );
  const byPath = {
    "updater-block": "out/main/index.js",
    1558: "out/main/index.js",
    1792: "out/renderer/assets/registerExtensionSystem-D6mrEjei.js",
    1758: "out/renderer/assets/registerExtensionSystem-D6mrEjei.js",
    1836: "out/renderer/assets/index-BIbaJj7C.js",
    1867: "out/renderer/assets/registerExtensionSystem-D6mrEjei.js",
    1944: "out/main/index.js",
    "ask-line": "out/main/index.js",
    "files-and-agents": "out/renderer/assets/index-BIbaJj7C.js",
    "right-panel-menu": "out/renderer/assets/index-BIbaJj7C.js",
    "settings-batch": "out/main/index.js",
    "settled-repeat": "out/main/index.js",
    "tool-rows-stay": "out/renderer/assets/registerExtensionSystem-D6mrEjei.js",
    "files-chat-follows": "out/renderer/assets/index-BIbaJj7C.js",
    "wakeup-note": "out/main/index.js",
    "endpoint-keep": "out/main/index.js",
  };
  const missed = Object.entries(byPath)
    .filter(([id, p]) => !real.find((x) => x.id === id)?.files.test(p))
    .map(([id]) => id);
  check(
    "real patches: files patterns match their bundle paths",
    !missed.length,
    missed.join(", "),
  );

  // 10b. endpoint-keep: the patched remove keeps a file another process wrote and deletes its own
  {
    const keep = real.find((p) => p.id === "endpoint-keep");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "endpoint-keep-"));
    const file = path.join(dir, "mcp-endpoint.json");
    const body = `${keep.edits[0].replace}\n  } catch {\n  }\n}\nreturn removeMcpEndpointDescriptor;`;
    const remove = new Function(
      "fs__namespace",
      "descriptorPath",
      "process",
      body,
    )(fs, () => file, { pid: 111 });
    fs.writeFileSync(file, JSON.stringify({ pid: 222 }));
    remove();
    const keptForeign = fs.existsSync(file);
    fs.writeFileSync(file, JSON.stringify({ pid: 111 }));
    remove();
    const removedOwn = !fs.existsSync(file);
    fs.writeFileSync(file, "not json");
    remove();
    const removedBroken = !fs.existsSync(file);
    fs.rmSync(dir, { recursive: true, force: true });
    check(
      "endpoint-keep: a second Nimbalyst quitting keeps the running app's endpoint file, deletes its own and a broken one",
      keptForeign && removedOwn && removedBroken,
      JSON.stringify({ keptForeign, removedOwn, removedBroken }),
    );
  }

  // 11. a requiredFirst patch: sorted first, a null upstream never reads as RETIRED (the patched text holds
  // "null"), and when it is skipped nothing at all is written and the run exits 1
  const REQ = `files: /^out\\/preload\\/index\\.js$/, upstream: null, requiredFirst: true, edits: [{ anchor: 'exposeInMainWorld("x", {})', replace: 'exposeInMainWorld("x", null)' }]`;
  const Q = makeApp("required");
  const QP = patchDir("required", { label: LABEL, main: MAINP, zreq: REQ });
  st = run(["--status", "--app", Q.res, "--patches", QP]);
  check(
    "required patch: null upstream loads, status lists it first",
    st.code === 0 &&
      /^patch zreq: would apply/m.test(st.out) &&
      st.out.indexOf("patch zreq:") < st.out.indexOf("patch label:"),
    st.out,
  );
  r = run(["--app", Q.res, "--patches", QP]);
  const qMarker = fs.existsSync(Q.marker)
    ? JSON.parse(fs.readFileSync(Q.marker, "utf8"))
    : null;
  check(
    "required patch: applied first (marker order)",
    r.code === 0 && qMarker?.patches.join() === "zreq,label,main",
    r.out + JSON.stringify(qMarker),
  );
  st = run(["--status", "--app", Q.res, "--patches", QP]);
  check(
    "required patch: applied, not RETIRED, although the patched text holds null",
    /^patch zreq: applied/m.test(st.out),
    st.out,
  );
  const K = makeApp("required-skip"),
    kBefore = hashOf(K.asar);
  const KP = patchDir("required-skip", {
    label: LABEL,
    main: MAINP,
    zreq: REQ.replace(`'exposeInMainWorld("x", {})'`, "'NOT_THERE'"),
  });
  for (const mode of [[], ["--dry-run"]]) {
    r = run([...mode, "--app", K.res, "--patches", KP]);
    check(
      `required patch skipped${mode.length ? " (dry run)" : ""}: exit 1, nothing written, no backup, no marker, no tmp`,
      r.code === 1 &&
        /refused: patch zreq: SKIPPED, anchor changed: "NOT_THERE".*no patch is applied\); nothing written/.test(
          r.out,
        ) &&
        hashOf(K.asar) === kBefore &&
        !fs.existsSync(K.orig) &&
        !fs.existsSync(K.marker) &&
        !fs.existsSync(K.asar + ".patched-tmp"),
      r.out,
    );
  }
  st = run(["--status", "--app", K.res, "--patches", KP]);
  check(
    "required patch skipped: status says no patch is applied without it",
    st.code === 0 && /^patch zreq: SKIPPED.*no patch is applied/m.test(st.out),
    st.out,
  );

  // runningFrom: any program whose executable lives under the install folder counts, whatever its name
  const { runningFrom } = await import(pathToFileURL(PATCHER).href);
  const RF = path.join(T, "Programs", "Nimbalyst"),
    helper = path.join(RF, "resources", "bin", "rg.exe");
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  fs.copyFileSync(process.execPath, helper);
  check(
    "runningFrom: nothing running from a fresh folder",
    runningFrom(RF).length === 0,
    JSON.stringify(runningFrom(RF)),
  );
  const h = spawn(helper, ["-e", "setTimeout(() => {}, 30000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    await new Promise((res, rej) => {
      h.once("spawn", res);
      h.once("error", rej);
    });
    const seen = runningFrom(RF);
    check(
      "runningFrom: a helper named rg.exe under the install folder is listed",
      seen.length === 1 &&
        path.resolve(seen[0]).toLowerCase() === helper.toLowerCase(),
      JSON.stringify(seen),
    );
    check(
      "runningFrom: a sibling folder with the same prefix is not matched",
      runningFrom(RF.slice(0, -2)).length === 0,
    );
  } finally {
    h.kill();
  }
  await new Promise((res) =>
    h.exitCode !== null || h.signalCode ? res() : h.once("exit", res),
  );
} finally {
  cleanup();
}
summary();
