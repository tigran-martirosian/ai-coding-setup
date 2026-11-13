// The base project folders from projects/ (each with its skills, hooks, tools, CLAUDE.md and its own
// .claude/settings.json), with the picture skill linked in where Codex is used. Returns `written`: the
// notes files (CLAUDE.md, how-to.md) as a run last wrote them, for state.written.
import fs from "node:fs";
import path from "node:path";
import { filesIn, fwd, read, sha } from "./files.mjs";
import { retire, wire } from "./wiring.mjs";
import {
  splitBlocks,
  key,
  unfit,
  carve,
  appendOwn,
  historyKeys,
} from "./blocks.mjs";

const NOTE = "## Workers on this computer";
// The lines about a missing worker, as the last section of a folder's CLAUDE.md; none when nothing is missing
function withNote(text, wanted) {
  const lines = text.split("\n");
  const i = lines.indexOf(NOTE);
  if (i === -1 && !wanted.length) return text;
  if (i !== -1) {
    let j = i + 1;
    while (j < lines.length && !/^#{1,2} /.test(lines[j])) j++;
    lines.splice(i, j - i);
  }
  while (lines.length && lines.at(-1) === "") lines.pop();
  if (wanted.length) lines.push("", NOTE, "", ...wanted);
  return lines.join("\n") + "\n";
}
// The text without the installer's own note lines (any line homes.json can put there). Anything else under
// the note's heading is the person's: it stays, under the heading, for the carve to move.
function withoutOurNote(text, ours) {
  const lines = text.split("\n");
  const i = lines.indexOf(NOTE);
  if (i === -1) return text;
  let j = i + 1;
  while (j < lines.length && !/^#{1,2} /.test(lines[j])) j++;
  const rest = lines.slice(i + 1, j).filter((l) => !ours.has(l.trimEnd()));
  lines.splice(
    i,
    j - i,
    ...(rest.some((l) => l.trim()) ? [NOTE, ...rest] : []),
  );
  return lines.join("\n");
}

// The folders older versions shipped and this one merged into quick-tasks (homes.json "retired"). Nothing in them
// is deleted. Runs before projects(), which writes the shipped profile.md and finds/INDEX.md where they are missing:
// the person's own notes are copied into quick-tasks first (only where it has none), so they are the ones that stay.
// A CLAUDE.md still as a run wrote it (state.written) becomes a short note that the folder moved; one the person
// changed stays. Then the folder leaves the record (state.written, state.files), so a later run passes it by.
const RETIRED_NOTES = [
  /^profile\.md$/,
  /^finds\//,
  /^tools\/labels\.json$/,
  /^answers\//,
];
export function retiredHomes(ctx) {
  const { PROJECTS, state, homes, say, put } = ctx;
  const target = path.join(PROJECTS, "quick-tasks");
  const written = state.written || {};
  for (const name of homes.retired || []) {
    const dir = path.join(PROJECTS, name);
    const inside = (key) =>
      key.toLowerCase().startsWith(fwd(dir).toLowerCase() + "/");
    if (
      !fs.existsSync(dir) ||
      ![...Object.keys(written), ...Object.keys(ctx.filesWritten)].some(inside)
    )
      continue;
    for (const rel of filesIn(dir)) {
      if (RETIRED_NOTES.some((r) => r.test(fwd(rel))))
        put(path.join(target, rel), fs.readFileSync(path.join(dir, rel)), {
          keep: true,
        });
    }
    const notes = path.join(dir, "CLAUDE.md");
    if (fs.existsSync(notes) && written[fwd(notes)] === sha(read(notes))) {
      put(
        notes,
        Buffer.from(
          `# ${name} (moved)\n\nThis folder was merged into \`${target}\`. Your files and chats here stay. Start new work there.\n`,
        ),
      );
    } else if (fs.existsSync(notes))
      say(`kept yours ${fwd(notes)} (you changed it, so it stays as it is)`);
    for (const key of Object.keys(written))
      if (inside(key)) delete written[key];
    for (const key of Object.keys(ctx.filesWritten))
      if (inside(key)) delete ctx.filesWritten[key];
    say(
      `${fwd(dir)} is no longer part of the setup: its files and chats stay, new work goes to ${fwd(target)}. Delete the folder when you no longer need it.`,
    );
  }
}

// Quick Tasks ran on sonnet before it took in the hunts and the questions; it ships with opus now. A folder still on
// sonnet moves once (state.homeModel records "moved"), so a person who sets sonnet again later keeps it.
// --keep-home-model keeps sonnet ("kept") and, after a move, puts sonnet back. The global model is model.mjs's alone.
const MOVE_TO_OPUS = ["quick-tasks"];
function homeModel(ctx, name, s, file) {
  if (!MOVE_TO_OPUS.includes(name)) return;
  const { say } = ctx;
  const mark = ctx.homeModel[name];
  if (ctx.args.includes("--keep-home-model")) {
    if (mark === "moved" && s.model === "opus") {
      s.model = "sonnet";
      say(
        `model: sonnet is back in ${fwd(file)}, and stays on later runs (--keep-home-model)`,
      );
    } else if (mark !== "kept")
      say(
        `model: ${fwd(file)} keeps ${JSON.stringify(s.model)} (--keep-home-model); later runs keep it too`,
      );
    ctx.homeModel[name] = "kept";
  } else if (!mark && s.model === "sonnet") {
    s.model = "opus";
    ctx.homeModel[name] = "moved";
    say(
      `MODEL CHANGED in ${name}: ${fwd(file)} had "model": "sonnet" and is now opus, as this version ships it. To keep sonnet: ${ctx.selfRun("--keep-home-model")} (in a chat: /update-setup --keep-home-model)`,
    );
  } else if (!mark) ctx.homeModel[name] = "set"; // already past the move (a new folder, or opus by choice)
}

export function projects(ctx) {
  const {
    REPO,
    CLAUDE,
    PROJECTS,
    WIN,
    DRY,
    state,
    homes,
    have,
    say,
    put,
    putJson,
    fit,
    filesWritten,
  } = ctx;
  ctx.homeModel = { ...(state.homeModel || {}) };
  // The notes files as a run last wrote them, by full path. One that still matches is not the user's yet.
  const written = { ...(state.written || {}) };
  const asWritten = (file) =>
    fs.existsSync(file) && written[fwd(file)] === sha(read(file));
  for (const name of ctx.HOMES) {
    const from = path.join(REPO, "projects", name);
    const dir = path.join(PROJECTS, name);
    const example = path.join(".claude", "settings.json");
    for (const rel of filesIn(from)) {
      if (rel === example || rel === "CLAUDE.md") continue;
      // Skills, hooks and tools are the setup's; anything else in the folder is the user's once it is there
      const own =
        rel.startsWith(".claude" + path.sep) ||
        rel.startsWith("tools" + path.sep);
      put(
        path.join(dir, rel),
        fit(rel, fs.readFileSync(path.join(from, rel))),
        { keep: !own, own },
      );
    }
    if (name === "claude-settings") {
      const howTo = path.join(dir, "how-to.md");
      // Older versions wrote it as HOW-TO.md: renamed once with its record, in two steps so a disk that
      // ignores case renames it too
      const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      if (names.includes("HOW-TO.md") && !names.includes("how-to.md")) {
        const old = path.join(dir, "HOW-TO.md");
        if (!DRY) {
          fs.renameSync(old, `${howTo}.part`);
          fs.renameSync(`${howTo}.part`, howTo);
        }
        if (fwd(old) in written) {
          written[fwd(howTo)] = written[fwd(old)];
          delete written[fwd(old)];
        }
        say(`renamed ${fwd(old)} to how-to.md`);
      }
      const text = fit(
        "HOW-TO.md",
        fs.readFileSync(path.join(REPO, "docs", "HOW-TO.md")),
      )
        .toString("utf8")
        .replace(/\r\n/g, "\n");
      const ours = asWritten(howTo);
      put(howTo, Buffer.from(text), { keep: !ours });
      if (ours || !fs.existsSync(howTo) || read(howTo) === text)
        written[fwd(howTo)] = sha(text);
    }

    // CLAUDE.md: written when missing and replaced while it is as an earlier run wrote it. One the user
    // changed is carved like the global rules (scripts/rules.mjs): the note's lines about missing workers are
    // the installer's and are left out (a line the person added there is theirs and is carved), the user's own blocks go to the folder's .claude/rules/my-rules.md, and
    // this version's text is written whole, with a dated copy and both files on ctx.rulesUndo.
    const notes = path.join(dir, "CLAUDE.md");
    const wanted = (homes.notes[name] || [])
      .filter((n) => n.without.every((w) => !have[w]))
      .map((n) => n.line);
    const shipped = ctx.repoText(path.join("projects", name, "CLAUDE.md"));
    const fresh = withNote(shipped, wanted);
    if (!fs.existsSync(notes) || asWritten(notes) || read(notes) === fresh) {
      put(notes, Buffer.from(fresh));
    } else {
      const ourLines = new Set(
        Object.values(homes.notes)
          .flat()
          .map((n) => n.line),
      );
      const now = withoutOurNote(
        fs.readFileSync(notes, "utf8").replace(/\r\n/g, "\n"),
        ourLines,
      );
      const asShipped = (t) => unfit(t, PROJECTS, WIN);
      const shippedKeys = splitBlocks(asShipped(shipped)).map((b) =>
        key(b.text),
      );
      const { own, oldCount } = carve(
        now,
        shippedKeys,
        historyKeys(REPO),
        asShipped,
      );
      const write = (file, text) => {
        if (!DRY) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, text);
        }
      };
      const backup = ctx.keepCopy(notes, !state.version);
      ctx.rulesUndo.push({ file: fwd(notes), copy: backup });
      ctx.saveCopies(); // on disk before the file changes, so a run that stops part way can still be undone
      const myRules = path.join(dir, ".claude", "rules", "my-rules.md");
      const had = fs.existsSync(myRules)
        ? fs.readFileSync(myRules, "utf8")
        : null;
      const next = appendOwn(had ?? "", own);
      if (next !== (had ?? "")) {
        ctx.rulesUndo.push({
          file: fwd(myRules),
          copy: had === null ? null : ctx.keepCopy(myRules),
        });
        ctx.saveCopies();
        write(myRules, next);
      }
      write(notes, fresh);
      say(
        `notes: brought ${fwd(notes)} up to this version: ${oldCount} old setup lines removed, ${own.length} of yours moved to ${fwd(myRules)} (old copy: ${ctx.short(backup)})`,
      );
    }
    written[fwd(notes)] = sha(fresh);

    // The folder's own settings: its model, its hooks and, with Codex, the picture skill and its gate
    const file = path.join(dir, example);
    const s = ctx.homeSettings[name];
    const was = JSON.stringify(s);
    const wants = JSON.parse(fs.readFileSync(path.join(from, example), "utf8"));
    s.model ??= wants.model;
    homeModel(ctx, name, s, file);
    // A hook file this folder had under an earlier name: its entry and the file the setup wrote go
    const oldHooks = ctx.RETIRED_IN_HOMES[name] || [];
    retire(ctx, s, path.join(dir, ".claude"), oldHooks, ` in ${name}`);
    for (const old of oldHooks) {
      const f = path.join(dir, ".claude", "hooks", old);
      const hash = filesWritten[fwd(f)];
      if (hash === undefined || !fs.existsSync(f)) continue;
      delete filesWritten[fwd(f)];
      if (sha(fs.readFileSync(f)) !== hash) {
        say(
          `kept yours ${fwd(f)} (no longer part of the setup, and changed since it was installed)`,
        );
        continue;
      }
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
            fs.symlinkSync(
              path.join(CLAUDE, "shared-skills", "picture"),
              link,
              "junction",
            );
          }
          say(`linked ${fwd(link)} to the picture skill in ${fwd(CLAUDE)}`);
        }
      } else {
        // Codex is gone after an earlier run with it: the link (never a real folder) and the gate's entries go
        if (linked && fs.lstatSync(link).isSymbolicLink()) {
          if (!DRY) {
            if (WIN) fs.rmdirSync(link);
            else fs.unlinkSync(link);
          }
          say(`removed the link ${fwd(link)} (the picture skill needs Codex)`);
        }
        for (const event of Object.keys(s.hooks || {})) {
          s.hooks[event] = s.hooks[event].filter(
            (g) => !JSON.stringify(g).includes("picture-gate.mjs"),
          );
          if (!s.hooks[event].length) delete s.hooks[event];
        }
        if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
      }
    }
    putJson(file, s, was);
  }
  return written;
}
