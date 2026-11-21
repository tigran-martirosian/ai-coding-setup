#!/usr/bin/env node
// file-name-note: a PreToolUse hook in the dispatcher's pre-tool group (Write only). A Write that makes a new file
// whose name or place breaks the file standard (skills/file-upkeep/standard.md: N1-N8, P8 folder roles, P10 the
// projects root) gets one note for Claude naming the rule and the proposed name, both as absolute paths, so the file
// is made right the first time instead of renamed later. The call itself is never rewritten or refused, auto mode
// included.
// No project of the person's, so nothing: ~/.claude (Claude Code's own names), the temp folder (os.tmpdir(), real
// paths; the tests point TEMP, TMP and TMPDIR elsewhere to judge their made-up projects there), and a file in no
// project. The project is the file's git top, else the nearest folder with CLAUDE.md, looked for below the home
// folder. A file straight in the projects folder (file-check.mjs projectsRoot) or in a new top folder there is judged
// against the projects folder itself, so P10 applies; one in an existing top folder needs a project inside it.
// The checking is file-check.mjs newPathNotes: the one path and a listing of its folder. Nothing for an existing file
// or a git-ignored one. The person's own setting files when broken (~/.claude/setup-state.json,
// .claude/file-standard.json) give nothing, silently: they are not the hook's fault and would log on every Write.
// Any other fault is runHook's: one line in hook-errors.log, and the Write goes through.
// FILE_NAME_NOTE=off disables it, also from a project's settings env.
// It imports from skills/, unlike the other hooks: the checker is the standard's one reading of the names, and
// hooks/ and skills/ are siblings both in the repo and in ~/.claude. It is loaded only after the cheap checks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emit, runHook } from "./lib/hook-io.mjs";
import { fileKey, gitBashToNative } from "./lib/paths.mjs";

const CHECKER = new URL(
  "../skills/file-upkeep/file-check.mjs",
  import.meta.url,
);
// newPathNotes' faults that are a broken setting file: .claude/file-standard.json (not valid JSON, an ignore without
// a reason) or ~/.claude/setup-state.json (not valid JSON; newPathNotes reads it through projectsRoot)
const SETTING_FAULT = /(file-standard|setup-state)\.json/;

// A path in its real form, so a short temp name (C:\Users\<name>~1) or a link compares right: the nearest part of it
// that exists through realpath, then the rest
function real(p) {
  const rest = [];
  for (let d = path.resolve(p); ; ) {
    try {
      return path.join(fs.realpathSync.native(d), ...rest);
    } catch {
      const up = path.dirname(d);
      if (up === d) return path.resolve(p);
      rest.unshift(path.basename(d));
      d = up;
    }
  }
}
const same = (a, b) => fileKey(a) === fileKey(b);
// strictly inside
const within = (root, file) => fileKey(file).startsWith(`${fileKey(root)}/`);

// The file's git top, else its nearest folder with CLAUDE.md, below the home folder (a home with a .git of its own
// is no project); null when none
function projectFolder(file, home) {
  let claudeMd = null;
  for (let d = path.dirname(file); !same(d, home); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (!claudeMd && fs.existsSync(path.join(d, "CLAUDE.md"))) claudeMd = d;
    if (path.dirname(d) === d) break;
  }
  return claudeMd;
}

// The folder newPathNotes judges the file in, or null when the file is in no project
function rootOf(file, found, projects) {
  if (!projects || !within(projects, file)) return found;
  const top = path.relative(projects, file).split(path.sep)[0];
  if (same(path.dirname(file), projects)) return projects;
  if (!fs.existsSync(path.join(projects, top))) return projects;
  return found && within(projects, found) ? found : null;
}

runHook(
  "file-name-note",
  async (event) => {
    if (event.tool_name !== "Write") return;
    const given = event.tool_input?.file_path;
    if (typeof given !== "string") return;
    const native = gitBashToNative(given);
    if (!path.isAbsolute(native) || fs.existsSync(native)) return;
    const file = real(native);
    const home = real(os.homedir());
    if (
      within(path.join(home, ".claude"), file) ||
      within(real(os.tmpdir()), file)
    )
      return;
    const found = projectFolder(file, home);
    const { newPathNotes, projectsRoot } = await import(CHECKER.href);
    let projects = null;
    try {
      projects = projectsRoot(os.homedir());
    } catch {
      // a broken setup-state.json: no projects folder is known, so P10 is not judged
    }
    const root = rootOf(file, found, projects && real(projects));
    if (!root) return;
    const rel = path.relative(root, file).split(path.sep).join("/");
    let notes;
    try {
      notes = newPathNotes(root, rel);
    } catch (err) {
      if (SETTING_FAULT.test(err.message)) return;
      throw err;
    }
    if (!notes.length) return;
    const abs = (r) => path.join(root, r).replace(/\\/g, "/");
    const rules = [...new Set(notes.map((n) => n.rule))].join("+");
    const target = notes.find((n) => n.target)?.target;
    const lines = [
      `file-name-note: the new file ${abs(rel)} breaks the file standard (${rules}, ~/.claude/skills/file-upkeep/standard.md):`,
      ...notes.map((n) => `${n.rule}: ${n.why}`),
      target
        ? `Proposed: ${abs(target)}. Write it there instead, unless the name is right as it is.`
        : `No name is proposed: pick one that follows the rule, or keep this one if it is right.`,
    ];
    emit.context("PreToolUse", lines.join("\n"));
  },
  { projectSettings: true },
);
