// Builds orbs.js from orbs-src.mjs and the thinking-orbs 0.3.2 package, and writes the package's MIT licence
// beside it. The package is fetched from npm into a fresh temp folder each time and deleted afterwards, so the
// repo carries no dependency for it: the built orbs.js is committed, and only a change of the mount or of the
// package version needs this build. Needs the network (npm pack, npx esbuild). Run: node build.mjs

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.3.2";
const ESBUILD = "esbuild@0.24.0";
const CHUNK = "dist/index-B8WsUNf5.js"; // the package file that holds the drawing engine (no React)
const here = path.dirname(fileURLToPath(import.meta.url));

/** Runs a command (through the shell, so npm and npx resolve on Windows too); throws with its output when it fails. */
function run(cmd, args, cwd) {
  const line = [cmd, ...args.map((a) => `"${a}"`)].join(" ");
  const r = spawnSync(line, { cwd, shell: true, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`${line} failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orbs-build-"));
try {
  // The download goes in its own folder; nothing is run from inside it
  const fetched = path.join(tmp, "fetch");
  fs.mkdirSync(fetched);
  run("npm", ["pack", `thinking-orbs@${VERSION}`, "--silent"], fetched);
  run("tar", ["-xzf", `thinking-orbs-${VERSION}.tgz`], fetched);
  const pkg = path.join(fetched, "package");
  const meta = JSON.parse(
    fs.readFileSync(path.join(pkg, "package.json"), "utf8"),
  );
  if (meta.version !== VERSION || meta.license !== "MIT")
    throw new Error(
      `expected thinking-orbs ${VERSION} under MIT, got ${meta.version} under ${meta.license}`,
    );
  const chunk = path.join(pkg, CHUNK);
  if (!fs.existsSync(chunk))
    throw new Error(
      `the package has no ${CHUNK}; the mount's imports need checking`,
    );

  const licence = fs.readFileSync(path.join(pkg, "LICENSE"), "utf8");
  fs.writeFileSync(
    path.join(here, "LICENSE-thinking-orbs.txt"),
    `orbs.js bundles the drawing engine of thinking-orbs ${VERSION} by Jakub Antalik\n` +
      `(https://www.npmjs.com/package/thinking-orbs, https://github.com/Jakubantalik/thinking-orbs) under this licence:\n\n${licence}`,
  );

  const out = path.join(tmp, "orbs.js");
  run(
    "npx",
    [
      "--yes",
      ESBUILD,
      path.join(here, "orbs-src.mjs"),
      "--bundle",
      "--format=iife",
      "--minify",
      `--alias:thinking-orbs-chunk=${chunk}`,
      `--outfile=${out}`,
    ],
    here,
  );
  const banner =
    `/*! thinking-orbs ${VERSION} (c) Jakub Antalik, MIT licence (LICENSE-thinking-orbs.txt), ` +
    `https://github.com/Jakubantalik/thinking-orbs . Plain-script mount, built by build.mjs from orbs-src.mjs. */\n`;
  fs.writeFileSync(
    path.join(here, "orbs.js"),
    banner + fs.readFileSync(out, "utf8"),
  );
  console.log(
    `built ${path.join(here, "orbs.js")} (${fs.statSync(path.join(here, "orbs.js")).size} bytes)`,
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
