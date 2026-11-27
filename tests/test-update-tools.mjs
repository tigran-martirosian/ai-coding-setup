#!/usr/bin/env node
// Checks of workers/update-tools.mjs with stand-in claude, npm, python and winget commands: a temp folder that is
// the whole PATH (.cmd files on Windows, sh scripts elsewhere), each running fake.mjs, which answers from
// state.json (what is installed, what is newer), changes it on an update, and logs every call. No real program is
// run or updated. winget is looked at only on Windows, as the worker does.
// Run: node tests/test-update-tools.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WORKER = path.join(REPO, "workers", "update-tools.mjs");
const WIN = process.platform === "win32";

let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    return;
  }
  fail++;
  console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
};

// realpath: on a Mac the temp folder /var is /private/var
const tmp = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "test-update-tools-")),
);
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));

const FAKE = path.join(tmp, "fake.mjs");
fs.writeFileSync(
  FAKE,
  `import fs from "node:fs";
const [name, ...args] = process.argv.slice(2);
const file = process.env.FAKE_STATE;
const s = JSON.parse(fs.readFileSync(file, "utf8"));
fs.appendFileSync(s.log, [name, ...args].join(" ") + "\\n");
const save = () => fs.writeFileSync(file, JSON.stringify(s));
const line = args.join(" ");
const out = (t) => process.stdout.write(t + "\\n");
const plugins = () => JSON.parse(fs.readFileSync(s.pluginsFile, "utf8"));
if (name === "claude") {
  if (line === "plugin marketplace update") {
    if (s.slowSources) { const end = Date.now() + s.slowSources; while (Date.now() < end); }
    process.exit(0);
  }
  const m = line.match(/^plugin update (\\S+) --scope user$/);
  if (m) {
    if (s.pluginFails === m[1]) { console.error("Plugin update failed: the source is gone"); process.exit(1); }
    const j = plugins();
    for (const i of j.plugins[m[1]]) if (i.scope === "user") i.version = s.pluginLatest[m[1]] || i.version;
    fs.writeFileSync(s.pluginsFile, JSON.stringify(j));
    process.exit(0);
  }
  process.exit(3);
}
if (name === "npm") {
  if (line === "ls -g --depth=0 --json") {
    out(JSON.stringify({ dependencies: Object.fromEntries(Object.entries(s.npm).map(([n, v]) => [n, { version: v.current }])) }));
    process.exit(0);
  }
  if (line === "outdated -g --json") {
    const behind = Object.entries(s.npm).filter(([, v]) => v.current !== v.latest);
    out(JSON.stringify(Object.fromEntries(behind.map(([n, v]) => [n, { current: v.current, wanted: v.latest, latest: v.latest }]))));
    process.exit(behind.length ? 1 : 0);
  }
  const m = line.match(/^install -g (\\S+)@latest$/);
  if (m) { s.npm[m[1]].current = s.npm[m[1]].latest; save(); process.exit(0); }
  process.exit(3);
}
if (name === "python") {
  if (line === "-m yt_dlp --version") { if (!s.ytdlp) process.exit(1); out(s.ytdlp.current); process.exit(0); }
  if (line === "-m pip index versions yt-dlp") { out("yt-dlp (" + s.ytdlp.latest + ")"); process.exit(0); }
  if (line === "-m pip install -U -q yt-dlp") { s.ytdlp.current = s.ytdlp.latest; save(); process.exit(0); }
  process.exit(3);
}
if (name === "winget") {
  const m = line.match(/^(list|upgrade) --id (\\S+) --exact/);
  const w = m && s.winget[m[2]];
  if (m && m[1] === "list") {
    if (!w) { out("No installed package found matching input criteria."); process.exit(1); }
    out("Name  Id  Version  Available  Source");
    out("-------------------------------------");
    out("Some Program  " + m[2] + "  " + w.current + "  " + (w.current === w.latest ? "" : w.latest + "  ") + "winget");
    process.exit(0);
  }
  if (m) { w.current = w.latest; save(); process.exit(0); }
  process.exit(3);
}
process.exit(3);
`,
);

// One folder of stand-in commands per run: only the names given are there
function bin(names) {
  const dir = fs.mkdtempSync(path.join(tmp, "bin-"));
  for (const n of names)
    if (WIN)
      fs.writeFileSync(
        path.join(dir, `${n}.cmd`),
        `@"${process.execPath}" "${FAKE}" ${n} %*\r\n`,
      );
    else
      fs.writeFileSync(
        path.join(dir, n),
        `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" ${n} "$@"\n`,
        {
          mode: 0o755,
        },
      );
  return dir;
}

// A home with the plugins file, and the state the stand-ins answer from; returns run(args) and the state
function world(over = {}) {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  const pluginsFile = path.join(
    home,
    ".claude",
    "plugins",
    "installed_plugins.json",
  );
  fs.mkdirSync(path.dirname(pluginsFile), { recursive: true });
  fs.writeFileSync(
    pluginsFile,
    JSON.stringify({
      version: 2,
      plugins: {
        "hud@market": [{ scope: "user", version: "1.0.0" }],
        "lsp@market": [
          { scope: "project", version: "2.0.0", projectPath: home },
        ],
      },
    }),
  );
  const log = path.join(home, "calls.log");
  fs.writeFileSync(log, "");
  const state = {
    log,
    pluginsFile,
    pluginLatest: { "hud@market": "1.1.0" },
    npm: {
      "@openai/codex": { current: "0.1.0", latest: "0.2.0" },
      "someones-own-tool": { current: "1.0.0", latest: "9.0.0" },
      "@anthropic-ai/claude-code": { current: "2.0.0", latest: "2.1.0" },
    },
    ytdlp: { current: "2026.01.05", latest: "2026.11.23" },
    winget: {
      "GitHub.cli": { current: "2.1.0", latest: "2.2.0" },
      "Git.Git": { current: "2.50.0", latest: "2.51.0" },
    },
    ...over,
  };
  const stateFile = path.join(home, "state.json");
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const names = over.names || ["claude", "npm", "python", "winget"];
  const dir = bin(names);
  const run = (args, env = {}) => {
    // the stand-ins' folder is the whole PATH, so no real program is found; Path is the same variable on Windows
    const base = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH"),
    );
    const r = spawnSync(process.execPath, [WORKER, "--home", home, ...args], {
      encoding: "utf8",
      env: { ...base, PATH: dir, FAKE_STATE: stateFile, ...env },
      timeout: 60000,
    });
    return {
      code: r.status,
      out: `${r.stdout || ""}${r.stderr || ""}`,
      calls: fs.readFileSync(log, "utf8"),
    };
  };
  return { run, state: () => JSON.parse(fs.readFileSync(stateFile, "utf8")) };
}
const CHANGES =
  /marketplace update|plugin update|install -g|pip install|winget upgrade/;

// ---- --check lists, changes nothing
{
  const w = world();
  const r = w.run(["--check"]);
  ok(
    "--check exits 0 with nothing failed",
    r.code === 0 && !/FAILED/.test(r.out),
    r.out,
  );
  ok(
    "--check runs no command that changes a program",
    !CHANGES.test(r.calls),
    r.calls,
  );
  ok(
    "--check says the setup's npm package is behind",
    /^npm @openai\/codex: 0\.1\.0 -> 0\.2\.0 \(behind\)$/m.test(r.out),
    r.out,
  );
  ok(
    "--check lists someone's own global npm tool as not the setup's",
    /^npm someones-own-tool: 1\.0\.0 -> 9\.0\.0 behind \(not updated: not the setup's\)$/m.test(
      r.out,
    ),
    r.out,
  );
  ok(
    "--check leaves Claude Code's npm package to update.mjs",
    !/claude-code/.test(r.out),
    r.out,
  );
  ok(
    "--check says yt-dlp is behind",
    /^yt-dlp: 2026\.01\.05 -> 2026\.11\.23 \(behind\)$/m.test(r.out),
    r.out,
  );
  if (WIN)
    ok(
      "--check says a winget program is behind",
      /^GitHub CLI \(GitHub\.cli\): 2\.1\.0 -> 2\.2\.0 \(behind\)$/m.test(
        r.out,
      ),
      r.out,
    );
}

// ---- an update: only the setup's npm packages; plugins for the user; Git only named
{
  const w = world();
  const r = w.run([]);
  ok(
    "an update with nothing failing exits 0",
    r.code === 0 && !/FAILED/.test(r.out),
    r.out,
  );
  ok(
    "an update installs the setup's npm package",
    /^npm install -g @openai\/codex@latest$/m.test(r.calls),
    r.calls,
  );
  ok(
    "an update never installs someone's own global npm tool",
    !/install -g someones-own-tool/.test(r.calls),
    r.calls,
  );
  ok(
    "an update never installs Claude Code's npm package",
    !/install -g @anthropic-ai/.test(r.calls),
    r.calls,
  );
  ok(
    "an update says each plugin's new version",
    /^plugin hud@market: 1\.0\.0 -> 1\.1\.0$/m.test(r.out),
    r.out,
  );
  ok(
    "a plugin only in a project folder is left alone",
    !/plugin update lsp@market/.test(r.calls) &&
      /^plugin lsp@market: skipped, installed only in project folders$/m.test(
        r.out,
      ),
    r.out,
  );
  ok(
    "an update brings yt-dlp up",
    /^yt-dlp: 2026\.01\.05 -> 2026\.11\.23$/m.test(r.out),
    r.out,
  );
  if (WIN) {
    ok(
      "an update upgrades a behind winget program",
      /^winget upgrade --id GitHub\.cli /m.test(r.calls) &&
        /^GitHub CLI \(GitHub\.cli\): 2\.1\.0 -> 2\.2\.0$/m.test(r.out),
      r.out,
    );
    ok(
      "a winget program that is not installed is one skipped line",
      /^FFmpeg \(Gyan\.FFmpeg\): skipped, not installed$/m.test(r.out),
      r.out,
    );
    ok(
      "Git is named, not upgraded",
      !/upgrade --id Git\.Git/.test(r.calls) &&
        /^Git: 2\.50\.0 -> 2\.51\.0 behind; update Git yourself/m.test(r.out),
      r.out,
    );
  }
}

// ---- a program that is not there is skipped, not failed
{
  const w = world({ names: ["claude"] });
  const r = w.run([]);
  ok(
    "missing npm, python and winget do not fail the run",
    r.code === 0 && !/FAILED/.test(r.out),
    r.out,
  );
  ok(
    "missing npm is one skipped line",
    /^npm packages: skipped, not installed \(no npm command\)$/m.test(r.out),
    r.out,
  );
  ok(
    "missing yt-dlp is one skipped line",
    /^yt-dlp: skipped, not installed as a Python package$/m.test(r.out),
    r.out,
  );
  ok(
    "missing winget (or not Windows) is one skipped line",
    WIN
      ? /^winget programs: skipped, not installed \(no winget command\)$/m.test(
          r.out,
        )
      : /^winget programs: skipped, not Windows$/m.test(r.out),
    r.out,
  );
  const py = world({ ytdlp: null }).run([]);
  ok(
    "a Python without yt-dlp is skipped, not failed",
    py.code === 0 &&
      /^yt-dlp: skipped, not installed as a Python package$/m.test(py.out),
    py.out,
  );
  const none = world({ names: [] }).run([]);
  ok(
    "no claude command: plugins skipped, not failed",
    none.code === 0 &&
      /^plugins: skipped, not installed \(no claude command\)$/m.test(none.out),
    none.out,
  );
}

// ---- a failing update: FAILED and exit 1, the rest still updated
{
  const w = world({ pluginFails: "hud@market" });
  const r = w.run([]);
  ok("a failing plugin update exits 1", r.code === 1, r.out);
  ok(
    "a failing plugin update is under FAILED with its reason",
    /FAILED:\n- plugin hud@market: .*the source is gone/.test(r.out),
    r.out,
  );
  ok(
    "a failing plugin update does not stop the next program",
    /install -g @openai\/codex@latest/.test(r.calls),
    r.calls,
  );
}

// ---- the budget: once spent, the programs not reached are failures and run nothing
{
  const w = world({ slowSources: 8000 });
  const r = w.run(["--budget", "0.03"]);
  ok("a spent budget exits 1", r.code === 1, r.out);
  ok(
    "a spent budget lists the programs not reached",
    /- npm packages: not updated, the 0\.03 min time budget is spent/.test(
      r.out,
    ),
    r.out,
  );
  ok(
    "a spent budget runs no further command",
    !/^npm /m.test(r.calls) && !/plugin update/.test(r.calls),
    r.calls,
  );
}

// ---- off switch and a bad budget
{
  const w = world();
  const r = w.run([], { UPDATE_TOOLS: "off" });
  ok(
    "UPDATE_TOOLS=off runs nothing",
    r.code === 0 && r.calls === "" && /UPDATE_TOOLS=off/.test(r.out),
    r.out,
  );
  const b = w.run(["--budget", "x"]);
  ok(
    "a budget that is not a number stops with exit 2",
    b.code === 2 && b.calls === "",
    b.out,
  );
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
