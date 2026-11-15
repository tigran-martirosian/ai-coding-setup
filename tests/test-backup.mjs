#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
// Test of workers/backup.mjs against a restic repository in a local temp folder (no B2 calls). restic 0.19.1 is
// downloaded from its GitHub release and hash-checked into the test's temp folder, so the test needs the network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(new URL("../workers/backup.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
const home = path.join(tmp, "home");
const claude = path.join(home, ".claude");
const projects = path.join(home, "Projects");
const bk = path.join(tmp, "backup-home");
const repo = path.join(tmp, "repo");
const tmpRun = path.join(tmp, "tmp"); // the worker's temp folder, to see that restore tests leave nothing behind
const PW = "test-" + crypto.randomBytes(12).toString("hex");
const env = {
  ...process.env,
  CLAUDE_BACKUP_HOME: bk,
  CLAUDE_HOME: claude,
  TMP: tmpRun,
  TEMP: tmpRun,
  TMPDIR: tmpRun,
};
Object.assign(process.env, { CLAUDE_BACKUP_HOME: bk, CLAUDE_HOME: claude });

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
  }
};
const outputs = [];
const backup = (args, input) => {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env,
    input,
  });
  const res = { code: r.status, out: r.stdout || "", err: r.stderr || "" };
  outputs.push(res.out, res.err);
  return res;
};
const put = (rel, text, root = claude) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return f;
};
const leftovers = () =>
  fs.existsSync(tmpRun)
    ? fs.readdirSync(tmpRun).filter((n) => n.startsWith("claude-backup-test-"))
    : [];

// A Claude folder with kept files, excluded paths and one file over 100 MB; two project folders
fs.mkdirSync(tmpRun, { recursive: true });
const settings = put("settings.json", '{ "model": "x" }\n');
put("rules/one.md", "# rule\n");
put("skills/x/SKILL.md", "---\nname: x\n---\n");
put("projects/p1/memory/MEMORY.md", "remember this\n");
put("projects/p1/chat.jsonl", "{}\n");
put("scratch/s.txt", "scratch\n");
put("browser-profiles/site/Cookies", "cookie\n");
put("skills/y/node_modules/m.js", "module\n");
put("plugins/cache/p.txt", "cache\n");
const big = put("big.bin", "");
fs.truncateSync(big, 101 * 1024 * 1024);
put("setup-state.json", JSON.stringify({ projects }) + "\n");
put("alpha/src/a.js", "console.log(1)\n", projects);
put("alpha/node_modules/x.js", "x\n", projects);
put("alpha/dist/out.js", "x\n", projects);
put("beta/README.md", "beta\n", projects);
const alpha = path.join(projects, "alpha");

// Excludes as design section 4
const B = await import(pathToFileURL(script).href);
const cm = B.matcher({ path: claude, exclude: [] });
check("claude excludes: chat logs out", cm("projects/p1/chat.jsonl"));
check("claude excludes: memory stays in", !cm("projects/p1/memory/MEMORY.md"));
check(
  "claude excludes: scratch, browser-profiles, plugins/cache, node_modules at any depth out",
  cm("scratch/s.txt") &&
    cm("browser-profiles/site/Cookies") &&
    cm("plugins/cache/p.txt") &&
    cm("skills/y/node_modules/m.js"),
);
check(
  "claude excludes: settings and skills stay in",
  !cm("settings.json") && !cm("skills/x/SKILL.md"),
);
const pm = B.matcher({ path: alpha, exclude: ["shown/"] });
check(
  "project excludes: node_modules, dist, .next at any depth out; own extra out",
  pm("node_modules/x.js") &&
    pm("dist/out.js") &&
    pm("pkg/a/.next/x") &&
    pm("shown/p.png"),
);
check(
  "project excludes: source and .git stay in",
  !pm("src/a.js") && !pm(".git/HEAD"),
);
const lines = B.excludeLines({
  folders: [
    { path: claude, exclude: [] },
    { path: alpha, exclude: [".git/"] },
  ],
});
check(
  "exclude file: absolute lines for both folders",
  lines.includes(claude.replace(/\\/g, "/") + "/projects/**/*.jsonl") &&
    lines.includes(alpha.replace(/\\/g, "/") + "/.git"),
  lines.slice(0, 3).join(" | "),
);

// Folder listing before setup
let r = backup(["folders"]);
check(
  "folders: lists the projects folder's subfolders with sizes after excludes",
  r.code === 0 &&
    /\[ \] .*alpha {2}\d+ B, 1 files/.test(r.out) &&
    /\[ \] .*beta/.test(r.out),
  r.out + r.err,
);
check(
  "folders: the Claude folder always in, the big file named as left out",
  /\[x\] .*\.claude .*1 over 100 MB left out {2}\(always\)/.test(r.out),
  r.out,
);

// Checksum mismatch stops with both hashes and installs nothing
const fake = put("fake/restic.zip", "not restic", tmp);
const fakeHash = crypto.createHash("sha256").update("not restic").digest("hex");
const pin = B.pinFor();
r = backup(["get-restic", "--file", fake]);
check(
  "checksum mismatch: stops with expected and found hashes",
  r.code === 1 && r.err.includes(pin.sha256) && r.err.includes(fakeHash),
  r.err,
);
check("checksum mismatch: nothing installed", !fs.existsSync(B.resticPath()));

// The pinned restic, downloaded and checked
r = backup(["get-restic"]);
const haveRestic = r.code === 0 && fs.existsSync(B.resticPath());
check(
  `get-restic: downloaded ${B.releaseUrl(pin.file)} and checked`,
  haveRestic,
  r.err,
);

r = backup(["setup", "--target", "b2", "--password-stdin"], PW + "\n");
check(
  "setup b2 from stdin: refused before any B2 call, keys go in a window",
  r.code === 1 && /own window/.test(r.err),
  r.err,
);

if (haveRestic) {
  r = backup(
    ["setup", "--target", "local", "--repo", repo, "--password-stdin"],
    PW + "\n",
  );
  check(
    "setup local: exit 0, repository made",
    r.code === 0 &&
      /repository made/.test(r.out) &&
      fs.existsSync(path.join(repo, "config")),
    r.out + r.err,
  );
  const cfg = JSON.parse(fs.readFileSync(path.join(bk, "config.json"), "utf8"));
  check(
    "config.json: target, folders, time, keep, restic, schedule off",
    cfg.target === "local" &&
      cfg.folders.length === 1 &&
      path.resolve(cfg.folders[0].path.replace(/^~/, os.homedir())) ===
        claude &&
      cfg.time === "21:00" &&
      cfg.keep.daily === 7 &&
      cfg.restic === "0.19.1" &&
      cfg.schedule === false,
    JSON.stringify(cfg),
  );
  const pwFile = path.join(bk, "password");
  check(
    "password file holds the password",
    fs.readFileSync(pwFile, "utf8").trim() === PW,
  );
  if (process.platform === "win32") {
    const acl = spawnSync("icacls", [pwFile], { encoding: "utf8" }).stdout;
    check(
      "password file: owner-only (one entry in its ACL)",
      (acl.match(/:\(/g) || []).length === 1 && !/Users:|Everyone/.test(acl),
      acl,
    );
    // a file that starts with explicit SYSTEM and Administrators entries (as on a CI runner) ends owner-only too
    const pre = path.join(bk, "explicit-acl");
    fs.writeFileSync(pre, "");
    spawnSync("icacls", [pre, "/grant", "*S-1-5-18:F", "*S-1-5-32-544:F"]);
    const before = spawnSync("icacls", [pre], { encoding: "utf8" }).stdout;
    B.writeSecret(pre, "x");
    const after = spawnSync("icacls", [pre], { encoding: "utf8" }).stdout;
    check(
      "a file with explicit SYSTEM and Administrators entries: owner-only after writeSecret",
      /SYSTEM/.test(before) &&
        (after.match(/:\(/g) || []).length === 1 &&
        !/SYSTEM|Administrators/.test(after),
      before + after,
    );
    fs.rmSync(pre);
  } else
    check(
      "password file: owner-only (600)",
      (fs.statSync(pwFile).mode & 0o777) === 0o600,
    );

  r = backup(["folders", "--add", alpha]);
  check(
    "folders --add: project folder in config",
    r.code === 0 &&
      JSON.parse(fs.readFileSync(path.join(bk, "config.json"), "utf8")).folders
        .length === 2,
    r.out + r.err,
  );
  r = backup(["folders", "--add", bk]);
  check(
    "folders --add: the backup home refused",
    r.code === 1 && /inside the backed-up folder/.test(r.err),
    r.err,
  );

  r = backup(["run"]);
  check(
    "run: backup made",
    r.code === 0 && /backup: snapshot \w{8}, \d+ files/.test(r.out),
    r.out + r.err,
  );
  check(
    "run: the file over 100 MB named as skipped",
    r.out.includes(`skipped, over 100 MB: ${big}`),
    r.out,
  );
  check(
    "run: first run does upkeep and the restore test, which matches",
    /weekly upkeep/.test(r.out) &&
      /restore test: matches \(\d+ files/.test(r.out),
    r.out,
  );
  const last = JSON.parse(
    fs.readFileSync(path.join(bk, "last-run.json"), "utf8"),
  );
  check(
    "last-run.json: ok, snapshot, test time",
    last.ok === true &&
      last.snapshot &&
      last.lastTestOk &&
      last.skipped.length === 1,
    JSON.stringify(last),
  );
  check("logs: one log", fs.readdirSync(path.join(bk, "logs")).length === 1);

  r = backup(["test"]);
  check(
    "test: restore test matches",
    r.code === 0 &&
      /^restore test: matches \(\d+ files, .*; 0 changed since the backup, not compared\)/m.test(
        r.out,
      ),
    r.out + r.err,
  );
  check(
    "test: temp restore folder deleted",
    leftovers().length === 0,
    leftovers().join(", "),
  );

  const back = path.join(tmp, "back");
  r = backup(["restore", path.join(claude, "projects"), "--to", back]);
  const found = [];
  const walkAll = (d) => {
    if (fs.existsSync(d))
      for (const e of fs.readdirSync(d, { withFileTypes: true }))
        e.isDirectory() ? walkAll(path.join(d, e.name)) : found.push(e.name);
  };
  walkAll(back);
  check(
    "restore: memory back in a new folder, chat log never backed up",
    r.code === 0 &&
      found.includes("MEMORY.md") &&
      !found.includes("chat.jsonl"),
    r.out + r.err + found.join(","),
  );
  r = backup(["restore", path.join(claude, "projects"), "--to", back]);
  check(
    "restore: an existing folder refused",
    r.code === 1 && /already exists/.test(r.err),
    r.err,
  );
  r = backup(["restore", claude, "--to", path.join(claude, "restored")]);
  check(
    "restore: never over the original",
    r.code === 1 && /never goes over the original/.test(r.err),
    r.err,
  );

  r = backup(["status"]);
  check(
    "status: last run, snapshot count, size, schedule off",
    r.code === 0 &&
      /last run: .*ok/.test(r.out) &&
      /snapshots: 1; latest [\d.]+ \w+, \d+ files/.test(r.out) &&
      /schedule: off/.test(r.out),
    r.out + r.err,
  );

  // Same size, same modified time, other content: the restore test must see it
  const st = fs.statSync(settings);
  fs.writeFileSync(settings, '{ "model": "y" }\n');
  fs.utimesSync(settings, st.atime, st.mtime);
  r = backup(["test"]);
  check(
    "changed content: restore test differs, names the file, exit 1",
    r.code === 1 &&
      /^restore test: differs/m.test(r.out) &&
      r.out.includes(`content differs: ${settings}`),
    r.out + r.err,
  );
  check(
    "changed content: temp restore folder deleted after a failure too",
    leftovers().length === 0,
    leftovers().join(", "),
  );

  for (const [platform, want] of [
    [
      "win32",
      [
        /Register-ScheduledTask -TaskName "Claude backup"/,
        /-StartWhenAvailable/,
        /-Daily -At 21:00/,
        /backup\.mjs\\?"? run/,
      ],
    ],
    [
      "darwin",
      [
        /launchctl bootstrap "?gui\//,
        /<key>StartCalendarInterval<\/key>.*<integer>21<\/integer>/,
        /com\.ai-coding-setup\.backup\.plist/,
      ],
    ],
    [
      "linux",
      [
        /OnCalendar=\*-\*-\* 21:00:00/,
        /Persistent=true/,
        /systemctl --user enable --now claude-backup\.timer/,
      ],
    ],
  ]) {
    r = backup([
      "schedule",
      "on",
      "--every",
      "day",
      "--print",
      "--platform",
      platform,
    ]);
    check(
      `schedule --print ${platform}: the command text`,
      r.code === 0 && want.every((w) => w.test(r.out)),
      r.out + r.err,
    );
  }
  for (const [platform, want] of [
    ["win32", /-Weekly -DaysOfWeek Sunday -At 21:00/],
    [
      "darwin",
      /<key>Weekday<\/key><integer>0<\/integer><key>Hour<\/key><integer>21<\/integer>/,
    ],
    ["linux", /OnCalendar=Sun \*-\*-\* 21:00:00/],
  ]) {
    r = backup([
      "schedule",
      "on",
      "--every",
      "week",
      "--print",
      "--platform",
      platform,
    ]);
    check(
      `schedule --every week --print ${platform}: Sundays`,
      r.code === 0 && want.test(r.out),
      r.out + r.err,
    );
  }
  r = backup(["schedule", "on", "--print", "--platform", "win32"]);
  check(
    "schedule on without --every: refused, the user picks",
    r.code !== 0 && /--every day or --every week/.test(r.out + r.err),
    r.out + r.err,
  );
  r = backup(["schedule", "off", "--print", "--platform", "win32"]);
  check(
    "schedule off --print: unregister text",
    r.code === 0 &&
      /Unregister-ScheduledTask -TaskName "Claude backup"/.test(r.out),
    r.out,
  );
  check(
    "schedule --print registers nothing",
    JSON.parse(fs.readFileSync(path.join(bk, "config.json"), "utf8"))
      .schedule === false,
  );

  r = backup(["off"]);
  check(
    "off: keeps everything and says how to delete",
    r.code === 0 && /Nothing was deleted/.test(r.out) && fs.existsSync(repo),
    r.out + r.err,
  );

  const files = fs
    .readdirSync(bk, { recursive: true })
    .map((n) => path.join(bk, n))
    .filter(
      (f) =>
        fs.statSync(f).isFile() &&
        path.basename(f) !== "password" &&
        !f.includes(path.sep + "cache" + path.sep) &&
        !f.includes(path.sep + "bin" + path.sep),
    );
  check(
    "secrets: the password is in no output",
    !outputs.some((o) => o.includes(PW)),
  );
  check(
    "secrets: the password is in no other file of the backup home",
    !files.some((f) => fs.readFileSync(f, "utf8").includes(PW)),
    files.join(", "),
  );
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
