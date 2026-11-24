// An upgrade from the last release, as a person runs it: the last tag's setup installed into a temporary home,
// then its own updater (the old one, as on a real computer) brings in this checkout, served by a small local
// server as a newer version. Afterwards nothing of a hook, agent, skill, worker or tool deleted since that tag
// may be left: no file under the home, no settings.json hook entry whose script is gone.
// Two more cases run when the old release calls for them:
//   - the tour: when the old update skill offers no tour of docs/whats-new.md (26.4.4 and before), the update's own
//     output must ask for it, as the chat runs that old skill:  node tests/upgrade-from-last-release.mjs --from v26.4.4
//   - the folder tidy: when the old release had tools/, promo/ or projects/, the install has none of them left and
//     scripts/, docs/promo/, templates/ hold what they held:  node tests/upgrade-from-last-release.mjs --from v26.5.2
// Offline and safe to run again; slow (two installs), so not in run-all.
//   node tests/upgrade-from-last-release.mjs [--from <tag>]   (default: the newest v* tag before HEAD)
// Exit 1 with the list of leftovers and failed cases, else prints "0 leftovers". The installers' output goes to a
// log file in the temporary folder, which is named at the end and kept; the run's other files are deleted.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// no network and no real Claude Code update from either installer; no real Nimbalyst staging
process.env.SETUP_CC_CHECK = "off";
process.env.NIMBALYST_FOLLOW = "off";
delete process.env.CLAUDE_BACKUP_HOME;
const REPO = fileURLToPath(new URL("..", import.meta.url));
const fwd = (p) => p.replace(/\\/g, "/");
const git = (...a) => {
  const r = spawnSync("git", a, { cwd: REPO, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`git ${a.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
};
const fromAt = process.argv.indexOf("--from");
const FROM =
  fromAt === -1
    ? git("describe", "--tags", "--abbrev=0", "--match", "v*").trim()
    : process.argv[fromAt + 1];
const winTar = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "tar.exe",
);
const tar =
  process.platform === "win32" && fs.existsSync(winTar) ? winTar : "tar";
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0)
    throw new Error(
      `${path.basename(cmd)} ${args.join(" ")} failed (exit ${r.status}): ${(r.stderr || r.stdout || r.error?.message || "").trim()}`,
    );
  return r.stdout;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "upgrade-test-"));
const log = path.join(tmp, "installer-output.log");
const home = path.join(tmp, "home");
const claude = path.join(home, ".claude");
// on every exit, an early FAIL too: the log is kept beside the temporary folder, one file overwritten by each run;
// the rest goes
const kept = path.join(os.tmpdir(), "upgrade-from-last-release.log");
process.on("exit", () => {
  if (fs.existsSync(log)) fs.copyFileSync(log, kept);
  fs.rmSync(tmp, { recursive: true, force: true });
});
const note = (title, text) =>
  fs.appendFileSync(log, `==== ${title}\n${text}\n`);

// ---- 1. the last release, unpacked from its tag, installed into the temporary home
const old = path.join(tmp, "old");
fs.mkdirSync(old);
const oldTar = path.join(tmp, "old.tar");
run("git", ["archive", "--format=tar", "-o", oldTar, FROM], { cwd: REPO });
run(tar, ["-xf", "../old.tar"], { cwd: old });
const first = spawnSync(
  process.execPath,
  [
    path.join(old, "install.mjs"),
    "--home",
    home,
    "--codex",
    "no",
    "--extensions",
    "no",
    "--plugins",
    "no",
    "--obscura",
    "no",
    "--no-theme",
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
note(`install ${FROM}`, first.stdout + first.stderr);
if (first.status !== 0) {
  console.log(
    `FAIL the install of ${FROM} ended with exit ${first.status}; its output: ${fwd(kept)}`,
  );
  process.exit(1);
}

// ---- 2. this checkout (tracked and new files, as they are on disk) as a newer version
const ver = JSON.parse(
  fs.readFileSync(path.join(REPO, "version.json"), "utf8"),
);
const [a, b] = ver.version.split(".").map(Number);
const NEW = `${a}.${b + 1}`; // a version above the checkout's own, so the old updater takes it
const packName = `ai-coding-setup-${NEW}`;
const pack = path.join(tmp, "pack", packName);
for (const rel of git("ls-files", "-co", "--exclude-standard", "-z")
  .split("\0")
  .filter(Boolean)) {
  const src = path.join(REPO, rel);
  if (!fs.existsSync(src)) continue; // deleted in the working tree, not yet committed
  fs.mkdirSync(path.dirname(path.join(pack, rel)), { recursive: true });
  fs.copyFileSync(src, path.join(pack, rel));
}
// docs/whats-new.md comes with the release; until this checkout has it, a stand-in, so the pointer line shows
const doc = path.join(pack, "docs", "whats-new.md");
if (!fs.existsSync(doc)) fs.writeFileSync(doc, "# What is new (a stand-in)\n");
ver.version = NEW;
ver.releases = {
  ...ver.releases,
  [NEW]: {
    kind: "setup",
    important: true,
    headline: "The upgrade test's release",
  },
};
fs.writeFileSync(path.join(pack, "version.json"), JSON.stringify(ver, null, 2));
const served = path.join(tmp, "served");
fs.mkdirSync(served);
run(tar, ["-czf", path.join("..", "served", `v${NEW}.tar.gz`), packName], {
  cwd: path.join(tmp, "pack"),
});
const server = http.createServer((req, res) => {
  if (req.url === "/version.json") return res.end(JSON.stringify(ver));
  const file = path.join(served, path.basename(req.url));
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    return res.end();
  }
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

// ---- 3. the installed (old) updater brings it in
const updater = path.join(claude, "skills", "update-setup", "update.mjs");
const up = await new Promise((resolve) => {
  const p = spawn(process.execPath, [updater, "--home", home], {
    env: {
      ...process.env,
      SETUP_UPDATE_BASE: `http://127.0.0.1:${server.address().port}`,
      NIMBALYST_DELIVER_DATA: path.join(tmp, "nimbalyst-data"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => resolve({ code, out }));
});
server.close();
note(`update ${FROM} -> ${NEW} (exit ${up.code})`, up.out);
const state = JSON.parse(
  fs.readFileSync(path.join(claude, "setup-state.json"), "utf8"),
);
if (up.code !== 0 || state.version !== NEW) {
  console.log(
    `FAIL the update to ${NEW} did not finish (exit ${up.code}, installed version ${state.version}); its output: ${fwd(kept)}`,
  );
  process.exit(1);
}
// the old updater's own line (version.json summary) and the new installer's pointer to docs/whats-new.md
const lines = up.out.split(/\r?\n/);
const whatsNew = lines.filter((l) => l.startsWith("What is new"));
console.log(
  `The update's "What is new" lines:\n${whatsNew.map((l) => `  ${l}`).join("\n") || "  (none)"}`,
);
const pointer = `What is new in ${NEW}: ${fwd(path.join(claude, "setup-source", `v${NEW}`, "docs", "whats-new.md"))}`;
if (!lines.includes(pointer)) {
  console.log(
    `FAIL the new installer did not print "${pointer}"; its output: ${fwd(kept)}`,
  );
  process.exit(1);
}
const failed = [];
// the tour (D4): the chat that runs the update follows the old update skill, read before the update; one that
// offers no tour only passes the printed lines on, so a printed line must ask for the tour of docs/whats-new.md
const oldSkill = git("show", `${FROM}:skills/update-setup/SKILL.md`);
if (!/\btour\b/i.test(oldSkill)) {
  const tourDoc = fwd(
    path.join(claude, "setup-source", `v${NEW}`, "docs", "whats-new.md"),
  );
  if (!lines.some((l) => l.includes(tourDoc) && /\btour\b/i.test(l)))
    failed.push(
      `tour: the ${FROM} update skill offers no tour, and no line of the update's output asks for the tour of ${tourDoc}, so the person only gets the pointer line`,
    );
}
// the folder tidy (D20): tools/ -> scripts/, promo/ -> docs/promo/, projects/ -> templates/. The home's own copy
// (~/.claude/tools) moves, and the release the install now runs from has the new folders only.
const oldTop = git("ls-tree", "--name-only", FROM).split("\n");
if (["tools", "promo", "projects"].some((d) => oldTop.includes(d))) {
  const must = [
    [path.join(claude, "tools"), false],
    [path.join(claude, "scripts", "nimbalyst-patch", "deliver.mjs"), true],
    [path.join(state.repo, "tools"), false],
    [path.join(state.repo, "promo"), false],
    [path.join(state.repo, "projects"), false],
    [path.join(state.repo, "scripts", "nimbalyst-patch", "deliver.mjs"), true],
    [path.join(state.repo, "docs", "promo", "render.mjs"), true],
    [path.join(state.repo, "templates", "homes.json"), true],
  ];
  for (const [at, there] of must)
    if (fs.existsSync(at) !== there)
      failed.push(
        `folder tidy: ${fwd(at)} ${there ? "is missing" : "is still there"} after the update from ${FROM}`,
      );
}

// ---- 4. the leftovers
const leftovers = [];
const deleted = git(
  "diff",
  "--name-only",
  "--no-renames", // a moved file leaves its old place too
  "--diff-filter=D",
  FROM,
  "--",
  "hooks",
  "agents",
  "skills",
  "workers",
  "tools",
)
  .split("\n")
  .filter(Boolean);
const folders = new Set();
for (const rel of deleted) {
  const at = path.join(claude, rel);
  if (fs.existsSync(at)) leftovers.push(`file ${fwd(path.relative(home, at))}`);
  // a folder this checkout no longer has (a whole skill cut) must be gone from the home as well
  for (let d = path.dirname(rel); d !== "."; d = path.dirname(d))
    if (!fs.existsSync(path.join(REPO, d))) folders.add(d);
}
for (const d of folders)
  if (fs.existsSync(path.join(claude, d)))
    leftovers.push(`folder ${fwd(path.relative(home, path.join(claude, d)))}/`);
// every hook entry in settings.json, the home's and each project folder's, must name a script that is there
const projects = state.projects ? path.resolve(state.projects) : null;
const settingsFiles = [[path.join(claude, "settings.json"), home]];
if (projects && fs.existsSync(projects))
  for (const e of fs.readdirSync(projects, { withFileTypes: true }))
    if (e.isDirectory()) {
      const f = path.join(projects, e.name, ".claude", "settings.json");
      if (fs.existsSync(f))
        settingsFiles.push([f, path.join(projects, e.name)]);
    }
for (const [file, folder] of settingsFiles) {
  const hooks = JSON.parse(fs.readFileSync(file, "utf8")).hooks || {};
  for (const [event, groups] of Object.entries(hooks))
    for (const g of groups)
      for (const h of g.hooks || []) {
        const scripts =
          h.command?.match(/[^\s"']+\.(?:mjs|cjs|js|py|sh|ps1)\b/g) || [];
        for (const s of scripts) {
          const at = s
            .replace(/^~(?=[\\/])/, home)
            .replace(/^\$\{?HOME\}?(?=[\\/])/, home)
            .replace(/^%USERPROFILE%(?=[\\/])/i, home)
            .replace(/^\$\{?CLAUDE_PROJECT_DIR\}?(?=[\\/])/, folder);
          const full = path.isAbsolute(at) ? at : path.join(folder, at);
          if (!fs.existsSync(full))
            leftovers.push(
              `settings ${fwd(path.relative(home, file))} ${event}: "${h.command}" (no ${fwd(path.relative(home, full))})`,
            );
        }
      }
}

// ---- 5. an uninstall from the downloaded version, as the person runs it after updates, takes the other downloads;
// the version it runs from stays, named in its output for deleting by hand (scripts/uninstall.mjs, step 4e)
const un = spawnSync(
  process.execPath,
  [path.join(state.repo, "install.mjs"), "--home", home, "--uninstall"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
note(`uninstall (exit ${un.status})`, un.stdout + un.stderr);
if (un.status !== 0)
  leftovers.push(`uninstall ended with exit ${un.status} (see the log)`);
const sourcesLeft = path.join(claude, "setup-source");
if (fs.existsSync(sourcesLeft))
  for (const n of fs.readdirSync(sourcesLeft)) {
    const at = path.join(sourcesLeft, n);
    const own =
      path.resolve(at) === path.resolve(state.repo) &&
      un.stdout.includes(
        `${fwd(at)}: the setup's download this uninstall runs from`,
      );
    if (!own) leftovers.push(`after uninstall .claude/setup-source/${n}`);
  }

console.log(`Installer output: ${fwd(kept)}`);
console.log(
  `Upgrade ${FROM} -> this checkout (served as ${NEW}), ${deleted.length} files deleted since ${FROM}:`,
);
for (const f of failed) console.log(`FAIL ${f}`);
if (leftovers.length) {
  for (const l of leftovers) console.log(`  leftover ${l}`);
  console.log(`FAIL ${leftovers.length} leftovers`);
  process.exit(1);
}
console.log("0 leftovers");
if (failed.length) {
  console.log(`FAIL ${failed.length} of the checks above`);
  process.exit(1);
}
