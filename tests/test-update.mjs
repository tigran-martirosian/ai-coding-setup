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
const first = spawnSync(process.execPath, [path.join(REPO, "install.mjs"), "--home", home, "--codex", "no"], { encoding: "utf8" });
check("this version installs", first.status === 0 && json(path.join(claude, "setup-state.json")).version === json(path.join(REPO, "version.json")).version);
const ownSkill = path.join(claude, "skills", "build-table", "SKILL.md");
fs.mkdirSync(path.dirname(ownSkill), { recursive: true });
fs.writeFileSync(ownSkill, "# My own skill\n");
const settingsFile = path.join(claude, "settings.json");
const settings = json(settingsFile);
settings.model = "opus";
settings.hooks.Stop.push({ hooks: [{ type: "command", command: "node my-own-hook.mjs" }] });
// as an older version wired it: question-other on PromptForUserInput only, no code-review or file-link gate
for (const g of settings.hooks.PreToolUse) if (JSON.stringify(g).includes("question-other.mjs")) g.matcher = "mcp__nimbalyst__PromptForUserInput";
for (const g of settings.hooks.Stop) g.hooks = g.hooks.filter((h) => !/code-review-gate|file-link-gate/.test(h.command));
settings.hooks.Stop = settings.hooks.Stop.filter((g) => g.hooks.length);
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
const profile = path.join(home, "Projects", "internet-search", "profile.md");
fs.writeFileSync(profile, "# My profile\n");
// as an older version that used Antigravity left it: its hook in Antigravity's hooks file and its allow rule
// on record, each beside one of the user's own
const agyHooks = path.join(home, ".gemini", "config", "hooks.json");
const agySettings = path.join(home, ".gemini", "antigravity-cli", "settings.json");
const setupRule = `read_file(${fwd(path.join(home, "Projects"))})`;
fs.mkdirSync(path.dirname(agyHooks), { recursive: true });
fs.mkdirSync(path.dirname(agySettings), { recursive: true });
fs.writeFileSync(agyHooks, JSON.stringify({
  "ask-worker-gate": { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `node ${fwd(claude)}/workers/agy-gate.mjs`, timeout: 10 }] }] },
  "my-own-gate": { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "node my-gate.mjs" }] }] },
}));
fs.writeFileSync(agySettings, JSON.stringify({ theme: "dark", permissions: { allow: [setupRule, "read_file(C:/mine)"] } }));
const stateAt = path.join(claude, "setup-state.json");
fs.writeFileSync(stateAt, JSON.stringify({ ...json(stateAt), agy: false, agyAdded: [setupRule] }));

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
check("an older install gets the new Stop gates and question-other's wider matcher",
  ["code-review-gate.mjs", "file-link-gate.mjs"].every((h) => JSON.stringify(after.hooks.Stop).includes(h))
  && after.hooks.PreToolUse.some((g) => g.matcher === "mcp__nimbalyst__PromptForUserInput|mcp__nimbalyst__AskUserQuestion|AskUserQuestion" && JSON.stringify(g).includes("question-other.mjs")));
check("the user's notes stay", fs.readFileSync(profile, "utf8") === "# My profile\n");
check("the answer about Codex is remembered", /Codex CLI \(GPT\): not used, optional \(as answered before\)/.test(done.out));
check("what an older version set up in Antigravity goes, the user's own hook and rule stay",
  JSON.stringify(Object.keys(json(agyHooks))) === JSON.stringify(["my-own-gate"])
  && JSON.stringify(json(agySettings)) === JSON.stringify({ theme: "dark", permissions: { allow: ["read_file(C:/mine)"] } })
  && !("agyAdded" in state) && !("agy" in state));
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
spawnSync(process.execPath, [path.join(REPO, "install.mjs"), "--home", mine, "--codex", "no"], { encoding: "utf8" });
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

// ---- the closing list: what stays behind this version, with the line that takes it
check("an update ends with the list of what stays on old versions, each with its --replace line",
  /Yours, on old versions/.test(keptMine.out) && keptMine.out.includes("hooks/sql-guard.mjs: node ") && /--replace "?hooks\/sql-guard\.mjs"?/.test(keptMine.out)
  && /the rules \(CLAUDE\.md\): node [^\n]*--replace-rules/.test(keptMine.out));
check("a run with nothing left behind prints no such list", !/Yours, on old versions/.test(taken.out));
// the printed line is run as it stands, on a home of its own
const listHome = path.join(tmp, "list-home");
spawnSync(process.execPath, [path.join(REPO, "install.mjs"), "--home", listHome, "--codex", "no"], { encoding: "utf8" });
const listHook = path.join(listHome, ".claude", "hooks", "sql-guard.mjs");
fs.appendFileSync(listHook, "\n// my own change\n");
const listed = (await update(listHome)).out.split("\n").find((l) => l.includes("hooks/sql-guard.mjs: node "));
const listedRun = spawnSync(listed.slice(listed.indexOf(": node ") + 2), { shell: true, encoding: "utf8", env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || "") } });
check("the printed --replace line works as it stands: it takes this version's hook",
  fs.readFileSync(listHook, "utf8").includes("// my own change") === false && listedRun.status === 0);

// ---- a friend from before 1.0.74 on sonnet moves to Opus medium, loudly; --keep-model undoes it
const oldHome = (name, model) => {
  const h = path.join(tmp, name);
  spawnSync(process.execPath, [path.join(REPO, "install.mjs"), "--home", h, "--codex", "no"], { encoding: "utf8" });
  const stateFileOld = path.join(h, ".claude", "setup-state.json");
  fs.writeFileSync(stateFileOld, JSON.stringify({ ...json(stateFileOld), version: "1.0.70" }));
  const sf = path.join(h, ".claude", "settings.json");
  const s = json(sf);
  delete s.modelSettings;
  s.model = model;
  fs.writeFileSync(sf, JSON.stringify(s));
  return { h, settings: () => json(sf), state: () => json(stateFileOld) };
};
const sonnetHome = oldHome("sonnet-old", "sonnet");
const moved = await update(sonnetHome.h);
check("an update from 1.0.70 moves sonnet to Opus medium and says so with the undo",
  moved.code === 0 && sonnetHome.settings().model === "opus" && Object.values(sonnetHome.settings().modelSettings || {}).some((m) => m.effortLevel === "medium")
  && /MODEL CHANGED/.test(moved.out) && /--keep-model/.test(moved.out) && sonnetHome.state().model === "moved");
const keptSonnet = oldHome("sonnet-keep", "sonnet");
const keptRun = await update(keptSonnet.h, "--keep-model");
check("--keep-model through the updater keeps sonnet and records it", keptRun.code === 0 && keptSonnet.settings().model === "sonnet" && !/MODEL CHANGED/.test(keptRun.out) && keptSonnet.state().model === "kept");
const otherHome = oldHome("other-model", "opus");
check("a friend on another model is not moved", (await update(otherHome.h)).code === 0 && otherHome.settings().model === "opus" && !otherHome.state().model);

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
