// The base project folders from projects/ (each with its skills, hooks, tools, CLAUDE.md and its own
// .claude/settings.json), with the picture skill linked in where Codex is used. Returns `written`: the
// notes files (CLAUDE.md, HOW-TO.md) as a run last wrote them, for state.written.
import fs from "node:fs";
import path from "node:path";
import { filesIn, fwd, read, sha } from "./files.mjs";
import { retire, wire } from "./wiring.mjs";

const NOTE = "## Workers on this computer";
// The lines about a missing worker, as the last section of a folder's CLAUDE.md; none when nothing is missing
function withNote(text, wanted) {
  const lines = text.split("\n");
  const i = lines.indexOf(NOTE);
  if (i === -1 && !wanted.length) return text;
  if (i !== -1) { let j = i + 1; while (j < lines.length && !/^#{1,2} /.test(lines[j])) j++; lines.splice(i, j - i); }
  while (lines.length && lines.at(-1) === "") lines.pop();
  if (wanted.length) lines.push("", NOTE, "", ...wanted);
  return lines.join("\n") + "\n";
}

export function projects(ctx) {
  const { REPO, CLAUDE, PROJECTS, WIN, DRY, state, homes, have, say, put, putJson, fit, filesWritten } = ctx;
  // The notes files as a run last wrote them, by full path. One that still matches is not the user's yet.
  const written = { ...(state.written || {}) };
  const asWritten = (file) => fs.existsSync(file) && written[fwd(file)] === sha(read(file));
  for (const name of ctx.HOMES) {
    const from = path.join(REPO, "projects", name);
    const dir = path.join(PROJECTS, name);
    const example = path.join(".claude", "settings.json");
    for (const rel of filesIn(from)) {
      if (rel === example || rel === "CLAUDE.md") continue;
      // Skills, hooks and tools are the setup's; anything else in the folder is the user's once it is there
      const own = rel.startsWith(".claude" + path.sep) || rel.startsWith("tools" + path.sep);
      put(path.join(dir, rel), fit(rel, fs.readFileSync(path.join(from, rel))), { keep: !own, own });
    }
    if (name === "claude-settings") {
      const howTo = path.join(dir, "HOW-TO.md");
      const text = fit("HOW-TO.md", fs.readFileSync(path.join(REPO, "docs", "HOW-TO.md"))).toString("utf8").replace(/\r\n/g, "\n");
      const ours = asWritten(howTo);
      put(howTo, Buffer.from(text), { keep: !ours });
      if (ours || !fs.existsSync(howTo) || read(howTo) === text) written[fwd(howTo)] = sha(text);
    }

    // CLAUDE.md: written when missing and replaced while it is as an earlier run wrote it; in one the
    // user changed only the note about missing workers changes
    const notes = path.join(dir, "CLAUDE.md");
    const wanted = (homes.notes[name] || []).filter((n) => n.without.every((w) => !have[w])).map((n) => n.line);
    const fresh = withNote(ctx.repoText(path.join("projects", name, "CLAUDE.md")), wanted);
    if (!fs.existsSync(notes) || asWritten(notes) || read(notes) === fresh) {
      put(notes, Buffer.from(fresh));
      written[fwd(notes)] = sha(fresh);
    } else {
      const now = fs.readFileSync(notes, "utf8").replace(/\r\n/g, "\n");
      const next = withNote(now, wanted);
      if (next === now) say(`kept ${fwd(notes)} (already there)`);
      else put(notes, Buffer.from(next));
    }

    // The folder's own settings: its model, its hooks and, with Codex, the picture skill and its gate
    const file = path.join(dir, example);
    const s = ctx.homeSettings[name];
    const was = JSON.stringify(s);
    const wants = JSON.parse(fs.readFileSync(path.join(from, example), "utf8"));
    s.model ??= wants.model;
    // A hook file this folder had under an earlier name: its entry and the file the setup wrote go
    const oldHooks = ctx.RETIRED_IN_HOMES[name] || [];
    retire(ctx, s, path.join(dir, ".claude"), oldHooks, ` in ${name}`);
    for (const old of oldHooks) {
      const f = path.join(dir, ".claude", "hooks", old);
      const hash = filesWritten[fwd(f)];
      if (hash === undefined || !fs.existsSync(f)) continue;
      delete filesWritten[fwd(f)];
      if (sha(fs.readFileSync(f)) !== hash) { say(`kept yours ${fwd(f)} (no longer part of the setup, and changed since it was installed)`); continue; }
      if (!DRY) fs.rmSync(f);
      say(`removed ${fwd(f)} (no longer part of the setup)`);
    }
    wire(ctx, s, wants.hooks, dir, ` in ${name}`);
    if (homes.picture.homes.includes(name)) {
      const link = path.join(dir, ".claude", "skills", "picture");
      const linked = fs.existsSync(link);
      if (have.codex) {
        wire(ctx, s, homes.picture.hooks, dir, ` in ${name}`);
        if (!linked) {
          if (!DRY) {
            fs.mkdirSync(path.dirname(link), { recursive: true });
            fs.symlinkSync(path.join(CLAUDE, "shared-skills", "picture"), link, "junction");
          }
          say(`linked ${fwd(link)} to the picture skill in ${fwd(CLAUDE)}`);
        }
      } else {
        // Codex is gone after an earlier run with it: the link (never a real folder) and the gate's entries go
        if (linked && fs.lstatSync(link).isSymbolicLink()) {
          if (!DRY) { if (WIN) fs.rmdirSync(link); else fs.unlinkSync(link); }
          say(`removed the link ${fwd(link)} (the picture skill needs Codex)`);
        }
        for (const event of Object.keys(s.hooks || {})) {
          s.hooks[event] = s.hooks[event].filter((g) => !JSON.stringify(g).includes("picture-gate.mjs"));
          if (!s.hooks[event].length) delete s.hooks[event];
        }
        if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
      }
    }
    putJson(file, s, was);
  }
  return written;
}
