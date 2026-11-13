// The setup's own files in ~/.claude: copies the hooks, agents, skills and workers (and, with Codex, the
// picture skill), then takes out what earlier versions left: the worker switches, what they set up in
// Antigravity, the retired skills and the files no longer shipped. A file the user changed stays and is named.
import fs from "node:fs";
import path from "node:path";
import { filesIn, fwd, OWN_FOLDERS, readJson, sha } from "./files.mjs";
import { fableToOpus } from "./model.mjs";

// Add-ons: left out of a default install. --with name[,name,...] adds any of them; a copy already in
// the target stays and keeps being updated by a plain run; --uninstall treats them like any other skill or extension.
export const ADDONS = { "phone-bot": "skill", "read-aloud": "extension" };
// A file under an add-on skill is left out unless it was asked for with --with, or a copy is already there
const addonSkip = ({ CLAUDE, withNames }, rel) =>
  Object.entries(ADDONS).some(
    ([name, kind]) =>
      kind === "skill" &&
      fwd(rel).startsWith(fwd(path.join("skills", name)) + "/") &&
      !withNames.includes(name) &&
      !fs.existsSync(path.join(CLAUDE, "skills", name, "SKILL.md")),
  );

// Claude Code on Windows starts the hooks through Git Bash: without it every guard of this setup fails.
// Looked for as Claude Code does: the path set in CLAUDE_CODE_GIT_BASH_PATH (environment or the "env" of
// settings.json), then the usual Git for Windows folders, then a git.exe on the PATH.
export const gitBashFound = (settings) => {
  const env = process.env;
  const roots = [
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.ProgramW6432,
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs"),
  ];
  const gits = (env.PATH || "")
    .split(path.delimiter)
    .filter((d) => d && fs.existsSync(path.join(d, "git.exe")));
  return [
    env.CLAUDE_CODE_GIT_BASH_PATH,
    settings.env?.CLAUDE_CODE_GIT_BASH_PATH,
    ...roots.filter(Boolean).map((r) => path.join(r, "Git", "bin", "bash.exe")),
    ...gits.flatMap((d) => [
      path.join(d, "..", "bin", "bash.exe"),
      path.join(d, "..", "..", "bin", "bash.exe"),
    ]),
  ]
    .filter(Boolean)
    .some((p) => fs.existsSync(p));
};
export const gitBashMissing = (settingsFile) =>
  `Git Bash was not found on this computer. Claude Code on Windows starts the hooks through it, so without it every guard of this setup fails. Install Git for Windows (https://git-scm.com/download/win), or, when it is installed in an unusual place, set CLAUDE_CODE_GIT_BASH_PATH to the full path of its bash.exe in the "env" part of ${fwd(settingsFile)}. The install goes on; run it again after that.`;

// Versions before 1.0.77 wrote workers/<name>.off for an outside worker that was not used: each one still
// as the setup wrote it goes to drop(file). Both names stay here, so an older install loses both files.
export function dropSwitches({ CLAUDE }, drop) {
  for (const name of ["codex", "agy"]) {
    const off = path.join(CLAUDE, "workers", `${name}.off`);
    if (
      fs.existsSync(off) &&
      fs.readFileSync(off, "utf8").startsWith("Not used on this computer.")
    )
      drop(off);
  }
}
// Versions before 1.0.77 gave long reading to outside workers and set Antigravity up for it: allow-rules in its
// settings (state.agyAdded records the ones the setup really added) and the hook ask-worker-gate in its hooks
// file. An update and --uninstall take both out; the user's own rules and hooks stay.
// kept: --uninstall's list of what stays; with no record the rules those versions could add are only named there.
export function dropAgy(
  { home, CLAUDE, PROJECTS, state, DRY, say, putJson },
  kept = null,
) {
  const AGY_HOOK = "ask-worker-gate";
  const agyFile = path.join(
    home,
    ".gemini",
    "antigravity-cli",
    "settings.json",
  );
  const agyHooksFile = path.join(home, ".gemini", "config", "hooks.json");
  const AGY_RULES = [
    `read_file(${fwd(PROJECTS)})`,
    ...["hooks", "skills", "agents"].map(
      (d) => `read_file(${fwd(CLAUDE)}/${d})`,
    ),
    "read_url(*)",
    `read_file(${fwd(CLAUDE)})`,
  ];
  if (fs.existsSync(agyFile) && (state.agyAdded?.length || kept)) {
    const agy = readJson(agyFile);
    const allow = agy.permissions?.allow || [];
    const added = (state.agyAdded || []).filter((r) => allow.includes(r));
    if (added.length) {
      agy.permissions.allow = allow.filter((r) => !added.includes(r));
      putJson(agyFile, agy, null);
      say(
        `removed the allow rules the setup added from ${fwd(agyFile)}: ${added.join(", ")}`,
      );
    } else if (
      kept &&
      !state.agyAdded &&
      AGY_RULES.some((r) => allow.includes(r))
    ) {
      kept.push(
        `${fwd(agyFile)}: allow rules (${AGY_RULES.filter((r) => allow.includes(r)).join(", ")}) that the setup may have added; remove them by hand if they are not yours`,
      );
    }
  }
  if (
    fs.existsSync(agyHooksFile) &&
    fs.readFileSync(agyHooksFile, "utf8").includes(AGY_HOOK)
  ) {
    const hooks = readJson(agyHooksFile);
    if (!(AGY_HOOK in hooks)) return;
    delete hooks[AGY_HOOK];
    if (DRY) say(`would remove the hook ${AGY_HOOK} from ${fwd(agyHooksFile)}`);
    else if (Object.keys(hooks).length) {
      putJson(agyHooksFile, hooks, null);
      say(`removed the hook ${AGY_HOOK} from ${fwd(agyHooksFile)}`);
    } else {
      fs.rmSync(agyHooksFile);
      say(`removed ${fwd(agyHooksFile)} (it held only the setup's hook)`);
    }
  }
}

// Versions up to 1.0.114 had the add-on /shared-usage, whose logon-start.mjs made ccpool's background program
// start at log-on: a Startup-folder file on Windows, a launch agent on macOS. An update takes out each one that is
// still as that script wrote it; ccpool itself, its group and its running program stay, and the line says how to stop them.
export function dropCcpoolStart({ home, DRY, say }) {
  const vbs = path.join(
    home,
    "AppData",
    "Roaming",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "ccpool.vbs",
  );
  const plist = path.join(
    home,
    "Library",
    "LaunchAgents",
    "com.ai-coding-setup.ccpool.plist",
  );
  const ours = [
    [
      vbs,
      (t) =>
        t ===
        `CreateObject("WScript.Shell").Run "cmd /c ccpool daemon start", 0, False\r\n`,
    ],
    [
      plist,
      (t) =>
        t.includes(
          "<key>Label</key><string>com.ai-coding-setup.ccpool</string>",
        ),
    ],
  ];
  for (const [file, isOurs] of ours) {
    if (!fs.existsSync(file) || !isOurs(fs.readFileSync(file, "utf8")))
      continue;
    if (!DRY) fs.rmSync(file);
    say(
      `${DRY ? "would remove" : "removed"} ${fwd(file)} (the start at log-on that the retired /shared-usage set up for ccpool; ccpool itself stays: \`ccpool daemon stop\` stops it, \`npm uninstall -g ccpool\` removes it)`,
    );
  }
}

export function claudeFiles(ctx) {
  const {
    REPO,
    CLAUDE,
    PROJECTS,
    WIN,
    DRY,
    say,
    put,
    fit,
    short,
    filesWritten,
    files,
    shared,
  } = ctx;
  for (const rel of files) {
    if (addonSkip(ctx, rel)) continue;
    let data = fs.readFileSync(path.join(REPO, rel));
    // a shell script needs Unix line ends and has to be runnable; off Windows Codex's Windows-only sandbox flag goes
    const script = rel.endsWith(".sh"); // started by its own name
    if (script)
      data = Buffer.from(
        data
          .toString("utf8")
          .replace(/\r\n/g, "\n")
          .replace(WIN ? "" : ` -c 'windows.sandbox="unelevated"'`, ""),
      );
    // on the Pro plan a text's Fable choices are written as Opus (scripts/model.mjs)
    if (ctx.PRO && /\.(md|txt)$/.test(rel))
      data = Buffer.from(fableToOpus(data.toString("utf8")));
    put(path.join(CLAUDE, rel), data, { own: true });
    if (script && !DRY) fs.chmodSync(path.join(CLAUDE, rel), 0o755);
  }
  // the worker files themselves go with the files no longer shipped, below
  dropSwitches(ctx, (off) => {
    if (!DRY) fs.rmSync(off);
    say(`removed ${fwd(off)} (no longer part of the setup)`);
  });
  dropAgy(ctx);
  dropCcpoolStart(ctx);
  if (ctx.have.codex)
    for (const rel of filesIn(shared))
      put(
        path.join(CLAUDE, rel),
        fit(rel, fs.readFileSync(path.join(shared, rel))),
        { own: true },
      );
  // Skills the setup retired (most are now /setup-audit <part>; null means no replacement): the files an earlier run wrote there go, one
  // line for each skill. A file the user changed stays and is named, as below. These run before the loop
  // below, which would otherwise say it once for every file.
  const RETIRED_SKILLS = [
    [path.join(CLAUDE, "skills", "usage-report"), "/setup-audit usage"],
    [path.join(CLAUDE, "skills", "project-scan"), "/setup-audit scan"],
    [path.join(CLAUDE, "skills", "court"), null],
    [path.join(CLAUDE, "skills", "shared-usage"), null],
    [
      path.join(CLAUDE, "skills", "blind-screen-review"),
      "the blind-reviewer agent",
    ],
    [
      path.join(
        PROJECTS,
        "claude-settings",
        ".claude",
        "skills",
        "chat-review",
      ),
      "/setup-audit chat",
    ],
    [
      path.join(
        PROJECTS,
        "claude-settings",
        ".claude",
        "skills",
        "full-review",
      ),
      "/setup-audit full",
    ],
  ];
  for (const [dir, now] of RETIRED_SKILLS) {
    if (!fs.existsSync(dir)) continue;
    let gone = 0;
    const unknown = [];
    for (const f of filesIn(dir).map((rel) => path.join(dir, rel))) {
      const hash = filesWritten[fwd(f)];
      if (hash === undefined) {
        unknown.push(f);
        continue;
      }
      delete filesWritten[fwd(f)];
      if (sha(fs.readFileSync(f)) !== hash) {
        say(
          `kept yours ${fwd(f)} (a retired skill, and changed since it was installed; delete it by hand when not needed)`,
        );
        continue;
      }
      if (!DRY) fs.rmSync(f);
      gone++;
    }
    if (gone)
      say(
        `removed the retired skill ${short(dir)} (${gone} file${gone === 1 ? "" : "s"}; ${now ? `it is now ${now}` : "the setup no longer has it"})`,
      );
    if (unknown.length)
      say(
        `kept yours ${fwd(dir)} (a retired skill${now ? `, now ${now}` : ""}; there is no record that the setup wrote ${unknown.length === 1 ? "its file" : "these files"}, so ${unknown.length === 1 ? "it stays" : "they stay"}; delete the folder by hand when not needed)`,
      );
    if (!DRY) {
      // folders left empty go, deepest first
      const prune = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true }))
          if (e.isDirectory()) prune(path.join(d, e.name));
        if (!fs.readdirSync(d).length) fs.rmdirSync(d);
      };
      prune(dir);
    }
  }
  // A file an earlier version put here and this one no longer ships goes, unless it was changed since
  const shipped = new Set(
    [...files, ...filesIn(shared)].map((rel) => fwd(path.join(CLAUDE, rel))),
  );
  const ownFolders = OWN_FOLDERS.map((d) => `${fwd(path.join(CLAUDE, d))}/`);
  for (const [to, hash] of Object.entries(filesWritten)) {
    if (shipped.has(to) || !ownFolders.some((d) => to.startsWith(d))) continue;
    const now = fs.existsSync(to) ? fs.readFileSync(to) : null;
    delete filesWritten[to];
    if (now && sha(now) !== hash) {
      say(
        `kept yours ${to} (no longer part of the setup, and changed since it was installed)`,
      );
      continue;
    }
    if (now && !DRY) {
      fs.rmSync(to);
      if (!fs.readdirSync(path.dirname(to)).length)
        fs.rmdirSync(path.dirname(to));
    }
    if (now) say(`removed ${to} (no longer part of the setup)`);
  }
  // The add-ons left out of this run are named, so the commands the docs list can be found
  for (const name of Object.keys(ADDONS).filter(
    (n) =>
      ADDONS[n] === "skill" &&
      addonSkip(ctx, path.join("skills", n, "SKILL.md")),
  ))
    say(`add-on left out: ${name} (add it with --with ${name})`);
}
