#!/usr/bin/env node
// nimbalyst-patch: puts our fixes into Nimbalyst's app.asar and takes them out again. Plain Node, no npm
// dependencies. Run by hand or by our updater while Nimbalyst is closed; Nimbalyst updates come through our
// repo, not through its own updater, so there is no waiter and no extension.
//
//   patch.mjs --status            what each patch would do on the installed app, and the marker
//   patch.mjs [--dry-run]         apply (the default action); --dry-run checks everything, writes nothing
//   patch.mjs --restore           puts app.asar.orig back as app.asar
//   options: --app <resources dir>  (default %LOCALAPPDATA%/Programs/Nimbalyst/resources)
//            --patches <dir>        (default patches/ beside this script)
//
// A patch is patches/<id>.mjs with one default export:
//   export default { id: "1558", files: /^out\/main\/index\.js$/, edits: [{ anchor: "...", replace: "..." }],
//                    upstream: "<text only the merged upstream fix has>", requires: ["1758"] };
// `upstream: null` means the patch never retires. `requiredFirst: true` puts the patch before all others, and
// when it is skipped no patch is applied at all: apply and --dry-run exit 1 and write nothing.
// `files` is tested on the path inside the asar ("out/renderer/assets/index-BIbaJj7C.js"). Rules:
// - all edits of a patch apply together or not at all, in the order given; a later edit sees the earlier ones;
// - each anchor must occur exactly once across the matching files, else SKIPPED (anchor changed);
// - every `replace` text present (and its anchor gone, unless the replace text holds it) means applied, so a
//   replace text must not occur in the unpatched file; the `upstream` text present means RETIRED;
// - a patch whose `requires` is skipped is skipped too (a retired one counts as there);
// - before the swap each changed main/preload file must compile (new vm.Script, in Node's CommonJS wrapper)
//   and each renderer chunk passes `node --check` as a temp .mjs; a failure writes nothing.
// Packed files only: an entry in app.asar.unpacked lives outside the archive and is never changed.
//
// The rewrite never extracts: it parses the asar header, replaces text in the changed files, rewrites
// offsets and sizes, drops the stale `integrity` of each changed file and copies every other byte as it is.
// Swap: write app.asar.patched-tmp, rename app.asar to app.asar.orig (kept when it already exists), rename
// the tmp to app.asar, write resources/ai-coding-setup-patched.json {version, patches}. A failed rename undoes
// the earlier ones. Refused: any running program from the install dir (Nimbalyst holds app.asar), a per-machine
// install (Program Files, or a resources dir we can't write), and the EnableEmbeddedAsarIntegrityValidation
// fuse on in Nimbalyst.exe (a patched asar would not load).
//
// Exit codes: 0 done (skipped patches are reported, not errors); 1 refused (also a skipped requiredFirst
// patch) or failed; 2 bad usage.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARKER = "ai-coding-setup-patched.json";
// @electron/fuses: the wire is SENTINEL, a version byte (1), a length byte, then one byte per fuse:
// '0' off, '1' on, 'r' removed. Order of FuseV1Options:
const SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
const FUSES = [
  "RunAsNode",
  "EnableCookieEncryption",
  "EnableNodeOptionsEnvironmentVariable",
  "EnableNodeCliInspectArguments",
  "EnableEmbeddedAsarIntegrityValidation",
  "OnlyLoadAppFromAsar",
  "LoadBrowserProcessSpecificV8Snapshot",
  "GrantFileProtocolExtraPrivileges",
  "WasmTrapHandlers",
];

export class Refused extends Error {}

// ---- asar reading ----

// The header: a pickle holding the header pickle's size, then the header pickle (payload size, string
// length, JSON, zero padding to 4 bytes). File data starts right after it, in header order, without gaps.
export function readAsar(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(8);
    if (fs.readSync(fd, head, 0, 8, 0) !== 8 || head.readUInt32LE(0) !== 4)
      throw new Error(`${file}: not an asar archive (bad size pickle)`);
    const headerSize = head.readUInt32LE(4);
    if (headerSize < 8 || 8 + headerSize > size)
      throw new Error(
        `${file}: not an asar archive (header size ${headerSize})`,
      );
    const h = Buffer.alloc(headerSize);
    fs.readSync(fd, h, 0, headerSize, 8);
    const len = h.readUInt32LE(4);
    if (8 + len > headerSize)
      throw new Error(`${file}: header string longer than the header`);
    let header;
    try {
      header = JSON.parse(h.toString("utf8", 8, 8 + len));
    } catch (e) {
      throw new Error(`${file}: header JSON does not parse: ${e.message}`);
    }
    const entries = [];
    (function walk(dir, prefix) {
      for (const [name, e] of Object.entries(dir.files)) {
        const p = prefix ? `${prefix}/${name}` : name;
        if (e.files) walk(e, p);
        else
          entries.push({
            path: p,
            entry: e,
            packed: !e.unpacked && !e.link && e.offset !== undefined,
          });
      }
    })(header, "");
    const dataStart = 8 + headerSize;
    const packed = entries
      .filter((x) => x.packed)
      .sort((a, b) => Number(a.entry.offset) - Number(b.entry.offset));
    let end = 0;
    for (const x of packed) {
      if (Number(x.entry.offset) !== end)
        throw new Error(
          `${file}: unexpected layout, ${x.path} at ${x.entry.offset}, expected ${end}`,
        );
      end += x.entry.size;
    }
    if (dataStart + end !== size)
      throw new Error(
        `${file}: unexpected layout, data ends at ${dataStart + end}, file is ${size} bytes`,
      );
    return { file, header, dataStart, entries, packed };
  } finally {
    fs.closeSync(fd);
  }
}

export function readEntry(asar, p) {
  const x = asar.entries.find((e) => e.path === p);
  if (!x) throw new Error(`${asar.file}: no ${p} inside`);
  if (!x.packed)
    throw new Error(`${asar.file}: ${p} is not packed in the archive`);
  const buf = Buffer.alloc(x.entry.size);
  const fd = fs.openSync(asar.file, "r");
  try {
    if (
      fs.readSync(
        fd,
        buf,
        0,
        buf.length,
        asar.dataStart + Number(x.entry.offset),
      ) !== buf.length
    )
      throw new Error(`${asar.file}: short read of ${p}`);
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}

export function asarVersion(asar) {
  let pkg;
  try {
    pkg = JSON.parse(readEntry(asar, "package.json").toString("utf8"));
  } catch (e) {
    throw new Error(`${asar.file}: package.json: ${e.message}`);
  }
  if (typeof pkg.version !== "string")
    throw new Error(`${asar.file}: package.json has no version`);
  return pkg.version;
}

// ---- fuses, install kind, running app ----

export function readFuses(exe) {
  const fd = fs.openSync(exe, "r");
  try {
    const size = fs.fstatSync(fd).size,
      CHUNK = 16 * 1024 * 1024;
    const buf = Buffer.alloc(CHUNK + 64);
    for (let pos = 0; pos < size; pos += CHUNK) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      const i = buf.subarray(0, n).indexOf(SENTINEL);
      if (i < 0 || i + SENTINEL.length + 2 > n) continue;
      const w = i + SENTINEL.length,
        version = buf[w],
        length = buf[w + 1];
      if (version !== 1)
        throw new Refused(
          `${exe}: fuse wire version ${version}, this patcher knows version 1 only`,
        );
      const wire = Buffer.alloc(length);
      fs.readSync(fd, wire, 0, length, pos + w + 2);
      const fuses = {};
      [...wire.toString("latin1")].forEach((c, k) => {
        fuses[FUSES[k] ?? `fuse${k}`] = c;
      });
      return fuses;
    }
    throw new Error(`${exe}: no Electron fuse wire found`);
  } finally {
    fs.closeSync(fd);
  }
}

const inside = (p, dir) => {
  const r = path.relative(dir, p);
  return !!r && !r.startsWith("..") && !path.isAbsolute(r);
};
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};

// Program Files (from the environment, plus the plain name) means a per-machine install that needs admin.
// NIMBALYST_PATCH_PROGRAM_DIRS: folders to treat as Program Files (tests: a child process on Windows keeps
// the real ProgramFiles whatever its parent passes).
export function perMachine(res) {
  const r = real(res);
  const roots = (
    process.env.NIMBALYST_PATCH_PROGRAM_DIRS
      ? process.env.NIMBALYST_PATCH_PROGRAM_DIRS.split(path.delimiter)
      : [
          process.env.ProgramFiles,
          process.env["ProgramFiles(x86)"],
          process.env.ProgramW6432,
        ]
  )
    .filter(Boolean)
    .map(real);
  return (
    roots.some((root) => inside(r, root)) ||
    /[\\/]Program Files( \(x86\))?[\\/]/i.test(r)
  );
}

const listRunning = (paths) =>
  `${paths.length} process(es) from ${[...new Set(paths)].join(", ")}`;

// Paths of running programs whose executable lives under installDir, one per process: Nimbalyst.exe and the
// helpers it ships there (claude.exe, codex.exe, rg.exe, OpenConsole.exe, winpty-agent.exe, ...), whatever their name.
export function runningFrom(installDir) {
  let r;
  if (process.platform === "win32") {
    r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path } | ForEach-Object { $_.Path }",
      ],
      { encoding: "utf8", windowsHide: true },
    );
  } else {
    r = spawnSync("ps", ["-A", "-o", "comm="], { encoding: "utf8" });
  }
  if (r.error || r.status !== 0)
    throw new Error(
      `could not list running processes: ${r.error?.message || r.stderr}`,
    );
  const dir = real(installDir),
    plain = path.resolve(installDir);
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((p) => p && path.isAbsolute(p))
    .filter((p) => inside(path.resolve(p), plain) || inside(real(p), dir));
}

// ---- patches ----

export async function loadPatches(dir) {
  if (!fs.existsSync(dir))
    throw new Error(`patches folder ${dir} does not exist`);
  const out = [];
  for (const name of fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".mjs"))
    .sort()) {
    const file = path.join(dir, name);
    const bad = (why) => {
      throw new Error(`${file}: ${why}`);
    };
    let p;
    try {
      p = (await import(pathToFileURL(file).href)).default;
    } catch (e) {
      bad(`does not load: ${e.message}`);
    }
    if (!p || typeof p !== "object") bad("no default export object");
    if (p.id !== name.slice(0, -4))
      bad(`id "${p.id}" must equal the file name "${name.slice(0, -4)}"`);
    if (!(p.files instanceof RegExp)) bad("files must be a RegExp");
    if (!Array.isArray(p.edits) || !p.edits.length)
      bad("edits must be a non-empty array");
    for (const e of p.edits) {
      if (typeof e?.anchor !== "string" || !e.anchor)
        bad("each edit needs a non-empty anchor");
      if (typeof e.replace !== "string" || !e.replace || e.replace === e.anchor)
        bad("each edit needs a replace text that differs from its anchor");
    }
    if (p.upstream !== null && (typeof p.upstream !== "string" || !p.upstream))
      bad(
        "upstream must be a non-empty string, or null for a patch that never retires",
      );
    if (
      p.requires !== undefined &&
      (!Array.isArray(p.requires) ||
        p.requires.some((r) => typeof r !== "string"))
    )
      bad("requires must be an array of ids");
    if (p.requiredFirst !== undefined && typeof p.requiredFirst !== "boolean")
      bad("requiredFirst must be true or false");
    if (p.requiredFirst && p.requires?.length)
      bad("a requiredFirst patch can't require other patches");
    out.push({
      ...p,
      requires: p.requires ?? [],
      requiredFirst: p.requiredFirst === true,
    });
  }
  const ids = new Map(out.map((p) => [p.id, p]));
  for (const p of out)
    for (const r of p.requires)
      if (!ids.has(r))
        throw new Error(`patch ${p.id} requires ${r}, which is not in ${dir}`);
  // requiredFirst patches first, then each patch after the patches it requires
  out.sort((a, b) => Number(b.requiredFirst) - Number(a.requiredFirst));
  const sorted = [],
    state = new Map();
  const visit = (p, chain) => {
    if (state.get(p.id) === "done") return;
    if (state.get(p.id) === "busy")
      throw new Error(
        `patches require each other in a circle: ${[...chain, p.id].join(" -> ")}`,
      );
    state.set(p.id, "busy");
    for (const r of p.requires) visit(ids.get(r), [...chain, p.id]);
    state.set(p.id, "done");
    sorted.push(p);
  };
  for (const p of out) visit(p, []);
  return sorted;
}

const count = (text, s) => {
  let n = 0;
  for (let i = text.indexOf(s); i >= 0; i = text.indexOf(s, i + s.length)) n++;
  return n;
};
const short = (s) => JSON.stringify(s.length > 50 ? s.slice(0, 50) + "..." : s);

// Works out each patch's state on the asar, in memory. States: applied, would apply, skipped, retired.
// Returns the results and the new text of each file the "would apply" patches change.
export function plan(asar, patches) {
  const texts = new Map(),
    changed = new Map(),
    states = new Map(),
    results = [];
  const text = (p) => {
    if (!texts.has(p)) {
      const buf = readEntry(asar, p),
        t = buf.toString("utf8");
      texts.set(p, { t, utf8: Buffer.from(t).equals(buf) });
    }
    return texts.get(p).t;
  };
  for (const p of patches) {
    const res = {
      id: p.id,
      state: "skipped",
      reason: "",
      files: [],
      requiredFirst: p.requiredFirst,
    };
    results.push(res);
    const files = asar.packed.map((x) => x.path).filter((f) => p.files.test(f));
    const need = p.requires.find(
      (r) => !["applied", "would apply", "retired"].includes(states.get(r)),
    );
    if (!files.length) res.reason = `no file in the asar matches ${p.files}`;
    else if (
      p.upstream !== null &&
      files.some((f) => text(f).includes(p.upstream))
    )
      res.state = "retired";
    else if (need)
      res.reason = `requires ${need}, which was ${states.get(need)}`;
    else {
      // an edit is in when its replace text is there and its anchor is gone (or lives inside the replace text)
      const done = p.edits.map(
        (e) =>
          files.some((f) => text(f).includes(e.replace)) &&
          (e.replace.includes(e.anchor) ||
            files.every((f) => !text(f).includes(e.anchor))),
      );
      if (done.every(Boolean)) res.state = "applied";
      else if (done.some(Boolean))
        res.reason = `partly applied (${done.filter(Boolean).length} of ${done.length} edits), anchors changed`;
      else {
        const work = new Map(files.map((f) => [f, text(f)]));
        let failed = "";
        for (const e of p.edits) {
          const hits = files
            .map((f) => [f, count(work.get(f), e.anchor)])
            .filter(([, n]) => n);
          const n = hits.reduce((a, [, k]) => a + k, 0);
          if (n !== 1) {
            failed = `anchor changed: ${short(e.anchor)} found ${n}x in ${files.length} matching file(s)`;
            break;
          }
          const [f] = hits[0],
            t = work.get(f),
            i = t.indexOf(e.anchor);
          work.set(f, t.slice(0, i) + e.replace + t.slice(i + e.anchor.length));
        }
        if (failed) res.reason = failed;
        else {
          for (const [f, t] of work) {
            if (t === text(f)) continue;
            if (!texts.get(f).utf8)
              throw new Error(
                `${asar.file}: ${f} is not plain UTF-8, refusing to edit it (patch ${p.id})`,
              );
            texts.get(f).t = t;
            changed.set(f, [...(changed.get(f) ?? []), p.id]);
            res.files.push(f);
          }
          res.state = "would apply";
        }
      }
    }
    states.set(p.id, res.state);
  }
  return {
    results,
    changed: new Map(
      [...changed].map(([f, ids]) => [f, { text: texts.get(f).t, ids }]),
    ),
  };
}

// Main and preload code is CommonJS: compiled as Node wraps a module. Renderer chunks are ES modules.
export function compileCheck(changed) {
  const errors = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nimbalyst-patch-check-"));
  try {
    for (const [f, { text, ids }] of changed) {
      const who = `${f} (changed by ${ids.join(", ")})`;
      if (f.endsWith(".json")) {
        try {
          JSON.parse(text);
        } catch (e) {
          errors.push(`${who}: ${e.message}`);
        }
        continue;
      }
      if (!/\.(c|m)?js$/.test(f)) continue;
      if (/(^|\/)renderer\//.test(f) || f.endsWith(".mjs")) {
        const t = path.join(
          tmp,
          `check-${errors.length}-${path.basename(f).replace(/\.\w+$/, "")}.mjs`,
        );
        fs.writeFileSync(t, text);
        const r = spawnSync(process.execPath, ["--check", t], {
          encoding: "utf8",
        });
        if (r.error)
          throw new Error(`node --check could not run: ${r.error.message}`);
        if (r.status !== 0)
          errors.push(
            `${who}: ${(r.stderr || "").trim().split("\n").slice(-3).join(" | ")}`,
          );
      } else {
        try {
          new vm.Script(
            `(function (exports, require, module, __filename, __dirname) {${text}\n})`,
            { filename: f },
          );
        } catch (e) {
          errors.push(`${who}: ${e.message}`);
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return errors;
}

// Writes a new asar to dst: the changed files get their new bytes, size and offset and lose their stale
// integrity; every other byte is copied from the source as it is.
export function writeAsar(asar, changed, dst) {
  const header = structuredClone(asar.header);
  const node = (p) => p.split("/").reduce((d, name) => d.files[name], header);
  const bufs = new Map(
    [...changed].map(([f, { text }]) => [f, Buffer.from(text)]),
  );
  let offset = 0;
  for (const x of asar.packed) {
    const e = node(x.path),
      buf = bufs.get(x.path);
    e.offset = String(offset);
    if (buf) {
      e.size = buf.length;
      delete e.integrity;
    }
    offset += e.size;
  }
  const json = Buffer.from(JSON.stringify(header));
  const payload = (4 + json.length + 3) & ~3;
  const head = Buffer.alloc(8 + 4 + payload);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(4 + payload, 4);
  head.writeUInt32LE(payload, 8);
  head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);
  const src = fs.openSync(asar.file, "r"),
    out = fs.openSync(dst, "w");
  try {
    fs.writeSync(out, head);
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    const copy = (from, len) => {
      while (len > 0) {
        const n = fs.readSync(src, chunk, 0, Math.min(len, chunk.length), from);
        if (n <= 0) throw new Error(`${asar.file}: short read at ${from}`);
        fs.writeSync(out, chunk, 0, n);
        from += n;
        len -= n;
      }
    };
    let runFrom = -1,
      runLen = 0;
    for (const x of asar.packed) {
      const buf = bufs.get(x.path);
      if (!buf) {
        if (runFrom < 0) runFrom = asar.dataStart + Number(x.entry.offset);
        runLen += x.entry.size;
        continue;
      }
      if (runLen) {
        copy(runFrom, runLen);
        runFrom = -1;
        runLen = 0;
      }
      fs.writeSync(out, buf);
    }
    if (runLen) copy(runFrom, runLen);
    fs.fsyncSync(out);
  } finally {
    fs.closeSync(src);
    fs.closeSync(out);
  }
}

// ---- commands ----

const paths = (res) => {
  const asar = path.join(res, "app.asar");
  return {
    res,
    asar,
    orig: `${asar}.orig`,
    tmp: `${asar}.patched-tmp`,
    marker: path.join(res, MARKER),
    install: path.dirname(res),
    exe: path.join(path.dirname(res), "Nimbalyst.exe"),
  };
};

function readMarker(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
}

function describe(r) {
  if (r.state === "skipped")
    return `SKIPPED, ${r.reason}${r.requiredFirst ? " (a required patch: without it no patch is applied)" : ""}`;
  if (r.state === "retired")
    return "RETIRED, upstream has the fix: delete this patch file";
  return r.files.length ? `${r.state} (${r.files.join(", ")})` : r.state;
}

// The refusals, in order. write: also prove we can create a file in the resources folder.
function guard(P, { fuse = true, write = false } = {}) {
  if (!fs.existsSync(P.asar))
    throw new Error(
      `${P.asar} does not exist (give the resources folder with --app)`,
    );
  if (perMachine(P.res))
    throw new Refused(
      `${P.install} is a per-machine install (Program Files): can't patch here, it needs admin`,
    );
  if (fuse) {
    if (!fs.existsSync(P.exe))
      throw new Error(`${P.exe} does not exist, so its fuses can't be read`);
    if (readFuses(P.exe).EnableEmbeddedAsarIntegrityValidation === "1")
      throw new Refused(
        `${P.exe} has the EnableEmbeddedAsarIntegrityValidation fuse on: a patched app.asar would not load, so nothing is patched`,
      );
  }
  const running = runningFrom(P.install);
  if (running.length)
    throw new Refused(
      `Nimbalyst is running (${listRunning(running)}) and holds app.asar: quit it, then run this again`,
    );
  if (write) {
    const probe = path.join(
      P.res,
      `.ai-coding-setup-write-test-${process.pid}`,
    );
    try {
      fs.writeFileSync(probe, "");
      fs.rmSync(probe);
    } catch (e) {
      throw new Refused(
        `can't write in ${P.res} (${e.code || e.message}): can't patch here`,
      );
    }
  }
}

export async function status(P, patchesDir) {
  const asar = readAsar(P.asar),
    version = asarVersion(asar),
    marker = readMarker(P.marker);
  const lines = [
    `Nimbalyst ${version} at ${P.res}`,
    `marker: ${marker ? `${marker.version}, patches ${marker.patches.join(", ") || "none"}` : "none"}`,
    `backup app.asar.orig: ${fs.existsSync(P.orig) ? "present" : "none"}`,
  ];
  const fuse = fs.existsSync(P.exe)
    ? readFuses(P.exe).EnableEmbeddedAsarIntegrityValidation
    : null;
  lines.push(
    `fuse EnableEmbeddedAsarIntegrityValidation: ${fuse === null ? `unknown, no ${P.exe}` : fuse === "1" ? "ON (can't patch)" : "off"}`,
  );
  lines.push(
    `install: ${perMachine(P.res) ? "per-machine (can't patch here)" : "per-user"}`,
  );
  const running = runningFrom(P.install);
  lines.push(
    `running: ${running.length ? `yes (${listRunning(running)})` : "no"}`,
  );
  const { results } = plan(asar, await loadPatches(patchesDir));
  for (const r of results) lines.push(`patch ${r.id}: ${describe(r)}`);
  if (!results.length) lines.push("no patches");
  return lines;
}

export async function apply(P, patchesDir, { dryRun = false } = {}) {
  guard(P, { write: !dryRun });
  const asar = readAsar(P.asar),
    version = asarVersion(asar);
  const { results, changed } = plan(asar, await loadPatches(patchesDir));
  const blocked = results.find((r) => r.requiredFirst && r.state === "skipped");
  if (blocked)
    throw new Refused(
      `patch ${blocked.id}: ${describe(blocked)}; nothing written, app.asar left as it is`,
    );
  const lines = [
    `Nimbalyst ${version} at ${P.res}`,
    ...results.map(
      (r) =>
        `patch ${r.id}: ${dryRun ? describe(r) : describe(r).replace(/^would apply/, "applied now")}`,
    ),
  ];
  const ids = results
    .filter((r) => r.state === "applied" || r.state === "would apply")
    .map((r) => r.id);
  const markerText = JSON.stringify({ version, patches: ids }, null, 2) + "\n";
  const writeMarker = () => {
    const cur = fs.existsSync(P.marker)
      ? fs.readFileSync(P.marker, "utf8")
      : null;
    if (cur === markerText || (cur === null && !ids.length)) return;
    fs.writeFileSync(P.marker, markerText);
  };
  if (!changed.size) {
    lines.push(
      ids.length
        ? "already applied, app.asar left as it is"
        : "nothing to apply, app.asar left as it is",
    );
    if (!dryRun) writeMarker();
    return lines;
  }
  const errors = compileCheck(changed);
  if (errors.length)
    throw new Error(
      `changed code does not compile, nothing written:\n  ${errors.join("\n  ")}`,
    );
  if (dryRun)
    return [
      ...lines,
      `dry run: ${changed.size} file(s) would change and compile; nothing written`,
    ];
  if (fs.existsSync(P.orig) && asarVersion(readAsar(P.orig)) !== version) {
    throw new Error(
      `${P.orig} is from another Nimbalyst version than app.asar (${version}): remove or restore it first`,
    );
  }
  writeAsar(asar, changed, P.tmp);
  try {
    if (asarVersion(readAsar(P.tmp)) !== version)
      throw new Error(`${P.tmp} reads back with another version`);
  } catch (e) {
    fs.rmSync(P.tmp, { force: true });
    throw e;
  }
  let moved = false;
  try {
    if (!fs.existsSync(P.orig)) {
      fs.renameSync(P.asar, P.orig);
      moved = true;
    }
    fs.renameSync(P.tmp, P.asar);
  } catch (e) {
    if (moved) {
      try {
        fs.renameSync(P.orig, P.asar);
      } catch (e2) {
        throw new Error(
          `swap failed (${e.message}) and the undo failed too (${e2.message}): the original is ${P.orig}`,
        );
      }
    }
    fs.rmSync(P.tmp, { force: true });
    throw new Error(`swap failed, earlier renames undone: ${e.message}`);
  }
  writeMarker();
  return [
    ...lines,
    `written: ${changed.size} file(s) changed; the original is ${P.orig}`,
  ];
}

export function restore(P) {
  guard(P, { fuse: false, write: true });
  if (!fs.existsSync(P.orig))
    throw new Error(`${P.orig} does not exist: nothing to restore`);
  const old = `${P.asar}.restore-tmp`;
  fs.renameSync(P.asar, old);
  try {
    fs.renameSync(P.orig, P.asar);
  } catch (e) {
    fs.renameSync(old, P.asar);
    throw new Error(`restore failed, app.asar left as it was: ${e.message}`);
  }
  fs.rmSync(old);
  fs.rmSync(P.marker, { force: true });
  return [
    `restored the original app.asar (Nimbalyst ${asarVersion(readAsar(P.asar))}) in ${P.res}`,
  ];
}

async function main(argv) {
  const usage =
    "usage: patch.mjs [--status | --restore | --dry-run] [--app <resources dir>] [--patches <dir>]";
  let mode = "apply",
    app = null,
    patchesDir = path.join(HERE, "patches");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--status") mode = "status";
    else if (a === "--restore") mode = "restore";
    else if (a === "--dry-run") mode = "dry-run";
    else if ((a === "--app" || a === "--patches") && argv[i + 1]) {
      if (a === "--app") app = argv[++i];
      else patchesDir = argv[++i];
    } else {
      console.error(
        `[nimbalyst-patch] unknown or incomplete option ${a}. ${usage}`,
      );
      return 2;
    }
  }
  if (!app) {
    if (!process.env.LOCALAPPDATA) {
      console.error(
        `[nimbalyst-patch] LOCALAPPDATA is not set: give --app. ${usage}`,
      );
      return 2;
    }
    app = path.join(
      process.env.LOCALAPPDATA,
      "Programs",
      "Nimbalyst",
      "resources",
    );
  }
  const P = paths(path.resolve(app));
  try {
    const lines =
      mode === "status"
        ? await status(P, path.resolve(patchesDir))
        : mode === "restore"
          ? restore(P)
          : await apply(P, path.resolve(patchesDir), {
              dryRun: mode === "dry-run",
            });
    console.log(lines.join("\n"));
    return 0;
  } catch (e) {
    console.error(
      `[nimbalyst-patch] ${e instanceof Refused ? "refused" : "failed"}: ${e.message}`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  real(process.argv[1]) === real(fileURLToPath(import.meta.url))
)
  process.exitCode = await main(process.argv.slice(2));
