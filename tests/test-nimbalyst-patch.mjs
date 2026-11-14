// node tests/test-nimbalyst-patch.mjs
// Builds small fake Nimbalyst installs under the system temp (an app.asar written here byte by byte: size
// pickle, header pickle, JSON, file data; a fake Nimbalyst.exe holding only the Electron fuse wire), runs
// tools/nimbalyst-patch/patch.mjs on them with test patches and checks the archive it leaves. The archive is
// read back with this file's own reader, not the patcher's.
process.env.HOOK_ERRORS_LOG = "off";

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PATCHER = path.join(
  import.meta.dirname,
  "..",
  "tools",
  "nimbalyst-patch",
  "patch.mjs",
);
const T = fs.mkdtempSync(path.join(os.tmpdir(), "nimbalyst-patch-test-"));
let failed = 0,
  passed = 0;
function check(name, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${String(detail).slice(0, 800)}`}`,
  );
}
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const hashOf = (f) => sha(fs.readFileSync(f));

// ---- the fixture app ----
const MAIN =
  'const fs = require("fs");\nfunction sortThemes(a){return a;}\nmodule.exports = { label: "Edited Files" };\nreturn;\n';
const PRELOAD =
  'const { contextBridge } = require("electron");\ncontextBridge.exposeInMainWorld("x", {});\n';
const CHUNK_A =
  'import { a } from "./dep.js";\nexport const title = "Edited Files";\nexport function f() { return a; }\n';
const CHUNK_B = "export const z = 2;\n";
const ICON = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0xc3, 0x28,
]); // not valid UTF-8
const PKG = JSON.stringify({
  name: "nimbalyst",
  version: "0.83.0",
  main: "out/main/index.js",
});
const FILES = {
  "package.json": PKG,
  "icon.png": ICON,
  "out/main/index.js": MAIN,
  "out/preload/index.js": PRELOAD,
  "out/renderer/assets/index-AAAA1111.js": CHUNK_A,
  "out/renderer/assets/index-BBBB2222.js": CHUNK_B,
  "node_modules/sdk/claude.exe": { unpacked: 10 },
};

function integrity(buf) {
  const h = sha(buf);
  return { algorithm: "SHA256", hash: h, blockSize: 4194304, blocks: [h] };
}
function buildAsar(file, files) {
  const header = { files: {} },
    data = [];
  let offset = 0;
  for (const [p, content] of Object.entries(files)) {
    const parts = p.split("/"),
      name = parts.pop();
    let dir = header;
    for (const d of parts) dir = dir.files[d] ??= { files: {} };
    if (content.unpacked) {
      dir.files[name] = {
        size: content.unpacked,
        unpacked: true,
        integrity: integrity(Buffer.alloc(content.unpacked)),
      };
      continue;
    }
    const buf = Buffer.from(content);
    dir.files[name] = {
      size: buf.length,
      offset: String(offset),
      integrity: integrity(buf),
    };
    offset += buf.length;
    data.push(buf);
  }
  const json = Buffer.from(JSON.stringify(header));
  const payload = Math.ceil((4 + json.length) / 4) * 4;
  const head = Buffer.alloc(16 + payload - 4);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(payload + 4, 4);
  head.writeUInt32LE(payload, 8);
  head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);
  fs.writeFileSync(file, Buffer.concat([head, ...data]));
}
function readAsar(file) {
  const b = fs.readFileSync(file),
    hs = b.readUInt32LE(4),
    len = b.readUInt32LE(12);
  const header = JSON.parse(b.toString("utf8", 16, 16 + len)),
    start = 8 + hs,
    out = {};
  (function walk(dir, pre) {
    for (const [n, e] of Object.entries(dir.files)) {
      const p = pre ? `${pre}/${n}` : n;
      if (e.files) walk(e, p);
      else
        out[p] = {
          entry: e,
          data: e.unpacked
            ? null
            : b.subarray(
                start + Number(e.offset),
                start + Number(e.offset) + e.size,
              ),
        };
    }
  })(header, "");
  return out;
}
function fakeExe(file, integrityFuse) {
  // junk, the sentinel, version 1, length 9, then the 9 fuses as on the real 0.83.0 exe ("101100011")
  const wire = "101100011".split("");
  wire[4] = integrityFuse;
  fs.writeFileSync(
    file,
    Buffer.concat([
      crypto.randomBytes(5000),
      Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"),
      Buffer.from([1, 9]),
      Buffer.from(wire.join("")),
      crypto.randomBytes(300),
    ]),
  );
}
function makeApp(name, { fuse = "0", under = T, files = FILES } = {}) {
  const install = path.join(under, name, "Nimbalyst"),
    res = path.join(install, "resources");
  fs.mkdirSync(path.join(res, "app.asar.unpacked", "node_modules", "sdk"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(res, "app.asar.unpacked", "node_modules", "sdk", "claude.exe"),
    Buffer.alloc(10),
  );
  buildAsar(path.join(res, "app.asar"), files);
  fakeExe(path.join(install, "Nimbalyst.exe"), fuse);
  return {
    install,
    res,
    asar: path.join(res, "app.asar"),
    orig: path.join(res, "app.asar.orig"),
    marker: path.join(res, "ai-coding-setup-patched.json"),
  };
}

// ---- test patches ----
const R_CHUNKS = "/^out\\/renderer\\/assets\\/index-.*\\.js$/",
  R_MAIN = "/^out\\/main\\/index\\.js$/";
function patchDir(name, patches) {
  const dir = path.join(T, "patches-" + name);
  fs.mkdirSync(dir);
  for (const [id, body] of Object.entries(patches))
    fs.writeFileSync(
      path.join(dir, `${id}.mjs`),
      `export default { id: ${JSON.stringify(id)}, ${body} };\n`,
    );
  return dir;
}
const LABEL = `files: ${R_CHUNKS}, edits: [{ anchor: 'export const title = "Edited Files"', replace: 'export const title = "Changed Files"' }], upstream: "UPSTREAM_LABEL_FIX"`;
const MAINP = `files: ${R_MAIN}, edits: [{ anchor: "function sortThemes(a){return a;}", replace: "function sortThemes(a){return a.slice().sort();}" },
  { anchor: 'label: "Edited Files"', replace: 'label: "Changed Files", patched: true' }], upstream: "UPSTREAM_SORT_FIX"`;
// its anchor exists only once main is patched: proves the patches run in order on the changed text
const DEP = `files: ${R_MAIN}, requires: ["main"], edits: [{ anchor: "patched: true", replace: "patched: true, dep: 1" }], upstream: "UPSTREAM_DEP_FIX"`;

const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [PATCHER, ...args], {
    encoding: "utf8",
    env: { ...process.env, NIMBALYST_PATCH_PROGRAM_DIRS: "", ...env },
  });
  return { code: r.status, out: r.stdout + r.stderr };
};
const stateOf = (out, id) =>
  (out.match(new RegExp(`^patch ${id}: (.*)$`, "m")) || [])[1] || "";

try {
  // 1. apply: three patches, the third needs the second
  const A = makeApp("apply"),
    before = hashOf(A.asar),
    orig = readAsar(A.asar);
  const ALL = patchDir("all", { label: LABEL, main: MAINP, dep: DEP });
  let st = run(["--status", "--app", A.res, "--patches", ALL]);
  check(
    "status before: version, no marker, fuse off, per-user, all would apply",
    st.code === 0 &&
      /Nimbalyst 0\.83\.0/.test(st.out) &&
      /marker: none/.test(st.out) &&
      /IntegrityValidation: off/.test(st.out) &&
      /install: per-user/.test(st.out) &&
      ["label", "main", "dep"].every((id) =>
        stateOf(st.out, id).startsWith("would apply"),
      ),
    st.out,
  );
  let r = run(["--app", A.res, "--patches", ALL]);
  const got = readAsar(A.asar);
  check(
    "apply: exit 0, all three applied now",
    r.code === 0 &&
      ["label", "main", "dep"].every((id) =>
        stateOf(r.out, id).startsWith("applied now"),
      ),
    r.out,
  );
  check(
    "apply: the renderer chunk has the new label",
    got["out/renderer/assets/index-AAAA1111.js"].data
      .toString()
      .includes('"Changed Files"'),
  );
  check(
    "apply: main has both edits and the dependant's edit",
    got["out/main/index.js"].data.toString() ===
      MAIN.replace("return a;}", "return a.slice().sort();}").replace(
        'label: "Edited Files"',
        'label: "Changed Files", patched: true, dep: 1',
      ),
  );
  check(
    "apply: untouched files are byte-identical (package.json, preload, other chunk, binary icon)",
    [
      "package.json",
      "out/preload/index.js",
      "out/renderer/assets/index-BBBB2222.js",
      "icon.png",
    ].every(
      (p) =>
        got[p].data.equals(orig[p].data) &&
        JSON.stringify(got[p].entry.integrity) ===
          JSON.stringify(orig[p].entry.integrity),
    ),
  );
  check(
    "apply: changed files lost their stale integrity, sizes match",
    ["out/main/index.js", "out/renderer/assets/index-AAAA1111.js"].every(
      (p) =>
        !got[p].entry.integrity && got[p].entry.size === got[p].data.length,
    ),
  );
  check(
    "apply: the unpacked entry is kept as it was",
    JSON.stringify(got["node_modules/sdk/claude.exe"].entry) ===
      JSON.stringify(orig["node_modules/sdk/claude.exe"].entry),
  );
  check(
    "apply: app.asar.orig is the original, byte for byte; no tmp left",
    hashOf(A.orig) === before && !fs.existsSync(A.asar + ".patched-tmp"),
  );
  const marker = JSON.parse(fs.readFileSync(A.marker, "utf8"));
  check(
    "apply: marker has the version and the applied patches",
    marker.version === "0.83.0" && marker.patches.join() === "main,dep,label",
    JSON.stringify(marker),
  );
  st = run(["--status", "--app", A.res, "--patches", ALL]);
  check(
    "status after: all applied, marker and backup shown",
    ["label", "main", "dep"].every((id) =>
      stateOf(st.out, id).startsWith("applied"),
    ) &&
      /marker: 0\.83\.0, patches main, dep, label/.test(st.out) &&
      /app\.asar\.orig: present/.test(st.out),
    st.out,
  );

  // 2. a second run changes nothing
  const once = hashOf(A.asar),
    markerOnce = fs.readFileSync(A.marker, "utf8");
  r = run(["--app", A.res, "--patches", ALL]);
  check(
    "second apply: already applied, app.asar byte-identical, backup and marker unchanged",
    r.code === 0 &&
      /already applied/.test(r.out) &&
      hashOf(A.asar) === once &&
      hashOf(A.orig) === before &&
      fs.readFileSync(A.marker, "utf8") === markerOnce,
    r.out,
  );

  // 3. restore
  r = run(["--restore", "--app", A.res]);
  check(
    "restore: the original is back, backup and marker gone",
    r.code === 0 &&
      hashOf(A.asar) === before &&
      !fs.existsSync(A.orig) &&
      !fs.existsSync(A.marker),
    r.out,
  );
  r = run(["--restore", "--app", A.res]);
  check(
    "restore without a backup: clear error, exit 1",
    r.code === 1 && /app\.asar\.orig does not exist/.test(r.out),
    r.out,
  );

  // 4. a changed anchor skips the patch and its dependant; an anchor found twice skips too; others still apply
  const S = makeApp("skip"),
    sBefore = hashOf(S.asar);
  const SK = patchDir("skip", {
    label: LABEL,
    main: MAINP.replace(
      "function sortThemes(a){return a;}",
      "function sortThemes(list){return list;}",
    ),
    dep: DEP,
    twice: `files: ${R_CHUNKS}, edits: [{ anchor: "export const", replace: "export let" }], upstream: "UPSTREAM_TWICE"`,
  });
  r = run(["--app", S.res, "--patches", SK]);
  check(
    "changed anchor: SKIPPED with the anchor named",
    r.code === 0 &&
      /^SKIPPED, anchor changed: "function sortThemes\(list\)/.test(
        stateOf(r.out, "main"),
      ),
    r.out,
  );
  check(
    "changed anchor: the dependant is skipped through requires",
    /^SKIPPED, requires main, which was skipped/.test(stateOf(r.out, "dep")),
    r.out,
  );
  check(
    "anchor found twice: SKIPPED",
    /^SKIPPED, anchor changed: "export const" found 2x in 2 matching/.test(
      stateOf(r.out, "twice"),
    ),
    r.out,
  );
  const sGot = readAsar(S.asar);
  check(
    "changed anchor: the other patch applied, main left as it was",
    stateOf(r.out, "label").startsWith("applied now") &&
      sGot["out/main/index.js"].data.toString() === MAIN &&
      hashOf(S.orig) === sBefore,
    r.out,
  );

  // 5. all-or-nothing, retired, dry run: nothing written
  const N = makeApp("none"),
    nBefore = hashOf(N.asar);
  const NP = patchDir("none", {
    half: `files: ${R_MAIN}, edits: [{ anchor: "function sortThemes(a){return a;}", replace: "function sortThemes(a){return [];}" }, { anchor: "NOT_THERE", replace: "X" }], upstream: "UPSTREAM_HALF"`,
    gone: `files: ${R_MAIN}, edits: [{ anchor: 'label: "Edited Files"', replace: 'label: "Gone"' }], upstream: "module.exports = { label"`,
  });
  r = run(["--app", N.res, "--patches", NP]);
  check(
    "all-or-nothing: the second edit's anchor is missing, so the first is not applied either",
    r.code === 0 &&
      /^SKIPPED, anchor changed: "NOT_THERE" found 0x/.test(
        stateOf(r.out, "half"),
      ) &&
      /nothing to apply/.test(r.out) &&
      hashOf(N.asar) === nBefore &&
      !fs.existsSync(N.orig) &&
      !fs.existsSync(N.marker),
    r.out,
  );
  check(
    "retired: the upstream text is there",
    /^RETIRED/.test(stateOf(r.out, "gone")),
    r.out,
  );
  r = run(["--dry-run", "--app", N.res, "--patches", ALL]);
  check(
    "dry run: reports, compiles, writes nothing",
    r.code === 0 &&
      /dry run: 2 file\(s\) would change and compile; nothing written/.test(
        r.out,
      ) &&
      hashOf(N.asar) === nBefore &&
      !fs.existsSync(N.orig),
    r.out,
  );

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

  // 9. bad usage and bad patch files
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
    "real patches: updater-block, 1558, 1758, 1792, 1836, 1867, 1944, ask-line, files-and-agents, right-panel-menu, settings-batch, settled-repeat load with the right shape",
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
  };
  const missed = Object.entries(byPath)
    .filter(([id, p]) => !real.find((x) => x.id === id)?.files.test(p))
    .map(([id]) => id);
  check(
    "real patches: files patterns match their bundle paths",
    !missed.length,
    missed.join(", "),
  );

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

  // 12. the real updater-block patch on a fixture main holding its six anchors as in 0.83.0, then the patched
  // main is run against a fake electron: the quit word quits, skips only the streaming-chat dialog, logs a line
  const UB_FILE = path.join(
    path.dirname(PATCHER),
    "patches",
    "updater-block.mjs",
  );
  const { QUIT_WORD } = await import(pathToFileURL(UB_FILE).href);
  check(
    "quit word: exported, a lowercase switch, used by the patch",
    typeof QUIT_WORD === "string" &&
      /^--[a-z-]+$/.test(QUIT_WORD) &&
      block?.edits.some((e) => e.replace.includes(JSON.stringify(QUIT_WORD))),
    String(QUIT_WORD),
  );
  const UB_MAIN = `const require$$1$2 = require("electron");
const logger$p = { main: { info() {} } };
const mainExports = { autoUpdater: { checkForUpdates: async () => "checked", checkForUpdatesAndNotify: async () => "checked" } };
const autoUpdaterService = { startAutoUpdateCheck() { require$$1$2.checks++; } };
const hasActiveStreamingSessions = () => true;
function boot() {
  if (require$$1$2.app.isPackaged) {
    logger$p.main.info("Starting auto-updater service");
    autoUpdaterService.startAutoUpdateCheck(60);
  }
}
function AutoUpdaterService() {
    mainExports.autoUpdater.autoDownload = true;
    mainExports.autoUpdater.autoInstallOnAppQuit = true;
}
const service = { sendToFrontmostWindow() {}, async checkForUpdatesWithUI() { await mainExports.autoUpdater.checkForUpdates(); } };
async function ipcCheck() { const result2 = await mainExports.autoUpdater.checkForUpdatesAndNotify(); return result2; }
if (require$$1$2.app.requestSingleInstanceLock()) {
    require$$1$2.app.on("second-instance", (_event, argv, workingDirectory) => {
      logger$p.main.info("[SingleInstance] second-instance event, argv:", argv);
      require$$1$2.opened.push(argv);
    });
}
require$$1$2.app.on("before-quit", async (event) => {
  if (hasActiveStreamingSessions() && !process.env.PLAYWRIGHT) {
    require$$1$2.dialogs++;
  }
  require$$1$2.cleanups++;
});
boot();
AutoUpdaterService();
return { service, ipcCheck };
`;
  const U = makeApp("updater-block", {
    files: { ...FILES, "out/main/index.js": UB_MAIN },
  });
  const UP = path.join(T, "patches-updater-block");
  fs.mkdirSync(UP);
  fs.copyFileSync(UB_FILE, path.join(UP, "updater-block.mjs"));
  r = run(["--app", U.res, "--patches", UP]);
  check(
    "updater-block on the fixture: all six edits apply",
    r.code === 0 && stateOf(r.out, "updater-block").startsWith("applied now"),
    r.out,
  );
  const uOnce = hashOf(U.asar);
  r = run(["--app", U.res, "--patches", UP]);
  check(
    "updater-block on the fixture: a second run changes nothing",
    r.code === 0 && /already applied/.test(r.out) && hashOf(U.asar) === uOnce,
    r.out,
  );
  const patchedMain = readAsar(U.asar)["out/main/index.js"].data.toString();
  const handlers = {},
    fake = { checks: 0, dialogs: 0, cleanups: 0, quits: 0, opened: [] };
  fake.app = {
    isPackaged: true,
    requestSingleInstanceLock: () => true,
    on: (n, f) => (handlers[n] ??= []).push(f),
    once: (n, f) => (handlers[n] ??= []).push(f),
    quit() {
      fake.quits++;
      for (const f of handlers["before-quit"]) f({ preventDefault() {} });
    },
  };
  const D = path.join(T, "deliver-data"),
    fakeProcess = { env: { NIMBALYST_DELIVER_DATA: D } };
  fs.mkdirSync(D);
  const fakeRequire = (m) =>
    m === "electron"
      ? fake
      : {
          fs,
          path,
          child_process: {
            spawn() {
              throw new Error("no spawn in this test");
            },
          },
        }[m];
  const out = new Function("require", "process", patchedMain)(
    fakeRequire,
    fakeProcess,
  );
  check(
    "patched main: no timed update check, the IPC check returns null",
    fake.checks === 0 && (await out.ipcCheck()) === null,
  );
  fake.app.quit();
  check(
    "patched main: a normal quit with a chat streaming still shows the dialog",
    fake.dialogs === 1 && fake.cleanups === 1,
    JSON.stringify(fake),
  );
  handlers["second-instance"][0](
    {},
    ["C:\\Nimbalyst\\Nimbalyst.exe", "C:\\work\\notes.md"],
    "C:\\work",
  );
  check(
    "patched main: a second launch without the word opens its target, no quit",
    fake.opened.length === 1 && fake.quits === 1,
    JSON.stringify(fake),
  );
  try {
    handlers["second-instance"][0](
      {},
      [
        "C:\\Nimbalyst\\Nimbalyst.exe",
        "--allow-file-access-from-files",
        QUIT_WORD,
      ],
      "C:\\Nimbalyst",
    );
    check(
      "patched main: the word quits through app.quit, skips only the dialog, cleanup runs, nothing opened",
      fake.quits === 2 &&
        fake.dialogs === 1 &&
        fake.cleanups === 2 &&
        fake.opened.length === 1,
      JSON.stringify(fake),
    );
    const log = fs.existsSync(path.join(D, "quit-hook.log"))
      ? fs.readFileSync(path.join(D, "quit-hook.log"), "utf8")
      : "";
    check(
      "patched main: the word writes a line to quit-hook.log",
      /^\S+ quit word received, quitting\n$/.test(log),
      log,
    );
    fakeProcess.env.NIMBALYST_DELIVER_DATA = path.join(
      T,
      "no-such-folder",
      "deeper",
    );
    handlers["second-instance"][0]({}, ["Nimbalyst.exe", QUIT_WORD], ".");
    check(
      "patched main: a log that can't be written does not stop the quit",
      fake.quits === 3 && fake.cleanups === 3,
      JSON.stringify(fake),
    );
  } finally {
    delete globalThis.__claudeSetupQuitWord;
  }

  // 13. the real ask-line patch: on a fixture main holding Nimbalyst's question block in a template literal,
  // then on a temp copy of the installed app.asar (when there is one): replaced once, a second run changes
  // nothing, a main without the block is skipped, --restore brings the original back
  const AL_FILE = path.join(path.dirname(PATCHER), "patches", "ask-line.mjs");
  const AL = (await import(pathToFileURL(AL_FILE).href)).default;
  const [alEdit] = AL.edits;
  const AL_MAIN = `const askUserQuestionTool = "ASK", promptForUserInputTool = "FORM";\nmodule.exports = \`## Interactive User Input\n\n${alEdit.anchor}\n\n## Visual Communication\`;\n`;
  const ALP = path.join(T, "patches-ask-line");
  fs.mkdirSync(ALP);
  fs.copyFileSync(AL_FILE, path.join(ALP, "ask-line.mjs"));
  const count = (s, part) => s.split(part).length - 1;
  const L = makeApp("ask-line", {
      files: { ...FILES, "out/main/index.js": AL_MAIN },
    }),
    lBefore = hashOf(L.asar);
  r = run(["--app", L.res, "--patches", ALP]);
  const lMain = readAsar(L.asar)["out/main/index.js"].data.toString();
  check(
    "ask-line on the fixture: applied, the block replaced once, the old sentence gone",
    r.code === 0 &&
      stateOf(r.out, "ask-line").startsWith("applied now") &&
      count(lMain, alEdit.replace) === 1 &&
      !lMain.includes("call an interactive tool instead"),
    r.out,
  );
  const lText = new Function(
    "module",
    lMain.replace(/^module\.exports = /m, "return "),
  )({});
  check(
    "ask-line on the fixture: the patched prompt still fills in both tool names",
    lText.includes("- ASK — a quick yes/no or pick-one") &&
      lText.includes("- FORM — only for a draft to edit") &&
      !lText.includes("${"),
    lText,
  );
  const lOnce = hashOf(L.asar);
  r = run(["--app", L.res, "--patches", ALP]);
  check(
    "ask-line on the fixture: a second run changes nothing",
    r.code === 0 && /already applied/.test(r.out) && hashOf(L.asar) === lOnce,
    r.out,
  );
  r = run(["--restore", "--app", L.res]);
  check(
    "ask-line on the fixture: --restore brings the original back",
    r.code === 0 && hashOf(L.asar) === lBefore && !fs.existsSync(L.marker),
    r.out,
  );
  const LM = makeApp("ask-line-missing"),
    lmBefore = hashOf(LM.asar);
  r = run(["--app", LM.res, "--patches", ALP]);
  check(
    "ask-line without the block: skipped with a clear reason, nothing written",
    r.code === 0 &&
      /^patch ask-line: SKIPPED, anchor changed: "Before writing a question/m.test(
        r.out,
      ) &&
      hashOf(LM.asar) === lmBefore &&
      !fs.existsSync(LM.orig),
    r.out,
  );
  // the installed app's unpatched original: app.asar.orig once the patcher has run
  const realRes =
    process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, "Programs", "Nimbalyst", "resources");
  const REAL =
    realRes &&
    (fs.existsSync(path.join(realRes, "app.asar.orig"))
      ? path.join(realRes, "app.asar.orig")
      : path.join(realRes, "app.asar"));
  if (REAL && fs.existsSync(REAL)) {
    const RC = makeApp("ask-line-real");
    fs.copyFileSync(REAL, RC.asar);
    const rcBefore = readAsar(RC.asar)["out/main/index.js"].data.toString();
    r = run(["--app", RC.res, "--patches", ALP]);
    const rcMain = readAsar(RC.asar)["out/main/index.js"].data.toString();
    check(
      "ask-line on a copy of the installed app.asar: the block replaced once, the old sentence gone, nothing else in main changed",
      r.code === 0 &&
        stateOf(r.out, "ask-line").startsWith("applied now") &&
        count(rcMain, alEdit.replace) === 1 &&
        !rcMain.includes("call an interactive tool instead") &&
        rcMain === rcBefore.replace(alEdit.anchor, () => alEdit.replace),
      r.out,
    );
    const rcOnce = hashOf(RC.asar);
    r = run(["--app", RC.res, "--patches", ALP]);
    check(
      "ask-line on a copy of the installed app.asar: a second run changes nothing",
      r.code === 0 &&
        /already applied/.test(r.out) &&
        hashOf(RC.asar) === rcOnce,
      r.out,
    );
    fs.rmSync(path.dirname(RC.install), { recursive: true, force: true });
  } else
    console.log(`skip ask-line on the installed app.asar: none at ${REAL}`);

  // 14. the real files-and-agents patch: on a fixture renderer chunk holding the menu list and the File viewer's
  // empty-state button, all three words change once and the mode ids stay; a chunk without the button is skipped
  const FA_FILE = path.join(
    path.dirname(PATCHER),
    "patches",
    "files-and-agents.mjs",
  );
  const FA = (await import(pathToFileURL(FA_FILE).href)).default;
  const FAP = path.join(T, "patches-files-and-agents");
  fs.mkdirSync(FAP);
  fs.copyFileSync(FA_FILE, path.join(FAP, "files-and-agents.mjs"));
  const [faMenu, faChat, faButton] = FA.edits;
  const FA_CHUNK = `const modes = [\n${faMenu.anchor}  { id: "review", label: "Review", icon: "rate_review" },\n${faChat.anchor}  { id: "file-viewer", label: "File viewer", icon: "tab" }\n];\nconst b = jsx("button", { onClick: () => setRightPanelMode({ workstreamId, ${faButton.anchor};\n`;
  const faFiles = (chunk) => ({
    ...FILES,
    "out/renderer/assets/index-AAAA1111.js": chunk,
  });
  const FG = makeApp("files-and-agents", { files: faFiles(FA_CHUNK) });
  r = run(["--app", FG.res, "--patches", FAP]);
  const fChunk = readAsar(FG.asar)[
    "out/renderer/assets/index-AAAA1111.js"
  ].data.toString();
  check(
    "files-and-agents on the fixture: three edits, each new word once, the old words gone, the mode ids kept",
    r.code === 0 &&
      FA.edits.length === 3 &&
      stateOf(r.out, "files-and-agents").startsWith("applied now") &&
      [
        'label: "Files & agents"',
        'label: "Chat with session"',
        'children: "Show files & agents"',
        'id: "edited-files"',
        'id: "session-chat"',
        'mode: "edited-files"',
      ].every((s) => count(fChunk, s) === 1) &&
      !/Edited Files|Chat with Session|Show edited files/.test(fChunk),
    r.out + fChunk,
  );
  const FM = makeApp("files-and-agents-missing", {
      files: faFiles(FA_CHUNK.replace("Show edited files", "Show changes")),
    }),
    fmBefore = hashOf(FM.asar);
  r = run(["--app", FM.res, "--patches", FAP]);
  check(
    "files-and-agents without the button: skipped with a clear reason, nothing written",
    r.code === 0 &&
      /^patch files-and-agents: SKIPPED, anchor changed: "mode: \\"edited-files\\" }\), children: \\"Show edited/m.test(
        r.out,
      ) &&
      hashOf(FM.asar) === fmBefore &&
      !fs.existsSync(FM.orig),
    r.out,
  );

  // 15. the real settled-repeat patch: on a fixture main holding its four anchors as in 0.83.0 (with a stand-in
  // for 1944, which it requires), then the patched main is run with made-up transcripts under a temp
  // CLAUDE_CONFIG_DIR. A result left out of the closed-process wake is D (dropped), one still named is K (kept).
  const SR_FILE = path.join(
    path.dirname(PATCHER),
    "patches",
    "settled-repeat.mjs",
  );
  const SR_MAIN = `const path$2 = require("path");
const fs$3 = require("fs");
function resolveClaudeConfigDir(env2 = process.env) {
  return env2.CLAUDE_CONFIG_DIR;
}
// fixture: patch 1944 stands here
const BACKGROUND_LAUNCH_ACK = /running in (the )?background|working in the background|async agent launched/i;
function extractToolResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block) => block && typeof block === "object" && typeof block.text === "string" ? block.text : "").join("\\n");
  }
  return "";
}
function isBackgroundLaunchAcknowledgement(resultContent) {
  return BACKGROUND_LAUNCH_ACK.test(extractToolResultText(resultContent));
}
function isReportable(n2) {
  return n2.status !== "stopped" || n2.killedByTeardown === true;
}
function shouldContinueWithTaskResults(cause, notifications) {
  return cause === "resolved" && notifications.some(isReportable);
}
function buildTaskResultContinuationMessage(notifications) {
  return "[System: background task(s) you launched have settled:\\n" + notifications.map((n2) => "- " + n2.description + " [" + n2.taskId + "]").join("\\n") + "]";
}
function hasRunningTasks(tasks) {
  for (const t2 of tasks) {
    if (t2.status === "running") return true;
  }
  return false;
}
function applySystemTaskChunk(params2) {
  const { subtype, chunk, tasks, notifications } = params2;
  if (subtype === "task_started") {
    tasks.set(chunk.task_id, { taskId: chunk.task_id, description: chunk.description || "", status: "running", startedAt: Date.now() - 5e3 });
    return true;
  }
  const existing = tasks.get(chunk.task_id);
  if (!existing) return false;
  if (subtype === "task_notification") {
    existing.status = chunk.status || "completed";
    const status = existing.status;
    const record2 = {
        taskId: chunk.task_id,
        description: existing.description,
        status,
        killedByTeardown: false,
        elapsedMs: Date.now() - existing.startedAt
      };
    notifications.push(record2);
    return true;
  }
  return false;
}
class Provider {
  constructor(claudeSessionId) {
    this.sessions = { getSessionId: (id) => (id === "nim-1" ? claudeSessionId : void 0) };
    this.emitted = [];
    this.activeTasks = new Map();
    this.drainTerminalNotifications = [];
    this.drainExitCause = "resolved";
  }
  emit(name, payload) {
    this.emitted.push([name, payload]);
  }
  finalizeBackgroundDrain(sessionId) {
    if (sessionId && shouldContinueWithTaskResults(this.drainExitCause, this.drainTerminalNotifications)) {
      const message = buildTaskResultContinuationMessage(this.drainTerminalNotifications);
      console.log(\`[CLAUDE-CODE] SUBAGENT_DRAIN: waking session \${sessionId} with \${this.drainTerminalNotifications.length} background task result(s)\`);
      this.teammateIdleMessagePending = true;
      this.emit("teammate:messageWhileIdle", { sessionId, message });
      return;
    }
    if (sessionId) {
      console.log(\`[CLAUDE-CODE] SUBAGENT_DRAIN: drain settled (cause=\${this.drainExitCause}); releasing deferred session end for \${sessionId}\`);
      this.emit("subagents:drainSettled", { sessionId });
    }
  }
}
return { isBackgroundLaunchAcknowledgement, applySystemTaskChunk, Provider };
`;
  const SRP = patchDir("settled-repeat", {
    1944: `files: ${R_MAIN}, upstream: null, edits: [{ anchor: "// fixture: patch 1944 stands here\\n", replace: "// fixture: patch 1944 applied\\n" }]`,
  });
  fs.copyFileSync(SR_FILE, path.join(SRP, "settled-repeat.mjs"));
  const SRA = makeApp("settled-repeat", {
    files: { ...FILES, "out/main/index.js": SR_MAIN },
  });
  r = run(["--app", SRA.res, "--patches", SRP]);
  check(
    "settled-repeat on the fixture: applied after 1944",
    r.code === 0 &&
      stateOf(r.out, "1944").startsWith("applied now") &&
      stateOf(r.out, "settled-repeat").startsWith("applied now"),
    r.out,
  );
  const srMain = readAsar(SRA.asar)["out/main/index.js"].data.toString();
  // runs a main; its console and CLAUDE_CONFIG_DIR are the test's
  const srBox = (main) => {
    const env = {},
      logs = [];
    const con = {
      log: (...a) => logs.push(a.map(String).join(" ")),
      warn: (...a) => logs.push(a.map(String).join(" ")),
    };
    const api = new Function("require", "process", "console", main)(
      (m) => ({ fs, path })[m],
      { env },
      con,
    );
    return { ...api, env, logs };
  };
  const SR = srBox(srMain);

  // E1: the launch test reads the first line only
  const usageScan = [
    "# Usage scan",
    "2026-11-12T02:23 to 2026-11-14T02:23 UTC.",
    "",
    "## Background tasks",
    'Agent = Agent/Task launched in the background (run_in_background: true, or without run_in_background: false and the result says "Async agent launched"). Bash = run_in_background: true.',
    "",
  ].join("\n");
  const notAck = {
    "the usage scan of chat 35fe9669": usageScan,
    "a helper hand-back quoting the panel": [
      {
        type: "text",
        text: '[Subagent hand-back] The text below is the final report of a helper you launched.\n\nThe panel now shows:\n- "Running in the background · 3m".\n',
      },
    ],
    "a Bash result quoting the panel":
      "FAIL css: the app's dots hidden only while our orb is there\n  expected: hidden\n  label: Running in the background·3m\n",
  };
  for (const [name, content] of Object.entries(notAck))
    check(
      `settled-repeat E1: ${name} is not a launch acknowledgement`,
      SR.isBackgroundLaunchAcknowledgement(content) === false,
    );
  const asyncAck =
    "Async agent launched successfully. (This tool result is internal metadata for you, not the user.)\nagentId: a45d4cfd28747670d\nThe agent is working in the background. You will be notified when it completes.";
  const isAck = {
    "a Bash launch":
      "Command running in background with ID: b1h63ua03. Output is being written to: C:\\Temp\\tasks\\b1h63ua03.output",
    "a helper launch": [{ type: "text", text: asyncAck }],
    "a helper launch after a blank line": "\n" + asyncAck,
  };
  for (const [name, content] of Object.entries(isAck))
    check(
      `settled-repeat E1: ${name} is still a launch acknowledgement`,
      SR.isBackgroundLaunchAcknowledgement(content) === true,
    );

  // E2: the record of a task end carries the start of its run
  {
    const tasks = new Map(),
      notifications = [];
    SR.applySystemTaskChunk({
      subtype: "task_started",
      chunk: { task_id: "b2start", description: "x" },
      tasks,
      notifications,
    });
    SR.applySystemTaskChunk({
      subtype: "task_notification",
      chunk: { task_id: "b2start", status: "completed" },
      tasks,
      notifications,
    });
    check(
      "settled-repeat E2: the task_notification record carries the task's startedAt",
      notifications.length === 1 &&
        typeof notifications[0].startedAt === "number" &&
        notifications[0].startedAt === tasks.get("b2start").startedAt,
      JSON.stringify(notifications),
    );
  }

  // E3 and E4: the proof, run through the closed-process wake
  const SID = "5e551011-0000-4000-8000-00000000c1a0",
    T0 = Date.parse("2026-11-12T10:00:00.000Z"),
    iso = (ms) => new Date(ms).toISOString();
  const noticeText = (id) =>
    `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>Agent "work" finished</summary>\n<result>done</result>\n</task-notification>`;
  const TL = {
    queued: (id, at) => ({
      type: "attachment",
      timestamp: iso(at),
      attachment: { type: "queued_command", prompt: noticeText(id) },
    }),
    own: (id, at) => ({
      type: "user",
      timestamp: iso(at),
      message: { role: "user", content: noticeText(id) },
    }),
    quoted: (id, at) => ({
      type: "user",
      timestamp: iso(at),
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_grep",
            content: noticeText(id),
          },
        ],
      },
    }),
    reply: (text, at) => ({
      type: "assistant",
      timestamp: iso(at),
      message: {
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text }],
      },
    }),
    toolUse: (at) => ({
      type: "assistant",
      timestamp: iso(at),
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "toolu_x", name: "Bash", input: {} }],
      },
    }),
    compact: (at) => ({
      type: "system",
      subtype: "compact_boundary",
      timestamp: iso(at),
      content: "Conversation compacted",
    }),
  };
  const jsonl = (entries) =>
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  // ~1 KB lines that hold none of the words the proof looks for
  const FILL_LINE =
    JSON.stringify({ type: "progress", data: "x".repeat(1000) }) + "\n";
  const filler = (mb) =>
    FILL_LINE.repeat(Math.ceil((mb * 1024 * 1024) / FILL_LINE.length));
  let srCase = 0;
  // writes a session (lead lines, helper files) under a fresh config folder; returns the lead path
  const session = (lead, helpers = {}) => {
    const cfg = path.join(T, `claude-config-${++srCase}`),
      dir = path.join(cfg, "projects", "C--work-demo");
    fs.mkdirSync(path.join(cfg, "projects", "C--other"), { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
    const leadFile = path.join(dir, `${SID}.jsonl`);
    if (lead !== null)
      fs.writeFileSync(leadFile, typeof lead === "string" ? lead : jsonl(lead));
    const sub = path.join(dir, SID, "subagents");
    for (const [name, lines] of Object.entries(helpers)) {
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(
        path.join(sub, `${name}.jsonl`),
        typeof lines === "string" ? lines : jsonl(lines),
      );
    }
    return { cfg, leadFile, sub };
  };
  const record = (id, startedAt = T0, extra = {}) => ({
    taskId: id,
    description: `task ${id}`,
    status: "completed",
    killedByTeardown: false,
    elapsedMs: 1000,
    startedAt,
    ...extra,
  });
  // one closed-process wake: which records the message names, whether the drain settled, the log
  const drain = (box, cfg, records, tasks = new Map()) => {
    box.env.CLAUDE_CONFIG_DIR = cfg;
    box.logs.length = 0;
    const p = new box.Provider(SID);
    p.drainTerminalNotifications = records;
    p.activeTasks = tasks;
    p.finalizeBackgroundDrain("nim-1");
    const wake = p.emitted.find(([n]) => n === "teammate:messageWhileIdle");
    const message = wake?.[1].message ?? null;
    return {
      message,
      named: (id) => message !== null && message.includes(`[${id}]`),
      settled: p.emitted.some(([n]) => n === "subagents:drainSettled"),
      log: box.logs.join("\n"),
    };
  };
  const NO_HELPER = srBox(
    srMain.replace(
      "const HELPER_READ_COUNTS = true;",
      "const HELPER_READ_COUNTS = false;",
    ),
  );
  const NO_TRIM = srBox(
    srMain.replace(
      "const TRIM_PROVEN_RESULTS = true;",
      "const TRIM_PROVEN_RESULTS = false;",
    ),
  );
  const reply = (at) => TL.reply("Merged both; the tests pass.", at);
  let s, d;

  s = session([
    TL.toolUse(T0 + 10e3),
    TL.queued("a1", T0 + 60e3),
    TL.toolUse(T0 + 70e3),
    reply(T0 + 90e3),
  ]);
  d = drain(SR, s.cfg, [record("a1")]);
  check(
    "settled-repeat 1: a mid-turn notice in the lead, then a real reply: D, no wake, the drain settles, one log line",
    !d.named("a1") &&
      d.message === null &&
      d.settled &&
      /1 of 1 background task result\(s\) already reached Claude in its transcript; not sent again: \[a1\]/.test(
        d.log,
      ),
    JSON.stringify(d),
  );
  for (const text of ["No response requested.", "No response requested", ""]) {
    s = session([TL.queued("a2", T0 + 60e3), TL.reply(text, T0 + 90e3)]);
    d = drain(SR, s.cfg, [record("a2")]);
    check(
      `settled-repeat 2: the only reply is ${JSON.stringify(text)}: K`,
      d.named("a2") && !d.settled,
      JSON.stringify(d),
    );
  }
  // Claude Code writes each block of a reply as its own entry, all with stop_reason end_turn (chat f2e7b76a)
  const thinking = (at) => ({
    type: "assistant",
    timestamp: iso(at),
    message: {
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "" }],
    },
  });
  s = session([
    TL.queued("a2b", T0 + 60e3),
    thinking(T0 + 80e3),
    reply(T0 + 90e3),
  ]);
  d = drain(SR, s.cfg, [record("a2b")]);
  check(
    "settled-repeat 2: a thinking-only entry, then the reply's text entry: D",
    !d.named("a2b") && d.settled,
    JSON.stringify(d),
  );
  s = session([
    TL.queued("a2c", T0 + 60e3),
    thinking(T0 + 80e3),
    TL.reply("No response requested.", T0 + 90e3),
    reply(T0 + 900e3),
  ]);
  d = drain(SR, s.cfg, [record("a2c")]);
  check(
    "settled-repeat 2: a thinking-only entry, then the stand-in reply: K",
    d.named("a2c"),
    JSON.stringify(d),
  );
  s = session([
    TL.queued("a3", T0 + 60e3),
    TL.toolUse(T0 + 70e3),
    TL.toolUse(T0 + 80e3),
  ]);
  d = drain(SR, s.cfg, [record("a3")]);
  check(
    "settled-repeat 3: the turn was cut after the notice: K",
    d.named("a3"),
    JSON.stringify(d),
  );
  s = session([TL.toolUse(T0 + 10e3)], {
    "agent-x": [TL.queued("a4", T0 + 60e3), reply(T0 + 90e3)],
  });
  d = drain(SR, s.cfg, [record("a4")]);
  check(
    "settled-repeat 4: the notice read and answered by a helper: D (helper reads count)",
    !d.named("a4") && d.settled,
    JSON.stringify(d),
  );
  d = drain(NO_HELPER, s.cfg, [record("a4")]);
  check(
    "settled-repeat 4: the same with HELPER_READ_COUNTS false: K",
    d.named("a4"),
    JSON.stringify(d),
  );
  s = session([TL.own("a5", T0 + 60e3), reply(T0 + 90e3)]);
  d = drain(SR, s.cfg, [record("a5")]);
  check(
    "settled-repeat 5: the notice as its own user turn, then a real reply: D",
    !d.named("a5") && d.settled,
    JSON.stringify(d),
  );
  s = session([TL.queued("a6", T0 - 60e3), reply(T0 - 30e3)]);
  d = drain(SR, s.cfg, [record("a6")]);
  check(
    "settled-repeat 6: the only notice is from an earlier run: K",
    d.named("a6"),
    JSON.stringify(d),
  );
  s = session([TL.queued("a7", T0 + 60e3), reply(T0 + 90e3)]);
  d = drain(SR, s.cfg, [record("a7", T0), record("a7", T0 + 600e3)]);
  check(
    "settled-repeat 7: two runs of one id, one notice in the first run's window: the first D, the second K",
    d.named("a7") &&
      /waking session nim-1 with 1 background task result\(s\)/.test(d.log),
    JSON.stringify(d),
  );
  s = session([TL.queued("a7b", T0 + 700e3), reply(T0 + 720e3)]);
  d = drain(
    SR,
    s.cfg,
    [record("a7b", T0)],
    new Map([
      ["a7b", { taskId: "a7b", status: "running", startedAt: T0 + 600e3 }],
    ]),
  );
  check(
    "settled-repeat 7: a notice from the next run, still in the task map, does not prove the first run: K",
    d.named("a7b"),
    JSON.stringify(d),
  );
  s = session([TL.quoted("a8", T0 + 60e3), reply(T0 + 90e3)]);
  d = drain(SR, s.cfg, [record("a8")]);
  check(
    "settled-repeat 8: the id only inside a tool result (a grep quoting the notice): K",
    d.named("a8"),
    JSON.stringify(d),
  );
  s = session([TL.queued("a9", T0 + 60e3), reply(T0 + 90e3)]);
  d = drain(SR, s.cfg, [
    record("a9", T0, { status: "stopped", killedByTeardown: true }),
  ]);
  check(
    "settled-repeat 9: a task killed by teardown: K",
    d.named("a9"),
    JSON.stringify(d),
  );
  s = session(null);
  d = drain(SR, s.cfg, [record("a10"), record("a10b")]);
  check(
    "settled-repeat 10: no transcript: all K, with the log line",
    d.named("a10") &&
      d.named("a10b") &&
      /no transcript .*\.jsonl found; sending every result/.test(d.log),
    JSON.stringify(d),
  );
  s = session([
    TL.toolUse(T0 + 3000e3),
    TL.toolUse(T0 + 3100e3),
    TL.queued("a11", T0 + 60e3),
    reply(T0 + 3200e3),
  ]);
  d = drain(SR, s.cfg, [record("a11")]);
  check(
    "settled-repeat 11: the notice stamped earlier than the lines before it, then a reply: D",
    !d.named("a11") && d.settled,
    JSON.stringify(d),
  );
  s = session([
    TL.queued("a12", T0 + 60e3),
    TL.compact(T0 + 70e3),
    reply(T0 + 90e3),
  ]);
  d = drain(SR, s.cfg, [record("a12")]);
  check(
    "settled-repeat 12: a compaction between the notice and the reply: K",
    d.named("a12"),
    JSON.stringify(d),
  );
  s = session([TL.queued("a13", T0 + 60e3), reply(T0 + 90e3)]);
  d = drain(SR, s.cfg, [record("a13")], {
    get() {
      throw new Error("broken task map");
    },
  });
  check(
    "settled-repeat 13: an error while checking (the task map throws): K, with the warn line",
    d.named("a13") &&
      /could not check which results Claude already has; sending every result: Error: broken task map/.test(
        d.log,
      ),
    JSON.stringify(d),
  );
  s = session(null);
  fs.mkdirSync(s.leadFile);
  d = drain(SR, s.cfg, [record("a13b")]);
  // on Windows a folder opens and reads as 0 bytes, so nothing throws there: the result is kept either way
  check(
    "settled-repeat 13: the transcript path is a folder: K",
    d.named("a13b") && !/not sent again/.test(d.log),
    JSON.stringify(d),
  );
  s = session(
    jsonl([TL.queued("a14", T0 + 60e3)]) +
      filler(16.5) +
      jsonl([reply(T0 + 90e3)]),
  );
  d = drain(SR, s.cfg, [record("a14")]);
  check(
    "settled-repeat 14: the notice more than 16 MB before the end of the file: K",
    d.named("a14"),
    JSON.stringify(d).slice(0, 400),
  );
  s = session([TL.toolUse(T0 + 10e3)], {
    "agent-old": [TL.queued("a14b", T0 + 60e3), reply(T0 + 90e3)],
  });
  fs.utimesSync(
    path.join(s.sub, "agent-old.jsonl"),
    (T0 - 3600e3) / 1e3,
    (T0 - 3600e3) / 1e3,
  );
  d = drain(SR, s.cfg, [record("a14b")]);
  check(
    "settled-repeat 14: a helper file last changed before the run started is not read: K",
    d.named("a14b"),
    JSON.stringify(d),
  );
  const big = filler(16.5);
  s = session(big, {
    "agent-a": big,
    "agent-b": big,
    "agent-c": big,
    "agent-z": [TL.queued("a14c", T0 + 60e3), reply(T0 + 90e3)],
  });
  d = drain(SR, s.cfg, [record("a14c")]);
  check(
    "settled-repeat 14: files past the 64 MB total are not read, with the log line: K",
    d.named("a14c") &&
      /transcript read limit \(64 MB\) reached before .*agent-z\.jsonl; results not yet proven are sent/.test(
        d.log,
      ),
    d.log,
  );
  fs.rmSync(s.cfg, { recursive: true, force: true });
  s = session([TL.queued("a15", T0 + 60e3), reply(T0 + 90e3)]);
  d = drain(SR, s.cfg, [record("a15"), record("a15b")]);
  check(
    "settled-repeat 15 (E4): one of two proven: the wake names only the other one",
    !d.named("a15") &&
      d.named("a15b") &&
      /waking session nim-1 with 1 background task result\(s\)/.test(d.log),
    JSON.stringify(d),
  );
  d = drain(NO_TRIM, s.cfg, [record("a15"), record("a15b")]);
  check(
    "settled-repeat 15: one of two proven with TRIM_PROVEN_RESULTS false: both sent",
    d.named("a15") && d.named("a15b"),
    JSON.stringify(d),
  );

  // the real patches on a copy of the installed app's unpatched original: settled-repeat and all the others apply
  if (REAL && fs.existsSync(REAL)) {
    const SC = makeApp("settled-repeat-real");
    fs.copyFileSync(REAL, SC.asar);
    r = run(["--dry-run", "--app", SC.res]);
    check(
      "settled-repeat on a copy of the installed app.asar: every real patch would apply, the changed code compiles",
      r.code === 0 &&
        stateOf(r.out, "settled-repeat").startsWith("would apply") &&
        real.every((p) => stateOf(r.out, p.id).startsWith("would apply")) &&
        /would change and compile/.test(r.out),
      r.out,
    );
    fs.rmSync(path.dirname(SC.install), { recursive: true, force: true });
  } else
    console.log(
      `skip settled-repeat on the installed app.asar: none at ${REAL}`,
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
  fs.rmSync(T, { recursive: true, force: true });
}

console.log(
  failed ? `${failed} failed, ${passed} passed` : `all ${passed} passed`,
);
process.exit(failed ? 1 : 0);
