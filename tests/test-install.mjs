// Tests for install.mjs on a blank temporary home folder. Nothing outside that folder is touched and
// Codex doesn't have to be installed. Run: node tests/test-install.mjs
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// No network and no real Claude Code update from any installer this test starts (scripts/claude-code-version.mjs)
process.env.SETUP_CC_CHECK = "off";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const INSTALL = path.join(REPO, "install.mjs");
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-test-"));
// The installer looks for Codex on the PATH; the tests give it a PATH with nothing on it
const emptyPath = path.join(tmp, "empty-path");
fs.mkdirSync(emptyPath);
const installWith = (PATH, home, ...flags) => {
  const r = spawnSync(process.execPath, [INSTALL, "--home", home, ...flags], {
    encoding: "utf8",
    env: { ...process.env, PATH, Path: PATH },
  });
  return { code: r.status, out: r.stdout };
};
const install = (home, ...flags) => installWith(emptyPath, home, ...flags);
// Every real file under a folder; a link to a folder is not followed
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isSymbolicLink()
        ? []
        : e.isDirectory()
          ? walk(path.join(dir, e.name))
          : [path.join(dir, e.name)],
    );
const snap = (dir) => walk(dir).map((f) => [f, fs.readFileSync(f, "utf8")]);
const fwd = (p) => p.replace(/\\/g, "/");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const commandsIn = (settings) =>
  Object.values(settings.hooks || {})
    .flat()
    .flatMap((g) => g.hooks)
    .map((h) => h.command);
// The copies of replaced files, in setup-logs/<date>-install-backup(-n)/ of a home folder: the copy and the file it is of
const backupsOf = (h) => {
  const logs = path.join(h, ".claude", "setup-logs");
  return (fs.existsSync(logs) ? fs.readdirSync(logs) : [])
    .filter((d) => /^\d{4}-\d{2}-\d{2}-install-backup(-\d+)?$/.test(d))
    .flatMap((d) =>
      walk(path.join(logs, d)).map((f) => ({
        copy: f,
        of: path.join(h, path.relative(path.join(logs, d), f)),
      })),
    );
};
const copiesIn = (h, dir) =>
  backupsOf(h)
    .filter((b) => b.of.startsWith(dir + path.sep))
    .map((b) => path.basename(b.of))
    .sort();
const copyOf = (h, file) => backupsOf(h).find((b) => b.of === file)?.copy;
const besideFiles = (dir) =>
  walk(dir).filter((f) => f.includes(".before-install-"));
// The add-on skills are left out of a default install, so they are not part of what a plain run ships
const ADDON_SKILLS = ["phone-bot"];
const shipped = ["hooks", "agents", "skills", "workers", "tools"]
  .flatMap((d) => walk(path.join(REPO, d)))
  .map((f) => path.relative(REPO, f))
  .filter(
    (f) =>
      !ADDON_SKILLS.some((n) =>
        f.startsWith(path.join("skills", n) + path.sep),
      ),
  );
const example = json(path.join(REPO, "settings.example.json"));
const scripts = Object.values(example.hooks)
  .flat()
  .flatMap((g) => g.hooks)
  .map((h) => h.command.match(/~\/\.claude\/(\S+)/)[1]);
const HOMES = ["claude-settings", "quick-tasks"];
const CHANGED = /copied|replaced|hook added|wrote|linked|removed/;

// ---- dry run on a blank home folder
const home = path.join(tmp, "blank");
fs.mkdirSync(home);
const claude = path.join(home, ".claude");
const projects = path.join(home, "Projects");
const dry = install(home, "--dry-run");
const globalHooks = (out) =>
  out
    .split("\n")
    .filter((l) => l.includes("hook added") && !/ in [\w-]+$/.test(l.trim()));
ok("dry run exits cleanly", dry.code, 0);
ok(
  "dry run lists every file it would copy",
  shipped.every((f) => dry.out.includes(f.replace(/\\/g, "/"))),
);
ok(
  "dry run lists every hook it would wire",
  globalHooks(dry.out).length,
  scripts.length,
);
ok(
  "dry run lists the rules file",
  dry.out.includes(`rules: wrote ${fwd(path.join(claude, "CLAUDE.md"))}`),
);
ok(
  "dry run lists the two project folders",
  HOMES.map((h) =>
    dry.out.includes(`copied ${fwd(path.join(projects, h, "CLAUDE.md"))}`),
  ),
  HOMES.map(() => true),
);
ok(
  "dry run lists each folder's settings and the link gate's wiring",
  [
    ...HOMES.map((h) =>
      dry.out.includes(
        `wrote ${fwd(path.join(projects, h, ".claude", "settings.json"))}`,
      ),
    ),
    dry.out.includes("hook added: Stop finder-link-gate.mjs in quick-tasks"),
  ],
  [...HOMES.map(() => true), true],
);
ok(
  "dry run says how to build the extensions",
  /extensions are not installed by this script.*npm run build/.test(dry.out),
);
ok("dry run changes nothing", fs.readdirSync(home), []);
// install-ext copies dist/, so it builds first: a stale or missing dist/ is never what gets installed
ok(
  "every extension's install-ext builds before it copies dist/",
  fs
    .readdirSync(path.join(REPO, "extensions"))
    .filter((d) =>
      fs.existsSync(path.join(REPO, "extensions", d, "package.json")),
    )
    .map((d) => {
      const s = JSON.parse(
        fs.readFileSync(
          path.join(REPO, "extensions", d, "package.json"),
          "utf8",
        ),
      ).scripts;
      return `${d}: ${
        s["install-ext"] === "node build.mjs --install" ||
        s["install-ext"] === "npm run build && node scripts/install.mjs"
      }`;
    })
    .filter((x) => x.endsWith("false")),
  [],
);

// ---- the real install
const first = install(home);
ok("install exits cleanly", first.code, 0);
// off Windows the installer takes Codex's Windows-only sandbox flag out of a shell script
const asInstalled = (f) =>
  f.endsWith(".sh") && process.platform !== "win32"
    ? Buffer.from(
        fs
          .readFileSync(path.join(REPO, f), "utf8")
          .replace(` -c 'windows.sandbox="unelevated"'`, ""),
      )
    : fs.readFileSync(path.join(REPO, f));
ok(
  "every file arrived byte for byte",
  shipped.filter(
    (f) =>
      !fs.existsSync(path.join(claude, f)) ||
      !fs.readFileSync(path.join(claude, f)).equals(asInstalled(f)),
  ),
  [],
);
const settings = json(path.join(claude, "settings.json"));
const commands = commandsIn(settings);
ok(
  "helpers keep their prompt cache for an hour",
  settings.subagentPromptCacheTtl,
  "1h",
);
ok(
  "no advisor is set (the person's choice, /advisor fable)",
  "advisorModel" in settings,
  false,
);
{
  // an advisor the person set stays
  const { addClaudeCodeSettings } = await import(
    pathToFileURL(path.join(REPO, "scripts", "claude-code-settings.mjs")).href
  );
  const own = { advisorModel: "opus" };
  addClaudeCodeSettings(own, false, false);
  ok("an own advisor stays", own.advisorModel, "opus");
}
ok(
  "a fresh install empties CLAUDE_CODE_EFFORT_LEVEL, so helpers run at their own effort",
  settings.env?.CLAUDE_CODE_EFFORT_LEVEL,
  "",
);
ok(
  "the install says so",
  first.out.includes("effort: each helper now runs at its own effort: line"),
  true,
);
{
  // a level the person set stays and is named; an empty value is left alone
  const { addClaudeCodeSettings, effortLines } = await import(
    pathToFileURL(path.join(REPO, "scripts", "claude-code-settings.mjs")).href
  );
  const own = { env: { CLAUDE_CODE_EFFORT_LEVEL: "high" } },
    done = { env: { CLAUDE_CODE_EFFORT_LEVEL: "" } };
  const ownDid = addClaudeCodeSettings(own, false, false),
    doneDid = addClaudeCodeSettings(done, false, false);
  ok(
    "an own effort level stays and is named",
    [
      ownDid.effortEnv,
      ownDid.effortKept,
      own.env.CLAUDE_CODE_EFFORT_LEVEL,
      effortLines(ownDid, null, "s").length,
    ],
    [false, "high", "high", 1],
  );
  ok(
    "an empty value already there: nothing to say",
    [doneDid.effortEnv, doneDid.effortKept, effortLines(doneDid, null, "s")],
    [false, null, []],
  );
  const nimb = path.join(tmp, "nimbalyst-app-settings.json");
  fs.writeFileSync(nimb, JSON.stringify({ defaultEffortLevel: "medium" }));
  const was = fs.readFileSync(nimb, "utf8");
  const said = effortLines(doneDid, nimb, "s");
  ok(
    "Nimbalyst's effort pick is named in one line and its file is not written",
    [
      said.length,
      said[0].includes("set to medium") && said[0].includes("/effort"),
      fs.readFileSync(nimb, "utf8") === was,
    ],
    [1, true, true],
  );
}
ok(
  "no cap on one reply's output is set",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS" in (settings.env ?? {}),
  false,
);
{
  // the 64k cap 1.0.104 wrote goes on an update from it; a cap the person set stays
  const { removeOldOutputCap } = await import(
    pathToFileURL(path.join(REPO, "scripts", "claude-code-settings.mjs")).href
  );
  const from104 = { env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000" } };
  const keepEnv = {
    env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000", OTHER: "1" },
  };
  const own = { env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "20000" } };
  const older = { env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000" } };
  ok(
    "an update from 1.0.104 takes its 64k cap out (and the emptied env)",
    [removeOldOutputCap(from104, "1.0.104"), from104],
    [true, {}],
  );
  ok(
    "other env values stay",
    [removeOldOutputCap(keepEnv, "1.0.104"), keepEnv],
    [true, { env: { OTHER: "1" } }],
  );
  ok(
    "a cap the person set stays",
    [removeOldOutputCap(own, "1.0.104"), own.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS],
    [false, "20000"],
  );
  ok(
    "64000 set before 1.0.104 was not ours and stays",
    [
      removeOldOutputCap(older, "1.0.103"),
      older.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
    ],
    [false, "64000"],
  );
  // the PowerShell tool goes off only on Windows with Git Bash, a value already set stays; the helper rules come in
  const { addClaudeCodeSettings, HELPER_DENY } = await import(
    pathToFileURL(path.join(REPO, "scripts", "claude-code-settings.mjs")).href
  );
  const gb = {},
    noGb = {},
    mac = {},
    set = { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } };
  ok(
    "Windows with Git Bash: PowerShell tool off",
    [
      addClaudeCodeSettings(gb, true, true).powershellOff,
      gb.env?.CLAUDE_CODE_USE_POWERSHELL_TOOL,
    ],
    [true, "0"],
  );
  ok(
    "Windows without Git Bash: PowerShell tool stays",
    [
      addClaudeCodeSettings(noGb, true, false).powershellOff,
      "CLAUDE_CODE_USE_POWERSHELL_TOOL" in noGb.env,
    ],
    [false, false],
  );
  ok(
    "macOS: no PowerShell setting",
    [
      addClaudeCodeSettings(mac, false, false).powershellOff,
      "CLAUDE_CODE_USE_POWERSHELL_TOOL" in mac.env,
    ],
    [false, false],
  );
  ok(
    "a value the person set stays",
    [
      addClaudeCodeSettings(set, true, true).powershellOff,
      set.env.CLAUDE_CODE_USE_POWERSHELL_TOOL,
    ],
    [false, "1"],
  );
  ok(
    "the Explore and general-purpose helpers are denied",
    HELPER_DENY.every((r) => mac.permissions.deny.includes(r)),
    true,
  );
}
{
  // a retired entry named with its arguments goes, the same script's other entry stays
  const { retire } = await import(
    pathToFileURL(path.join(REPO, "scripts", "wiring.mjs")).href
  );
  const c = "C:/Users/you/.claude",
    said = [];
  const s = {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `node "${c}/hooks/file-link-gate.mjs" --remind`,
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `node "${c}/hooks/file-link-gate.mjs"`,
            },
          ],
        },
      ],
    },
  };
  const n = retire({ home: "C:/Users/you", say: (m) => said.push(m) }, s, c, [
    "file-link-gate.mjs --remind",
  ]);
  ok(
    "--remind entry retired, the Stop entry stays",
    [n, s.hooks.UserPromptSubmit.length, s.hooks.Stop.length, said[0]],
    [
      1,
      0,
      1,
      "hook removed: UserPromptSubmit file-link-gate.mjs --remind (no longer part of the setup)",
    ],
  );
}
{
  // an update from 1.0.104 through the installer itself
  const upd = path.join(os.tmpdir(), `cap-upd-${process.pid}`);
  fs.rmSync(upd, { recursive: true, force: true });
  fs.cpSync(home, upd, { recursive: true });
  const sf = path.join(upd, ".claude", "settings.json"),
    st = path.join(upd, ".claude", "setup-state.json");
  fs.writeFileSync(
    sf,
    JSON.stringify({
      ...json(sf),
      env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000" },
    }),
  );
  fs.writeFileSync(st, JSON.stringify({ ...json(st), version: "1.0.104" }));
  const r = install(upd);
  ok(
    "the installer takes the 1.0.104 cap out and says so",
    [
      r.code,
      "CLAUDE_CODE_MAX_OUTPUT_TOKENS" in (json(sf).env ?? {}),
      /output: the 64k cap/.test(r.out),
    ],
    [0, false, true],
  );
  fs.rmSync(upd, { recursive: true, force: true });
}
{
  // the pointer to what is new: an installer with docs/whats-new.md beside it (a copy of this repository) names
  // that file when the first two numbers of the version rose from the one on record, and only then
  const copy = path.join(tmp, "whats-new-repo");
  fs.cpSync(REPO, copy, {
    recursive: true,
    filter: (src) =>
      ![".git", "node_modules", "promo", "dist", "img"].includes(
        path.basename(src),
      ),
  });
  const doc = path.join(copy, "docs", "whats-new.md");
  fs.writeFileSync(doc, "# What is new\n");
  const now = json(path.join(REPO, "version.json")).version;
  const [major, middle] = now.split(".").map(Number);
  // the installer names it through Node's path of its own file: links resolved on macOS (/var is /private/var), a
  // short folder name kept on Windows (RUNNER~1); either form is the same file
  const lines = new Set(
    [doc, fs.realpathSync.native(doc)].map(
      (d) => `What is new in ${now}: ${d.replace(/\\/g, "/")}`,
    ),
  );
  const from = (version, withDoc = true) => {
    const upd = path.join(tmp, "whats-new-home");
    fs.rmSync(upd, { recursive: true, force: true });
    if (version) {
      fs.cpSync(home, upd, { recursive: true });
      const st = path.join(upd, ".claude", "setup-state.json");
      fs.writeFileSync(st, JSON.stringify({ ...json(st), version }));
    }
    if (!withDoc) fs.rmSync(doc);
    const r = spawnSync(
      process.execPath,
      [path.join(copy, "install.mjs"), "--home", upd],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: emptyPath, Path: emptyPath },
      },
    );
    if (!withDoc) fs.writeFileSync(doc, "# What is new\n");
    return [
      r.status,
      r.stdout.split(/\r?\n/).filter((l) => lines.has(l)).length,
    ];
  };
  ok(
    "an update from a lower middle number prints the What is new line once; the same middle number, a first install or no whats-new.md print none",
    [
      from(`${major}.${middle - 1}.9`),
      from(`${major - 1}.9`),
      from(`${major}.${middle}.0`),
      from(null),
      from(`${major}.${middle - 1}.9`, false),
    ],
    [
      [0, 1],
      [0, 1],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  );
}
for (const [own, gone] of [
  ["fable", true],
  ["opus", false],
]) {
  // an update from 1.0.108, which set a Fable advisor
  const upd = path.join(os.tmpdir(), `adv-upd-${process.pid}`);
  fs.rmSync(upd, { recursive: true, force: true });
  fs.cpSync(home, upd, { recursive: true });
  const sf = path.join(upd, ".claude", "settings.json"),
    st = path.join(upd, ".claude", "setup-state.json");
  fs.writeFileSync(sf, JSON.stringify({ ...json(sf), advisorModel: own }));
  fs.writeFileSync(
    st,
    JSON.stringify({ ...json(st), version: "1.0.108", advisor: true }),
  );
  const r = install(upd);
  ok(
    `an update from 1.0.108 ${gone ? "turns off the Fable advisor it set, and says how to turn it back on" : "keeps an advisor the person chose"}`,
    [
      r.code,
      json(sf).advisorModel,
      /advisor fable turns it back on/.test(r.out),
      "advisor" in json(st),
    ],
    [0, gone ? undefined : own, gone, false],
  );
  fs.rmSync(upd, { recursive: true, force: true });
}
const times = (list, s) =>
  list.filter((x) => x.includes(path.basename(s))).length;
ok(
  "each hook is wired as often as the example has it",
  scripts.map((s) => times(commands, s)),
  scripts.map((s) => times(scripts, s)),
);
ok(
  "each command runs the installed copy by its full path",
  scripts.every((s) =>
    commands.some((c) =>
      c.startsWith(`node "${path.join(claude, s).replace(/\\/g, "/")}"`),
    ),
  ),
);
for (const [event, groups] of Object.entries(example.hooks)) {
  for (const g of groups.filter((g) => g.matcher)) {
    const wired = settings.hooks[event].filter(
      (x) => x.matcher === g.matcher,
    ).length;
    ok(`${event} hooks keep the matcher ${g.matcher}`, wired >= 1);
  }
}
const watcher = Object.values(settings.hooks)
  .flat()
  .flatMap((g) => g.hooks)
  .find((h) => /steer.mjs" --watch$/.test(h.command));
ok(
  "the note watcher stays a background hook",
  [watcher?.asyncRewake, watcher?.timeout],
  [true, 7200],
);
// The guards block the action when they crash or time out; every other hook lets it go ahead.
const failClosed = Object.values(settings.hooks)
  .flat()
  .flatMap((g) => g.hooks)
  .filter((h) => h.onFailure)
  .map((h) => [h.command.match(/([\w-]+\.mjs)"/)[1], h.if || "", h.onFailure])
  .map((e) => JSON.stringify(e))
  .sort();
// planner-readonly is not in the settings (cut by plan 2.8): the agents run it from their own frontmatter.
// delete-guard, find-guard and sql-guard run in the pre-tool group, so its dispatcher entry blocks (spec D14).
// job 9 D9: push-key-scan moved into the pre-tool group too, so its two `if` entries are gone from this list.
ok(
  "the guards, and only they, block when they fail: opencli-readonly and the pre-tool dispatcher",
  failClosed,
  [
    ["dispatch.mjs", ""],
    ["opencli-readonly.mjs", "Bash(*opencli*)"],
    ["opencli-readonly.mjs", "PowerShell(*opencli*)"],
  ]
    .map((e) => JSON.stringify([...e, "block"]))
    .sort(),
);

// ---- the rules and the project folders, without Codex
const rules = () => fs.readFileSync(path.join(claude, "CLAUDE.md"), "utf8");
const text = (...p) => fs.readFileSync(path.join(projects, ...p), "utf8");
ok(
  "the rules are written with the section on gathering information",
  [
    rules().startsWith("# How to format replies"),
    rules().includes("## Gathering information\n"),
    rules().includes("ask.mjs"),
  ],
  [true, true, false],
);
ok(
  "the rules keep the sections after the section on gathering information",
  rules().includes("# Web research"),
);
// The rules no longer name the home folders (nimbalyst-notes finds them at run time); the project notes still do
ok(
  "the rules keep no <projects> placeholder",
  rules().includes("<projects>"),
  false,
);
ok(
  "the project notes name the real projects folder",
  text("quick-tasks", "CLAUDE.md").includes(
    path.join(projects, "claude-settings"),
  ),
);
ok(
  "each project folder has its notes and its model",
  HOMES.map((h) => [
    fs.existsSync(path.join(projects, h, "CLAUDE.md")),
    text(h, "CLAUDE.md").includes("<projects>"),
    json(path.join(projects, h, ".claude", "settings.json")).model,
  ]),
  [
    [true, false, "opus"],
    [true, false, "opus"],
  ],
);
const expected = [
  "quick-tasks/.claude/skills/read-web/SKILL.md",
  "claude-settings/how-to.md",
  "quick-tasks/.claude/skills/finder/SKILL.md",
  "quick-tasks/.claude/skills/finder/tools.md",
  "quick-tasks/.claude/hooks/finder-link-gate.mjs",
  "quick-tasks/tools/peek.mjs",
  "quick-tasks/profile.md",
  "quick-tasks/finds/INDEX.md",
];
ok(
  "the skills, the link gate, the tools and the starter notes are there",
  expected.filter((f) => !fs.existsSync(path.join(projects, f))),
  [],
);
ok(
  "the one audit skill arrives with its sub-commands and scripts",
  [
    "SKILL.md",
    "chat.md",
    "full.md",
    "usage.md",
    "scan.md",
    "outcomes.md",
    "memory.md",
    "scripts/outcomes.mjs",
    "scripts/usage-scan.mjs",
  ].filter(
    (f) => !fs.existsSync(path.join(claude, "skills", "setup-audit", f)),
  ),
  [],
);
const NESTED = [
  "skills/lead/reference.md",
  "hooks/nimbalyst-notes.mjs",
  "hooks/verify-gate.mjs",
  "workers/versions.mjs",
  "workers/download.mjs",
];
ok(
  "files in folders below a skill, and the newer hooks and workers, are in the repo and arrive",
  [
    ...NESTED,
    ...walk(path.join(REPO, "skills", "setup-audit", "scripts")).map((f) =>
      fwd(path.relative(REPO, f)),
    ),
  ].filter(
    (f) =>
      !fs.existsSync(path.join(REPO, f)) ||
      !fs.existsSync(path.join(claude, f)),
  ),
  [],
);
ok(
  "the scripts of the audit skill are more than a few",
  walk(path.join(REPO, "skills", "setup-audit", "scripts")).length > 3,
);
const gate = commandsIn(
  json(path.join(projects, "quick-tasks", ".claude", "settings.json")),
);
ok("the link gate is wired once, to the copy inside its folder", gate, [
  `node "${fwd(path.join(projects, "quick-tasks", ".claude", "hooks", "finder-link-gate.mjs"))}"`,
]);
ok(
  "without Codex the picture skill and its gate are left out",
  [
    fs.existsSync(path.join(claude, "hooks", "picture-gate.mjs")),
    fs.existsSync(
      path.join(projects, "quick-tasks", ".claude", "skills", "picture"),
    ),
    JSON.stringify(
      json(path.join(projects, "quick-tasks", ".claude", "settings.json")),
    ).includes("picture-gate"),
  ],
  [false, false, false],
);
ok(
  "the notes say what a missing worker changes",
  [
    /## Workers on this computer\n\n- Codex is not set up/.test(
      text("quick-tasks", "CLAUDE.md"),
    ),
    text("quick-tasks", "CLAUDE.md").includes("No generated pictures here"),
  ],
  [true, true],
);
ok(
  "the installer says one line for each thing it did",
  [
    first.out.includes(
      `copied ${fwd(path.join(projects, "quick-tasks", "profile.md"))}`,
    ),
    /Codex CLI \(GPT\): not used, optional \(not found on the PATH\)/.test(
      first.out,
    ),
  ],
  [true, true],
);

ok(
  "setup-state.json records the projects folder and this repository folder as `repo`",
  [
    json(path.join(claude, "setup-state.json")).projects,
    path.resolve(json(path.join(claude, "setup-state.json")).repo),
  ],
  [projects, path.resolve(REPO)],
);

ok(
  "Board Tidy leaves quick-tasks alone after the install",
  json(path.join(claude, "board-tidy.json")).keep,
  [fwd(path.join(projects, "quick-tasks"))],
);
// the person takes it off the list ("tidy quick-tasks again"): later runs must not put it back
fs.writeFileSync(
  path.join(claude, "board-tidy.json"),
  JSON.stringify({ keep: [] }),
);

// ---- a second run changes nothing
const before = [...snap(claude), ...snap(projects)];
const second = install(home);
ok("second run exits cleanly", second.code, 0);
ok(
  "second run copies nothing and wires nothing",
  CHANGED.test(second.out),
  false,
);
ok(
  "second run leaves every file as it was",
  [...snap(claude), ...snap(projects)],
  before,
);

// ---- what the user wrote in the notes files stays, also when Codex is added; rules from an older version
// are written whole, the user's own rule moves to ~/.claude/rules/my-rules.md
fs.writeFileSync(
  path.join(projects, "quick-tasks", "profile.md"),
  "# Profile for hunts\n\n- **Country:** somewhere\n",
);
fs.writeFileSync(
  path.join(projects, "quick-tasks", "CLAUDE.md"),
  text("quick-tasks", "CLAUDE.md").replace(
    "# quick-tasks",
    "# quick-tasks\n\nMy own line.",
  ),
);
fs.writeFileSync(
  path.join(claude, "CLAUDE.md"),
  rules()
    .replace("# How to work", "# How to work\n\n- My own rule.")
    .replace(
      /## Gathering information\n[\s\S]*?(?=\n# Web research)/,
      "## The free workers read local files, not the web\n\n- Run `node ~/.claude/workers/ask.mjs`.\n",
    ),
);
// the switches an older version wrote for the outside workers
for (const name of ["codex", "agy"])
  fs.writeFileSync(
    path.join(claude, "workers", `${name}.off`),
    `Not used on this computer. Run install.mjs with --${name} yes to use this worker.\n`,
  );
const withCodex = install(home, "--codex", "yes");
ok("install with Codex exits cleanly", withCodex.code, 0);
ok(
  "the user's profile is kept as it is",
  text("quick-tasks", "profile.md"),
  "# Profile for hunts\n\n- **Country:** somewhere\n",
);
const myRules = () =>
  fs.readFileSync(path.join(claude, "rules", "my-rules.md"), "utf8");
ok(
  "the rules are this version's whole, the old section gone, the user's own rule in my-rules.md under its heading",
  [
    rules().includes("- My own rule."),
    rules().includes("## Gathering information\n"),
    rules().includes("## The free workers read local files"),
    rules().includes("ask.mjs"),
    myRules().startsWith("## How to work\n\n- My own rule.\n"),
  ],
  [false, true, false, false, true],
);
ok(
  "the installer says the rules were brought up and where the user's went",
  /rules: brought up to this version: \d+ setup rules new or changed, \d+ old ones removed, \d+ of yours moved to .*my-rules\.md/.test(
    withCodex.out,
  ),
);
const inWorkers = (name) => fs.existsSync(path.join(claude, "workers", name));
ok(
  "the old worker switches go and no worker command arrives",
  [inWorkers("ask.mjs"), inWorkers("codex.off"), inWorkers("agy.off")],
  [false, false, false],
);
ok(
  "the user's own line moves to the folder's my-rules.md and the note about Codex goes",
  [
    text("quick-tasks", "CLAUDE.md").includes("My own line."),
    text("quick-tasks", path.join(".claude", "rules", "my-rules.md")).includes(
      "My own line.",
    ),
    text("quick-tasks", "CLAUDE.md").includes("Codex is not set up"),
  ],
  [false, true, false],
);
ok(
  "the changed files are kept as dated copies in setup-logs",
  [
    copiesIn(home, claude).includes("CLAUDE.md"),
    copiesIn(home, projects).includes("CLAUDE.md"),
    copiesIn(home, projects).includes("profile.md"),
  ],
  [true, true, false],
);
ok("no copy is left beside a replaced file", besideFiles(home), []);
const shared = path.join(claude, "shared-skills", "picture");
ok(
  "with Codex the picture skill and its gate are installed",
  [
    fs.existsSync(path.join(shared, "picture.mjs")),
    fs.existsSync(path.join(claude, "hooks", "picture-gate.mjs")),
  ],
  [true, true],
);
for (const h of ["quick-tasks"]) {
  const link = path.join(projects, h, ".claude", "skills", "picture");
  ok(
    `${h}: the picture skill is linked and is the shared one`,
    [
      fs.lstatSync(link).isSymbolicLink(),
      fs.readFileSync(path.join(link, "SKILL.md"), "utf8") ===
        fs.readFileSync(path.join(shared, "SKILL.md"), "utf8"),
    ],
    [true, true],
  );
  const s = json(path.join(projects, h, ".claude", "settings.json"));
  const at = `node "${fwd(path.join(claude, "hooks", "picture-gate.mjs"))}"`;
  ok(
    `${h}: the gate is wired for display_to_user and Stop`,
    [
      s.hooks.PreToolUse.some(
        (g) =>
          g.matcher === "mcp__nimbalyst__display_to_user" &&
          g.hooks[0].command === at,
      ),
      s.hooks.Stop.some((g) => g.hooks[0].command === at),
    ],
    [true, true],
  );
}
ok(
  "the other folder gets no picture gate",
  ["claude-settings"].map((h) =>
    fs
      .readFileSync(path.join(projects, h, ".claude", "settings.json"), "utf8")
      .includes("picture-gate"),
  ),
  [false],
);
const beforeAgain = [...snap(claude), ...snap(projects)];
const again = install(home, "--codex", "yes");
ok(
  "the next run says the rules are up to date",
  again.out.includes("rules: up to date"),
  true,
);
ok(
  "a second run with Codex changes nothing",
  [
    CHANGED.test(again.out),
    JSON.stringify([...snap(claude), ...snap(projects)]) ===
      JSON.stringify(beforeAgain),
  ],
  [false, true],
);

// ---- Codex taken away again: the link and the gate's wiring go, the shared files are not deleted through the link
ok(
  "install without Codex again exits cleanly",
  install(home, "--codex", "no").code,
  0,
);
ok(
  "the link and the gate's wiring are gone",
  ["quick-tasks"].map((h) => [
    fs.existsSync(path.join(projects, h, ".claude", "skills", "picture")),
    fs
      .readFileSync(path.join(projects, h, ".claude", "settings.json"), "utf8")
      .includes("picture-gate"),
  ]),
  [[false, false]],
);
ok(
  "the shared skill's files are still there",
  fs.existsSync(path.join(shared, "SKILL.md")),
);
ok(
  "the link gate's wiring stays",
  commandsIn(
    json(path.join(projects, "quick-tasks", ".claude", "settings.json")),
  ).length,
  1,
);

// ---- Codex on the PATH is found without a flag
const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, "codex"), "");
const found = installWith(bin, path.join(tmp, "never-asked"), "--dry-run");
ok(
  "codex on the PATH is found",
  found.out.includes("Codex CLI (GPT): used (found on the PATH)"),
);

ok(
  "an answer given once wins over the PATH on a later run",
  installWith(bin, home, "--dry-run").out.includes(
    "Codex CLI (GPT): not used, optional (as answered before)",
  ),
);
ok(
  "the answers, the version and Node are on record",
  (() => {
    const s = json(path.join(claude, "setup-state.json"));
    return [
      s.codex,
      "agy" in s,
      s.version === json(path.join(REPO, "version.json")).version,
      "node" in s,
    ];
  })(),
  [false, false, true, false],
);

// ---- the two opt-ins (voice typing with Handy, the backup): the first install's chat asks them once, install.mjs
// only keeps the answers and neither installs nor removes Handy or a backup
const optIns = () => {
  const s = json(path.join(claude, "setup-state.json"));
  return ["handy" in s, "backup" in s, s.handy, s.backup];
};
ok(
  "OPT1. no flag and no answer before: neither opt-in is on record, so it is still to be asked once",
  optIns().slice(0, 2),
  [false, false],
);
// a backup folder and a Handy as they would be on a computer that has them (inside the test home)
const backupDir = path.join(home, ".claude-backup");
ok(
  "OPT1. the test home has no backup folder or app folders of its own",
  ["AppData", "Library", ".claude-backup"].some((d) =>
    fs.existsSync(path.join(home, d)),
  ),
  false,
);
const handyDirs = [
  path.join(home, "AppData", "Roaming", "com.pais.handy"),
  path.join(home, "AppData", "Local", "Handy"),
  path.join(home, "Library", "Application Support", "com.pais.handy"),
];
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(
  path.join(backupDir, "config.json"),
  JSON.stringify({ target: "b2", folders: [fwd(projects)] }),
);
fs.writeFileSync(
  path.join(backupDir, "last-run.json"),
  JSON.stringify({ time: new Date().toISOString(), ok: true }),
);
for (const d of handyDirs) {
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, "settings_store.json"),
    JSON.stringify({ settings: { push_to_talk: true } }),
  );
}
const optBefore = [...snap(backupDir), ...handyDirs.flatMap(snap)];
const saidNo = install(home, "--backup", "no", "--handy", "no");
ok(
  "OPT1. --backup no --handy no: both on record as no",
  [saidNo.code, ...optIns()],
  [0, true, true, false, false],
);
ok(
  "OPT1. a no leaves a backup folder and a Handy that are there exactly as they were",
  [...snap(backupDir), ...handyDirs.flatMap(snap)],
  optBefore,
);
ok(
  "OPT1. a later run with no flag keeps both answers",
  [install(home).code, ...optIns()],
  [0, true, true, false, false],
);
ok(
  "OPT1. --handy yes goes on record, the backup's no stays",
  [install(home, "--handy", "yes").code, ...optIns()],
  [0, true, true, true, false],
);
const badOpt = install(home, "--backup", "maybe");
ok(
  "OPT1. --backup with no yes or no stops before anything, the answers stay",
  [
    badOpt.code,
    badOpt.out.includes("--backup maybe: the answer is yes or no."),
    ...optIns(),
  ],
  [1, true, true, true, true, false],
);
fs.rmSync(backupDir, { recursive: true });
for (const d of ["AppData", "Library"])
  fs.rmSync(path.join(home, d), { recursive: true });

// ---- an update: files the user never changed are replaced by the newer version's, changed ones stay
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const upd = path.join(tmp, "upd");
install(upd);
const updState = path.join(upd, ".claude", "setup-state.json");
const updRules = path.join(upd, ".claude", "CLAUDE.md");
const updNotes = path.join(upd, "Projects", "quick-tasks", "CLAUDE.md");
const updHowTo = path.join(upd, "Projects", "claude-settings", "how-to.md");
const mineNotes = path.join(upd, "Projects", "claude-settings", "CLAUDE.md");
// as if an older version had written these three files: other text, and on record as written
const s = json(updState);
fs.writeFileSync(updRules, "# Rules of an older version\n");
s.rules = sha("# Rules of an older version\n");
for (const f of [updNotes, updHowTo]) {
  fs.writeFileSync(f, "# Notes of an older version\n");
  s.written[fwd(f)] = sha("# Notes of an older version\n");
}
fs.writeFileSync(updState, JSON.stringify(s));
fs.writeFileSync(mineNotes, "# claude-settings\n\nAll mine.\n");
const updated = install(upd);
ok(
  "rules that are as an older version wrote them are replaced, with a dated copy",
  [
    fs.readFileSync(updRules, "utf8").startsWith("# How to format replies"),
    updated.out.includes(`rules: replaced ${fwd(updRules)}`),
    copiesIn(upd, path.join(upd, ".claude")).includes("CLAUDE.md"),
  ],
  [true, true, true],
);
ok(
  "a folder's notes and the how-to that are as written are replaced too",
  [
    fs.readFileSync(updNotes, "utf8").startsWith("# quick-tasks"),
    fs.readFileSync(updHowTo, "utf8").includes("Notes of an older version"),
  ],
  [true, false],
);
ok(
  "notes the user changed are this version's, the user's line in the folder's my-rules.md",
  [
    fs
      .readFileSync(mineNotes, "utf8")
      .startsWith("# claude-settings\n\nAll mine.\n"),
    fs.readFileSync(mineNotes, "utf8").includes("All mine."),
    fs
      .readFileSync(
        path.join(path.dirname(mineNotes), ".claude", "rules", "my-rules.md"),
        "utf8",
      )
      .includes("All mine."),
  ],
  [false, false, true],
);
ok(
  "the run after the update changes nothing",
  CHANGED.test(install(upd).out),
  false,
);

// ---- an existing setup keeps its own settings and rules, and old copies are kept
const used = path.join(tmp, "used");
fs.mkdirSync(path.join(used, ".claude", "hooks"), { recursive: true });
const own = {
  model: "sonnet",
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: "node my-own-hook.mjs" }] }],
  },
};
fs.writeFileSync(
  path.join(used, ".claude", "settings.json"),
  JSON.stringify(own),
);
fs.writeFileSync(
  path.join(used, ".claude", "hooks", "sql-guard.mjs"),
  "// an older version\n",
);
fs.writeFileSync(
  path.join(used, ".claude", "CLAUDE.md"),
  "# My rules\n\n- Mine.\n",
);
const elsewhere = path.join(tmp, "work");
const onUsed = install(used, "--projects", elsewhere);
ok("install on an existing setup exits cleanly", onUsed.code, 0);
const merged = json(path.join(used, ".claude", "settings.json"));
ok(
  "the user's own model and hook stay",
  [merged.model, JSON.stringify(merged.hooks.Stop).includes("my-own-hook.mjs")],
  ["sonnet", true],
);
ok(
  "the old settings and the rules from before the install are kept as copies in setup-logs, none beside them",
  [copiesIn(used, path.join(used, ".claude")), besideFiles(used)],
  [["CLAUDE.md", "settings.json"], []],
);
const usedHook = path.join(used, ".claude", "hooks", "sql-guard.mjs");
ok(
  "a file that was there before under the same name stays, and the run lists it with the way to take the setup's",
  [
    fs.readFileSync(usedHook, "utf8"),
    onUsed.out.includes(`kept yours ${fwd(usedHook)}`),
    /Kept as yours[^\n]*\n {2}hooks\/sql-guard\.mjs\n[^\n]*--replace <name>[^\n]*--replace-all/.test(
      onUsed.out,
    ),
  ],
  ["// an older version\n", true, true],
);
const logs = () =>
  fs
    .readdirSync(path.join(used, ".claude", "setup-logs"))
    .filter((n) => !n.includes("-install-backup"));
ok(
  "a run that changed something saves what it printed",
  [
    logs().length,
    fs
      .readFileSync(path.join(used, ".claude", "setup-logs", logs()[0]), "utf8")
      .includes(`kept yours ${fwd(usedHook)}`),
  ],
  [1, true],
);
ok(
  "rules from before the install: the setup's are written, the user's own rule moves to my-rules.md, and the installer says so",
  [
    fs
      .readFileSync(path.join(used, ".claude", "CLAUDE.md"), "utf8")
      .startsWith("# How to format replies"),
    fs.readFileSync(path.join(used, ".claude", "rules", "my-rules.md"), "utf8"),
    /rules: brought up to this version: .* 1 of yours moved/.test(onUsed.out),
  ],
  [true, "## My rules\n\n- Mine.\n", true],
);
ok(
  "--projects puts the folders where it says",
  [
    HOMES.every((h) => fs.existsSync(path.join(elsewhere, h, "CLAUDE.md"))),
    fs.existsSync(path.join(used, "Projects")),
  ],
  [true, false],
);
const replaced = install(used);
const oldRules = copyOf(used, path.join(used, ".claude", "CLAUDE.md"));
ok(
  "the rules from before the install stay as a dated copy, on record as the user's",
  [
    oldRules && fs.readFileSync(oldRules, "utf8"),
    (
      json(path.join(used, ".claude", "setup-state.json")).userCopies || []
    ).includes(oldRules && fwd(oldRules)),
  ],
  ["# My rules\n\n- Mine.\n", true],
);
ok(
  "a later run without --projects uses the folder given before",
  [
    replaced.out.includes(fwd(path.join(elsewhere, "quick-tasks"))),
    fs.existsSync(path.join(used, "Projects")),
  ],
  [true, false],
);
ok(
  "the file of the user's still stays on a later run",
  fs.readFileSync(usedHook, "utf8"),
  "// an older version\n",
);
const oneTaken = install(used, "--replace", "hooks/sql-guard.mjs");
const hookCopy = copyOf(used, usedHook);
ok(
  "--replace takes the setup's version of that one file and keeps the user's as a dated copy",
  [
    fs
      .readFileSync(usedHook)
      .equals(fs.readFileSync(path.join(REPO, "hooks", "sql-guard.mjs"))),
    hookCopy && fs.readFileSync(hookCopy, "utf8"),
    /Replaced[^\n]*\n {2}hooks\/sql-guard\.mjs\n/.test(oneTaken.out),
  ],
  [true, "// an older version\n", true],
);
// a second copy of the same file that day goes to <day>-install-backup-2, and the run names that folder
fs.writeFileSync(usedHook, "// changed again the same day\n");
const twiceTaken = install(used, "--replace", "hooks/sql-guard.mjs");
const usedLogs = path.join(used, ".claude", "setup-logs");
const twiceCopy = backupsOf(used).find(
  (b) =>
    b.of === usedHook &&
    fs.readFileSync(b.copy, "utf8") === "// changed again the same day\n",
)?.copy;
const twiceFolder = twiceCopy
  ? fwd(
      path.join(
        usedLogs,
        path.relative(usedLogs, twiceCopy).split(path.sep)[0],
      ),
    )
  : "";
ok(
  "a second copy that day goes to <day>-install-backup-2 and the run names the folder used",
  [
    /-install-backup-2$/.test(twiceFolder),
    twiceTaken.out
      .split("\n")
      .some(
        (l) =>
          l.startsWith("Replaced, the old one of each is kept in ") &&
          l.includes(twiceFolder),
      ),
  ],
  [true, true],
);

// ---- a file of the setup's that the user changed after the install stays, also in a project folder
const usedSkill = path.join(used, ".claude", "skills", "handoff", "SKILL.md");
const usedTool = path.join(elsewhere, "quick-tasks", "tools", "peek.mjs");
for (const f of [usedHook, usedSkill, usedTool])
  fs.appendFileSync(f, "\n// my own change\n");
const usedBefore = [...snap(path.join(used, ".claude")), ...snap(elsewhere)];
const keptMine = install(used);
ok(
  "the changed files stay and the run changes nothing",
  [
    JSON.stringify([
      ...snap(path.join(used, ".claude")),
      ...snap(elsewhere),
    ]) === JSON.stringify(usedBefore),
    CHANGED.test(keptMine.out),
    ["hooks/sql-guard.mjs", "skills/handoff/SKILL.md", fwd(usedTool)].every(
      (f) => keptMine.out.includes(`\n  ${f}\n`),
    ),
    keptMine.out.includes("Files: 3 kept as yours"),
  ],
  [true, false, true, true],
);
install(used, "--replace-all");
ok(
  "--replace-all takes the setup's version of every one of them",
  [usedHook, usedSkill, usedTool].map((f) =>
    fs.readFileSync(f, "utf8").includes("my own change"),
  ),
  [false, false, false],
);
ok(
  "the run after it has nothing left to keep",
  install(used).out.includes("kept yours"),
  false,
);

// ---- a setup installed before files were on record: a file that differs is replaced once, with a copy
const usedState = path.join(used, ".claude", "setup-state.json");
const old = json(usedState);
delete old.files;
fs.writeFileSync(usedState, JSON.stringify(old));
fs.writeFileSync(usedSkill, "# The skill of an older version\n");
const fromOld = install(used);
ok(
  "with no record an older file is replaced, and from then on the files are on record",
  [
    fromOld.out.includes(`replaced ${fwd(usedSkill)}`),
    fs.readFileSync(usedSkill, "utf8").includes("older version"),
    fwd(usedSkill) in json(usedState).files,
  ],
  [true, false, true],
);

// ---- a hook in the settings whose script is gone is named
const gone = fwd(path.join(used, ".claude", "hooks", "gone.mjs"));
const withGone = json(path.join(used, ".claude", "settings.json"));
withGone.hooks.Stop.push({
  hooks: [{ type: "command", command: `node "${gone}"` }],
});
fs.writeFileSync(
  path.join(used, ".claude", "settings.json"),
  JSON.stringify(withGone),
);
ok(
  "a wired hook whose script is not there is listed",
  install(used).out.includes(`\n  Stop: ${gone}\n`),
);

// ---- a hook of the setup's that an older copy wired from another place in ~/.claude is pointed at the installed one
const moved = path.join(tmp, "moved");
fs.mkdirSync(path.join(moved, ".claude", "skills", "old"), {
  recursive: true,
});
const oldGate = fwd(
  path.join(moved, ".claude", "skills", "old", "link-gate.mjs"),
);
fs.writeFileSync(oldGate, "// old\n");
const gateEvent = Object.keys(example.hooks).find((e) =>
  JSON.stringify(example.hooks[e]).includes("hooks/link-gate.mjs"),
);
fs.writeFileSync(
  path.join(moved, ".claude", "settings.json"),
  JSON.stringify({
    hooks: {
      [gateEvent]: [
        {
          hooks: [
            { type: "command", command: `"node.exe" "${oldGate}"` },
            { type: "command", command: "node /elsewhere/file-link-gate.mjs" },
          ],
        },
      ],
    },
  }),
);
const movedRun = install(moved);
const movedCmds = commandsIn(
  json(path.join(moved, ".claude", "settings.json")),
);
ok(
  "a hook wired from an older place in ~/.claude is pointed at the installed copy, and a script elsewhere is left alone",
  [
    movedCmds.filter((c) => /\/link-gate\.mjs/.test(c)),
    movedCmds.includes("node /elsewhere/file-link-gate.mjs"),
    movedRun.out.includes(`hook repointed: ${gateEvent} link-gate.mjs`),
  ],
  [
    [`node "${fwd(path.join(moved, ".claude", "hooks", "link-gate.mjs"))}"`],
    true,
    true,
  ],
);
ok(
  "the run after it repoints nothing",
  install(moved).out.includes("hook repointed"),
  false,
);

// ---- hooks the setup switched off (build-nudge, turn-cap): the entry goes, a script from another folder stays
const wiredText = JSON.stringify(example.hooks);
ok(
  "the example settings wire neither build-nudge nor turn-cap",
  [wiredText.includes("build-nudge.mjs"), wiredText.includes("turn-cap.mjs")],
  [false, false],
);
const off = path.join(tmp, "retired");
fs.mkdirSync(path.join(off, ".claude"), { recursive: true });
const ownTurnCap = "node /elsewhere/turn-cap.mjs";
fs.writeFileSync(
  path.join(off, ".claude", "settings.json"),
  JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: "node ~/.claude/hooks/build-nudge.mjs",
              timeout: 5,
            },
          ],
        },
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: `node "${fwd(path.join(off, ".claude", "hooks", "turn-cap.mjs"))}"`,
              timeout: 10,
            },
            { type: "command", command: ownTurnCap },
          ],
        },
      ],
    },
  }),
);
const offRun = install(off);
const offCmds = commandsIn(json(path.join(off, ".claude", "settings.json")));
ok(
  "an install that had the two wired loses both entries, and says so",
  [
    offCmds.some((c) => c.includes("build-nudge.mjs")),
    offCmds.some((c) => c.includes(".claude/hooks/turn-cap.mjs")),
    offCmds.includes(ownTurnCap),
    offRun.out.includes("hook removed: PreToolUse"),
  ],
  [false, false, true, true],
);
ok(
  "the run after it removes nothing",
  install(off).out.includes("hook removed"),
  false,
);

// ---- with Nimbalyst there, the run builds an extension and puts it into Nimbalyst's folder. Nimbalyst counts as
// closed (SETUP_NIMBALYST_OPEN=no), so the build staged in extensions-pending is swapped in at once and nothing
// is left pending; the staged flow with Nimbalyst open is T11 below
if (process.platform === "win32") {
  const pendingIn = (appData) =>
    path.join(appData, "@nimbalyst", "electron", "extensions-pending");
  const nothingPending = (appData) =>
    !fs.existsSync(pendingIn(appData)) ||
    fs.readdirSync(pendingIn(appData)).every((f) => f.startsWith("."));
  const themeDist = path.join(REPO, "extensions", "ink-themes", "dist");
  const hadDist = fs.existsSync(themeDist);
  const appData = path.join(tmp, "appdata");
  fs.mkdirSync(path.join(appData, "@nimbalyst", "electron"), {
    recursive: true,
  });
  const withExt = () =>
    spawnSync(
      process.execPath,
      [INSTALL, "--home", path.join(tmp, "ext-home"), "--extensions", "yes"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: emptyPath,
          Path: emptyPath,
          APPDATA: appData,
          SETUP_EXTENSIONS: "ink-themes",
          SETUP_NIMBALYST_OPEN: "no",
        },
      },
    ).stdout;
  ok(
    "the theme extension is built and installed",
    [
      withExt().includes("extension installed: ink-themes"),
      nothingPending(appData),
      fs.existsSync(
        path.join(
          appData,
          "@nimbalyst",
          "electron",
          "extensions",
          "inktheme",
          "manifest.json",
        ),
      ),
    ],
    [true, true, true],
  );
  ok(
    "the next run leaves it alone",
    withExt().includes("extension unchanged: ink-themes"),
  );
  const panelDist = path.join(REPO, "extensions", "agents-panel", "dist");
  const hadPanelDist = fs.existsSync(panelDist);
  const panelRun = spawnSync(
    process.execPath,
    [INSTALL, "--home", path.join(tmp, "ext-home"), "--extensions", "yes"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: emptyPath,
        Path: emptyPath,
        APPDATA: appData,
        SETUP_EXTENSIONS: "agents-panel",
        SETUP_NIMBALYST_OPEN: "no",
      },
    },
  ).stdout;
  ok(
    "the agents panel is built and installed without npm",
    [
      panelRun.includes("extension installed: agents-panel"),
      nothingPending(appData),
      fs.existsSync(
        path.join(
          appData,
          "@nimbalyst",
          "electron",
          "extensions",
          "agentspanel",
          "dist",
          "style.css",
        ),
      ),
    ],
    [true, true, true],
  );
  if (!hadPanelDist) fs.rmSync(panelDist, { recursive: true, force: true });
  const trackerDist = path.join(REPO, "extensions", "job-tracker", "dist");
  const hadTrackerDist = fs.existsSync(trackerDist);
  const trackerRun = spawnSync(
    process.execPath,
    [INSTALL, "--home", path.join(tmp, "ext-home"), "--extensions", "yes"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: emptyPath,
        Path: emptyPath,
        APPDATA: appData,
        SETUP_EXTENSIONS: "job-tracker",
        SETUP_NIMBALYST_OPEN: "no",
      },
    },
  ).stdout;
  ok(
    "the job tracker is built and installed without npm",
    [
      trackerRun.includes("extension installed: job-tracker"),
      nothingPending(appData),
      fs.existsSync(
        path.join(
          appData,
          "@nimbalyst",
          "electron",
          "extensions",
          "jobtracker",
          "dist",
          "style.css",
        ),
      ),
    ],
    [true, true, true],
  );
  if (!hadTrackerDist) fs.rmSync(trackerDist, { recursive: true, force: true });
  ok(
    "--extensions no leaves the extensions out",
    install(path.join(tmp, "ext-home"), "--extensions", "no").out.includes(
      "extensions are not installed by this script",
    ),
  );
  // the build writes its output next to the source; a folder this test made goes again
  if (!hadDist) fs.rmSync(themeDist, { recursive: true, force: true });
}

// ---- the staged flow (scripts/extensions.mjs, tools/nimbalyst-patch/ext-swap.mjs), both systems: a build goes to
// extensions-pending and into the live folder only while Nimbalyst is closed. A live folder that changes while
// Nimbalyst counts as open fails the case.
{
  const darwin = process.platform === "darwin";
  const nimbalystIn = (root) =>
    darwin
      ? path.join(
          root,
          "Library",
          "Application Support",
          "@nimbalyst",
          "electron",
        )
      : path.join(root, "@nimbalyst", "electron");
  // Every file under a folder with its text, relative; [] for a missing folder
  const tree = (dir) =>
    fs.existsSync(dir)
      ? walk(dir)
          .map((f) => [path.relative(dir, f), fs.readFileSync(f, "utf8")])
          .sort()
      : [];
  const staged = (root, extra) => {
    const r = spawnSync(
      process.execPath,
      [INSTALL, "--home", path.join(root, "home"), "--extensions", "yes"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: emptyPath,
          Path: emptyPath,
          ...(darwin ? { HOME: root } : { APPDATA: root }),
          ...extra,
        },
      },
    );
    return `${r.stdout}${r.stderr}`;
  };
  const writeFile = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };

  // T11: Nimbalyst open, then closed
  const themeDist = path.join(REPO, "extensions", "ink-themes", "dist");
  const hadDist = fs.existsSync(themeDist);
  const root = path.join(tmp, "staged-open");
  const data = nimbalystIn(root);
  const live = path.join(data, "extensions", "inktheme");
  const pending = path.join(data, "extensions-pending");
  writeFile(path.join(live, "manifest.json"), "the installed ink");
  writeFile(path.join(live, "dist", "theme.css"), "the installed css");
  const before = tree(live);
  const open = staged(root, {
    SETUP_EXTENSIONS: "ink-themes",
    SETUP_NIMBALYST_OPEN: "yes",
  });
  ok(
    "T11 Nimbalyst open: the build waits in extensions-pending, the live folder is unchanged",
    [
      open.includes(
        "extension waiting: ink-themes (goes in when Nimbalyst is closed)",
      ),
      open.includes("extension installed:"),
      tree(live),
      fs.existsSync(path.join(pending, "inktheme", "manifest.json")),
      fs.existsSync(path.join(pending, ".part", "inktheme")),
    ],
    [true, false, before, true, false],
  );
  const closed = staged(root, {
    SETUP_EXTENSIONS: "ink-themes",
    SETUP_NIMBALYST_OPEN: "no",
  });
  ok(
    "T11 Nimbalyst closed: the next run swaps the waiting build in without building again",
    [
      closed.includes("extension installed: ink-themes"),
      closed.includes("extension waiting:"),
      closed.includes("extension unchanged:"),
      fs.readFileSync(path.join(live, "manifest.json"), "utf8") ===
        fs.readFileSync(
          path.join(REPO, "extensions", "ink-themes", "manifest.json"),
          "utf8",
        ),
      fs.existsSync(path.join(pending, "inktheme")),
    ],
    [true, false, false, true, false],
  );
  ok(
    "T11 the run after it leaves the extension alone",
    staged(root, {
      SETUP_EXTENSIONS: "ink-themes",
      SETUP_NIMBALYST_OPEN: "no",
    }).includes("extension unchanged: ink-themes"),
  );
  if (!hadDist) fs.rmSync(themeDist, { recursive: true, force: true });

  // T3 (installer part): a broken extension source. A copy of board-tidy without pick.mjs, so its --install step
  // fails after it has written into the side folder
  const sources = path.join(tmp, "broken-sources");
  for (const name of ["board-tidy", "shared"])
    fs.cpSync(path.join(REPO, "extensions", name), path.join(sources, name), {
      recursive: true,
      filter: (f) => !/[\\/](node_modules|dist)$/.test(f),
    });
  fs.rmSync(path.join(sources, "board-tidy", "pick.mjs"));
  const brokenRoot = path.join(tmp, "staged-broken");
  const brokenLive = path.join(
    nimbalystIn(brokenRoot),
    "extensions",
    "boardtidy",
  );
  const brokenPending = path.join(
    nimbalystIn(brokenRoot),
    "extensions-pending",
  );
  writeFile(path.join(brokenLive, "manifest.json"), "the installed tidy");
  writeFile(path.join(brokenLive, "pick.mjs"), "the installed pick");
  const brokenBefore = tree(brokenLive);
  const broken = staged(brokenRoot, {
    SETUP_EXT_SOURCES: sources,
    SETUP_EXTENSIONS: "board-tidy",
    SETUP_NIMBALYST_OPEN: "no",
  });
  const brokenState = path.join(
    brokenRoot,
    "home",
    ".claude",
    "setup-state.json",
  );
  ok(
    "T3 a broken extension: named as failed, the live folder is byte-identical, nothing is pending",
    [
      broken.includes("extension failed: board-tidy"),
      broken.includes("extension installed:"),
      tree(brokenLive),
      fs.existsSync(brokenPending)
        ? fs.readdirSync(brokenPending).filter((f) => f !== ".part")
        : [],
      tree(path.join(brokenPending, ".part")),
      fs.existsSync(brokenState) &&
        "board-tidy" in (json(brokenState).extensions || {}),
    ],
    [true, false, brokenBefore, [], [], false],
  );
}

// ---- Claude Code's own settings: a model when none is set, the permission rules, and a set model stays
ok(
  "a blank home gets a model and the permission rules",
  [
    settings.model,
    settings.permissions.deny.includes("Read(~/.ssh/**)"),
    settings.permissions.ask.includes("Read(//**/.env)"),
  ],
  ["opus", true, true],
);
ok(
  "a model that was set stays, next to the rules",
  [merged.model, merged.permissions.deny.length > 0],
  ["sonnet", true],
);

// ---- the plugin (claude-hud is the only one left), with a stand-in for the claude command that keeps a list of what it was told
const fake = path.join(tmp, "fake-claude");
fs.mkdirSync(fake);
const told = path.join(fake, "told.txt");
fs.writeFileSync(
  path.join(fake, "claude.mjs"),
  `import fs from "node:fs";
const a = process.argv.slice(2).join(" ");
fs.appendFileSync(${JSON.stringify(told)}, a + "\\n");
if (a === "plugin list") console.log("Installed plugins:\\n  (none)");
`,
);
fs.writeFileSync(
  path.join(fake, "claude.cmd"),
  `@"${process.execPath}" "%~dp0claude.mjs" %*\r\n`,
);
fs.writeFileSync(
  path.join(fake, "claude"),
  `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/claude.mjs" "$@"\n`,
  { mode: 0o755 },
);
fs.writeFileSync(path.join(fake, "git"), "");
const plugHome = path.join(tmp, "plug-home");
const shellPath =
  process.platform === "win32"
    ? `${fake}${path.delimiter}${path.join(process.env.SystemRoot || "C:\\Windows", "System32")}`
    : `${fake}${path.delimiter}/bin${path.delimiter}/usr/bin`;
const plug = installWith(shellPath, plugHome, "--plugins", "yes");
const toldLines = () => fs.readFileSync(told, "utf8").trim().split("\n");
ok(
  "a missing plugin is installed and stays switched on",
  [
    plug.out.includes("plugin installed: claude-hud@claude-hud\n"),
    toldLines().some((l) => l.startsWith("plugin disable")),
  ],
  [true, false],
);
ok(
  "what was handled is on record",
  json(path.join(plugHome, ".claude", "setup-state.json")).plugins,
  ["claude-hud@claude-hud"],
);
// a stand-in claude command that reports claude-hud as already on the system
const hadFake = path.join(tmp, "fake-claude-had");
fs.mkdirSync(hadFake);
const hadTold = path.join(hadFake, "told.txt");
fs.writeFileSync(
  path.join(hadFake, "claude.mjs"),
  `import fs from "node:fs";
const a = process.argv.slice(2).join(" ");
fs.appendFileSync(${JSON.stringify(hadTold)}, a + "\\n");
if (a === "plugin list") console.log("Installed plugins:\\n  > claude-hud@claude-hud");
`,
);
fs.writeFileSync(
  path.join(hadFake, "claude.cmd"),
  `@"${process.execPath}" "%~dp0claude.mjs" %*\r\n`,
);
fs.writeFileSync(
  path.join(hadFake, "claude"),
  `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/claude.mjs" "$@"\n`,
  { mode: 0o755 },
);
fs.writeFileSync(path.join(hadFake, "git"), "");
const hadShellPath =
  process.platform === "win32"
    ? `${hadFake}${path.delimiter}${path.join(process.env.SystemRoot || "C:\\Windows", "System32")}`
    : `${hadFake}${path.delimiter}/bin${path.delimiter}/usr/bin`;
const hadTold2 = () => fs.readFileSync(hadTold, "utf8").trim().split("\n");
const had = installWith(
  hadShellPath,
  path.join(tmp, "plug-had-home"),
  "--plugins",
  "yes",
);
ok(
  "one that is there already is left as it is",
  [
    had.out.includes("plugin already there: claude-hud@claude-hud"),
    hadTold2().some((l) => l.startsWith("plugin install")),
  ],
  [true, false],
);
// a stand-in claude command whose install always fails, to check the failure is named and retried
const failFake = path.join(tmp, "fake-claude-fail");
fs.mkdirSync(failFake);
const failTold = path.join(failFake, "told.txt");
fs.writeFileSync(
  path.join(failFake, "claude.mjs"),
  `import fs from "node:fs";
const a = process.argv.slice(2).join(" ");
fs.appendFileSync(${JSON.stringify(failTold)}, a + "\\n");
if (a === "plugin list") console.log("Installed plugins:\\n  (none)");
if (a === "plugin install claude-hud@claude-hud") { console.error("no network"); process.exit(1); }
`,
);
fs.writeFileSync(
  path.join(failFake, "claude.cmd"),
  `@"${process.execPath}" "%~dp0claude.mjs" %*\r\n`,
);
fs.writeFileSync(
  path.join(failFake, "claude"),
  `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/claude.mjs" "$@"\n`,
  { mode: 0o755 },
);
fs.writeFileSync(path.join(failFake, "git"), "");
const failShellPath =
  process.platform === "win32"
    ? `${failFake}${path.delimiter}${path.join(process.env.SystemRoot || "C:\\Windows", "System32")}`
    : `${failFake}${path.delimiter}/bin${path.delimiter}/usr/bin`;
const failHome = path.join(tmp, "plug-fail-home");
const failed = installWith(failShellPath, failHome, "--plugins", "yes");
ok(
  "one that fails is named and the install goes on",
  [
    /plugin failed: claude-hud@claude-hud \(no network\)/.test(failed.out),
    failed.code,
  ],
  [true, 0],
);
ok(
  "a failed plugin is not on record",
  "plugins" in json(path.join(failHome, ".claude", "setup-state.json")),
  false,
);
const failToldLines = () =>
  fs.readFileSync(failTold, "utf8").trim().split("\n");
fs.writeFileSync(failTold, "");
installWith(failShellPath, failHome, "--plugins", "yes");
ok(
  "the next run retries the one that failed",
  failToldLines().filter((l) => l.startsWith("plugin install")),
  ["plugin install claude-hud@claude-hud"],
);
ok(
  "without the claude command the run says so",
  installWith(
    emptyPath,
    path.join(tmp, "no-claude"),
    "--plugins",
    "yes",
  ).out.includes(
    "plugins not installed: the claude command is not on the PATH",
  ),
);

// ---- add-ons: left out of a default install, --with adds them, an existing copy stays, bad names fail
const addonDefault = path.join(tmp, "addon-default");
install(addonDefault);
ok(
  "a default install leaves out the add-on skill, and says so",
  [
    fs.existsSync(path.join(addonDefault, ".claude", "skills", "phone-bot")),
    install(addonDefault).out.includes(
      "add-on left out: phone-bot (add it with --with phone-bot)",
    ),
  ],
  [false, true],
);
const addonWith = path.join(tmp, "addon-with");
install(addonWith, "--with", "phone-bot");
ok(
  "--with adds the add-on asked for",
  fs
    .readFileSync(
      path.join(addonWith, ".claude", "skills", "phone-bot", "SKILL.md"),
    )
    .equals(
      fs.readFileSync(path.join(REPO, "skills", "phone-bot", "SKILL.md")),
    ),
);
// the phone app's PC program imports ../../../../phone/shared/seal.mjs, so that folder goes with the add-on
const phoneIn = (home, ...p) =>
  fs.existsSync(path.join(home, ".claude", "phone", ...p));
ok(
  "phone-bot brings phone/shared and nothing else of phone/; a default install has no phone folder",
  [
    fs
      .readFileSync(
        path.join(addonWith, ".claude", "phone", "shared", "seal.mjs"),
      )
      .equals(fs.readFileSync(path.join(REPO, "phone", "shared", "seal.mjs"))),
    phoneIn(addonWith, "page"),
    phoneIn(addonWith, "relay"),
    phoneIn(addonWith, "README.md"),
    phoneIn(addonDefault),
  ],
  [true, false, false, false, false],
);
// the PC program reads its setup version from ~/.claude/version.json, so that file goes with the add-on only
const versionIn = (home) => path.join(home, ".claude", "version.json");
const repoVersion = fs.readFileSync(path.join(REPO, "version.json"));
ok(
  "phone-bot brings version.json, the same as the repo's; a default install has none",
  [
    fs.existsSync(versionIn(addonWith)) &&
      fs.readFileSync(versionIn(addonWith)).equals(repoVersion),
    fs.existsSync(versionIn(addonDefault)),
  ],
  [true, false],
);
// an older copy of the add-on, on record as the setup's own, which a plain run has to overwrite
const recordAs = (home, file, text) => {
  const statePath = path.join(home, ".claude", "setup-state.json");
  const s = json(statePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  s.files[fwd(file)] = crypto.createHash("sha256").update(text).digest("hex");
  fs.writeFileSync(statePath, JSON.stringify(s, null, 2));
};
const addonFile = path.join(
  addonWith,
  ".claude",
  "skills",
  "phone-bot",
  "SKILL.md",
);
recordAs(addonWith, addonFile, "an older version");
recordAs(addonWith, versionIn(addonWith), '{ "version": "0.0" }');
install(addonWith); // a plain run, no --with
ok(
  "a plain run keeps updating an add-on that is already there, and its version.json",
  [
    fs
      .readFileSync(addonFile)
      .equals(
        fs.readFileSync(path.join(REPO, "skills", "phone-bot", "SKILL.md")),
      ),
    fs.readFileSync(versionIn(addonWith)).equals(repoVersion),
  ],
  [true, true],
);
ok(
  "a plain run keeps phone/shared too, and --uninstall takes it and version.json out",
  [
    phoneIn(addonWith, "shared", "seal.mjs"),
    (install(addonWith, "--uninstall"), phoneIn(addonWith)),
    fs.existsSync(versionIn(addonWith)),
  ],
  [true, false, false],
);
ok(
  "--with and no name fails, naming the add-ons",
  [
    install(path.join(tmp, "addon-empty"), "--with").code,
    install(path.join(tmp, "addon-empty"), "--with").out.includes("phone-bot"),
  ],
  [1, true],
);
// ---- a file the repo stopped shipping goes on an update, unless the user changed it
const stopped = path.join(tmp, "stopped-shipping");
install(stopped);
const oldSkill = path.join(
  stopped,
  ".claude",
  "skills",
  "old-skill",
  "SKILL.md",
);
const oldHook = path.join(stopped, ".claude", "hooks", "old-hook.mjs");
recordAs(stopped, oldSkill, "shipped once");
recordAs(stopped, oldHook, "shipped once");
fs.writeFileSync(oldHook, "the user changed this");
const stoppedRun = install(stopped);
ok(
  "a file no longer shipped is removed with its empty folder, and off the record",
  [
    fs.existsSync(path.dirname(oldSkill)),
    stoppedRun.out.includes("no longer part of the setup"),
    fwd(oldSkill) in
      json(path.join(stopped, ".claude", "setup-state.json")).files,
  ],
  [false, true, false],
);
ok(
  "one the user changed stays",
  fs.readFileSync(oldHook, "utf8"),
  "the user changed this",
);
ok(
  "an unknown --with name fails with a clear error naming the valid ones",
  [
    install(path.join(tmp, "addon-bad"), "--with", "bogus").code,
    install(path.join(tmp, "addon-bad"), "--with", "bogus").out.includes(
      "phone-bot",
    ),
  ],
  [1, true],
);

// ---- the steps left for a chat are named by the first install only
ok(
  "the first install names the steps left for a chat",
  /Left for a chat, once.*steps 8 and 9/.test(plug.out),
);
ok(
  "a later run no longer names them, with nothing put on record",
  [
    install(plugHome).out.includes("Left for a chat"),
    "done" in json(path.join(plugHome, ".claude", "setup-state.json")),
  ],
  [false, false],
);
const marked = install(plugHome, "--done", "chat-steps");
ok(
  "--done from an older version's text still only puts them on record",
  [
    marked.out
      .split("\n")
      .filter((l) => !l.startsWith("Claude Code: version check skipped"))
      .join("\n")
      .trim(),
    json(path.join(plugHome, ".claude", "setup-state.json")).done,
  ],
  ["on record as done: chat-steps", ["chat-steps"]],
);

// ---- broken settings are left alone
const broken = path.join(tmp, "broken");
fs.mkdirSync(path.join(broken, ".claude"), { recursive: true });
fs.writeFileSync(path.join(broken, ".claude", "settings.json"), "{ not json");
ok(
  "settings that are not valid JSON stop the install",
  install(broken).code,
  1,
);
ok(
  "and nothing is changed or copied",
  [
    fs.readFileSync(path.join(broken, ".claude", "settings.json"), "utf8"),
    fs.readdirSync(path.join(broken, ".claude")),
  ],
  ["{ not json", ["settings.json"]],
);
const brokenHome = path.join(tmp, "broken-home");
fs.mkdirSync(path.join(brokenHome, "Projects", "quick-tasks", ".claude"), {
  recursive: true,
});
fs.writeFileSync(
  path.join(brokenHome, "Projects", "quick-tasks", ".claude", "settings.json"),
  "{ not json",
);
ok(
  "a project folder's settings that are not valid JSON stop it too, before anything is copied",
  [install(brokenHome).code, fs.existsSync(path.join(brokenHome, ".claude"))],
  [1, false],
);

// --node: the hooks are started with the Node given, by its full path
const nodeHome = path.join(tmp, "node-home");
install(nodeHome, "--node", process.execPath);
const withNode = [
  json(path.join(nodeHome, ".claude", "settings.json")),
  json(
    path.join(nodeHome, "Projects", "quick-tasks", ".claude", "settings.json"),
  ),
].flatMap(commandsIn);
ok(
  "--node starts every hook with that Node",
  withNode.filter((c) => !c.startsWith(`"${fwd(process.execPath)}" "`)),
  [],
);

ok(
  "--node is remembered for later runs",
  json(path.join(nodeHome, ".claude", "setup-state.json")).node,
  fwd(process.execPath),
);

// ---- the newer gates: an old settings file ends with each entry once, a second run adds nothing, --uninstall takes them out
// The five scripts and the dispatcher as wired (web-worker-gate and code-review-gate are retired, the second cut by
// plan 2.8: none of their entries may stay; verify-gate runs in the dispatcher's pre-tool and stop groups), each as
// [event, matcher, if, script and its arguments]
const GATES =
  /^(verify-gate|code-review-gate|nimbalyst-notes|opencli-readonly|web-worker-gate|dispatch)\.mjs/;
const gateShape = (s) =>
  Object.entries(s.hooks || {})
    .flatMap(([event, groups]) =>
      groups.flatMap((g) =>
        (g.hooks || []).map((h) => [
          event,
          g.matcher || "",
          h.if || "",
          h.command.replace(/^.*[\\/]([\w-]+\.mjs)"?\s*/, "$1 ").trim(),
        ]),
      ),
    )
    .filter((e) => GATES.test(e[3]))
    .map((e) => JSON.stringify(e))
    .sort();
const friend = path.join(tmp, "friend-wiring");
const friendCmd = (script, args = "") =>
  `node "${fwd(path.join(friend, ".claude", "hooks", script))}"${args}`;
fs.mkdirSync(path.join(friend, ".claude"), { recursive: true });
fs.writeFileSync(
  path.join(friend, ".claude", "settings.json"),
  JSON.stringify({
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: friendCmd("code-review-gate.mjs"),
              timeout: 10,
            },
          ],
        },
      ], // plain, in an event where --start belongs too
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: friendCmd("code-review-gate.mjs"),
              timeout: 10,
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "Bash|PowerShell",
          hooks: [
            {
              type: "command",
              command: friendCmd("opencli-readonly.mjs"),
              timeout: 15,
            },
            {
              type: "command",
              command: friendCmd("web-worker-gate.mjs"),
              timeout: 5,
            },
            {
              type: "command",
              command: "node /elsewhere/opencli-readonly.mjs",
            },
          ],
        },
      ],
    },
  }),
);
const wiredRun = install(friend);
const friendSettings = () =>
  json(path.join(friend, ".claude", "settings.json"));
const WANT = [
  ["SessionStart", "", "", "nimbalyst-notes.mjs"],
  // verify-gate plain and --pre: in the stop and pre-tool groups
  ["Stop", "", "", "dispatch.mjs stop"],
  ["PreToolUse", "", "", "dispatch.mjs pre-tool"],
  ["UserPromptSubmit", "", "", "dispatch.mjs prompt"],
  ["PreToolUse", "Bash|PowerShell", "", "opencli-readonly.mjs"], // the user's own, from another folder
  ["PreToolUse", "Bash|PowerShell", "Bash(*opencli*)", "opencli-readonly.mjs"],
  [
    "PreToolUse",
    "Bash|PowerShell",
    "PowerShell(*opencli*)",
    "opencli-readonly.mjs",
  ],
]
  .map((e) => JSON.stringify(e))
  .sort();
ok(
  "an old settings file gets each newer entry once: one dispatcher entry per group, the old unguarded handler is replaced, the retired web-worker-gate and code-review-gate go",
  gateShape(friendSettings()),
  WANT,
);
const quiet = path.join(tmp, "quiet-friend");
fs.mkdirSync(path.join(quiet, ".claude"), { recursive: true });
fs.writeFileSync(
  path.join(quiet, ".claude", "settings.json"),
  JSON.stringify({
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command:
                'node "' +
                fwd(path.join(quiet, ".claude", "hooks", "verify-gate.mjs")) +
                '" 2>/dev/null',
              timeout: 10,
            },
          ],
        },
      ],
    },
  }),
);
const quietRun = install(quiet);
// spec D18: no hook wired twice; steer and session-cleanup have side effects if run twice. So an entry the user
// added a redirect to goes too, once its hook runs in a group, and the update says its output is no longer hidden.
ok(
  "a hook the user added a redirect to is not wired a second time: its own entry goes, the stop group runs it",
  [
    json(path.join(quiet, ".claude", "settings.json"))
      .hooks.Stop.flatMap((g) => g.hooks)
      .filter((h) => h.command.includes("verify-gate.mjs")).length,
    /hook moved: Stop verify-gate\.mjs \(now run by dispatch\.mjs stop.*no longer hidden/.test(
      quietRun.out,
    ),
  ],
  [0, true],
);
// The dispatcher runs the groups file in ~/.claude, which an update keeps when the user changed it: a hook that
// file no longer lists in a group keeps its own entry, and the update says so
const edited = path.join(tmp, "edited-groups");
install(edited);
const editedClaude = path.join(edited, ".claude");
const editedGroupsFile = path.join(
  editedClaude,
  "hooks",
  "dispatch-groups.json",
);
const editedGroups = json(editedGroupsFile);
editedGroups["pre-tool"] = editedGroups["pre-tool"].filter(
  (e) => e.hook !== "hooks/session-cleanup.mjs",
);
fs.writeFileSync(editedGroupsFile, JSON.stringify(editedGroups, null, 2));
const editedSettingsFile = path.join(editedClaude, "settings.json");
const editedSettings = json(editedSettingsFile);
editedSettings.hooks.PreToolUse.push({
  matcher: "Bash|PowerShell",
  hooks: [
    {
      type: "command",
      command: `node "${fwd(path.join(editedClaude, "hooks", "session-cleanup.mjs"))}"`,
      timeout: 5,
    },
  ],
});
fs.writeFileSync(editedSettingsFile, JSON.stringify(editedSettings, null, 2));
const editedRun = install(edited);
ok(
  "a hook the installed groups file no longer lists keeps its own entry, and the update says so",
  [
    json(editedGroupsFile)["pre-tool"].some(
      (e) => e.hook === "hooks/session-cleanup.mjs",
    ),
    json(editedSettingsFile)
      .hooks.PreToolUse.flatMap((g) => g.hooks)
      .filter((h) => h.command.includes("session-cleanup.mjs")).length,
    /hook kept: PreToolUse session-cleanup\.mjs .*dispatch-groups\.json/.test(
      editedRun.out,
    ),
  ],
  [false, 1, true],
);
ok(
  "the handlers with an `if` carry the timeout of the example",
  friendSettings()
    .hooks.PreToolUse.flatMap((g) => g.hooks)
    .filter((h) => h.if)
    .map((h) => [
      h.if.startsWith("Bash(") || h.if.startsWith("PowerShell("),
      h.timeout,
    ]),
  [
    [true, 15],
    [true, 15],
  ],
); // opencli-readonly, Bash and PowerShell (job 9 D9: push-key-scan's two moved into the pre-tool dispatcher)
ok(
  "the run says it replaced the old handler and removed the retired one",
  [
    wiredRun.out.includes("hook replaced: PreToolUse opencli-readonly.mjs"),
    wiredRun.out.includes("hook removed: PreToolUse web-worker-gate.mjs"),
  ],
  [true, true],
);
const wiredBefore = fs.readFileSync(
  path.join(friend, ".claude", "settings.json"),
  "utf8",
);
const wiredAgain = install(friend);
ok(
  "a second run changes nothing in the settings and adds or replaces no hook",
  [
    fs.readFileSync(path.join(friend, ".claude", "settings.json"), "utf8") ===
      wiredBefore,
    /hook (added|replaced|repointed)/.test(wiredAgain.out),
  ],
  [true, false],
);
const unwired = install(friend, "--uninstall");
ok(
  "--uninstall takes all of them out and leaves the user's own",
  [unwired.code, gateShape(friendSettings())],
  [
    0,
    [
      JSON.stringify([
        "PreToolUse",
        "Bash|PowerShell",
        "",
        "opencli-readonly.mjs",
      ]),
    ],
  ],
);

// ---- guards wired before onFailure: an update makes them block on failure, a value the user set stays
// (planner-readonly left the settings, cut by plan 2.8: the agents run it from their own frontmatter)
// job 9 D9: this case used push-key-scan's Bash entry as the guard wired without onFailure; push-key-scan moved into
// the pre-tool dispatcher, so opencli-readonly's Bash entry plays that part and its PowerShell entry keeps the
// user's continue. It stays the one test of the onFailure update path.
const guarded = path.join(tmp, "guards-before-onfailure");
const guardCmd = (script) =>
  `node "${fwd(path.join(guarded, ".claude", "hooks", script))}"`;
fs.mkdirSync(path.join(guarded, ".claude"), { recursive: true });
fs.writeFileSync(
  path.join(guarded, ".claude", "settings.json"),
  JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash|PowerShell",
          hooks: [
            {
              type: "command",
              if: "Bash(*opencli*)",
              command: guardCmd("opencli-readonly.mjs"),
              timeout: 15,
            },
            {
              type: "command",
              if: "PowerShell(*opencli*)",
              command: guardCmd("opencli-readonly.mjs"),
              timeout: 15,
              onFailure: "continue",
            },
          ],
        },
      ],
    },
  }),
);
const guardRun = install(guarded);
const guardFails = () =>
  json(path.join(guarded, ".claude", "settings.json"))
    .hooks.PreToolUse.flatMap((g) => g.hooks)
    .filter((h) => /opencli-readonly\.mjs/.test(h.command))
    .map(
      (h) =>
        `${h.command.match(/([\w-]+)\.mjs/)[1]} ${h.if || ""} ${h.onFailure}`,
    )
    .sort();
ok(
  "an update sets onFailure block on the guards wired without it and keeps the user's continue",
  guardFails(),
  [
    "opencli-readonly Bash(*opencli*) block",
    "opencli-readonly PowerShell(*opencli*) continue",
  ],
);
ok(
  "the run names the guard it updated",
  (
    guardRun.out.match(
      /hook updated: PreToolUse [\w-]+\.mjs \(onFailure: block\)/g,
    ) || []
  ).sort(),
  ["hook updated: PreToolUse opencli-readonly.mjs (onFailure: block)"],
);
ok(
  "the run after it updates nothing",
  install(guarded).out.includes("hook updated"),
  false,
);

// job 9 D9: a settings.json from before push-key-scan moved into the pre-tool dispatcher still has its two standalone
// `if` entries; the update takes them out through the dispatcher entry's group-member drop (scripts/wiring.mjs), not
// through _setup.retiredEntries, so the push is scanned once, by the dispatcher
const pushOld = path.join(tmp, "push-key-scan-standalone");
const pushOldCmd = `node "${fwd(path.join(pushOld, ".claude", "hooks", "push-key-scan.mjs"))}"`;
fs.mkdirSync(path.join(pushOld, ".claude"), { recursive: true });
fs.writeFileSync(
  path.join(pushOld, ".claude", "settings.json"),
  JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash|PowerShell",
          hooks: ["Bash(*push*)", "PowerShell(*push*)"].map((cond) => ({
            type: "command",
            if: cond,
            command: pushOldCmd,
            timeout: 15,
            onFailure: "block",
          })),
        },
      ],
    },
  }),
);
const pushOldRun = install(pushOld);
ok(
  "job 9 D9 an update drops the standalone push-key-scan entries, says it moved into dispatch.mjs pre-tool, and retiredEntries does not name it",
  [
    pushOldRun.code,
    json(path.join(pushOld, ".claude", "settings.json"))
      .hooks.PreToolUse.flatMap((g) => g.hooks)
      .filter((h) => h.command.includes("push-key-scan.mjs")).length,
    /hook moved: PreToolUse push-key-scan\.mjs \(now run by dispatch\.mjs pre-tool/.test(
      pushOldRun.out,
    ),
    Object.values(example._setup?.retiredEntries ?? {})
      .flat()
      .some((n) => n.startsWith("push-key-scan")),
  ],
  [0, 0, true, false],
);

// ---- skills the setup retired go on an update, one line each; one the user changed stays and is named
const retiredHome = path.join(tmp, "retired-skills");
install(retiredHome);
const retiredSkills = path.join(retiredHome, ".claude", "skills");
const retiredProject = path.join(
  retiredHome,
  "Projects",
  "claude-settings",
  ".claude",
  "skills",
);
for (const [file, text] of [
  [
    path.join(retiredSkills, "usage-report", "SKILL.md"),
    "an older usage report",
  ],
  [
    path.join(retiredSkills, "usage-report", "scripts", "scan.mjs"),
    "an older script",
  ],
  [path.join(retiredSkills, "project-scan", "SKILL.md"), "an older scan"],
  [path.join(retiredSkills, "court", "SKILL.md"), "an older court"],
  [path.join(retiredSkills, "court", "roles.md"), "older seats"],
  [
    path.join(retiredProject, "chat-review", "SKILL.md"),
    "an older chat review",
  ],
  [
    path.join(retiredProject, "full-review", "SKILL.md"),
    "an older full review",
  ],
])
  recordAs(retiredHome, file, text);
fs.appendFileSync(
  path.join(retiredSkills, "project-scan", "SKILL.md"),
  "\nmy own line\n",
);
const retiredRun = install(retiredHome);
const removedLines = retiredRun.out
  .split("\n")
  .filter((l) => l.startsWith("removed the retired skill"));
ok(
  "the five retired skills are gone from the friend's skills and from the claude-settings project, except the one file the user changed",
  [
    ["usage-report", "court", "chat-review", "full-review"].map((n) =>
      fs.existsSync(
        path.join(
          n === "chat-review" || n === "full-review"
            ? retiredProject
            : retiredSkills,
          n,
        ),
      ),
    ),
    fs
      .readFileSync(
        path.join(retiredSkills, "project-scan", "SKILL.md"),
        "utf8",
      )
      .endsWith("my own line\n"),
  ],
  [[false, false, false, false], true],
);
ok(
  "each removal is one line that names the skill and where it went",
  [
    removedLines.length,
    removedLines.some((l) =>
      l.includes("skills/usage-report (2 files; it is now /setup-audit usage)"),
    ),
    removedLines.some(
      (l) => l.includes("chat-review") && l.includes("/setup-audit chat"),
    ),
    removedLines.some(
      (l) => l.includes("full-review") && l.includes("/setup-audit full"),
    ),
    removedLines.some((l) =>
      l.includes("skills/court (2 files; the setup no longer has it)"),
    ),
  ],
  [4, true, true, true, true],
);
ok(
  "the one the user changed is kept and listed, and the setup's own skills stay",
  [
    retiredRun.out.includes(
      `kept yours ${fwd(path.join(retiredSkills, "project-scan", "SKILL.md"))} (a retired skill`,
    ),
    fs.existsSync(path.join(retiredSkills, "setup-audit", "SKILL.md")),
  ],
  [true, true],
);
ok(
  "the run after it removes no skill",
  install(retiredHome).out.includes("removed the retired skill"),
  false,
);
// /blind-screen-review: its rubric moved into the blind-reviewer agent, and an update takes the old folder out
const blindSkill = path.join(retiredSkills, "blind-screen-review");
recordAs(
  retiredHome,
  path.join(blindSkill, "SKILL.md"),
  "an older screen review",
);
recordAs(retiredHome, path.join(blindSkill, "rubric.md"), "an older rubric");
const blindRun = install(retiredHome);
ok(
  "an update removes the blind-screen-review folder and names the blind-reviewer agent",
  [
    fs.existsSync(blindSkill),
    blindRun.out.includes(
      "skills/blind-screen-review (2 files; it is now the blind-reviewer agent)",
    ),
  ],
  [false, true],
);
// The hooks cut: a cut hook and the two libraries that moved out of hooks/lib/ (to skills/update-project/ and
// scripts/) go on an update, as files an earlier version wrote and this one no longer ships
const libGoneHooks = path.join(retiredHome, ".claude", "hooks");
const libGoneFiles = [
  path.join(libGoneHooks, "lib", "upkeep-checks.mjs"),
  path.join(libGoneHooks, "lib", "commit-subject.mjs"),
  path.join(libGoneHooks, "context-guard.mjs"),
];
for (const f of libGoneFiles) recordAs(retiredHome, f, "an older hook file");
const libGoneRun = install(retiredHome);
ok(
  "an update removes the moved hooks/lib files and a cut hook, naming each",
  libGoneFiles.flatMap((f) => [
    fs.existsSync(f),
    libGoneRun.out.includes(`removed ${fwd(f)} (no longer part of the setup)`),
  ]),
  [false, true, false, true, false, true],
);

// ---- the retired add-on /shared-usage: its files go on an update, a changed one stays and is named, and the
// start-at-log-on files its logon-start.mjs wrote go when still as written; another file of that name stays
const sharedHome = path.join(tmp, "retired-shared-usage");
install(sharedHome);
const sharedSkill = path.join(sharedHome, ".claude", "skills", "shared-usage");
const sharedScript = path.join(
  sharedHome,
  ".claude",
  "skills",
  "setup-audit",
  "scripts",
  "shared-usage.mjs",
);
for (const [file, text] of [
  [path.join(sharedSkill, "SKILL.md"), "an older shared usage"],
  [path.join(sharedSkill, "logon-start.mjs"), "an older logon start"],
  [sharedScript, "an older shared usage script"],
])
  recordAs(sharedHome, file, text);
fs.appendFileSync(path.join(sharedSkill, "SKILL.md"), "\nmy own line\n");
const ccpoolVbs = path.join(
  sharedHome,
  "AppData",
  "Roaming",
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "Startup",
  "ccpool.vbs",
);
const ccpoolPlist = path.join(
  sharedHome,
  "Library",
  "LaunchAgents",
  "com.ai-coding-setup.ccpool.plist",
);
fs.mkdirSync(path.dirname(ccpoolVbs), { recursive: true });
fs.writeFileSync(
  ccpoolVbs,
  `CreateObject("WScript.Shell").Run "cmd /c ccpool daemon start", 0, False\r\n`,
);
fs.mkdirSync(path.dirname(ccpoolPlist), { recursive: true });
fs.writeFileSync(
  ccpoolPlist,
  '<plist version="1.0">\n<dict>\n  <key>Label</key><string>com.ai-coding-setup.ccpool</string>\n</dict>\n</plist>\n',
);
const sharedRun = install(sharedHome);
ok(
  "an update takes out the files /shared-usage had and keeps the one the user changed, naming it",
  [
    fs.existsSync(path.join(sharedSkill, "logon-start.mjs")),
    fs.existsSync(sharedScript),
    fs
      .readFileSync(path.join(sharedSkill, "SKILL.md"), "utf8")
      .endsWith("my own line\n"),
    sharedRun.out.includes(
      `kept yours ${fwd(path.join(sharedSkill, "SKILL.md"))} (a retired skill`,
    ),
    sharedRun.out.includes(
      `removed ${fwd(sharedScript)} (no longer part of the setup)`,
    ),
  ],
  [false, false, true, true, true],
);
ok(
  "it removes the start at log-on that /shared-usage wrote, Windows and macOS, and names each",
  [
    fs.existsSync(ccpoolVbs),
    fs.existsSync(ccpoolPlist),
    sharedRun.out.includes(`removed ${fwd(ccpoolVbs)} (the start at log-on`),
    sharedRun.out.includes(`removed ${fwd(ccpoolPlist)} (the start at log-on`),
  ],
  [false, false, true, true],
);
fs.writeFileSync(ccpoolVbs, "my own start line\r\n");
ok(
  "a ccpool.vbs the setup did not write stays, and the run after it removes nothing",
  [install(sharedHome).out.includes("removed"), fs.existsSync(ccpoolVbs)],
  [false, true],
);

// ---- Git Bash on Windows: without it every guard fails, and the install says so
const bashOf = (...p) => {
  const f = path.join(tmp, "gitbash", ...p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, "");
  return f;
};
const noBashHome = path.join(tmp, "no-bash-home");
const bare = path.join(tmp, "no-git"); // stands in for Program Files and the local programs folder
fs.mkdirSync(bare);
// Windows names are not case sensitive but this object's keys are (PROGRAMFILES and ProgramFiles would both reach the child)
const without = (names) =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !names.includes(k.toLowerCase()),
    ),
  );
const withEnv = (home, extra = {}, PATH = emptyPath) =>
  spawnSync(process.execPath, [INSTALL, "--home", home, "--dry-run"], {
    encoding: "utf8",
    env: {
      ...without([
        "path",
        "programfiles",
        "programfiles(x86)",
        "programw6432",
        "localappdata",
        "claude_code_git_bash_path",
      ]),
      PATH,
      ProgramFiles: bare,
      "ProgramFiles(x86)": bare,
      ProgramW6432: bare,
      LOCALAPPDATA: bare,
      CLAUDE_CODE_GIT_BASH_PATH: "",
      ...extra,
    },
  }).stdout;
const MISSING = "Git Bash was not found";
if (process.platform === "win32") {
  const missing = withEnv(noBashHome);
  ok(
    "without Git Bash the install says so plainly, with the two ways to fix it, at the start and again at the end",
    [
      missing.split(MISSING).length - 1,
      missing.includes("every guard of this setup fails"),
      missing.includes("git-scm.com"),
      missing.includes("CLAUDE_CODE_GIT_BASH_PATH"),
    ],
    [2, true, true, true],
  );
  ok(
    "the install goes on after that",
    missing.includes("Nothing was changed."),
  );
  ok(
    "a bash.exe named in CLAUDE_CODE_GIT_BASH_PATH counts",
    withEnv(noBashHome, {
      CLAUDE_CODE_GIT_BASH_PATH: bashOf("custom", "bash.exe"),
    }).includes(MISSING),
    false,
  );
  fs.mkdirSync(path.join(tmp, "bash-in-settings", ".claude"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(tmp, "bash-in-settings", ".claude", "settings.json"),
    JSON.stringify({
      env: { CLAUDE_CODE_GIT_BASH_PATH: bashOf("fromsettings", "bash.exe") },
    }),
  );
  ok(
    "so does one named in the env of settings.json",
    withEnv(path.join(tmp, "bash-in-settings")).includes(MISSING),
    false,
  );
  bashOf("fakepf", "Git", "bin", "bash.exe"); // Windows gives a 64-bit process ProgramFiles from ProgramW6432, so that one is faked
  ok(
    "so does Git in Program Files",
    withEnv(noBashHome, {
      ProgramW6432: path.join(tmp, "gitbash", "fakepf"),
    }).includes(MISSING),
    false,
  );
  fs.mkdirSync(path.join(tmp, "gitbash", "onpath", "Git", "cmd"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(tmp, "gitbash", "onpath", "Git", "cmd", "git.exe"),
    "",
  );
  bashOf("onpath", "Git", "bin", "bash.exe");
  ok(
    "so does a git.exe on the PATH with its bash.exe next to it",
    withEnv(
      noBashHome,
      {},
      path.join(tmp, "gitbash", "onpath", "Git", "cmd"),
    ).includes(MISSING),
    false,
  );
} else {
  ok(
    "off Windows Git Bash is not asked for",
    withEnv(noBashHome).includes(MISSING),
    false,
  );
}

// ---- Node: below 18 the install refuses; below 22.5 it says which parts stay off
const atNode = (v) =>
  spawnSync(
    process.execPath,
    [INSTALL, "--home", path.join(tmp, "node-version"), "--dry-run"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: emptyPath,
        Path: emptyPath,
        SETUP_NODE_VERSION: v,
      },
    },
  );
const node16 = atNode("16.20.0");
ok(
  "Node 16 is refused with the version",
  [node16.status, node16.stdout.trim()],
  [1, "Node.js 18 or newer is needed; this is v16.20.0."],
);
const node20 = atNode("20.11.0");
ok(
  "Node 20 installs and the run names the three parts that need 22.5",
  [
    node20.status,
    node20.stdout.includes("older than 22.5"),
    node20.stdout.includes("skills/steer"),
    node20.stdout.includes("compact-self"),
    node20.stdout.includes("usage dashboard"),
  ],
  [0, true, true, true, true],
);
ok(
  "Node 22.4 still says it",
  atNode("22.4.1").stdout.includes("older than 22.5"),
);
ok(
  "Node 22.5 and 24 say nothing about it",
  [
    atNode("22.5.0").stdout.includes("older than 22.5"),
    atNode("24.1.0").stdout.includes("older than 22.5"),
  ],
  [false, false],
);

// ---- a run that stops part way leaves the old record, says so, and running it again finishes the job
const stops = path.join(tmp, "stops");
install(stops);
const stopsState = path.join(stops, ".claude", "setup-state.json");
const asOld = { ...json(stopsState), version: "1.0.70" };
fs.writeFileSync(stopsState, JSON.stringify(asOld));
const stopsNotes = path.join(stops, "Projects", "quick-tasks", "CLAUDE.md");
fs.rmSync(stopsNotes);
fs.mkdirSync(stopsNotes); // a folder where a file belongs: the run fails in the middle of the project folders
const halted = install(stops);
ok(
  "a run that fails part way exits with an error, says what happened and that running again is safe",
  [
    halted.code,
    halted.out.includes("The install stopped part way:"),
    halted.out.includes("still says version 1.0.70"),
    halted.out.includes("running it again is safe"),
  ],
  [1, true, true, true],
);
ok(
  "and the old record is exactly as it was",
  fs.readFileSync(stopsState, "utf8"),
  JSON.stringify(asOld),
);
fs.rmSync(stopsNotes, { recursive: true });
const finished = install(stops);
ok(
  "running it again finishes and records the new version",
  [finished.code, json(stopsState).version, fs.existsSync(stopsNotes)],
  [0, json(path.join(REPO, "version.json")).version, true],
);

// ---- an old install with "model": "sonnet" from the old installer moves to opus at medium effort
const modelHome = (name, version, own) => {
  const h = path.join(tmp, name);
  install(h);
  const st = path.join(h, ".claude", "setup-state.json");
  fs.writeFileSync(st, JSON.stringify({ ...json(st), version }));
  const sf = path.join(h, ".claude", "settings.json");
  const s = json(sf);
  delete s.model;
  delete s.modelSettings;
  fs.writeFileSync(sf, JSON.stringify({ ...s, ...own }));
  return {
    h,
    st: () => json(st),
    s: () => json(sf),
    setVersion: (v) =>
      fs.writeFileSync(st, JSON.stringify({ ...json(st), version: v })),
  };
};
const oldSonnet = modelHome("model-old", "1.0.70", { model: "sonnet" });
const movedModel = install(oldSonnet.h);
ok(
  "version 1.0.70 with sonnet moves to opus at medium effort, and the run says so loudly with the undo",
  [
    oldSonnet.s().model,
    oldSonnet.s().modelSettings,
    oldSonnet.st().model,
    movedModel.out.includes("MODEL CHANGED"),
    movedModel.out.includes(
      `install.mjs" --keep-model --home "${fwd(oldSonnet.h)}"`,
    ),
  ],
  [
    "opus",
    {
      "claude-opus-5": { effortLevel: "medium" },
      "claude-opus-5-5": { effortLevel: "medium" },
    },
    "moved",
    true,
    true,
  ],
);
ok(
  "it stays opus on the next run, which says nothing about it",
  [install(oldSonnet.h).out.includes("MODEL CHANGED"), oldSonnet.s().model],
  [false, "opus"],
);
const undone = install(oldSonnet.h, "--keep-model");
ok(
  "--keep-model after the move is the undo: sonnet is back, with the effort settings the move added gone, and it is on record",
  [
    oldSonnet.s().model,
    "modelSettings" in oldSonnet.s(),
    oldSonnet.st().model,
    undone.out.includes("sonnet is back"),
  ],
  ["sonnet", false, "kept", true],
);
oldSonnet.setVersion("1.0.70");
install(oldSonnet.h);
ok(
  "and later runs keep it, even on a record that looks old",
  oldSonnet.s().model,
  "sonnet",
);
const lastSonnet = modelHome("model-last", "1.0.74", { model: "sonnet" });
const movedLast = install(lastSonnet.h);
ok(
  "version 1.0.74 with sonnet moves too: its installer kept what an older one set, and the undo is printed",
  [lastSonnet.s().model, movedLast.out.includes("MODEL CHANGED")],
  ["opus", true],
);
const newSonnet = modelHome("model-new", "1.0.75", { model: "sonnet" });
const keptNew = install(newSonnet.h);
ok(
  "version 1.0.75 with sonnet is kept: a person chose it",
  [
    newSonnet.s().model,
    "modelSettings" in newSonnet.s(),
    keptNew.out.includes("MODEL CHANGED"),
  ],
  ["sonnet", false, false],
);
const noRecord = modelHome("model-none", "1.0.75", { model: "opus" });
ok(
  "--keep-model with no move on record says so",
  install(noRecord.h, "--keep-model").out.includes("found no move on record"),
  true,
);
const keepFlag = modelHome("model-keep", "1.0.70", { model: "sonnet" });
const keptFlag = install(keepFlag.h, "--keep-model");
ok(
  "1.0.70 with --keep-model keeps sonnet and puts the choice on record",
  [
    keepFlag.s().model,
    keepFlag.st().model,
    keptFlag.out.includes("MODEL CHANGED"),
  ],
  ["sonnet", "kept", false],
);
keepFlag.setVersion("1.0.70");
install(keepFlag.h);
ok("and a later run without the flag keeps it", keepFlag.s().model, "sonnet");
const otherModel = modelHome("model-other", "1.0.70", { model: "haiku" });
const keptOther = install(otherModel.h);
ok(
  "a friend on another model keeps it",
  [
    otherModel.s().model,
    "modelSettings" in otherModel.s(),
    keptOther.out.includes("MODEL CHANGED"),
  ],
  ["haiku", false, false],
);
const customSonnet = modelHome("model-custom", "1.0.70", {
  model: "sonnet",
  modelSettings: { "claude-sonnet-5": { effortLevel: "high" } },
});
install(customSonnet.h);
ok(
  "sonnet with model settings of their own is kept",
  customSonnet.s().model,
  "sonnet",
);

// ---- an install from the layout before the merge (ask-anything and internet-search beside quick-tasks), then updated:
// nothing in the old folders is deleted, the person's notes are copied into quick-tasks, the setup lets the folders go
const oldLayout = path.join(tmp, "old-layout");
install(oldLayout);
const olp = path.join(oldLayout, "Projects");
const olState = path.join(oldLayout, ".claude", "setup-state.json");
const qt = path.join(olp, "quick-tasks");
const isDir = path.join(olp, "internet-search");
const aaDir = path.join(olp, "ask-anything");
// quick-tasks had no hunt notes then, and ran on sonnet
fs.rmSync(path.join(qt, "profile.md"));
fs.rmSync(path.join(qt, "finds"), { recursive: true });
const qtSettings = path.join(qt, ".claude", "settings.json");
fs.writeFileSync(
  qtSettings,
  JSON.stringify({ ...json(qtSettings), model: "sonnet" }),
);
const oldFiles = {
  [path.join(isDir, "CLAUDE.md")]:
    "# internet-search\n\nNotes an older version wrote.\n",
  [path.join(isDir, "profile.md")]:
    "# Profile for hunts\n\n- **Country:** somewhere\n",
  [path.join(isDir, "finds", "INDEX.md")]: "# Finds\n\n- a bike\n",
  [path.join(isDir, "finds", "2026-01-02-bike.md")]: "A bike, found.\n",
  [path.join(isDir, "tools", "peek.mjs")]: "// the tool of an older version\n",
  [path.join(isDir, ".claude", "settings.json")]: '{ "model": "sonnet" }\n',
  [path.join(aaDir, "CLAUDE.md")]:
    "# ask-anything\n\nNotes an older version wrote, and a line of my own.\n",
  [path.join(aaDir, "answers", "2026-01-03-tides.md")]: "Why tides happen.\n",
};
for (const [f, body] of Object.entries(oldFiles)) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
}
const isNotes = path.join(isDir, "CLAUDE.md");
const ol = json(olState);
delete ol.homeModel;
ol.written[fwd(isNotes)] = sha(oldFiles[isNotes]);
ol.written[fwd(path.join(aaDir, "CLAUDE.md"))] = sha(
  "# ask-anything\n\nNotes an older version wrote.\n",
); // the person added a line since
ol.files[fwd(path.join(isDir, "tools", "peek.mjs"))] = sha(
  oldFiles[path.join(isDir, "tools", "peek.mjs")],
);
fs.writeFileSync(olState, JSON.stringify(ol));
const olBefore = snap(olp);
const olDry = install(oldLayout, "--dry-run");
ok(
  "old layout, dry run: says what it would do and changes nothing",
  [
    olDry.out.includes(`${fwd(isDir)} is no longer part of the setup`),
    olDry.out.includes(`copied ${fwd(path.join(qt, "profile.md"))}`),
    JSON.stringify(snap(olp)) === JSON.stringify(olBefore),
  ],
  [true, true, true],
);
const olRun = install(oldLayout);
const olNow = (f) => fs.readFileSync(f, "utf8");
ok(
  "old layout, update: both old folders keep every file, only the setup's CLAUDE.md changed",
  Object.keys(oldFiles).filter(
    (f) => !fs.existsSync(f) || (f !== isNotes && olNow(f) !== oldFiles[f]),
  ),
  [],
);
ok(
  "old layout, update: the person's profile, finds and answers are copied into quick-tasks",
  [
    olNow(path.join(qt, "profile.md")),
    olNow(path.join(qt, "finds", "INDEX.md")),
    olNow(path.join(qt, "finds", "2026-01-02-bike.md")),
    olNow(path.join(qt, "answers", "2026-01-03-tides.md")),
  ],
  [
    oldFiles[path.join(isDir, "profile.md")],
    oldFiles[path.join(isDir, "finds", "INDEX.md")],
    "A bike, found.\n",
    "Why tides happen.\n",
  ],
);
ok(
  "old layout, update: the CLAUDE.md the setup wrote is the moved note, with a dated copy",
  [
    olNow(isNotes),
    copyOf(oldLayout, isNotes) && olNow(copyOf(oldLayout, isNotes)),
  ],
  [
    `# internet-search (moved)\n\nThis folder was merged into \`${qt}\`. Your files and chats here stay. Start new work there.\n`,
    oldFiles[isNotes],
  ],
);
ok(
  "old layout, update: a CLAUDE.md the person changed is kept, and the run says so",
  [
    olNow(path.join(aaDir, "CLAUDE.md")),
    olRun.out.includes(`kept yours ${fwd(path.join(aaDir, "CLAUDE.md"))}`),
  ],
  [oldFiles[path.join(aaDir, "CLAUDE.md")], true],
);
ok(
  "old layout, update: one line for each old folder, and the record no longer names them",
  [
    [isDir, aaDir].every((d) =>
      olRun.out.includes(
        `${fwd(d)} is no longer part of the setup: its files and chats stay`,
      ),
    ),
    [
      ...Object.keys(json(olState).written),
      ...Object.keys(json(olState).files),
    ].some(
      (k) => k.startsWith(fwd(isDir) + "/") || k.startsWith(fwd(aaDir) + "/"),
    ),
  ],
  [true, false],
);
ok(
  "old layout, update: Quick Tasks moves from sonnet to opus once, on record, and the run names the flag",
  [
    json(qtSettings).model,
    json(olState).homeModel,
    olRun.out.includes("MODEL CHANGED in quick-tasks"),
    olRun.out.includes(
      `install.mjs" --keep-home-model --home "${fwd(oldLayout)}"`,
    ),
  ],
  ["opus", { "quick-tasks": "moved" }, true, true],
);
{
  // scripts/setup-state.mjs names every field of setup-state.json (STATE_KEYS)
  const { STATE_KEYS } = await import(
    pathToFileURL(path.join(REPO, "scripts", "setup-state.mjs")).href
  );
  ok(
    "every field install.mjs writes to setup-state.json (homeModel, boardTidyKeep too) is listed in STATE_KEYS",
    Object.keys(json(olState)).filter((k) => !STATE_KEYS.includes(k)),
    [],
  );
}
const olAfter = snap(olp);
const olAgain = install(oldLayout);
ok(
  "old layout, the run after: prints no change and changes no file",
  [
    CHANGED.test(olAgain.out),
    olAgain.out.includes("no longer part of the setup"),
    olAgain.out.includes("MODEL CHANGED"),
    JSON.stringify(snap(olp)) === JSON.stringify(olAfter),
  ],
  [false, false, false, true],
);
fs.writeFileSync(
  qtSettings,
  JSON.stringify({ ...json(qtSettings), model: "sonnet" }),
);
install(oldLayout);
ok(
  "old layout: a person who sets sonnet again after the move keeps it",
  json(qtSettings).model,
  "sonnet",
);
fs.writeFileSync(
  qtSettings,
  JSON.stringify({ ...json(qtSettings), model: "opus" }),
);
const homeUndo = install(oldLayout, "--keep-home-model");
ok(
  "--keep-home-model after the move puts sonnet back and is on record",
  [
    json(qtSettings).model,
    json(olState).homeModel["quick-tasks"],
    homeUndo.out.includes("sonnet is back"),
  ],
  ["sonnet", "kept", true],
);

// ---- --keep-home-model before the move: Quick Tasks stays on sonnet, and the global model is left as it was, also
// where the global move is on record (--keep-model would put sonnet back there)
const keepHome = modelHome("home-model-keep", "1.0.80", { model: "opus" });
const khState = path.join(keepHome.h, ".claude", "setup-state.json");
const { homeModel: _drop, ...khRecord } = json(khState);
fs.writeFileSync(khState, JSON.stringify({ ...khRecord, model: "moved" }));
const khSettings = path.join(
  keepHome.h,
  "Projects",
  "quick-tasks",
  ".claude",
  "settings.json",
);
fs.writeFileSync(
  khSettings,
  JSON.stringify({ ...json(khSettings), model: "sonnet" }),
);
const khRun = install(keepHome.h, "--keep-home-model");
ok(
  "--keep-home-model keeps Quick Tasks on sonnet and puts the choice on record",
  [
    json(khSettings).model,
    keepHome.st().homeModel,
    khRun.out.includes("MODEL CHANGED"),
  ],
  ["sonnet", { "quick-tasks": "kept" }, false],
);
ok(
  "--keep-home-model leaves the global model and its record as they were",
  [keepHome.s().model, keepHome.st().model],
  ["opus", "moved"],
);
install(keepHome.h);
ok(
  "and a later run without the flag keeps Quick Tasks on sonnet",
  json(khSettings).model,
  "sonnet",
);

// ---- every run ends with the list of what is the user's and on an older version, each with a line that takes the setup's
const yoursHome = path.join(tmp, "yours");
install(yoursHome);
const yoursPeek = path.join(
  yoursHome,
  "Projects",
  "quick-tasks",
  "tools",
  "peek.mjs",
);
fs.appendFileSync(
  path.join(yoursHome, ".claude", "hooks", "sql-guard.mjs"),
  "\n// my change\n",
);
fs.appendFileSync(yoursPeek, "\n// my change\n");
fs.appendFileSync(
  path.join(yoursHome, ".claude", "CLAUDE.md"),
  "\n# My own rules\n\n- Mine too.\n",
);
const closing = install(yoursHome);
const closingLines = closing.out.split("\n").filter(Boolean);
const closingAt = closingLines.findIndex((l) =>
  l.startsWith("Yours, on old versions"),
);
const closingList = closingLines.slice(closingAt + 1);
ok(
  "the run ends with the list, a line for each file and one for all, and no rules line (the rules were carved)",
  [
    closingAt >= 0,
    closingList.length,
    closingList.every((l) => l.startsWith("  ")),
    closingList.some(
      (l) =>
        l.startsWith("  hooks/sql-guard.mjs: node ") &&
        l.includes(" --replace hooks/sql-guard.mjs --home "),
    ),
    closingList.some(
      (l) =>
        l.startsWith(`  ${fwd(yoursPeek)}: node `) &&
        l.includes(` --replace ${fwd(yoursPeek)} --home `),
    ),
    closingList.some((l) => l.includes("rules")),
    closingList.some(
      (l) =>
        l.startsWith("  all of them at once: node ") &&
        l.includes(" --replace-all --home "),
    ),
  ],
  [true, 3, true, true, true, false, true],
);
// the printed lines are run as they stand, with a PATH that has Node and nothing else, so no worker is found
const nodeOnly = path.dirname(process.execPath);
const runPrinted = (line) =>
  spawnSync(line.slice(line.indexOf(": node ") + 2), {
    shell: true,
    encoding: "utf8",
    env: { ...process.env, PATH: nodeOnly, Path: nodeOnly },
  });
const printed = closingList.filter(
  (l) => l.includes(": node ") && !l.includes("--replace-all"),
);
const ran = printed.map(runPrinted);
ok(
  "every printed line runs and takes the setup's version",
  [
    ran.map((r) => r.status),
    fs
      .readFileSync(path.join(yoursHome, ".claude", "hooks", "sql-guard.mjs"))
      .equals(fs.readFileSync(path.join(REPO, "hooks", "sql-guard.mjs"))),
    fs
      .readFileSync(yoursPeek)
      .equals(
        fs.readFileSync(
          path.join(REPO, "projects", "quick-tasks", "tools", "peek.mjs"),
        ),
      ),
    fs.readFileSync(
      path.join(yoursHome, ".claude", "rules", "my-rules.md"),
      "utf8",
    ),
  ],
  [[0, 0], true, true, "## My own rules\n\n- Mine too.\n"],
);
ok(
  "the run after that has nothing to list",
  install(yoursHome).out.includes("Yours, on old versions"),
  false,
);

// The theme: Ink Cobalt only where nobody picked one (no key, or the app's default "system")
const themeHome = path.join(tmp, "theme-home");
const appAt = (name, data) => {
  const f = path.join(tmp, `${name}.json`);
  if (data !== undefined) fs.writeFileSync(f, JSON.stringify(data));
  return f;
};
const themed = (file, ...flags) => ({
  out: install(themeHome, "--app-settings", file, ...flags).out,
  s: fs.existsSync(file) ? json(file) : null,
});
const fresh = themed(
  appAt("app-fresh", {
    zoom: 1,
    extensionSettings: { other: { enabled: false } },
  }),
);
ok(
  "theme, fresh: Ink Cobalt set, the extension on, other keys kept",
  [
    fresh.s.theme,
    fresh.s.themeIsDark,
    fresh.s.themeBackgroundColor,
    fresh.s.extensionSettings["com.local.inktheme"].enabled,
    fresh.s.zoom,
    fresh.s.extensionSettings.other.enabled,
    /theme: set to Ink Cobalt/.test(fresh.out),
  ],
  ["com.local.inktheme:ink-cobalt", true, "#16171b", true, 1, false, true],
);
const sys = themed(
  appAt("app-system", { theme: "system", pendingThemeFallback: "dark" }),
);
ok(
  'theme, "system": counts as fresh, the fallback goes',
  [sys.s.theme, "pendingThemeFallback" in sys.s],
  ["com.local.inktheme:ink-cobalt", false],
);
ok(
  "theme, no settings file yet: written",
  themed(path.join(tmp, "app-none.json")).s?.theme,
  "com.local.inktheme:ink-cobalt",
);
// A theme picked before (not an Ink one) is switched to Cobalt once; the installer records it (inkSwitched)
const themedIn = (name, file, env = {}, ...flags) => {
  const h = path.join(tmp, name);
  const r = spawnSync(
    process.execPath,
    [INSTALL, "--home", h, "--app-settings", file, ...flags],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: emptyPath, Path: emptyPath, ...env },
    },
  );
  return {
    out: r.stdout,
    s: json(file),
    state: json(path.join(h, ".claude", "setup-state.json")),
    h,
  };
};
const oldPick = themedIn(
  "theme-old",
  appAt("app-picked", { theme: "dark", themeIsDark: true, zoom: 2 }),
);
ok(
  "theme, a built-in theme picked before: Cobalt once, old copy kept, recorded",
  [
    oldPick.s.theme,
    oldPick.s.zoom,
    oldPick.state.inkSwitched,
    /theme: set to Ink Cobalt/.test(oldPick.out),
    backupsOf(oldPick.h).some(
      (b) => path.basename(b.of) === "app-picked.json",
    ) &&
      !fs
        .readdirSync(tmp)
        .some((f) => f.startsWith("app-picked.json.before-install")),
  ],
  ["com.local.inktheme:ink-cobalt", 2, true, true, true],
);
fs.writeFileSync(
  path.join(tmp, "app-picked.json"),
  JSON.stringify({ theme: "light" }),
);
const later = spawnSync(
  process.execPath,
  [
    INSTALL,
    "--home",
    oldPick.h,
    "--app-settings",
    path.join(tmp, "app-picked.json"),
  ],
  {
    encoding: "utf8",
    env: { ...process.env, PATH: emptyPath, Path: emptyPath },
  },
);
ok(
  "theme, picked after the switch: stays, and the run says so",
  [
    json(path.join(tmp, "app-picked.json")),
    /theme: left as it is \(light\)/.test(later.stdout),
  ],
  [{ theme: "light" }, true],
);
const inkPick = themedIn(
  "theme-ink",
  appAt("app-ink", { theme: "com.local.inktheme:ink-paper" }),
);
ok(
  "theme, an Ink theme picked: stays, recorded as switched",
  [inkPick.s.theme, inkPick.state.inkSwitched],
  ["com.local.inktheme:ink-paper", true],
);
const open = themedIn("theme-open", appAt("app-open", { theme: "dark" }), {
  SETUP_NIMBALYST_OPEN: "yes",
});
ok(
  "theme, Nimbalyst open: the line for the update skill, file unchanged, pending",
  [
    open.s,
    /^theme: set now: com\.local\.inktheme:ink-cobalt \(Nimbalyst is open\. Claude inside Nimbalyst: .*appearance_set_theme.*--theme-done.*Ink Cobalt\.\)$/m.test(
      open.out,
    ),
    open.state.themePending,
    open.state.inkSwitched,
  ],
  [{ theme: "dark" }, true, true, undefined],
);
ok(
  "theme, Nimbalyst open: the theme seen is recorded",
  open.state.themePendingFrom,
  "dark",
);
// pending, then the person picks something else: that pick wins, whether Nimbalyst is open or closed
const pendingPick = (name, picked, env) => {
  const first = themedIn(name, appAt(`app-${name}`, { theme: "dark" }), {
    SETUP_NIMBALYST_OPEN: "yes",
  });
  fs.writeFileSync(
    path.join(tmp, `app-${name}.json`),
    JSON.stringify({ theme: picked }),
  );
  const second = themedIn(name, path.join(tmp, `app-${name}.json`), env);
  return { first, second };
};
const pickedOpen = pendingPick("theme-p1", "light", {
  SETUP_NIMBALYST_OPEN: "yes",
});
ok(
  "theme, pending, then another theme picked (Nimbalyst still open): no line, pending cleared, pick stays",
  [
    pickedOpen.second.s,
    pickedOpen.second.out.includes("theme: set now:"),
    "themePending" in pickedOpen.second.state,
    "themePendingFrom" in pickedOpen.second.state,
    pickedOpen.second.state.inkSwitched,
  ],
  [{ theme: "light" }, false, false, false, true],
);
const pickedClosed = pendingPick("theme-p2", "light", {
  SETUP_NIMBALYST_OPEN: "no",
});
ok(
  "theme, pending, then another theme picked (Nimbalyst closed): not overwritten with Cobalt",
  [pickedClosed.second.s, pickedClosed.second.state.inkSwitched],
  [{ theme: "light" }, true],
);
const pickedInk = pendingPick("theme-p3", "com.local.inktheme:ink-frost", {
  SETUP_NIMBALYST_OPEN: "yes",
});
ok(
  "theme, pending, then an Ink theme picked: cleared, stays",
  [
    pickedInk.second.s.theme,
    pickedInk.second.state.inkSwitched,
    "themePending" in pickedInk.second.state,
  ],
  ["com.local.inktheme:ink-frost", true, false],
);
const stillOpen = pendingPick("theme-p4", "dark", {
  SETUP_NIMBALYST_OPEN: "yes",
});
ok(
  "theme, pending and nothing picked: the line again, still pending",
  [
    stillOpen.second.out.includes("theme: set now:"),
    stillOpen.second.state.themePending,
  ],
  [true, true],
);
const doneRun = spawnSync(
  process.execPath,
  [INSTALL, "--home", open.h, "--theme-done"],
  { encoding: "utf8" },
);
const doneState = json(path.join(open.h, ".claude", "setup-state.json"));
ok(
  "theme, --theme-done: recorded, no longer pending",
  [doneRun.status, doneState.inkSwitched, "themePending" in doneState],
  [0, true, false],
);
const noTheme = themedIn(
  "theme-no",
  appAt("app-flag", { theme: "dark" }),
  {},
  "--no-theme",
);
ok(
  "theme, --no-theme: untouched",
  [noTheme.s, noTheme.state.inkSwitched],
  [{ theme: "dark" }, undefined],
);
const noSys = themed(appAt("app-flag2", { theme: "system" }), "--no-theme");
ok('theme, --no-theme, "system": untouched', noSys.s, { theme: "system" });
const themeOff = spawnSync(
  process.execPath,
  [INSTALL, "--home", themeHome, "--app-settings", appAt("app-env", {})],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: emptyPath,
      Path: emptyPath,
      SETUP_THEME: "off",
    },
  },
);
ok(
  "theme, SETUP_THEME=off: untouched",
  [
    json(path.join(tmp, "app-env.json")),
    /SETUP_THEME=off/.test(themeOff.stdout),
  ],
  [{}, true],
);
const themeDry = themed(appAt("app-dry", {}), "--dry-run");
ok(
  "theme, --dry-run: says it, writes nothing",
  [themeDry.s, /theme: would be set to Ink Cobalt/.test(themeDry.out)],
  [{}, true],
);

// ---- a first install over a person's own CLAUDE.md that stops right after the rules (a kill, or a later step
// failing) has already put on record the copy of their file and the carve's undo record: the next run sees only
// the setup's rules in place, and --uninstall still puts the person's file back
const stopHome = path.join(tmp, "stop-rules");
const stopRules = path.join(stopHome, ".claude", "CLAUDE.md");
const MINE_STOP = "# My rules\n\n- Mine, from before the setup.\n";
fs.mkdirSync(path.dirname(stopRules), { recursive: true });
fs.writeFileSync(stopRules, MINE_STOP);
const stoppedRules = spawnSync(
  process.execPath,
  [INSTALL, "--home", stopHome],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: emptyPath,
      Path: emptyPath,
      SETUP_TEST_STOP_AFTER: "rules",
    },
  },
);
const stopStateFile = path.join(stopHome, ".claude", "setup-state.json");
const localDay = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4)
  .toISOString()
  .slice(0, 10);
const stopCopy = fwd(
  path.join(
    stopHome,
    ".claude",
    "setup-logs",
    `${localDay}-install-backup`,
    ".claude",
    "CLAUDE.md",
  ),
);
const stopState = fs.existsSync(stopStateFile) ? json(stopStateFile) : {};
ok(
  "stop after rules: the run stops with the stop named, the record is on disk and names the person's copy",
  [
    stoppedRules.status,
    /stopped after the rules \(test\)/.test(stoppedRules.stdout),
    fs.existsSync(stopStateFile),
    (stopState.userCopies || []).includes(stopCopy),
    stopState.rulesUndo?.files?.[0]?.copy,
    fs.existsSync(stopCopy) && fs.readFileSync(stopCopy, "utf8"),
  ],
  [1, true, true, true, stopCopy, MINE_STOP],
);
const doneEarly = install(stopHome, "--done", "chat-steps");
ok(
  "stop after rules: a record with only the copies on it still reads as not installed (no version; --done refuses)",
  [
    "version" in stopState,
    doneEarly.code,
    /run the install first/.test(doneEarly.out),
  ],
  [false, 1, true],
);
const stopAgain = install(stopHome);
const stopUn = install(stopHome, "--uninstall");
ok(
  "stop after rules: the next run and --uninstall put the person's CLAUDE.md back",
  [
    stopAgain.code,
    stopUn.code,
    fs.existsSync(stopRules) && fs.readFileSync(stopRules, "utf8"),
  ],
  [0, 0, MINE_STOP],
);

// ---- D18 (spec docs/2026-11-20-hooks-cut-spec.md): a home wired from the example as it was before the hooks cut
// (frozen below: CI clones the repo shallow, so the old example can't be read from git), updated by the current
// installer, has no hook wired twice and none of the cut or moved entries left. "Wired" reads the settings together
// with the home's hooks/dispatch-groups.json: an entry `hooks/dispatch.mjs <group>` runs every hook of that group.
// The example's 80 hook entries before the cut: [event, matcher, if, script and its arguments, timeout, more]
const OLD_EXAMPLE = [
  ["SessionStart", "", "", "hooks/transcript-check.mjs", 5],
  ["SessionStart", "", "", "hooks/patch-next.mjs", 5],
  ["SessionStart", "", "", "hooks/code-review-gate.mjs --start", 10],
  ["SessionStart", "", "", "hooks/nimbalyst-notes.mjs", 5],
  ["SessionStart", "", "", "hooks/experiment-alert.mjs", 5],
  ["SessionStart", "", "", "hooks/session-cleanup.mjs", 5],
  ["SessionStart", "", "", "hooks/recheck-dates.mjs", 5],
  [
    "PreToolUse",
    "Bash|PowerShell|Agent|Task",
    "",
    "hooks/background-tasks.mjs",
    5,
  ],
  ["PreToolUse", "Agent|Task", "", "hooks/agent-run-log.mjs", 5],
  [
    "PreToolUse",
    "Agent|Task|Edit|Write|MultiEdit|NotebookEdit|mcp__nimbalyst-host__spawn_session|mcp__nimbalyst-host__send_prompt",
    "",
    "hooks/no-response-gate.mjs",
    10,
  ],
  ["PreToolUse", "*", "", "hooks/worker-size.mjs", 5],
  ["PreToolUse", "Read|Bash|PowerShell", "", "hooks/big-read-gate.mjs", 10],
  ["PreToolUse", "Agent|Task", "", "hooks/budget-gate.mjs", 10],
  ["PreToolUse", "Agent|Task", "", "hooks/map-brief.mjs", 10],
  ["PreToolUse", "Agent|Task", "", "hooks/serves-brief.mjs", 10],
  [
    "PreToolUse",
    "Agent|Task|Write|mcp__nimbalyst-host__spawn_session|mcp__nimbalyst-host__create_session|mcp__nimbalyst-host__send_prompt",
    "",
    "hooks/decided-quote.mjs",
    10,
  ],
  [
    "PreToolUse",
    "mcp__nimbalyst__PromptForUserInput|mcp__nimbalyst__AskUserQuestion|AskUserQuestion",
    "",
    "hooks/question-other.mjs",
    5,
  ],
  [
    "PreToolUse",
    "mcp__nimbalyst__display_to_user",
    "",
    "hooks/picture-in-project.mjs",
    5,
  ],
  [
    "PreToolUse",
    "mcp__nimbalyst-browser__browser_open_session",
    "",
    "hooks/browser-visible-gate.mjs",
    5,
  ],
  [
    "PreToolUse",
    "Edit|Write|Read|Bash|PowerShell|Grep|Glob|WebFetch|WebSearch|mcp__.*",
    "",
    "hooks/repeat-guard.mjs",
    5,
  ],
  [
    "PreToolUse",
    "Bash|Agent|Task|mcp__nimbalyst__developer_git_commit_proposal",
    "",
    "hooks/job-done.mjs",
    5,
  ],
  ["PreToolUse", "Bash|PowerShell", "", "hooks/code-review-gate.mjs --pre", 15],
  [
    "PreToolUse",
    "Bash|PowerShell|mcp__nimbalyst__developer_git_commit_proposal",
    "",
    "hooks/verify-gate.mjs --pre",
    15,
  ],
  ["PreToolUse", "Bash|PowerShell", "", "hooks/command-explain.mjs", 5],
  ["PreToolUse", "Bash|PowerShell", "", "hooks/sql-guard.mjs", 5],
  ["PreToolUse", "Bash|PowerShell", "", "hooks/delete-guard.mjs", 5],
  ["PreToolUse", "Bash|PowerShell", "", "hooks/long-sleep-guard.mjs", 5],
  ["PreToolUse", "Bash|PowerShell", "", "hooks/find-guard.mjs", 5],
  ["PreToolUse", "Bash|PowerShell", "", "hooks/download-guard.mjs", 10],
  // job 9 D9: push-key-scan's two `if` entries stay here (this is the old example); the update must move them into
  // the pre-tool group (D18_GROUPS below)
  [
    "PreToolUse",
    "Bash|PowerShell",
    "Bash(*push*)",
    "hooks/push-key-scan.mjs",
    15,
    { onFailure: "block" },
  ],
  [
    "PreToolUse",
    "Bash|PowerShell",
    "PowerShell(*push*)",
    "hooks/push-key-scan.mjs",
    15,
    { onFailure: "block" },
  ],
  [
    "PreToolUse",
    "Bash|PowerShell",
    "Bash(*opencli*)",
    "hooks/opencli-readonly.mjs",
    15,
    { onFailure: "block" },
  ],
  [
    "PreToolUse",
    "Bash|PowerShell",
    "PowerShell(*opencli*)",
    "hooks/opencli-readonly.mjs",
    15,
    { onFailure: "block" },
  ],
  [
    "PreToolUse",
    "Bash|PowerShell",
    "",
    "hooks/planner-readonly.mjs",
    5,
    { onFailure: "block" },
  ],
  ["PreToolUse", "Bash|PowerShell", "", "hooks/slow-output-gate.mjs", 5],
  ["PreToolUse", "", "", "skills/steer/steer.mjs --hook", 5],
  [
    "PreToolUse",
    "Edit|MultiEdit|Write|NotebookEdit",
    "",
    "hooks/map-generated.mjs",
    5,
  ],
  ["PreToolUse", "Bash|PowerShell", "", "hooks/session-cleanup.mjs", 5],
  ["PreCompact", "", "", "hooks/context-guard.mjs", 10],
  [
    "PostToolUse",
    "Bash|mcp__nimbalyst__developer_git_commit_proposal",
    "",
    "hooks/job-done.mjs",
    5,
  ],
  [
    "PostToolUse",
    "mcp__nimbalyst__PromptForUserInput|mcp__nimbalyst__AskUserQuestion|AskUserQuestion",
    "",
    "hooks/form-answer.mjs",
    5,
  ],
  ["PostToolUse", "Agent|Task", "", "hooks/helper-stopped.mjs", 5],
  ["PostToolUse", "Agent|Task", "", "hooks/agent-run-log.mjs", 5],
  ["PostToolUse", "", "", "hooks/context-guard.mjs", 5],
  ["PostToolUse", "", "", "hooks/worker-size.mjs", 5],
  ["PostToolUse", "", "", "skills/steer/steer.mjs --hook", 5],
  ["PostToolUse", "", "", "hooks/plan-usage-logger.mjs", 5],
  [
    "PostToolUse",
    "Edit|MultiEdit|Write|NotebookEdit",
    "",
    "hooks/map-drift.mjs",
    5,
  ],
  [
    "PostToolUse",
    "Bash|PowerShell|mcp__nimbalyst__developer_git_commit_proposal|Edit|MultiEdit|Write",
    "",
    "hooks/upkeep-note.mjs",
    5,
  ],
  ["PostToolUse", "Bash|PowerShell", "", "hooks/session-cleanup.mjs", 10],
  ["PostToolUseFailure", "Agent|Task", "", "hooks/agent-run-log.mjs", 5],
  ["UserPromptSubmit", "", "", "hooks/big-read-gate.mjs", 5],
  ["UserPromptSubmit", "", "", "hooks/context-guard.mjs", 10],
  ["UserPromptSubmit", "", "", "hooks/no-response-gate.mjs", 10],
  ["UserPromptSubmit", "", "", "hooks/pc-tidy-nudge.mjs", 5],
  ["UserPromptSubmit", "", "", "hooks/map-nudge.mjs", 5],
  ["UserPromptSubmit", "", "", "hooks/map-prompt.mjs", 5],
  ["UserPromptSubmit", "", "", "hooks/cold-cache.mjs", 5],
  ["UserPromptSubmit", "", "", "hooks/job-done.mjs", 5],
  ["UserPromptSubmit", "", "", "hooks/background-tasks.mjs", 10],
  ["UserPromptSubmit", "", "", "hooks/update-check.mjs", 10],
  ["UserPromptSubmit", "", "", "hooks/usage-dashboard-hook.mjs", 200],
  ["UserPromptSubmit", "", "", "hooks/plan-usage-logger.mjs", 5],
  ["UserPromptSubmit", "", "", "hooks/session-cleanup.mjs", 5],
  ["Stop", "", "", "hooks/link-gate.mjs", 10],
  ["Stop", "", "", "hooks/handoff-brief.mjs --hook", 15],
  ["Stop", "", "", "hooks/plan-usage-logger.mjs", 5],
  ["Stop", "", "", "hooks/run-yourself.mjs", 5],
  ["Stop", "", "", "hooks/job-done.mjs", 5],
  ["Stop", "", "", "hooks/code-review-gate.mjs", 10],
  ["Stop", "", "", "hooks/verify-gate.mjs", 10],
  ["Stop", "", "", "hooks/no-response-gate.mjs", 10],
  ["Stop", "", "", "hooks/next-step-gate.mjs", 10],
  ["Stop", "", "", "hooks/background-tasks.mjs", 10],
  ["Stop", "", "", "hooks/file-link-gate.mjs", 5],
  ["Stop", "", "", "hooks/context-guard.mjs", 10],
  ["Stop", "", "", "skills/steer/steer.mjs --hook", 5],
  [
    "Stop",
    "",
    "",
    "skills/steer/steer.mjs --watch",
    7200,
    { asyncRewake: true },
  ],
  ["Stop", "*", "", "hooks/web-answer-gate.mjs", 10],
  ["SessionEnd", "", "", "hooks/session-cleanup.mjs", 5],
];
// The 17 hooks plan 2.8 cuts, the 5 upkeep hooks, and map-prompt (plan 2.10)
const D18_CUT = [
  "long-sleep-guard",
  "big-read-gate",
  "background-tasks",
  "slow-output-gate",
  "decided-quote",
  "serves-brief",
  "budget-gate",
  "worker-size",
  "job-done",
  "context-guard",
  "cold-cache",
  "handoff-brief",
  "next-step-gate",
  "run-yourself",
  "web-answer-gate",
  "form-answer",
  "code-review-gate",
  "upkeep-note",
  "recheck-dates",
  "patch-next",
  "pc-tidy-nudge",
  "experiment-alert",
  "map-prompt",
];
// The hooks that move into a group (plan "Names fixed for every slice"): each runs once on that event, through its group
const D18_GROUPS = {
  PreToolUse: [
    "hooks/delete-guard.mjs",
    "hooks/find-guard.mjs",
    "hooks/sql-guard.mjs",
    "hooks/push-key-scan.mjs", // job 9 D9: moved into the pre-tool group, its two `if` entries dropped
    "hooks/download-guard.mjs",
    "hooks/command-explain.mjs",
    "hooks/verify-gate.mjs --pre",
    "hooks/session-cleanup.mjs",
    "skills/steer/steer.mjs --hook",
    "hooks/repeat-guard.mjs --near-cap-only",
    "hooks/map-brief.mjs",
  ],
  UserPromptSubmit: [
    "hooks/usage-dashboard-hook.mjs",
    "hooks/no-response-gate.mjs",
    "skills/steer/steer.mjs --hook",
    "hooks/session-cleanup.mjs",
    "hooks/map-nudge.mjs",
  ],
  Stop: [
    "hooks/plan-usage-logger.mjs",
    "hooks/verify-gate.mjs",
    "hooks/no-response-gate.mjs",
    "hooks/file-link-gate.mjs",
    "skills/steer/steer.mjs --hook",
  ],
};
const cutHome = path.join(tmp, "before-the-cut");
install(cutHome);
const cutClaude = path.join(cutHome, ".claude");
const cutSettingsFile = path.join(cutClaude, "settings.json");
const cutOld = json(cutSettingsFile);
cutOld.hooks = {};
for (const [event, matcher, cond, run, timeout, more] of OLD_EXAMPLE) {
  const [script, ...args] = run.split(" ");
  const command = `node "${fwd(path.join(cutClaude, script))}"${args.map((a) => ` ${a}`).join("")}`;
  const groups = (cutOld.hooks[event] ??= []);
  let g = groups.find((x) => (x.matcher ?? "") === matcher);
  if (!g) groups.push((g = { ...(matcher ? { matcher } : {}), hooks: [] }));
  g.hooks.push({
    type: "command",
    ...(cond ? { if: cond } : {}),
    command,
    timeout,
    ...more,
  });
}
fs.writeFileSync(cutSettingsFile, JSON.stringify(cutOld, null, 2));
const cutRun = install(cutHome);
// Every hook the updated home runs: { event, if, run ("hooks/x.mjs --arg"), group }
const cutGroupsFile = path.join(cutClaude, "hooks", "dispatch-groups.json");
const cutGroups = fs.existsSync(cutGroupsFile) ? json(cutGroupsFile) : {};
const cutWired = [];
for (const [event, groups] of Object.entries(json(cutSettingsFile).hooks || {}))
  for (const g of groups)
    for (const h of g.hooks) {
      const m = h.command.match(/^node "([^"]+)"((?:\s+\S+)*)\s*$/);
      if (!m)
        throw new Error(`D18: a command the test can't read: ${h.command}`);
      const script = fwd(path.relative(cutClaude, m[1]));
      const args = [
        ...m[2].trim().split(/\s+/).filter(Boolean),
        ...(h.args ?? []),
      ];
      if (script !== "hooks/dispatch.mjs") {
        cutWired.push({
          event,
          if: h.if ?? "",
          run: [script, ...args].join(" "),
        });
        continue;
      }
      const list = cutGroups[args[0]];
      if (!Array.isArray(list))
        throw new Error(
          `D18: dispatch.mjs ${args[0]} has no group in ${cutGroupsFile}`,
        );
      for (const x of list)
        cutWired.push({
          event,
          if: "",
          run: [x.hook, ...(x.args ?? [])].join(" "),
          group: args[0],
        });
    }
const cutKey = (w) => `${w.event} ${w.run}${w.if ? ` if ${w.if}` : ""}`;
const cutShow = (w) => `${cutKey(w)}${w.group ? ` (group ${w.group})` : ""}`;
const cutName = (w) => path.basename(w.run.split(" ")[0], ".mjs");
ok(
  "D18 the update of a home wired before the cut runs without an error",
  cutRun.code,
  0,
);
ok(
  "D18 after the update no hook is wired twice on one event (a group counts as its hooks)",
  [
    ...new Set(
      cutWired.map(cutKey).filter((k, i, all) => all.indexOf(k) !== i),
    ),
  ],
  [],
);
ok(
  "D18 after the update none of the cut hooks is wired",
  cutWired.filter((w) => D18_CUT.includes(cutName(w))).map(cutShow),
  [],
);
ok(
  "D18 after the update none of the partly cut entries is left (plan-usage-logger off UserPromptSubmit and PostToolUse, no-response-gate off PreToolUse, planner-readonly, plain repeat-guard, session-cleanup on SessionStart)",
  cutWired
    .filter(
      (w) =>
        (cutName(w) === "plan-usage-logger" &&
          ["UserPromptSubmit", "PostToolUse"].includes(w.event)) ||
        (cutName(w) === "no-response-gate" && w.event === "PreToolUse") ||
        cutName(w) === "planner-readonly" ||
        (cutName(w) === "repeat-guard" &&
          w.run !== "hooks/repeat-guard.mjs --near-cap-only") ||
        (cutName(w) === "session-cleanup" && w.event === "SessionStart"),
    )
    .map(cutShow),
  [],
);
ok(
  "D18 after the update every hook that moved into a group runs once on that event, through its group",
  Object.entries(D18_GROUPS).flatMap(([event, runs]) =>
    runs.flatMap((run) => {
      const on = cutWired.filter((w) => w.event === event && w.run === run);
      return on.length === 1 && on[0].group
        ? []
        : [`${event} ${run}: ${on.map(cutShow).join("; ") || "not wired"}`];
    }),
  ),
  [],
);

// ---- Obscura left the setup: the install downloads it no more and removes the copy an older install put in
// ~/.claude/obscura, known by the VERSION file it wrote. A folder without that file, a link and the PATH are not its own.
{
  const obscuraLines = (out) =>
    out.split("\n").filter((l) => /obscura/i.test(l));
  const withOld = (name, files) => {
    const h = path.join(tmp, name);
    const dir = path.join(h, ".claude", "obscura");
    fs.mkdirSync(dir, { recursive: true });
    for (const [f, text] of Object.entries(files))
      fs.writeFileSync(path.join(dir, f), text);
    return { h, dir };
  };
  const OLD = {
    "obscura.exe": "program",
    // as scripts/obscura.mjs wrote it (removed with 1.x; its last pin, the Windows archive)
    VERSION:
      "v0.2.6\nsha256 0a110d0693753a252ed7ffd61e682363e8622caf79697f564c529099a31a6242 obscura-x86_64-windows.zip\n",
  };

  // a PATH folder that holds an Obscura with a VERSION file too: it is not the setup's copy
  const pathBin = path.join(tmp, "old-reader-on-path");
  fs.mkdirSync(pathBin);
  for (const [f, text] of Object.entries(OLD))
    fs.writeFileSync(path.join(pathBin, f), text);

  const own = withOld("old-reader-own", OLD);
  const dryOwn = installWith(pathBin, own.h, "--dry-run");
  ok(
    "Obscura: a dry run removes nothing and says it would remove the old copy",
    [
      fs.existsSync(path.join(own.dir, "obscura.exe")),
      obscuraLines(dryOwn.out).length,
      obscuraLines(dryOwn.out).some((l) => l.includes("would remove")),
    ],
    [true, 1, true],
  );
  const ranOwn = installWith(pathBin, own.h);
  ok(
    "Obscura: the install removes the old copy that holds the setup's VERSION file, in one plain line",
    [
      ranOwn.code,
      fs.existsSync(own.dir),
      obscuraLines(ranOwn.out).length,
      obscuraLines(ranOwn.out).some((l) =>
        l.includes(`removed ${fwd(own.dir)}`),
      ),
    ],
    [0, false, 1, true],
  );
  ok(
    "Obscura: an Obscura on the PATH stays, VERSION file and all",
    fs.readdirSync(pathBin).sort(),
    ["VERSION", "obscura.exe"],
  );

  const theirs = withOld("old-reader-theirs", { "obscura.exe": "program" });
  const ranTheirs = install(theirs.h);
  ok(
    "Obscura: a ~/.claude/obscura without the VERSION file is not the setup's and stays, named nowhere",
    [ranTheirs.code, fs.readdirSync(theirs.dir), obscuraLines(ranTheirs.out)],
    [0, ["obscura.exe"], []],
  );
  // a VERSION file that is not the one the old install wrote: the folder is someone else's
  const otherVersion = withOld("old-reader-other-version", {
    "obscura.exe": "program",
    VERSION: "my own build\n",
  });
  const ranOther = install(otherVersion.h);
  ok(
    "Obscura: a ~/.claude/obscura whose VERSION file is not the old install's stays, named nowhere",
    [
      ranOther.code,
      fs.existsSync(otherVersion.dir)
        ? fs.readdirSync(otherVersion.dir).sort()
        : "gone",
      obscuraLines(ranOther.out),
    ],
    [0, ["VERSION", "obscura.exe"], []],
  );

  // --files-only (the self-update's run) removes the old copy too, and saves the record after it
  const filesOnlyState = (h) => {
    fs.writeFileSync(
      path.join(h, ".claude", "setup-state.json"),
      JSON.stringify({ version: "0.0.1", files: {} }),
    );
  };
  const ownFiles = withOld("old-reader-files-only", OLD);
  filesOnlyState(ownFiles.h);
  const ranOwnFiles = install(ownFiles.h, "--files-only");
  ok(
    "Obscura: --files-only removes the old copy that holds the setup's VERSION file and saves the record",
    [
      ranOwnFiles.code,
      fs.existsSync(ownFiles.dir),
      obscuraLines(ranOwnFiles.out).length,
      json(path.join(ownFiles.h, ".claude", "setup-state.json")).version !==
        "0.0.1",
    ],
    [0, false, 1, true],
  );
  // a VERSION that can't be read (here a folder): the folder stays with one note, and the run still finishes
  const unreadable = withOld("old-reader-unreadable", {
    "obscura.exe": "program",
  });
  fs.mkdirSync(path.join(unreadable.dir, "VERSION"));
  filesOnlyState(unreadable.h);
  const ranUnreadable = install(unreadable.h, "--files-only");
  ok(
    "Obscura: an unreadable VERSION is a note and a skip, never a crash: --files-only finishes, saves the record, and the folder stays",
    [
      ranUnreadable.code,
      fs.readdirSync(unreadable.dir).sort(),
      obscuraLines(ranUnreadable.out).length,
      obscuraLines(ranUnreadable.out).some((l) => l.includes("was left")),
      json(path.join(unreadable.h, ".claude", "setup-state.json")).version !==
        "0.0.1",
    ],
    [0, ["VERSION", "obscura.exe"], 1, true, true],
  );

  // ~/.claude/obscura as a link to a folder elsewhere that holds a VERSION file: the link and that folder stay
  const linkHome = path.join(tmp, "old-reader-link");
  const elsewhere = path.join(tmp, "old-reader-elsewhere");
  fs.mkdirSync(path.join(linkHome, ".claude"), { recursive: true });
  fs.mkdirSync(elsewhere);
  for (const [f, text] of Object.entries(OLD))
    fs.writeFileSync(path.join(elsewhere, f), text);
  fs.symlinkSync(
    elsewhere,
    path.join(linkHome, ".claude", "obscura"),
    "junction",
  );
  const ranLink = install(linkHome);
  ok(
    "Obscura: a ~/.claude/obscura that is a link is left, and so is what it points at",
    [
      ranLink.code,
      // the link itself, or "gone"
      (() => {
        try {
          return fs
            .lstatSync(path.join(linkHome, ".claude", "obscura"))
            .isSymbolicLink();
        } catch {
          return "gone";
        }
      })(),
      fs.existsSync(elsewhere) ? fs.readdirSync(elsewhere).sort() : "gone",
    ],
    [0, true, ["VERSION", "obscura.exe"]],
  );

  // nothing there: the first install of this file (blank home) said nothing about Obscura and made no folder
  ok(
    "Obscura: with nothing there the install names no Obscura and makes no folder",
    [obscuraLines(first.out), fs.existsSync(path.join(claude, "obscura"))],
    [[], false],
  );

  // an old command line with --obscura: accepted with one note, nothing downloaded, nothing put on record
  const flagHome = path.join(tmp, "old-reader-flag");
  fs.mkdirSync(path.join(flagHome, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(flagHome, ".claude", "setup-state.json"),
    JSON.stringify({ obscura: false }),
  );
  const flagNo = install(flagHome, "--obscura", "no");
  const flagYes = install(flagHome, "--obscura", "yes", "--dry-run");
  ok(
    "Obscura: --obscura yes|no from an old command line is ignored with one note, and an old state's obscura field goes",
    [
      flagNo.code,
      obscuraLines(flagNo.out).length,
      obscuraLines(flagNo.out).some((l) => l.includes("ignored")),
      flagYes.code,
      obscuraLines(flagYes.out).length,
      obscuraLines(flagYes.out).some((l) => l.includes("ignored")),
      fs.existsSync(path.join(flagHome, ".claude", "obscura")),
      "obscura" in json(path.join(flagHome, ".claude", "setup-state.json")),
    ],
    [0, 1, true, 0, 1, true, false, false],
  );
  // --obscura with no value: the next flag is not its value, and the note names none
  const noValue = path.join(tmp, "old-reader-no-value");
  const beforeFlag = install(noValue, "--obscura", "--dry-run");
  const lastFlag = install(noValue, "--dry-run", "--obscura");
  ok(
    "Obscura: --obscura with no value (before another flag, or last) is ignored with a note that names no value",
    [obscuraLines(beforeFlag.out), obscuraLines(lastFlag.out)],
    [
      ["[dry run] --obscura: ignored; Obscura is no longer part of the setup"],
      ["[dry run] --obscura: ignored; Obscura is no longer part of the setup"],
    ],
  );
  ok(
    "Obscura: the usage text at the top of install.mjs no longer offers --obscura",
    /^\/\/\s+--obscura\b/m.test(fs.readFileSync(INSTALL, "utf8")),
    false,
  );
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
