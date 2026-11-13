// Tests for skills/update-setup/update.mjs: a real update from this version to a made-up newer one,
// served by a small local server that stands in for GitHub. Everything happens in a temporary home
// folder. Run: node tests/test-update.mjs
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const UPDATE = path.join(REPO, "skills", "update-setup", "update.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "update-test-"));
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const fwd = (p) => p.replace(/\\/g, "/");

// ---- the newer version: this repository with a higher number, one new rule, one changed extension
const NEW = "9.9.9";
const pack = path.join(tmp, "pack", `ai-coding-setup-${NEW}`);
const SKIP = [".git", "node_modules", "promo", "dist", "img"];
fs.cpSync(REPO, pack, { recursive: true, filter: (src) => !SKIP.includes(path.basename(src)) });
fs.writeFileSync(path.join(pack, "version.json"), JSON.stringify({ version: NEW, summary: "A made-up release." }));
fs.appendFileSync(path.join(pack, "rules", "CLAUDE.md"), "\n- A rule from the newer version.\n");
fs.appendFileSync(path.join(pack, "hooks", "sql-guard.mjs"), "\n// newer\n");
fs.appendFileSync(path.join(pack, "extensions", "commands", "README.md"), "\nChanged in the newer version.\n");
const served = path.join(tmp, "served");
fs.mkdirSync(served);
const winTar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
const tar = process.platform === "win32" && fs.existsSync(winTar) ? winTar : "tar";
const packed = spawnSync(tar, ["-czf", path.join("..", "served", `v${NEW}.tar.gz`), `ai-coding-setup-${NEW}`], { cwd: path.join(tmp, "pack"), encoding: "utf8" });
check("the test archive was made", packed.status === 0 && fs.existsSync(path.join(served, `v${NEW}.tar.gz`)));

let released = { version: NEW, summary: "A made-up release." };
const server = http.createServer((req, res) => {
  if (req.url === "/version.json") return res.end(JSON.stringify(released));
  const file = path.join(served, path.basename(req.url));
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
// The server runs in this process, so the updater is started without blocking it
const update = (home, ...flags) => new Promise((resolve) => {
  const p = spawn(process.execPath, [UPDATE, "--home", home, ...flags], { env: { ...process.env, SETUP_UPDATE_BASE: BASE } });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.on("close", (code) => resolve({ code, out }));
});

// ---- this version installed, with no workers, plus things of the user's own
const home = path.join(tmp, "home");
const claude = path.join(home, ".claude");
const first = spawnSync(process.execPath, [path.join(REPO, "install.mjs"), "--home", home, "--codex", "no", "--agy", "no"], { encoding: "utf8" });
check("this version installs", first.status === 0 && json(path.join(claude, "setup-state.json")).version === json(path.join(REPO, "version.json")).version);
const ownSkill = path.join(claude, "skills", "build-table", "SKILL.md");
fs.mkdirSync(path.dirname(ownSkill), { recursive: true });
fs.writeFileSync(ownSkill, "# My own skill\n");
const settingsFile = path.join(claude, "settings.json");
const settings = json(settingsFile);
settings.model = "opus";
settings.hooks.Stop.push({ hooks: [{ type: "command", command: "node my-own-hook.mjs" }] });
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
const profile = path.join(home, "Projects", "internet-search", "profile.md");
fs.writeFileSync(profile, "# My profile\n");

// ---- only looking
const looked = await update(home, "--check");
check("--check names the newer version and what is new", looked.code === 0 && looked.out.includes(`Newer version: ${NEW}`) && looked.out.includes("What is new: A made-up release."));
check("--check downloads nothing", !fs.existsSync(path.join(claude, "setup-source")));

// ---- the update
const done = await update(home);
const state = json(path.join(claude, "setup-state.json"));
const source = path.join(claude, "setup-source", `v${NEW}`);
check("the update exits cleanly", done.code === 0 && done.out.includes(`Updated to version ${NEW}`));
check("the version on record is the new one", state.version === NEW);
// on a Mac the temporary folder is a link, and Node names a script by its real path
check("the setup's folder is now the downloaded one", fs.existsSync(path.join(source, "install.mjs")) && fs.realpathSync(state.repo) === fs.realpathSync(source));
check("a changed hook is replaced and the old one kept as a dated copy",
  fs.readFileSync(path.join(claude, "hooks", "sql-guard.mjs"), "utf8").endsWith("// newer\n") && fs.readdirSync(path.join(claude, "hooks")).some((f) => f.startsWith("sql-guard.mjs.before-install-")));
check("rules the user never changed are brought up to date", fs.readFileSync(path.join(claude, "CLAUDE.md"), "utf8").includes("A rule from the newer version."));
check("the user's own skill is untouched", fs.readFileSync(ownSkill, "utf8") === "# My own skill\n");
const after = json(settingsFile);
check("the user's own model and hook stay", after.model === "opus" && JSON.stringify(after.hooks.Stop).includes("my-own-hook.mjs"));
check("the user's notes stay", fs.readFileSync(profile, "utf8") === "# My profile\n");
check("the answers about the workers are remembered", ["codex.off", "agy.off"].every((f) => fs.existsSync(path.join(claude, "workers", f))) && /Codex CLI \(GPT\): not used, optional \(as answered before\)/.test(done.out));
check("the changed extension is named, the others are not", done.out.includes("extension changed: commands") && !done.out.includes("extension changed: usage-plan"));
check("the download leaves no archive and no half-made folder", fs.readdirSync(path.join(claude, "setup-source")).join() === `v${NEW}`);

// ---- an update is quiet: what a chat does at the first install (open the folders in Nimbalyst, ask
// about a theme and voice typing) is named by the first install only, and the skill has no such step
check("the first install names the steps left for a chat", /Left for a chat, once.*steps 8 and 9/.test(first.stdout));
check("an update names nothing for a chat: no folders to open, no theme or voice typing question", !/Left for a chat|voice typing|Handy|a theme/i.test(done.out));
check("the update skill has no step that opens folders or asks about a theme or voice typing",
  !/Left for a chat|workspace_open|folders opened|the theme|voice typing|Handy|full-install/i.test(fs.readFileSync(path.join(REPO, "skills", "update-setup", "SKILL.md"), "utf8")));

const again = await update(home);
check("a second run says it is on the newest version and changes nothing", again.code === 0 && again.out.trim() === `Already on the newest version (${NEW}).`);

// ---- rules the user changed are kept, said once, and taken with --replace-rules
const mine = path.join(tmp, "mine");
spawnSync(process.execPath, [path.join(REPO, "install.mjs"), "--home", mine, "--codex", "no", "--agy", "no"], { encoding: "utf8" });
const myRules = path.join(mine, ".claude", "CLAUDE.md");
fs.writeFileSync(myRules, fs.readFileSync(myRules, "utf8").replace("# How to work", "# How to work\n\n- My own rule."));
const myHook = path.join(mine, ".claude", "hooks", "sql-guard.mjs");
fs.appendFileSync(myHook, "\n// my own change\n");
const keptMine = await update(mine);
check("a hook of the setup's that the user changed is kept and listed",
  fs.readFileSync(myHook, "utf8").endsWith("// my own change\n") && /Kept as yours[^\n]*\n  hooks\/sql-guard\.mjs\n/.test(keptMine.out));
const hookTaken = await update(mine, "--replace", "hooks/sql-guard.mjs");
check("--replace takes this version's copy and keeps the user's as a dated copy",
  hookTaken.code === 0 && fs.readFileSync(myHook, "utf8").endsWith("// newer\n")
  && fs.readdirSync(path.dirname(myHook)).some((f) => f.startsWith("sql-guard.mjs.before-install-") && fs.readFileSync(path.join(path.dirname(myHook), f), "utf8").endsWith("// my own change\n")));
check("rules the user changed are kept and the updater says so",
  keptMine.code === 0 && keptMine.out.includes("rules: new in this version, yours were kept") && fs.readFileSync(myRules, "utf8").includes("- My own rule.") && !fs.readFileSync(myRules, "utf8").includes("A rule from the newer version."));
const taken = await update(mine, "--replace-rules");
const copies = fs.readdirSync(path.join(mine, ".claude")).filter((f) => f.startsWith("CLAUDE.md.before-install-"));
check("--replace-rules takes the new rules and keeps the user's as a dated copy",
  taken.code === 0 && fs.readFileSync(myRules, "utf8").includes("A rule from the newer version.") && !fs.readFileSync(myRules, "utf8").includes("- My own rule.")
  && copies.some((f) => fs.readFileSync(path.join(mine, ".claude", f), "utf8").includes("- My own rule.")));

// ---- what stops an update leaves the setup as it was
released = { version: "9.9.10" };
const noArchive = await update(home);
check("a release with no archive stops the update with the reason", noArchive.code === 1 && /Update stopped: could not download .*v9\.9\.10\.tar\.gz \(HTTP 404\)/.test(noArchive.out));
check("and the installed version is unchanged", json(path.join(claude, "setup-state.json")).version === NEW && fs.readdirSync(path.join(claude, "setup-source")).join() === `v${NEW}`);
fs.writeFileSync(path.join(served, "v9.9.10.tar.gz"), "not an archive");
const badArchive = await update(home);
check("a download that is not an archive stops it too", badArchive.code === 1 && badArchive.out.includes("Update stopped: could not unpack") && json(path.join(claude, "setup-state.json")).version === NEW);
released = { version: "soon" };
check("a version file with no number stops it", (await update(home)).out.includes("has no usable version number"));
const never = path.join(tmp, "never");
fs.mkdirSync(never);
const notInstalled = await update(never);
check("a home folder the installer never ran in is told to install first", notInstalled.code === 1 && notInstalled.out.includes("setup-state.json is missing"));
server.close();
const offline = await update(home);
check("no connection: stopped with the reason", offline.code === 1 && offline.out.includes("Update stopped: could not read"));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
