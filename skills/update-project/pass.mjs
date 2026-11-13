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
// The stamp is ~/.claude/project-pass.json: {level, folders: {<folder>: {done, date, kept}}, declined: {<folder>: level},
// declinedAll, mode: "on-open"|"off"}. Nothing is written into a project, which may be a shared repo.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The pass level this file's checks implement. It goes up only with a release that changes what a project folder
// should hold (the new-project base table, the file standard, checks.md); version.json's projectPass equals it.
export const LEVEL = 2;

const args = process.argv.slice(2);
const stop = (why) => {
  console.log(`project-pass stopped: ${why}`);
  process.exit(1);
};
const valueOf = (flag) => {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const v = args[at + 1];
  return v && !v.startsWith("--") ? v : null;
};
const homeArg = valueOf("--home");
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
const lineCount = (f) => {
  const t = read(f);
  return t ? t.split(/\r?\n/).length - (t.endsWith("\n") ? 1 : 0) : 0;
};
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
// the script a hook command runs: the first token ending in a script extension, with ~ and the project variable resolved
const hookScript = (cmd, dir) => {
  const m = cmd.match(/(["']?)([^"'\s]+\.(?:mjs|cjs|js|py|sh|ps1))\1/);
  if (!m) return null;
  const p = m[2]
    .replace(/^~(?=\/)/, home)
    .replace(/\$\{?CLAUDE_PROJECT_DIR\}?/, dir)
    .replace(/\$\{?HOME\}?/, home);
  return path.isAbsolute(p) ? p : path.join(dir, p);
};
// a backticked path worth checking: has a slash (a bare file name is a name, not a path), no placeholder, wildcard,
// variable or address, and is not a slash command
const looksLikePath = (t) =>
  /[/\\]/.test(t) &&
  !/[<>*{}$%|=()[\] ]|^-|:\/\/|^\.\.\.|…/.test(t) &&
  !/^\/[\w-]+$/.test(t);

export function check(dir, kept = []) {
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
  // P3, P4: lengths and replaced decisions
  if (isFile(at("HANDOFF.md")) && lineCount(at("HANDOFF.md")) > 120)
    add(
      "P3",
      "ask",
      "HANDOFF.md",
      `${lineCount(at("HANDOFF.md"))} lines, over 120: cut done work and old state`,
    );
  if (isFile(at("DECISIONS.md"))) {
    const n = lineCount(at("DECISIONS.md"));
    const marked = lines(at("DECISIONS.md"))
      .map((l, i) => (/\bReplaces\b|\breplaced by\b/i.test(l) ? i + 1 : 0))
      .filter(Boolean);
    if (n > 300 || marked.length)
      add(
        "P4",
        "ask",
        "DECISIONS.md",
        `${n} lines${marked.length ? `; marked replaced at lines ${marked.slice(0, 8).join(", ")}${marked.length > 8 ? ` +${marked.length - 8} more` : ""}` : ""}: move replaced entries to docs/decisions-archive.md`,
      );
  }
  checkClaudeFolder(dir, add);
  checkFiles(dir, add);
  checkPaths(dir, add);
  checkFacts(dir, add);
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
          const p = typeof h.command === "string" && hookScript(h.command, dir);
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

// P6: the file standard's checker; P7: untracked entries in a git folder
function checkFiles(dir, add) {
  const fc = path.join(HERE, "..", "file-upkeep", "file-check.mjs");
  if (!isFile(fc))
    throw new Error(
      `${fwd(fc)} is missing: the file-upkeep skill is part of the setup.`,
    );
  const r = spawnSync(process.execPath, [fc, "--report", dir, "--home", home], {
    encoding: "utf8",
  });
  if (r.status !== 0)
    throw new Error(
      `file-check.mjs --report failed: ${(r.stdout + r.stderr).trim().split("\n").pop()}`,
    );
  for (const l of r.stdout.split(/\r?\n/)) {
    const m = l.match(/^(F\d+)\s+(\S+)\s+(fix|ask)\s+(.*)$/);
    if (m) add("P6", m[3], m[4].split(" ")[0], `${m[1]} ${m[2]}: ${m[4]}`);
  }
  if (!fs.existsSync(path.join(dir, ".git"))) return;
  const g = spawnSync(
    "git",
    ["-C", dir, "status", "--porcelain", "--untracked-files=normal"],
    { encoding: "utf8" },
  );
  if (g.status !== 0)
    throw new Error(`git status failed in ${fwd(dir)}: ${g.stderr.trim()}`);
  const groups = new Map();
  for (const l of g.stdout.split("\n").filter((x) => x.startsWith("?? "))) {
    const p = l.slice(3).replace(/^"|"$/g, ""),
      top = p.includes("/") ? p.split("/")[0] + "/" : p;
    groups.set(top, (groups.get(top) || 0) + 1);
  }
  for (const [top, n] of groups)
    add(
      `P7.${top.replace(/\/$/, "")}`,
      "ask",
      top,
      `untracked${n > 1 ? ` (${n} entries)` : ""}: commit, add to .gitignore, or delete`,
    );
}

// P8: backticked paths in the notes that are found neither under the folder nor under ~, and the memory notes
function checkPaths(dir, add) {
  const rules = path.join(dir, ".claude", "rules");
  const notes = [
    "CLAUDE.md",
    "HANDOFF.md",
    ...(isDir(rules)
      ? fs
          .readdirSync(rules)
          .filter((n) => n.endsWith(".md"))
          .map((n) => `.claude/rules/${n}`)
      : []),
  ];
  for (const n of notes.filter((x) => isFile(path.join(dir, x)))) {
    const seen = new Set();
    lines(path.join(dir, n)).forEach((l, i) => {
      for (const [, t] of l.matchAll(/`([^`\n]+)`/g)) {
        if (!looksLikePath(t) || seen.has(t)) continue;
        seen.add(t);
        const p = t.replace(/^~(?=[/\\]|$)/, home).replace(/[/\\:]+$/, "");
        if (
          path.isAbsolute(p)
            ? fs.existsSync(p)
            : fs.existsSync(path.join(dir, p)) ||
              fs.existsSync(path.join(home, p))
        )
          continue;
        add(
          `P8.${t}`,
          "ask",
          `${n}:${i + 1}`,
          `\`${t}\` not found from the folder or ~: look where the note says it lives, then edit or drop`,
        );
      }
    });
  }
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
  const rd = path.join(CLAUDE, "hooks", "recheck-dates.mjs");
  if (!isFile(rd))
    add(
      "P9",
      "note",
      "~/.claude/hooks/recheck-dates.mjs",
      "not installed: recheck dates are not checked",
    );
  else {
    const r = spawnSync(process.execPath, [rd, "--list", dir], {
      encoding: "utf8",
    });
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
      add("P12", "fix", ".claude/systems-map.json", `does not parse: ${e.message}`);
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
  const v = valueOf(flag);
  if (v === null || (v === undefined && need)) stop(`${flag} needs a folder.`);
  const f = path.resolve(v || process.cwd());
  if (!isDir(f)) stop(`${fwd(f)} is not a folder.`);
  return f;
};
const MODES = {
  "--check": () => {
    const dir = folderAfter("--check", false),
      s = readStamp();
    const found = check(dir, s.folders[key(dir)]?.kept || []);
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
    const kv = valueOf("--kept");
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
