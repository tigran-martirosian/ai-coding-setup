#!/usr/bin/env node
// Brings an installed setup up to the newest released version.
//   node update.mjs                  check, and if a newer version is out: download it and install it
//   node update.mjs --check          only say whether a newer version is out
//   node update.mjs --replace-rules  also take this version's rules where ~/.claude/CLAUDE.md has the
//                                    user's own changes (a dated copy is kept). With nothing newer
//                                    out, it runs the installed version's installer again with it.
//   --home <folder>                  work on <folder>/.claude instead of the home folder's (tests)
// How: the newest version is the one in version.json on the repository's main branch. Its files are
// the tag v<version>, downloaded as one archive and unpacked to ~/.claude/setup-source/v<version>.
// Then that folder's install.mjs runs. It takes the projects folder, the answers about the workers
// and Node from ~/.claude/setup-state.json, so nothing is asked again, and it only writes the setup's
// own files: anything else in ~/.claude (other skills, hooks, settings) stays as it is.
// A step that fails stops the update with the reason; the installed setup is then unchanged.
// SETUP_UPDATE_BASE points it at another address that serves version.json and v<version>.tar.gz (tests).
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const REPO_URL = "https://github.com/tigran-martirosian/ai-coding-setup"; // where this setup is published
const BASE = process.env.SETUP_UPDATE_BASE;
const VERSION_URL = BASE ? `${BASE}/version.json` : `${REPO_URL.replace("github.com", "raw.githubusercontent.com")}/main/version.json`;
const archiveUrl = (v) => (BASE ? `${BASE}/v${v}.tar.gz` : `${REPO_URL}/archive/refs/tags/v${v}.tar.gz`);

const args = process.argv.slice(2);
const homeAt = args.indexOf("--home");
const home = homeAt === -1 ? os.homedir() : path.resolve(args[homeAt + 1]);
const CLAUDE = path.join(home, ".claude");
const fwd = (p) => p.replace(/\\/g, "/");
const stop = (why) => { console.log(`Update stopped: ${why}`); process.exit(1); };
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v || "0").split(".").map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
// Reads an address, following redirects. Not fetch: on Windows, Node can crash when a process ends
// right after one.
const get = (url, ms, hops = 5) => new Promise((resolve, reject) => {
  const req = (url.startsWith("https:") ? https : http).get(url, { timeout: ms, headers: { "user-agent": "setup-update" } }, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops > 0) {
      res.resume();
      return resolve(get(new URL(res.headers.location, url).href, ms, hops - 1));
    }
    if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
    const parts = [];
    res.on("data", (d) => parts.push(d));
    res.on("end", () => resolve(Buffer.concat(parts)));
    res.on("error", reject);
  });
  req.on("timeout", () => req.destroy(new Error("no answer in time")));
  req.on("error", reject);
});

const stateFile = path.join(CLAUDE, "setup-state.json");
if (!fs.existsSync(stateFile)) stop(`${fwd(stateFile)} is missing, so this setup was not put in place by install.mjs. Download ${REPO_URL} and run its install once.`);
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const installed = state.version || "0";

// Runs a version's installer with the flags that are passed on
function install(folder) {
  const flags = args.includes("--replace-rules") ? ["--replace-rules"] : [];
  if (homeAt !== -1) flags.push("--home", home);
  const r = spawnSync(process.execPath, [path.join(folder, "install.mjs"), ...flags], { stdio: "inherit" });
  if (r.status !== 0) stop(`install.mjs in ${fwd(folder)} ended with an error (see above).`);
}

let latest;
try {
  latest = JSON.parse(await get(VERSION_URL, 15000));
} catch (e) {
  stop(`could not read ${VERSION_URL} (${e.message}). Check the internet connection and try again.`);
}
if (!/^\d+(\.\d+)*$/.test(String(latest.version))) stop(`${VERSION_URL} has no usable version number.`);

if (!newer(latest.version, installed)) {
  console.log(`Already on the newest version (${installed}).`);
  if (args.includes("--replace-rules") && !args.includes("--check")) {
    if (!state.repo || !fs.existsSync(path.join(state.repo, "install.mjs"))) stop(`the setup's folder (${state.repo}) is gone, so its installer can't run again.`);
    install(state.repo);
  }
  process.exit(0);
}
console.log(`Newer version: ${latest.version} (installed: ${installed === "0" ? "an older one, no version on record" : installed}).`);
if (latest.summary) console.log(`What is new: ${latest.summary}`);
if (args.includes("--check")) process.exit(0);

// ---- download and unpack. The folder gets its final name only when it is complete.
const sources = path.join(CLAUDE, "setup-source");
const target = path.join(sources, `v${latest.version}`);
const part = `${target}.part`;
fs.rmSync(part, { recursive: true, force: true });
fs.mkdirSync(part, { recursive: true });
try {
  fs.writeFileSync(path.join(part, "source.tar.gz"), await get(archiveUrl(latest.version), 120000));
} catch (e) {
  fs.rmSync(part, { recursive: true, force: true });
  stop(`could not download ${archiveUrl(latest.version)} (${e.message}).`);
}
// Windows has its own tar in System32; a tar from Git reads "C:" in a path as another computer,
// so the archive is named without its folder and tar runs inside it.
const winTar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
const tar = process.platform === "win32" && fs.existsSync(winTar) ? winTar : "tar";
const un = spawnSync(tar, ["-xzf", "source.tar.gz", "--strip-components=1"], { cwd: part, encoding: "utf8" });
fs.rmSync(path.join(part, "source.tar.gz"), { force: true });
if (un.status !== 0 || !fs.existsSync(path.join(part, "install.mjs"))) {
  fs.rmSync(part, { recursive: true, force: true });
  stop(`could not unpack the download with tar${un.error ? ` (${un.error.message})` : un.stderr ? ` (${un.stderr.trim().split("\n")[0]})` : ""}.`);
}
fs.rmSync(target, { recursive: true, force: true });
fs.renameSync(part, target);
console.log(`Downloaded to ${fwd(target)}`);

// ---- which editor extensions changed: they are built from source, which the installer doesn't do
const filesIn = (dir, base = dir) => (!fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true })
  .filter((e) => !["node_modules", "dist"].includes(e.name))
  .flatMap((e) => (e.isDirectory() ? filesIn(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))])));
const print = (dir) => crypto.createHash("sha256")
  .update(filesIn(dir).sort().map((f) => f + "\n" + fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n")).join("\n")).digest("hex");
const extDir = path.join(target, "extensions");
const changed = (fs.existsSync(extDir) ? fs.readdirSync(extDir) : [])
  .filter((n) => fs.existsSync(path.join(extDir, n, "package.json")))
  .filter((n) => !state.repo || !fs.existsSync(path.join(state.repo, "extensions", n)) || print(path.join(state.repo, "extensions", n)) !== print(path.join(extDir, n)));

install(target);

// The folders of earlier updates go; the folder the setup was first installed from is left alone
for (const name of fs.readdirSync(sources)) {
  if (name !== `v${latest.version}`) fs.rmSync(path.join(sources, name), { recursive: true, force: true });
}
for (const name of changed) console.log(`extension changed: ${name} (source in ${fwd(path.join(extDir, name))})`);
console.log(`Updated to version ${latest.version}. The full list of changes: ${fwd(path.join(target, "CHANGELOG.md"))}`);
