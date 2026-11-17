// Shared fixture of the nimbalyst-patch tests (test-nimbalyst-patch*.mjs): builds small fake Nimbalyst installs
// under the system temp (an app.asar written here byte by byte: size pickle, header pickle, JSON, file data; a fake
// Nimbalyst.exe holding only the Electron fuse wire), runs tools/nimbalyst-patch/patch.mjs on them with test
// patches, and reads the archive back with its own reader, not the patcher's.
process.env.HOOK_ERRORS_LOG = "off";

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PATCHER = path.join(
  import.meta.dirname,
  "..",
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

// Removes the temp folder; a test file calls it in its finally.
function cleanup() {
  fs.rmSync(T, { recursive: true, force: true });
}
// Prints the count and exits 1 when a check failed.
function summary() {
  console.log(
    failed ? `${failed} failed, ${passed} passed` : `all ${passed} passed`,
  );
  process.exit(failed ? 1 : 0);
}

export {
  buildAsar,
  CHUNK_A,
  CHUNK_B,
  check,
  cleanup,
  DEP,
  FILES,
  fakeExe,
  hashOf,
  ICON,
  integrity,
  LABEL,
  MAIN,
  MAINP,
  makeApp,
  PATCHER,
  PKG,
  PRELOAD,
  patchDir,
  R_CHUNKS,
  R_MAIN,
  readAsar,
  run,
  sha,
  stateOf,
  summary,
  T,
};
