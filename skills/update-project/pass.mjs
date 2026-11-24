#!/usr/bin/env node
// The project pass's checker and stamp (skills/update-project/SKILL.md, checks in checks.md).
//   node pass.mjs --check [<folder>]               one line per finding, "P<n>  fix|ask|note  <file>  <what>", then
//                                                  "project-pass <folder> · <a> to fix · <b> to ask · <c> notes · level <L>";
//                                                  reads, never writes; ids the folder's stamp keeps are left out
//   node pass.mjs --list                           folders worked in lately: "<folder>  behind|done|declined  last used <date>"
//   node pass.mjs --done <folder> [--kept <ids>]   stamps the folder at the current level; <ids> comma-separated, kept
//                                                  from earlier passes too
//   node pass.mjs --skip <folder>                  "not now": not offered there again until the level rises
//   node pass.mjs --skip-all                       "never, for any folder": no offer until the level rises
//   node pass.mjs --status                         the stamp file, in short
//   --home <folder>                                work as if <folder> were the home folder (tests)
//   env PASS_GH=<file>                             the gh that P20-P22 and P26 run (GETs only); a fake one in tests
// The stamp is ~/.claude/project-pass.json: {level, folders: {<folder>: {done, date, kept}}, declined: {<folder>: level},
// declinedAll, mode: "on-open"|"off"}. Nothing is written into a project, which may be a shared repo.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBuildCode, isSetup } from "../../hooks/lib/code-files.mjs";
import {
  decisionFileLines,
  decisionFiles,
  lastingFailure,
  movableSections,
} from "../../hooks/lib/decisions.mjs";
import {
  countLines,
  deadPaths,
  decisionsOver,
  handoffOver,
  isReplacesLine,
  noteFiles,
  TOPIC_BYTES,
} from "./upkeep-checks.mjs";

// The pass level this file's checks implement. It goes up only with a release that changes what a project folder
// should hold (the new-project base table, the file standard, checks.md); version.json's projectPass equals it.
export const LEVEL = 6;

const args = process.argv.slice(2);
const stop = (why) => {
  console.log(`project-pass stopped: ${why}`);
  process.exit(1);
};
const flagValue = (flag) => {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const v = args[at + 1];
  return v && !v.startsWith("--") ? v : null;
};
const homeArg = flagValue("--home");
if (homeArg === null) stop("--home needs a folder.");
const home = homeArg === undefined ? os.homedir() : path.resolve(homeArg);
const CLAUDE = path.join(home, ".claude");
const STAMP = path.join(CLAUDE, "project-pass.json");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const fwd = (p) => p.replace(/\\/g, "/");
const key = (folder) => fwd(path.resolve(folder)).replace(/\/$/, "");
const localDay = (d) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 6e4)
    .toISOString()
    .slice(0, 10);
const read = (f) => fs.readFileSync(f, "utf8");
const lines = (f) => read(f).split(/\r?\n/);
const lineCount = (f) => countLines(read(f));
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// ---- the stamp
export function readStamp(file = STAMP) {
  const fresh = {
    level: LEVEL,
    folders: {},
    declined: {},
    declinedAll: null,
    mode: "on-open",
  };
  if (!fs.existsSync(file)) return fresh;
  let s;
  try {
    s = JSON.parse(read(file));
  } catch (e) {
    throw new Error(`${fwd(file)} is not valid JSON: ${e.message}`);
  }
  return { ...fresh, ...s, level: LEVEL };
}
function saveStamp(s) {
  fs.mkdirSync(path.dirname(STAMP), { recursive: true });
  fs.writeFileSync(`${STAMP}.part`, JSON.stringify(s, null, 2) + "\n");
  fs.renameSync(`${STAMP}.part`, STAMP);
}
// behind: no stamp for the folder or one below the level, and not declined at this level (the offer reads this too)
export function stateOf(s, folder) {
  const k = key(folder),
    f = s.folders[k];
  if (f && f.done >= s.level) return "done";
  if (s.declined[k] >= s.level || s.declinedAll >= s.level) return "declined";
  return "behind";
}

// ---- the checks
// A project home is a folder whose CLAUDE.md the setup installed (a state.written key under state.projects): P2 is
// the update's job there.
function projectHomes() {
  const f = path.join(CLAUDE, "setup-state.json");
  if (!fs.existsSync(f)) return [];
  const state = JSON.parse(read(f));
  if (!state.projects) return [];
  const root = fwd(state.projects).replace(/\/$/, "") + "/";
  return [
    ...new Set(
      Object.keys(state.written || {})
        .filter((k) => k.endsWith("/CLAUDE.md") && fwd(k).startsWith(root))
        .map((k) => key(path.dirname(k))),
    ),
  ];
}
const frontmatter = (f) => {
  const m = read(f).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m
    ? Object.fromEntries(
        m[1]
          .split(/\r?\n/)
          .map((l) => l.match(/^([\w-]+):\s*(.*)$/))
          .filter(Boolean)
          .map((x) => [x[1], x[2].trim()]),
      )
    : {};
};
const hasTests = (dir) =>
  isDir(path.join(dir, "tests")) ||
  isDir(path.join(dir, "test")) ||
  (isFile(path.join(dir, "package.json")) &&
    !!JSON.parse(read(path.join(dir, "package.json"))).scripts?.test);
// the script a hook entry runs, with ~ and the project variable resolved: the first `args` item ending in a script
// extension (exec form, where a path may hold spaces), else the first such token in `command` (shell form)
const SCRIPT = /\.(?:mjs|cjs|js|py|sh|ps1)$/;
const hookScript = (h, dir) => {
  let raw = Array.isArray(h.args)
    ? h.args.find((a) => typeof a === "string" && SCRIPT.test(a))
    : null;
  if (!raw && typeof h.command === "string")
    raw = h.command.match(/(["']?)([^"'\s]+\.(?:mjs|cjs|js|py|sh|ps1))\1/)?.[2];
  if (!raw) return null;
  const p = raw
    .replace(/^~(?=\/)/, home)
    .replace(/\$\{?CLAUDE_PROJECT_DIR\}?/, dir)
    .replace(/\$\{?HOME\}?/, home);
  return path.isAbsolute(p) ? p : path.join(dir, p);
};
// since: the date of the folder's last stamp (P23 asks only about plain tags made after it)
export function check(dir, kept = [], since = null) {
  const out = [];
  const add = (id, kind, file, what) => out.push({ id, kind, file, what });
  const at = (n) => path.join(dir, n);
  // P1: the base files and folders
  for (const n of ["CLAUDE.md", "HANDOFF.md", "DECISIONS.md"])
    if (!isFile(at(n)))
      add("P1", "fix", n, "missing: create it from the new-project base table");
  for (const n of ["docs", ".claude/rules"])
    if (!isDir(at(n))) add("P1", "fix", n + "/", "missing: create the folder");
  // P2: the base lines of CLAUDE.md (a project home's CLAUDE.md is brought up to date by the update)
  if (isFile(at("CLAUDE.md")) && !projectHomes().includes(key(dir))) {
    const t = read(at("CLAUDE.md"));
    const need = [
      ["handoff", /HANDOFF\.md/, "Start with HANDOFF.md, then DECISIONS.md"],
      [
        "designs",
        /-design\.md|designs?\b[^\n]*\bdocs\//i,
        "Designs and plans live in docs/ as dated markdown files, docs/YYYY-MM-DD-topic-design.md and -plan.md",
      ],
      [
        "standard",
        /file-upkeep\/standard\.md/,
        "New files follow ~/.claude/skills/file-upkeep/standard.md",
      ],
      [
        "checks",
        /^#+\s*Checks\b/m,
        "a Checks section: which check runs when (build, tests, review, release)",
      ],
      [
        "tools",
        /^#+\s*Tools in this project/im,
        "a Tools in this project section (new-project step 3)",
      ],
    ];
    if (hasTests(dir))
      need.push([
        "failures",
        /known-failures\.md/,
        "docs/known-failures.md: a failure listed there is expected",
      ]);
    for (const [sub, re, line] of need)
      if (!re.test(t))
        add(`P2.${sub}`, "ask", "CLAUDE.md", `lacks the base line: ${line}`);
    const n = lineCount(at("CLAUDE.md"));
    if (n > 60)
      add(
        "P2.length",
        "ask",
        "CLAUDE.md",
        `${n} lines, over 60: name the lines that could move to a .claude/rules/ file`,
      );
  }
  // P3, P4: lengths and replaced decisions (the HANDOFF limit and the line finder: skills/update-project/upkeep-checks.mjs)
  const handoffBig = isFile(at("HANDOFF.md"))
    ? handoffOver(read(at("HANDOFF.md")))
    : null;
  if (handoffBig)
    add(
      "P3",
      "ask",
      "HANDOFF.md",
      `${handoffBig.text}: cut done work and old state`,
    );
  // P4: the root DECISIONS.md over its limit (the split, or a ledger when it has no section), each topic file in
  // docs/decisions/ over its own, and lines marked replaced in any decision file (the record: hooks/lib/decisions.mjs)
  const decisionsBig = isFile(at("DECISIONS.md"))
    ? decisionsOver(read(at("DECISIONS.md")))
    : null;
  if (decisionsBig) {
    const failed = lastingFailure(dir);
    const ledger =
      "no sections to split; sort the entries into topic files with a ledger (decisions.mjs --list, --apply)";
    add(
      "P4",
      "ask",
      "DECISIONS.md",
      `${decisionsBig.text}: ${
        failed
          ? `the last split failed: ${failed.reason}`
          : movableSections(read(at("DECISIONS.md"))).sections.length
            ? "run node ~/.claude/skills/file-upkeep/decisions.mjs --split"
            : ledger
      }`,
    );
  }
  for (const rel of decisionFiles(dir)) {
    const name = path.posix.basename(rel);
    if (rel === "DECISIONS.md" || /^\d{4}-\d{2}-\d{2}/.test(name)) continue;
    const bytes = fs.statSync(at(rel)).size;
    if (bytes > TOPIC_BYTES)
      add(
        "P4",
        "ask",
        rel,
        `${Math.round(bytes / 1000)} KB, over ${TOPIC_BYTES / 1000} KB: split it by sub-topic with a ledger (decisions.mjs --apply)`,
      );
  }
  const marked = decisionFileLines(dir).filter((l) => isReplacesLine(l.text));
  for (const file of new Set(marked.map((m) => m.file))) {
    const where = marked
      .filter((m) => m.file === file)
      .map((m) => `${m.file}:${m.line}`);
    add(
      "P4",
      "ask",
      file,
      `marked replaced at ${where.slice(0, 8).join(", ")}${where.length > 8 ? ` +${where.length - 8} more` : ""}: move replaced entries to docs/decisions-archive.md`,
    );
  }
  checkClaudeFolder(dir, add);
  checkFiles(dir, add);
  checkPaths(dir, add);
  checkFacts(dir, add);
  checkVerify(dir, add);
  const g = checkGit(dir, add, since);
  // a GitHub HTTP error (a revoked token, a deleted repo) costs only the GitHub checks: one line names it
  if (g?.gh)
    try {
      checkGitHub(add, g);
    } catch (e) {
      if (!e.notRun) throw e;
      add(
        "GitHub",
        "note",
        e.where,
        `${e.message}; did not run: ${e.notRun.join(", ")}`,
      );
    }
  const skip = new Set(kept);
  return out.filter((f) => !skip.has(f.id) && !skip.has(f.id.split(".")[0]));
}

// P5: settings, hooks, project skills and agents
function checkClaudeFolder(dir, add) {
  const cl = path.join(dir, ".claude");
  for (const n of ["settings.json", "settings.local.json"]) {
    const f = path.join(cl, n);
    if (!isFile(f)) continue;
    let s;
    try {
      s = JSON.parse(read(f));
    } catch (e) {
      add("P5", "fix", `.claude/${n}`, `does not parse: ${e.message}`);
      continue;
    }
    for (const groups of Object.values(s.hooks || {}))
      for (const g of groups || [])
        for (const h of g.hooks || []) {
          const p = hookScript(h, dir);
          if (p && !fs.existsSync(p))
            add(
              "P5",
              "fix",
              `.claude/${n}`,
              `registers a hook whose file is missing: ${fwd(p)}`,
            );
        }
  }
  const claudeMd = isFile(path.join(dir, "CLAUDE.md"))
    ? read(path.join(dir, "CLAUDE.md"))
    : "";
  const skills = path.join(cl, "skills");
  for (const s of isDir(skills)
    ? fs
        .readdirSync(skills)
        .filter((n) => isFile(path.join(skills, n, "SKILL.md")))
    : []) {
    const fm = frontmatter(path.join(skills, s, "SKILL.md"));
    for (const k of ["name", "description"])
      if (!fm[k])
        add(
          "P5",
          "fix",
          `.claude/skills/${s}/SKILL.md`,
          `no ${k} in its frontmatter`,
        );
    if (
      !claudeMd.includes(`skills/${s}`) &&
      !new RegExp(
        `(^|[\\s\`(])/${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      ).test(claudeMd)
    )
      add(
        "P5",
        "fix",
        "CLAUDE.md",
        `names no line for the project skill ${s}: add "<the ask in the user's words> → \`.claude/skills/${s}\`"`,
      );
  }
  const agents = path.join(cl, "agents");
  for (const a of isDir(agents)
    ? fs.readdirSync(agents).filter((n) => n.endsWith(".md"))
    : []) {
    const fm = frontmatter(path.join(agents, a));
    for (const k of ["name", "description"])
      if (!fm[k])
        add("P5", "fix", `.claude/agents/${a}`, `no ${k} in its frontmatter`);
  }
}

// P27: a folder with code and no verify skill (new-project's base table, row .claude/skills/verify/SKILL.md).
// Code is what the verify gate counts (isBuildCode), outside dot folders, node_modules and setup files; a git
// folder's own files come from git ls-files, so its ignored output is not read. A skill named verify or verify-<name>,
// in the folder or at its repo's top, is one the gate counts.
const VERIFY_LINE =
  "- Before a commit that changes code: the verify skill (.claude/skills/verify/SKILL.md) starts the app and proves the change.";
const VERIFY_TODO =
  "- [ ] Write .claude/skills/verify/SKILL.md from new-project's preset/verify-<kind>.md once the app first starts.";
const hasVerifySkill = (d) => {
  const skills = path.join(d, ".claude", "skills");
  return (
    isDir(skills) &&
    fs
      .readdirSync(skills)
      .some(
        (n) =>
          /^verify(-[\w-]+)?$/.test(n) &&
          isFile(path.join(skills, n, "SKILL.md")),
      )
  );
};
const isAppCode = (rel) =>
  !rel.split("/").some((s) => s.startsWith(".") || s === "node_modules") &&
  isBuildCode(`/${rel}`) &&
  !isSetup(rel);
function hasCode(dir, inGit) {
  if (inGit) {
    const r = gitRead(dir, "ls-files", "-co", "--exclude-standard");
    if (r.status !== 0)
      throw new Error(`git ls-files failed in ${fwd(dir)}: ${r.stderr.trim()}`);
    return r.stdout.split(/\r?\n/).some((l) => l && isAppCode(l));
  }
  const todo = [""];
  while (todo.length) {
    const rel = todo.pop();
    for (const e of fs.readdirSync(path.join(dir, rel), {
      withFileTypes: true,
    })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const sub = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) todo.push(sub);
      else if (isAppCode(sub)) return true;
    }
  }
  return false;
}
// the template by what the folder shows; null when it shows no kind
function verifyKind(dir) {
  if (isFile(path.join(dir, "project.godot")))
    return ["verify-godot.md", "a Godot game: project.godot"];
  const pj = path.join(dir, "package.json");
  if (!isFile(pj)) return null;
  let p;
  try {
    p = JSON.parse(read(pj));
  } catch (e) {
    throw new Error(`${fwd(pj)} does not parse: ${e.message}`);
  }
  if (p.bin)
    return ["verify-tool.md", "a command-line tool: package.json has bin"];
  if (p.scripts?.dev || p.scripts?.start)
    return [
      "verify-web.md",
      "a web app: package.json has a dev or start script",
    ];
  return null;
}
function checkVerify(dir, add) {
  const top = gitTop(dir);
  if (hasVerifySkill(dir) || (top && hasVerifySkill(top))) return;
  if (!hasCode(dir, top !== null)) return;
  const kind = verifyKind(dir);
  const copy = kind
    ? `copy ${PRESET}/${kind[0]} (${kind[1]})`
    : `pick the kind (web app, Godot game, command-line tool or data pipeline) and copy its template, ${PRESET}/verify-<web|godot|tool|pipeline>.md,`;
  add(
    "P27",
    "ask",
    ".claude/skills/verify/SKILL.md",
    `the folder has code and no verify skill: ${copy} to .claude/skills/verify/SKILL.md, fill every {{...}} from the folder, run it once, and add the CLAUDE.md line \`${VERIFY_LINE}\`. When nothing starts yet, no skill: add to HANDOFF.md \`${VERIFY_TODO}\``,
  );
}

// P6: the file standard's checker (names, copies, places); P30: its folder-role findings (P8, a file in the wrong
// role folder); P7: untracked entries in a git folder. The checker's --json is read, not its printed lines: a printed
// path with a space or a long rule list cannot be split back apart.
function checkFiles(dir, add) {
  const fc = path.join(HERE, "..", "file-upkeep", "file-check.mjs");
  if (!isFile(fc))
    throw new Error(
      `${fwd(fc)} is missing: the file-upkeep skill is part of the setup.`,
    );
  const r = spawnSync(
    process.execPath,
    [fc, "--report", dir, "--home", home, "--json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0)
    throw new Error(
      `file-check.mjs --report failed: ${(r.stdout + r.stderr).trim().split("\n").pop()}`,
    );
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch (e) {
    throw new Error(
      `file-check.mjs --report --json printed no JSON: ${e.message}`,
    );
  }
  if (!Array.isArray(report.findings))
    throw new Error("file-check.mjs --report --json has no findings list");
  for (const f of report.findings) {
    if (f.kind !== "fix" && f.kind !== "ask") continue;
    const what = `${f.id} ${f.rules.join("+")}: ${f.path}${f.target ? ` → ${f.target}` : ""}${f.why ? `   (${f.why})` : ""}`;
    // each finding once: one with P8 under P30, whose target says where the file goes (its naming rules ride along
    // in the same line), every other under P6
    add(f.rules.includes("P8") ? "P30" : "P6", f.kind, f.path, what);
  }
  const repo = gitTop(dir);
  if (!repo) return;
  // only the folder's own entries (it can be a package inside a bigger repo); git prints paths from the repo's top
  const g = spawnSync(
    "git",
    ["-C", dir, "status", "--porcelain", "--untracked-files=normal", "--", "."],
    { encoding: "utf8" },
  );
  if (g.status !== 0)
    throw new Error(`git status failed in ${fwd(dir)}: ${g.stderr.trim()}`);
  const prefix = fwd(path.relative(repo, dir)),
    strip = prefix ? `${prefix}/` : "";
  const groups = new Map();
  for (const l of g.stdout.split("\n").filter((x) => x.startsWith("?? "))) {
    const p = l.slice(3).replace(/^"|"$/g, "");
    if (p.toLowerCase() === strip.toLowerCase()) {
      add(
        "P7",
        "ask",
        "./",
        `the whole folder is untracked in the repo at ${fwd(repo)}: commit it, or add it to that repo's .gitignore`,
      );
      return;
    }
    const q = p.slice(strip.length),
      top = q.includes("/") ? q.split("/")[0] + "/" : q;
    groups.set(top, (groups.get(top) || 0) + 1);
  }
  for (const [top, n] of groups)
    add(
      `P7.${top.replace(/\/$/, "")}`,
      "ask",
      top,
      top === ".nimbalyst/"
        ? "untracked: the Nimbalyst editor's own folder; add the line `.nimbalyst/` to .git/info/exclude (the shared .gitignore names no tool)"
        : `untracked${n > 1 ? ` (${n} entries)` : ""}: commit, add to .gitignore, or delete`,
    );
}

// P8: backticked paths in the notes that are found neither under the folder nor under ~ (the finder:
// skills/update-project/upkeep-checks.mjs), and the memory notes
function checkPaths(dir, add) {
  for (const n of noteFiles(dir))
    for (const { line, path: t } of deadPaths(
      read(path.join(dir, n)),
      dir,
      home,
    ))
      add(
        `P8.${t}`,
        "ask",
        `${n}:${line}`,
        `\`${t}\` not found from the folder or ~: look where the note says it lives, then edit or drop`,
      );
  const slug = key(dir).replace(/[^A-Za-z0-9]/g, "-");
  const memory = path.join(CLAUDE, "projects", slug, "memory");
  if (isDir(memory) && fs.readdirSync(memory).some((n) => n.endsWith(".md")))
    add(
      "P8.memory",
      "note",
      fwd(memory),
      "memory notes: run the memory check (~/.claude/skills/setup-audit/memory.md) for this project",
    );
}

// P9: facts past their recheck date; P10: the tools on here; P11: the facts file's header
function checkFacts(dir, add) {
  // recheck-dates.mjs ships beside this file; it finds ~/.claude by the home folder, so --home is passed on
  const r = spawnSync(
    process.execPath,
    [path.join(HERE, "recheck-dates.mjs"), "--list", dir],
    {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    },
  );
  if (r.status !== 0)
    throw new Error(
      `recheck-dates.mjs --list failed: ${(r.stdout + r.stderr).trim().split("\n").pop()}`,
    );
  for (const l of r.stdout.split(/\r?\n/)) {
    const m = l.match(/^(\S+:\d+)\s+(\d{4}-\d{2}-\d{2})\s+past\s+(.*)$/);
    if (m)
      add(
        `P9.${m[1]}`,
        "ask",
        m[1],
        `past its recheck date ${m[2]}: recheck it now, or drop it (${m[3].slice(0, 80)})`,
      );
  }
  const sf = path.join(dir, ".claude", "settings.json");
  let on = [];
  if (isFile(sf))
    try {
      on = Object.entries(JSON.parse(read(sf)).enabledPlugins || {})
        .filter(([, v]) => v)
        .map(([k]) => k);
    } catch {
      /* P5 reports it */
    }
  add(
    "P10",
    "note",
    ".claude/settings.json",
    `plugins on here: ${on.length ? on.join(", ") : "none"}; the skill runs new-project step 3 (tools for this project, one ask)`,
  );
  const facts = path.join(dir, "docs", "facts.md");
  if (
    isFile(facts) &&
    !lines(facts)
      .slice(0, 12)
      .some((l) => l.includes("(recheck YYYY-MM-DD)"))
  )
    add(
      "P11",
      "fix",
      "docs/facts.md",
      "its header has no recheck-date line: add the line of the new-project docs/facts.md row",
    );
  // P12: the Systems map, with the "how we do X" things that point at the setup (a file under "~/")
  const mapFile = path.join(dir, ".claude", "systems-map.json");
  if (!isFile(mapFile))
    add(
      "P12",
      "ask",
      ".claude/systems-map.json",
      "no Systems map: build one (its topics, its parts and how this project does research, tests and its other jobs) with a background worker, ~/.claude/skills/systems-map/SKILL.md",
    );
  else {
    let nodes = null;
    try {
      nodes = JSON.parse(read(mapFile).replace(/^﻿/, "")).nodes;
    } catch (e) {
      add(
        "P12",
        "fix",
        ".claude/systems-map.json",
        `does not parse: ${e.message}`,
      );
    }
    if (
      Array.isArray(nodes) &&
      !nodes.some((n) =>
        [...(n?.files || []), ...(n?.notes || [])].some(
          (f) => typeof f === "string" && /^~[\\/]/.test(f),
        ),
      )
    )
      add(
        "P12",
        "ask",
        ".claude/systems-map.json",
        'the map has no "how we do X" things (none lists a ~/ file): add them with a background worker, ~/.claude/skills/systems-map/SKILL.md, section Topics and how-to things',
      );
  }
}

// ---- P13-P18, P23, P25: git and the preset files, local reads only (the preset: new-project step 2b and its preset/
// folder). The kind: not in a git repo -> no git; in a repo with no github.com remote -> local git; a github.com
// remote -> GitHub. A folder inside a bigger repo (a package with its own CLAUDE.md) is a git folder: the repo-wide
// files (.gitattributes, .github/) are read at the repo's top folder.
const PRESET = "~/.claude/skills/new-project/preset";
const LOCAL_LINE =
  "Git: on this computer only; git init allowed; work is committed on main.";
const githubLine = (vis) =>
  `Git: GitHub (${vis}); main holds merged work only; each change goes on a branch <type>/<topic> and reaches main as one squash-merged pull request whose title follows the commit rule.`;
const COMMITS_LINE =
  'Commits: subject "<type>: <what the person gains>", at most 72 characters; type is one of feat, fix, docs, test, ci, refactor, perf, build, chore; no plan-step or session ids.';
const KIND_NAME = {
  local: "git on this computer only",
  github: "on GitHub",
};
const gitRead = (dir, ...a) => {
  const r = spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  if (r.error) throw new Error(`git could not run: ${r.error.message}`);
  return r;
};
// the top folder of the git repo the folder is in (the folder itself or one above it), or null when it is in none.
// Without a git program: the folder itself when it holds .git.
// Built from --show-cdup (the way up from the folder), not --show-toplevel: git prints the real path, which can
// be spelled unlike the folder (macOS /var is /private/var, a Windows short name like RUNNER~1), and
// path.relative between two spellings gives a wrong path.
function gitTop(dir) {
  const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-cdup"], {
    encoding: "utf8",
  });
  if (r.error) return fs.existsSync(path.join(dir, ".git")) ? dir : null;
  if (r.status === 0) return path.resolve(dir, r.stdout.trim());
  if (/not a git repository/i.test(r.stderr)) return null;
  throw new Error(
    `git rev-parse --show-cdup failed in ${fwd(dir)}: ${r.stderr.trim()}`,
  );
}
// the first github.com remote, origin first: {remote, owner, repo}, or null
function githubRemote(dir) {
  const r = gitRead(dir, "config", "--get-regexp", "^remote\\..*\\.url$");
  if (r.status !== 0 && r.status !== 1)
    throw new Error(`git config failed in ${fwd(dir)}: ${r.stderr.trim()}`);
  const found = r.stdout
    .split(/\r?\n/)
    .map((l) =>
      l.match(
        /^remote\.(.+)\.url\s+\S*github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
      ),
    )
    .filter(Boolean)
    .map((m) => ({ remote: m[1], owner: m[2], repo: m[3] }));
  return found.find((f) => f.remote === "origin") || found[0] || null;
}
// The remote names its default branch, and git allows $ ( ) ; in a branch name: a name outside these
// characters is never put into the P16 command Claude runs once ticked
const SAFE_BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/;
const ODD_BRANCH =
  "the default branch name has characters a shell reads: rename it to main by hand on GitHub, then git branch -m in each clone";
function checkGit(dir, add, since) {
  const at = (n) => path.join(dir, n);
  const t = isFile(at("CLAUDE.md")) ? read(at("CLAUDE.md")) : "";
  const line = t.match(/^Git: (.*)$/m)?.[1].trim();
  const has =
    line === undefined
      ? null
      : /^none\b/.test(line)
        ? "none"
        : /^on this computer only\b/.test(line)
          ? "local"
          : /^GitHub \((private|public)\)/.test(line)
            ? "github"
            : "other";
  const top = gitTop(dir),
    hasGit = top !== null;
  // a repo-wide file: its path at the repo's top, and its name as seen from the folder
  const atTop = (n) => path.join(top, n),
    topRel = (n) => fwd(path.relative(dir, atTop(n)));
  // P13: every project folder has local git (global rule), archives and scratch aside, so a folder with none
  // gets it started without a tick, over an old `Git: none.` line too; otherwise the Git: line must match the folder.
  // An archive or scratch folder is one named *-old, *-backup or *_worktrees, or whose line says so.
  if (!hasGit) {
    const kept =
      /(?:-old|-backup|_worktrees)$/i.test(path.basename(dir)) ||
      /^none \((?:archive|scratch)\b/.test(line || "");
    if (kept) return null;
    const nested = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, ".git")),
      )
      .map((e) => e.name + "/");
    add(
      "P13",
      "fix",
      "CLAUDE.md",
      `not a git folder: write \`${LOCAL_LINE}\` (in place of any Git: line); add the lines of ${PRESET}/gitignore.txt to .gitignore, plus each file over 10 MB, browser profiles and cookie files${nested.length ? `, and the folders holding their own repo: ${nested.join(" ")}` : ""}; then git init -b main, add the line \`.nimbalyst/\` to .git/info/exclude (the editor's own folder stays out of git without naming it in the shared .gitignore), git add -A, read the staged list for secrets, and commit "chore: start git for this project". Then run the pass again for the other git checks`,
    );
    return null;
  }
  const gh = githubRemote(dir);
  const want = gh ? "github" : "local";
  const wantLine = {
    local: `\`${LOCAL_LINE}\``,
    github: `\`${githubLine("<private|public>")}\``,
  }[want];
  if (has === null)
    add(
      "P13",
      "ask",
      "CLAUDE.md",
      `no Git: line (the folder is ${KIND_NAME[want]}): add ${wantLine}`,
    );
  else if (has !== want)
    add(
      "P13",
      "ask",
      "CLAUDE.md",
      `the line "Git: ${line.slice(0, 60)}" does not match the folder, which is ${KIND_NAME[want]}: make it ${wantLine}`,
    );
  // P14: the clear-commit line; P15: line endings
  const commits = t.match(
    /^Commits: subject "<type>: <what the person gains>".*$/m,
  )?.[0];
  if (
    !commits ||
    !/feat, fix, docs, test, ci, refactor, perf, build, chore/.test(commits)
  )
    add(
      "P14",
      "ask",
      "CLAUDE.md",
      `no clear-commit line: add \`${COMMITS_LINE}\``,
    );
  const ga = atTop(".gitattributes");
  if (!isFile(ga))
    add(
      "P15",
      "ask",
      topRel(".gitattributes"),
      `missing: copy ${PRESET}/gitattributes.txt; a second tick runs git add --renormalize ., committed on its own`,
    );
  else if (!lines(ga).some((l) => !/^\s*#/.test(l) && /\btext=auto\b/.test(l)))
    add(
      "P15",
      "ask",
      topRel(".gitattributes"),
      `no text=auto rule: add the rules of ${PRESET}/gitattributes.txt; a second tick runs git add --renormalize ., committed on its own`,
    );
  // P25: the "don't ask again" list. Claude Code writes each approved command word for word into
  // .claude/settings.local.json, a typed token too, and hides the file only through this computer's own git
  // excludes, which a clone elsewhere does not have. So a .gitignore the repo carries must ignore it, and git
  // must not track it.
  const LOCAL_SETTINGS = ".claude/settings.local.json";
  const rel = path.relative(top, dir);
  const relFile = fwd(path.join(rel, LOCAL_SETTINGS));
  const ruleOf = (r, where) => {
    if (r.status !== 0 && r.status !== 1)
      throw new Error(
        `git check-ignore failed in ${where}: ${r.stderr.trim()}`,
      );
    // "<source>:<line>:<pattern>\t<path>"
    const m = r.status === 0 ? r.stdout.match(/^(.*?):\d+:(.*)\t/) : null;
    return m ? { source: fwd(m[1]), pattern: m[2] } : null;
  };
  // Only the .gitignore files the repo carries, from its top down to the folder's .claude/, copied in place into a
  // scratch repo with no excludes: this computer's own excludes (global, .git/info/exclude) can then neither stand
  // in for them nor mask them (a ".claude/" line there would be the rule git names, the repo's line unseen).
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pass-p25-"));
  let carried;
  try {
    const parts = path.join(rel, ".claude").split(path.sep).filter(Boolean);
    for (let i = 0; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join(path.sep);
      const src = path.join(top, sub, ".gitignore");
      if (!isFile(src)) continue;
      fs.mkdirSync(path.join(scratch, sub), { recursive: true });
      fs.copyFileSync(src, path.join(scratch, sub, ".gitignore"));
    }
    const init = spawnSync("git", ["init", "-q", scratch], {
      encoding: "utf8",
    });
    if (init.status !== 0)
      throw new Error(
        `git init in ${fwd(scratch)} failed: ${init.stderr.trim()}`,
      );
    const none = path.join(scratch, ".git", "no-excludes");
    fs.writeFileSync(none, "");
    fs.writeFileSync(path.join(scratch, ".git", "info", "exclude"), "");
    carried = ruleOf(
      spawnSync(
        "git",
        [
          "-C",
          scratch,
          "-c",
          `core.excludesFile=${fwd(none)}`,
          "check-ignore",
          "-v",
          "--no-index",
          relFile,
        ],
        { encoding: "utf8" },
      ),
      `a scratch copy of ${fwd(top)}'s .gitignore files`,
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  if (!carried || carried.pattern.startsWith("!")) {
    const here = ruleOf(
      gitRead(dir, "check-ignore", "-v", "--no-index", LOCAL_SETTINGS),
      fwd(dir),
    );
    const why = carried
      ? ` (the line \`${carried.pattern}\` in ${carried.source} un-ignores it)`
      : here && !here.pattern.startsWith("!")
        ? ` (only ${here.source} on this computer ignores it, and a clone elsewhere does not have that)`
        : "";
    add(
      "P25.ignore",
      "ask",
      ".gitignore",
      `${LOCAL_SETTINGS} is not ignored by a .gitignore the repo carries${why}: add the line \`**/settings.local.json\`, because the "don't ask again" list keeps each approved command word for word, a typed token or password too`,
    );
  }
  const ls = gitRead(dir, "ls-files", "--", LOCAL_SETTINGS);
  if (ls.status !== 0)
    throw new Error(`git ls-files failed in ${fwd(dir)}: ${ls.stderr.trim()}`);
  if (ls.stdout.trim())
    add(
      "P25.tracked",
      "ask",
      LOCAL_SETTINGS,
      `git tracks ${LOCAL_SETTINGS}: run git rm --cached ${LOCAL_SETTINGS}, then commit on the person's word without naming that file (a commit that names it takes the copy on disk and tracks it again); read git log -p -- ${LOCAL_SETTINGS} and rotate at its provider any token or password in it, because the history keeps it`,
    );
  // P28 is retired (the reviewer reads no review-rules file); its number is not reused
  // P29: the safety baseline of a push and a deploy (workers/ship-check.mjs). A repo with a remote pushes somewhere,
  // so it is switched on: .claude/ship-check.json at the repo's top
  const remotes = gitRead(dir, "remote");
  if (remotes.status !== 0)
    throw new Error(
      `git remote failed in ${fwd(dir)}: ${remotes.stderr.trim()}`,
    );
  if (remotes.stdout.trim() && !isFile(atTop(".claude/ship-check.json")))
    add(
      "P29",
      "ask",
      topRel(".claude/ship-check.json"),
      "missing: the repo has a remote, but its pushes and deploys run without the safety baseline. Run node ~/.claude/workers/ship-check.mjs init (it writes this file and the missing ignore lines for secret files), then node ~/.claude/workers/ship-check.mjs push --full once and show its findings",
    );
  // P23: the changelog's headings and plain tags (only in a folder with a CHANGELOG.md or a tag)
  if (isFile(at("CHANGELOG.md"))) {
    const heads = lines(at("CHANGELOG.md"))
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /^## /.test(l));
    const old = heads.filter(
      ([, l]) =>
        !/^## \[Unreleased\]\s*$|^## \[[^\]]+\] - \d{4}-\d{2}-\d{2}\s*$/.test(
          l,
        ),
    );
    if (!heads.length || old.length)
      add(
        "P23",
        "ask",
        "CHANGELOG.md",
        `${
          heads.length
            ? `old-form headings at lines ${old
                .slice(0, 8)
                .map(([n]) => n)
                .join(", ")}${old.length > 8 ? ` +${old.length - 8} more` : ""}`
            : "no ## heading"
        }: use ## [Unreleased] and ## [<version>] - YYYY-MM-DD (a judgment edit, shown)`,
      );
  }
  const tr = gitRead(
    dir,
    "for-each-ref",
    "refs/tags",
    "--format=%(objecttype) %(creatordate:short) %(refname:short)",
  );
  if (tr.status !== 0)
    throw new Error(
      `git for-each-ref failed in ${fwd(dir)}: ${tr.stderr.trim()}`,
    );
  const plain = tr.stdout
    .split(/\r?\n/)
    .map((l) => l.split(" "))
    .filter(([type, date]) => type === "commit" && (!since || date > since))
    .map(([, , name]) => name);
  if (plain.length)
    add(
      "P23",
      since ? "ask" : "note",
      "refs/tags",
      `plain (not annotated) tags${since ? ` made after ${since}` : ""}: ${plain.slice(0, 8).join(", ")}${plain.length > 8 ? ` +${plain.length - 8} more` : ""}; old tags stay as they are, new tags are made with git tag -a v<version>`,
    );
  // P26 reads the run times of every workflow that runs on pull requests
  const wfTop = atTop(".github/workflows");
  const ciFlows = (isDir(wfTop) ? fs.readdirSync(wfTop) : [])
    .filter(
      (n) =>
        /\.ya?ml$/.test(n) &&
        /\bpull_request\b(?!_)/.test(read(path.join(wfTop, n))),
    )
    .sort();
  if (!gh) {
    if (ciFlows.length)
      add(
        "P26",
        "note",
        `${topRel(".github/workflows")}/`,
        "CI speed not checked: no github.com remote, so there are no CI runs to read",
      );
    return { gh: null };
  }
  // P16: the default branch as the clone knows it, and the branch flow in the Git: line
  const sr = gitRead(
    dir,
    "symbolic-ref",
    "--quiet",
    `refs/remotes/${gh.remote}/HEAD`,
  );
  const branch =
    sr.status === 0
      ? sr.stdout.trim().replace(`refs/remotes/${gh.remote}/`, "")
      : null;
  if (branch && branch !== "main" && !SAFE_BRANCH.test(branch))
    add("P16", "note", `${gh.remote}/HEAD`, ODD_BRANCH);
  else if (branch && branch !== "main")
    add(
      "P16",
      "ask",
      `${gh.remote}/HEAD`,
      `the default branch is ${branch}: rename it to main as its own tick (gh api -X POST repos/${gh.owner}/${gh.repo}/branches/${branch}/rename -f new_name=main); GitHub moves open pull requests and protection, and each clone needs git branch -m ${branch} main and a fetch`,
    );
  if (
    has === "github" &&
    !(
      /\bbranch\b/.test(line) &&
      /pull request/.test(line) &&
      /\bmain\b/.test(line)
    )
  )
    add(
      "P16",
      "ask",
      "CLAUDE.md",
      `the Git: line names no branch flow (main, a branch per change, a pull request): make it \`${githubLine("<private|public>")}\``,
    );
  // P17-P18: the pull-request template, a CI workflow on pull requests (no Dependabot file: its version pull
  // requests are noise for a small team; Claude bumps the packages as part of the work)
  const dotGh = atTop(".github");
  const ghNames = isDir(dotGh) ? fs.readdirSync(dotGh) : [];
  if (
    !ghNames.some(
      (n) =>
        n.toLowerCase() === "pull_request_template.md" ||
        (n.toLowerCase() === "pull_request_template" &&
          isDir(path.join(dotGh, n))),
    )
  )
    add(
      "P17",
      "ask",
      topRel(".github/pull_request_template.md"),
      `missing: copy ${PRESET}/pull_request_template.md`,
    );
  const wf = path.join(dotGh, "workflows");
  const flows = isDir(wf)
    ? fs.readdirSync(wf).filter((n) => /\.ya?ml$/.test(n))
    : [];
  if (
    !flows.some((n) => /\bpull_request\b(?!_)/.test(read(path.join(wf, n))))
  ) {
    const stack = isFile(at("package.json"))
      ? "ci-node.yml"
      : ["pyproject.toml", "requirements.txt", "setup.py"].some((n) =>
            isFile(at(n)),
          )
        ? "ci-python.yml"
        : "ci-generic.yml";
    const what = flows.length
      ? `no workflow runs on pull requests (${flows.join(", ")})`
      : "no workflow";
    const cost =
      "; on a private repo each run spends the included minutes (about $12 a month on Free), and runs stop, unbilled, when they are used up";
    if (stack === "ci-generic.yml" && !/^#+\s*Checks\b/m.test(t))
      add(
        "P18",
        "note",
        `${topRel(".github/workflows")}/`,
        `${what}; not offered: no test command is known (CLAUDE.md has no Checks section), and a workflow with nothing to run proves nothing`,
      );
    else
      add(
        "P18",
        "ask",
        topRel(".github/workflows/ci.yml"),
        `${what}: copy ${PRESET}/${stack} with the test command filled in, and add the Checks merge line${cost}`,
      );
  }
  return { gh, line, has, branch, ciFlows };
}

// ---- P20-P22: the GitHub settings, read with GETs. The token: the owner's, when the owner is a signed-in gh account
// (names compare case-insensitively); else (an organisation's repo) the first signed-in account whose token can read
// the repo. No gh, no account that can read it, or GitHub not reachable: each prints a note and nothing else.
// A GitHub HTTP error after that throws an error with .notRun (the checks that did not run) for check() to print.
// P26 (CI speed) reads with the same token, and needs no admin.
const CI_SLOW_SECONDS = 300;
function checkGitHub(add, g) {
  const { owner, repo } = g.gh,
    slug = `${owner}/${repo}`,
    where = `github.com/${slug}`;
  const bin = process.env.PASS_GH || "gh";
  const gh = (a, env) =>
    /\.m?js$/.test(bin)
      ? spawnSync(process.execPath, [bin, ...a], { encoding: "utf8", env })
      : spawnSync(bin, a, { encoding: "utf8", env });
  const settings = ["P20", "P21", "P22"],
    all = g.ciFlows.length ? [...settings, "P26"] : settings;
  // adminOnly: the account can read the repo, so P26 still runs
  const skipped = (why, adminOnly = false) => {
    for (const id of adminOnly ? settings : all)
      add(id, "note", where, `not checked: ${why}`);
    if (!g.branch)
      add(
        "P16",
        "note",
        where,
        "the default branch is not known: the clone has no origin/HEAD and GitHub was not read",
      );
  };
  const status = gh(["auth", "status"]);
  if (status.error) return skipped(`gh not found (${bin})`);
  // gh auth status exits 1 when one account has a fault; the accounts signed in are read from its lines either way
  const accounts = [
    ...`${status.stdout}\n${status.stderr}`.matchAll(
      /Logged in to github\.com (?:account|as) (\S+)/g,
    ),
  ].map((m) => m[1]);
  if (!accounts.length)
    return skipped("no gh account is signed in (gh auth login)");
  // an account's token, or null when gh gives none
  const tokenOf = (name) => {
    const t = gh(["auth", "token", "-u", name]);
    return t.error || t.status !== 0 ? null : t.stdout.trim();
  };
  const call = (p, token) => {
    const r = gh(["api", p], { ...process.env, GH_TOKEN: token });
    if (r.error)
      throw new Error(`gh api ${p} could not run: ${r.error.message}`);
    return {
      ok: r.status === 0,
      out: r.stdout || "",
      msg: ((r.stderr || "").trim() || (r.stdout || "").trim()).split("\n")[0],
    };
  };
  // the checks still to run, named when a GitHub error stops them
  let pending = [...all];
  if (!g.branch) pending.unshift("P16 (the default branch)");
  if (g.has === "github") pending.unshift("P13 (the visibility)");
  const fail = (p, r) => {
    throw Object.assign(new Error(`GitHub answered gh api ${p}: ${r.msg}`), {
      where,
      notRun: pending,
    });
  };
  // P26: CI speed. For each workflow on pull requests, its last 20 completed runs; only runs that did the work count
  // (success, failure, timed_out), so cancelled, skipped, action_required, startup_failure and the like are left out.
  // The slowest workflow by median, over CI_SLOW_SECONDS: a CI speed pass is offered.
  const ciSpeed = (tok) => {
    if (!g.ciFlows.length) return;
    pending = ["P26"];
    const timed = [],
      untimed = [];
    for (const file of g.ciFlows) {
      const p = `repos/${slug}/actions/workflows/${encodeURIComponent(file)}/runs?status=completed&per_page=20`;
      const r = call(p, tok);
      // a 404: GitHub does not know the file (not pushed yet); a known workflow with no runs answers an empty list
      if (!r.ok && /HTTP 404/.test(r.msg)) {
        untimed.push(
          `${file}: GitHub does not know this workflow file (not pushed yet)`,
        );
        continue;
      }
      if (!r.ok) fail(p, r);
      const secs = JSON.parse(r.out)
        .workflow_runs.filter((x) =>
          ["success", "failure", "timed_out"].includes(x.conclusion),
        )
        .map(
          (x) =>
            (Date.parse(x.updated_at) -
              Date.parse(x.run_started_at || x.created_at)) /
            1000,
        )
        .sort((a, b) => a - b);
      if (secs.length < 5) {
        untimed.push(`${file}: ${secs.length} finished runs`);
        continue;
      }
      const mid = secs.length / 2;
      timed.push({
        file,
        n: secs.length,
        median:
          secs.length % 2
            ? secs[Math.floor(mid)]
            : (secs[mid - 1] + secs[mid]) / 2,
        slowest: secs[secs.length - 1],
      });
    }
    if (!timed.length)
      return add(
        "P26",
        "note",
        `${where}/actions`,
        `CI speed not checked: ${untimed.join("; ")}; a median needs 5 finished runs`,
      );
    const top = timed.sort((a, b) => b.median - a.median)[0];
    const mins = (s) => {
      const r = Math.round(s);
      return `${Math.floor(r / 60)}m ${String(r % 60).padStart(2, "0")}s`;
    };
    if (top.median > CI_SLOW_SECONDS)
      add(
        "P26",
        "ask",
        `${where}/actions/workflows/${top.file}`,
        `${top.file} takes ${mins(top.median)} at the median, ${mins(top.slowest)} at the slowest, over its last ${top.n} finished runs: a CI speed pass by ~/.claude/skills/update-project/fast-ci.md (time each step first, then fix the biggest)`,
      );
  };
  // GitHub's repo answer names the caller's rights; a token that is no admin cannot see or change P20-P22
  const isAdmin = (r) => JSON.parse(r.out).permissions?.admin === true;
  const ownerAccount = accounts.find(
    (a) => a.toLowerCase() === owner.toLowerCase(),
  );
  let token = null,
    first = null;
  if (ownerAccount) {
    token = tokenOf(ownerAccount);
    if (!token)
      return skipped(`gh gives no token for ${ownerAccount} (gh auth login)`);
    first = call(`repos/${slug}`, token);
  } else {
    // anyone can read a public repo, so an account counts only when GitHub names it an admin of the repo
    let readable = null;
    for (const a of accounts) {
      const t = tokenOf(a);
      if (!t) continue;
      const r = call(`repos/${slug}`, t);
      if (!r.ok && !/HTTP \d{3}/.test(r.msg)) {
        token = t;
        first = r;
        break;
      }
      if (!r.ok) continue;
      if (isAdmin(r)) {
        token = t;
        first = r;
        break;
      }
      readable ??= { a, t };
    }
    if (!first && readable) {
      skipped(
        `no signed-in gh account is an admin of ${slug} (tried ${accounts.join(", ")}): GitHub shows and changes these settings only for an admin`,
        true,
      );
      return ciSpeed(readable.t);
    }
    if (!first)
      return skipped(
        `no signed-in gh account can read ${slug} (tried ${accounts.join(", ")}): one of them needs access to ${slug}`,
      );
  }
  if (first.ok && !isAdmin(first)) {
    skipped(
      `${ownerAccount} is not an admin of ${slug}: GitHub shows and changes these settings only for an admin`,
      true,
    );
    return ciSpeed(token);
  }
  const api = (p) => call(p, token);
  // a GET whose 404 means "off" (GitHub's answer for a setting that is not on): the JSON, true for an empty 2xx, or null
  const getOrOff = (p) => {
    const r = api(p);
    if (r.ok) return r.out.trim() ? JSON.parse(r.out) : true;
    if (/HTTP 404/.test(r.msg)) return null;
    return fail(p, r);
  };
  if (!first.ok) {
    if (/HTTP \d{3}/.test(first.msg)) fail(`repos/${slug}`, first);
    return skipped(`GitHub not reachable (${first.msg})`);
  }
  pending = [...all];
  const r = JSON.parse(first.out);
  const vis = r.private ? "private" : "public";
  // P13: the visibility the Git: line names; P16: the default branch, when the clone does not know it
  const named = g.line?.match(/^GitHub \((private|public)\)/)?.[1];
  if (named && named !== vis)
    add(
      "P13",
      "ask",
      "CLAUDE.md",
      `the Git: line says ${named}, GitHub says ${vis}: make it \`${githubLine(vis)}\``,
    );
  if (
    !g.branch &&
    r.default_branch !== "main" &&
    !SAFE_BRANCH.test(r.default_branch)
  )
    add("P16", "note", where, ODD_BRANCH);
  else if (!g.branch && r.default_branch !== "main")
    add(
      "P16",
      "ask",
      where,
      `the default branch is ${r.default_branch}: rename it to main as its own tick (gh api -X POST repos/${slug}/branches/${r.default_branch}/rename -f new_name=main); GitHub moves open pull requests and protection, and each clone needs git branch -m ${r.default_branch} main and a fetch`,
    );
  // P20: the merge settings
  const want = {
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    squash_merge_commit_title: "PR_TITLE",
    delete_branch_on_merge: true,
  };
  const differ = Object.entries(want)
    .filter(([k, v]) => r[k] !== v)
    .map(
      ([k]) =>
        `${k} ${r[k] === undefined ? "(not shown to this account)" : JSON.stringify(r[k])}`,
    );
  if (differ.length)
    add(
      "P20",
      "ask",
      where,
      `merge settings: ${differ.join(", ")}: the merge-settings PATCH of new-project step 2b, then a read-back`,
    );
  pending = all.slice(1);
  // P21: a ruleset on the default branch; GitHub Free answers 403 for a private repo
  const rs = api(`repos/${slug}/rulesets`);
  if (!rs.ok && /Upgrade to GitHub Pro/i.test(rs.out + rs.msg))
    add(
      "P21",
      "note",
      where,
      "a protected main is not possible on this plan for a private repo: the flow stays a written rule in CLAUDE.md",
    );
  else {
    if (!rs.ok) fail(`repos/${slug}/rulesets`, rs);
    const rules = JSON.parse(rs.out).length
      ? getOrOff(
          `repos/${slug}/rules/branches/${encodeURIComponent(r.default_branch)}`,
        ) || []
      : [];
    const types = new Set(rules.map((x) => x.type));
    const missing = ["pull_request", "non_fast_forward", "deletion"].filter(
      (x) => !types.has(x),
    );
    if (!types.has("required_status_checks")) {
      const runs = getOrOff(
        `repos/${slug}/actions/runs?status=success&per_page=1`,
      );
      if (runs?.total_count > 0)
        missing.push("required_status_checks (CI has run green)");
    }
    if (missing.length)
      add(
        "P21",
        "ask",
        where,
        `the ruleset on ${r.default_branch} lacks: ${missing.join(", ")}: create or update the ruleset of new-project step 2b`,
      );
  }
  pending = all.slice(2);
  // P22: the security settings (public: all of them; private on Free: Dependabot alerts and security updates only)
  const off = [];
  if (!getOrOff(`repos/${slug}/vulnerability-alerts`))
    off.push("Dependabot alerts");
  if (!getOrOff(`repos/${slug}/automated-security-fixes`)?.enabled)
    off.push("Dependabot security updates");
  if (vis === "public") {
    const sa = r.security_and_analysis || {};
    if (sa.secret_scanning?.status !== "enabled") off.push("secret scanning");
    if (sa.secret_scanning_push_protection?.status !== "enabled")
      off.push("push protection");
    if (!getOrOff(`repos/${slug}/private-vulnerability-reporting`)?.enabled)
      off.push("private vulnerability reporting");
    if (
      getOrOff(`repos/${slug}/code-scanning/default-setup`)?.state !==
      "configured"
    )
      off.push("CodeQL default setup");
  }
  if (off.length)
    add(
      "P22",
      "ask",
      where,
      `off on this ${vis} repo: ${off.join(", ")}: one call per setting (new-project step 2b, Security settings), then a read-back`,
    );
  ciSpeed(token);
}

// ---- folders worked in lately: the project homes, plus the cwd of the newest transcript in each
// ~/.claude/projects/<slug>/ touched in the last 90 days (the slug is lossy, the cwd is not)
export function candidates() {
  const found = new Map(projectHomes().map((h) => [h, null]));
  const projects = path.join(CLAUDE, "projects"),
    since = Date.now() - 90 * 864e5;
  for (const slug of isDir(projects) ? fs.readdirSync(projects) : []) {
    const d = path.join(projects, slug);
    if (!isDir(d)) continue;
    const newest = fs
      .readdirSync(d)
      .filter((n) => n.endsWith(".jsonl"))
      .map((n) => ({
        f: path.join(d, n),
        t: fs.statSync(path.join(d, n)).mtimeMs,
      }))
      .sort((a, b) => b.t - a.t)[0];
    if (!newest || newest.t < since) continue;
    const fd = fs.openSync(newest.f, "r"),
      buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = buf.toString("utf8", 0, n).match(/"cwd":("(?:[^"\\]|\\.)*")/);
    if (!m) continue;
    const k = key(JSON.parse(m[1]));
    if (found.has(k) && found.get(k) >= newest.t) continue;
    found.set(k, newest.t);
  }
  return [...found]
    .filter(
      ([f]) =>
        f !== key(home) &&
        isDir(f) &&
        (fs.existsSync(path.join(f, "CLAUDE.md")) ||
          fs.existsSync(path.join(f, ".git"))),
    )
    .map(([folder, t]) => ({ folder, last: t ? localDay(new Date(t)) : null }))
    .sort((a, b) => (b.last || "").localeCompare(a.last || ""));
}

// ---- the modes
const folderAfter = (flag, need) => {
  const v = flagValue(flag);
  if (v === null || (v === undefined && need)) stop(`${flag} needs a folder.`);
  const f = path.resolve(v || process.cwd());
  if (!isDir(f)) stop(`${fwd(f)} is not a folder.`);
  return f;
};
const MODES = {
  "--check": () => {
    const dir = folderAfter("--check", false),
      s = readStamp();
    const f0 = s.folders[key(dir)];
    const found = check(dir, f0?.kept || [], f0?.date || null);
    for (const f of found)
      console.log(
        `${f.id.padEnd(6)}  ${f.kind.padEnd(4)}  ${f.file}  ${f.what}`,
      );
    const n = (k) => found.filter((f) => f.kind === k).length;
    console.log(
      `project-pass ${key(dir)} · ${n("fix")} to fix · ${n("ask")} to ask · ${n("note")} notes · level ${s.level}`,
    );
  },
  "--list": () => {
    const s = readStamp(),
      list = candidates();
    if (!list.length)
      console.log(
        "project-pass: no project folders worked in during the last 90 days",
      );
    for (const c of list)
      console.log(
        `${c.folder}  ${stateOf(s, c.folder)}  last used ${c.last || "unknown (a project home)"}`,
      );
    const behind = list.filter((c) => stateOf(s, c.folder) === "behind").length;
    console.log(
      `project-pass list · ${list.length} folders · ${behind} behind · level ${s.level} · mode ${s.mode}`,
    );
  },
  "--done": () => {
    const dir = folderAfter("--done", true),
      s = readStamp(),
      k = key(dir);
    const kv = flagValue("--kept");
    if (kv === null) stop("--kept needs the ids, comma-separated.");
    const kept = [
      ...new Set([
        ...(s.folders[k]?.kept || []),
        ...(kv
          ? kv
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          : []),
      ]),
    ];
    s.folders[k] = { done: s.level, date: localDay(new Date()), kept };
    delete s.declined[k];
    saveStamp(s);
    console.log(
      `project-pass done: ${k} at level ${s.level}${kept.length ? `, kept ${kept.join(", ")}` : ""}`,
    );
  },
  "--skip": () => {
    const dir = folderAfter("--skip", true),
      s = readStamp(),
      k = key(dir);
    s.declined[k] = s.level;
    saveStamp(s);
    console.log(
      `project-pass skipped: ${k} is not offered again until the level rises above ${s.level}; /update-project any time`,
    );
  },
  "--skip-all": () => {
    const s = readStamp();
    s.declinedAll = s.level;
    saveStamp(s);
    console.log(
      `project-pass skipped for every folder until the level rises above ${s.level}; /update-project any time`,
    );
  },
  "--status": () => {
    const s = readStamp();
    console.log(
      `project-pass status · level ${s.level} · mode ${s.mode} · ${Object.keys(s.folders).length} done · ${Object.keys(s.declined).length} declined${s.declinedAll ? ` · all declined at level ${s.declinedAll}` : ""}`,
    );
    for (const [f, v] of Object.entries(s.folders))
      console.log(
        `  ${f}: ${v.done >= s.level ? "done" : "behind"} (level ${v.done}, ${v.date})${v.kept?.length ? ` kept ${v.kept.join(", ")}` : ""}`,
      );
    for (const [f, l] of Object.entries(s.declined))
      console.log(`  ${f}: declined at level ${l}`);
  },
};
// started as the script, not imported: by real path, as file-check.mjs
const realOr = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
if (
  process.argv[1] &&
  realOr(process.argv[1]).toLowerCase() ===
    realOr(fileURLToPath(import.meta.url)).toLowerCase()
) {
  const mode = Object.keys(MODES).filter((m) => args.includes(m));
  if (mode.length !== 1)
    stop(`give exactly one of ${Object.keys(MODES).join(", ")}.`);
  try {
    MODES[mode[0]]();
  } catch (e) {
    stop(e.message);
  }
}
