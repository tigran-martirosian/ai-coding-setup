// The installer's file helpers: reading, hashing, listing, and writing with a dated copy of what was there.
// A replaced file is kept outside the person's folders, in ~/.claude/setup-logs/<YYYY-MM-DD>-install-backup/
// under its path from the home folder (one outside it under outside-home/<drive>/...); a later copy that day with
// other content goes to <YYYY-MM-DD>-install-backup-2, -3. backupPath makes that
// path, BACKUP_DIR reads the folder's name back (--uninstall). Older versions kept the copy next to the file
// as <name>.before-install-<yyyymmdd>(-n), and own-rules.mjs as <name>.before-tidy|undo|restore-<yyyymmdd>(-n)
// (OLD_BACKUP); moveOldCopies moves those once into setup-logs (<date>-install-backup, <date>-tidy, -undo, -restore,
// the folders own-rules.mjs now writes). install.mjs, update.mjs and app-settings.mjs share these.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const fwd = (p) => p.replace(/\\/g, "/");
export const sha = (text) =>
  crypto.createHash("sha256").update(text).digest("hex");
export const read = (file) =>
  fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
// the local day, as the person's clock and git show it
export const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4)
    .toISOString()
    .slice(0, 10);
};
export const BACKUP_DIR = /^(\d{4}-\d{2}-\d{2})-install-backup(?:-(\d+))?$/;
export const OLD_BACKUP =
  /^(.*)\.before-(install|tidy|undo|restore)-(\d{8})(?:-(\d+))?$/;
// The path of a file inside a backup folder: from the home folder, else outside-home/<drive or root>/<rest>
export function backupRel(home, file) {
  const rel = path.relative(home, file);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  const abs = path.resolve(file);
  const root = path.parse(abs).root;
  return path.join(
    "outside-home",
    root.replace(/[:\\/]/g, "") || "root",
    abs.slice(root.length),
  );
}
// kind: install-backup (the installer's), tidy, undo or restore (own-rules.mjs)
export const backupPath = (home, file, day, n = 1, kind = "install-backup") =>
  path.join(
    home,
    ".claude",
    "setup-logs",
    `${day}-${kind}${n > 1 ? `-${n}` : ""}`,
    backupRel(home, file),
  );
// The copy of a file as it is now, in setup-logs/<day>-install-backup/. A copy made earlier that day stays as it
// is (it is the older one): the same content is that copy, other content goes to <day>-install-backup-2, -3, ...
// Returns the copy's path; with dry, nothing is written.
export function freshCopy(home, file, day, dry = false) {
  let n = 1;
  let copy = backupPath(home, file, day, n);
  while (
    fs.existsSync(copy) &&
    !fs.readFileSync(copy).equals(fs.readFileSync(file))
  )
    copy = backupPath(home, file, day, ++n);
  if (!dry && !fs.existsSync(copy)) {
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(file, copy);
  }
  return copy;
}
// A move that also works across drives; it fails loudly, naming both paths
export function moveFile(from, to) {
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    fs.rmSync(from);
  } catch (e) {
    throw new Error(`could not move ${fwd(from)} to ${fwd(to)}: ${e.message}`);
  }
}
// The copies older versions left next to the files they replaced, under these folders (node_modules and .git
// are skipped), moved into setup-logs/<their date>-<kind>/ (kind: install-backup, tidy, undo, restore). A second
// copy of the same day that differs goes to <date>-<kind>-<n>; one equal to the copy already there is dropped.
// A folder that can't be read is named in a warning and left as it is; the rest still moves. Returns old path ->
// new path, so the records that name a copy (userCopies, rulesUndo) can follow; with DRY, the moves it would make.
export function moveOldCopies({ home, dirs, DRY, say }) {
  const found = [];
  const walk = (dir, deep) => {
    let list;
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return say(
        `WARNING: could not look in ${fwd(dir)} for old copies to move into setup-logs (${e.code || e.message}); any there stay where they are`,
      );
    }
    for (const e of list) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (deep && !["node_modules", ".git"].includes(e.name)) walk(p, deep);
        continue;
      }
      const m = e.name.match(OLD_BACKUP);
      if (m)
        found.push({
          p,
          file: path.join(dir, m[1]),
          kind: m[2] === "install" ? "install-backup" : m[2],
          day: `${m[3].slice(0, 4)}-${m[3].slice(4, 6)}-${m[3].slice(6)}`,
          n: Number(m[4] || 1),
        });
    }
  };
  for (const { dir, deep } of dirs) if (fs.existsSync(dir)) walk(dir, deep);
  found.sort((a, b) => a.day.localeCompare(b.day) || a.n - b.n);
  const moved = new Map();
  // DRY: the place each copy would go -> that copy, so a second copy with the same content is named as dropped
  const planned = new Map();
  const differs = (a, b) => !fs.readFileSync(a).equals(fs.readFileSync(b));
  for (const c of found) {
    let n = 1;
    const at = () => backupPath(home, c.file, c.day, n, c.kind);
    let to = at();
    while (
      (fs.existsSync(to) && differs(to, c.p)) ||
      (planned.has(to) && differs(planned.get(to), c.p))
    ) {
      n++;
      to = at();
    }
    if (DRY) {
      moved.set(fwd(c.p), fwd(to));
      if (planned.has(to))
        say(`would remove ${fwd(c.p)} (the same copy goes to ${fwd(to)})`);
      else {
        planned.set(to, c.p);
        say(`would move ${fwd(c.p)} to ${fwd(to)}`);
      }
      continue;
    }
    if (fs.existsSync(to)) {
      try {
        fs.rmSync(c.p);
      } catch (e) {
        throw new Error(
          `could not remove ${fwd(c.p)} (the same copy is already in ${fwd(to)}): ${e.message}`,
        );
      }
    } else moveFile(c.p, to);
    moved.set(fwd(c.p), fwd(to));
    say(`moved the old copy ${fwd(c.p)} to ${fwd(to)}`);
  }
  return moved;
}
// The folders under ~/.claude that hold the setup's own files, each from the repo folder of the same name
export const OWN_FOLDERS = ["hooks", "agents", "skills", "workers", "tools"];
// The script paths a hook command starts: "<path>" or a bare <path> ending in a script extension
export const SCRIPT_PATHS =
  /"([^"]+\.(?:mjs|cjs|js|sh|py|ps1))"|(\S+\.(?:mjs|cjs|js|sh|py|ps1))(?=\s|$)/g;

export function filesIn(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? filesIn(path.join(dir, e.name), base)
        : [path.relative(base, path.join(dir, e.name))],
    );
}
// Like filesIn, without what a build makes (node_modules, dist): an extension's source
export const sourceOf = (dir, base = dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !["node_modules", "dist"].includes(e.name))
    .flatMap((e) =>
      e.isDirectory()
        ? sourceOf(path.join(dir, e.name), base)
        : [path.relative(base, path.join(dir, e.name))],
    );

// Settings that can't be read stop the install before anything is copied.
export function readJson(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    console.log(
      `${fwd(file)} is not valid JSON, so the install stopped here. Fix it and run this again.`,
    );
    process.exit(1);
  }
}

// The writers of one run, over its ctx (DRY, say, stateFile, userCopies, rulesUndo, filesWritten, onRecord, asked, short, tally)
export function writers(ctx) {
  const { DRY, say } = ctx;
  const day = today();
  // A copy of a file as it is now, made before it is changed. Returns its full path.
  // user: the file being copied is the user's own (not one the setup wrote earlier). Such a copy goes on
  // record in state.userCopies, and only those are put back by --uninstall: every update also copies the
  // setup's own older files, and those must not come back.
  function keepCopy(file, user = false) {
    const copy = freshCopy(ctx.home, file, day, DRY);
    if (user) {
      ctx.userCopies.add(fwd(copy));
      saveCopies();
    }
    return fwd(copy);
  }
  // The restore records (userCopies, the carve's rulesUndo) go on disk as each copy is made, so a run that
  // stops part way still knows what to put back. Only these keys change; the rest of the record stays old.
  // extra: more keys to write the same way (the undo records that followed the moved old copies).
  function saveCopies(extra = {}) {
    if (DRY) return;
    const now = fs.existsSync(ctx.stateFile)
      ? JSON.parse(fs.readFileSync(ctx.stateFile, "utf8"))
      : {};
    Object.assign(now, extra);
    if (ctx.userCopies.size) now.userCopies = [...ctx.userCopies].sort();
    if (ctx.rulesUndo?.length)
      now.rulesUndo = {
        at: (ctx.rulesUndoAt ??= new Date().toISOString()),
        by: "carve",
        files: ctx.rulesUndo,
      };
    fs.mkdirSync(path.dirname(ctx.stateFile), { recursive: true });
    fs.writeFileSync(
      `${ctx.stateFile}.part`,
      JSON.stringify(now, null, 2) + "\n",
    );
    fs.renameSync(`${ctx.stateFile}.part`, ctx.stateFile);
    ctx.copiesSaved = true;
  }
  // keep: a file that is already there is the user's and stays.
  // own: one of the setup's files, which stays only when the user changed it.
  function put(to, data, { keep = false, own = false } = {}) {
    const { filesWritten, tally } = ctx;
    const there = fs.existsSync(to);
    if (there && keep) return say(`kept ${fwd(to)} (already there)`);
    const now = there ? fs.readFileSync(to) : null;
    if (there && now.equals(data)) {
      if (own) filesWritten[fwd(to)] = sha(data);
      tally.same++;
      return say(`unchanged ${fwd(to)}`);
    }
    if (
      there &&
      own &&
      ctx.onRecord &&
      filesWritten[fwd(to)] !== sha(now) &&
      !ctx.asked(to)
    ) {
      tally.yours.push(ctx.short(to));
      return say(`kept yours ${fwd(to)} (it differs from the setup's version)`);
    }
    // The user's own unless it is exactly what the setup last wrote there (or it can't be told: no record)
    const backup = there
      ? keepCopy(
          to,
          ctx.onRecord && !(own && filesWritten[fwd(to)] === sha(now)),
        )
      : null;
    if (!DRY) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, data);
    }
    if (own) filesWritten[fwd(to)] = sha(data);
    if (backup) {
      tally.replaced.push(ctx.short(to));
      // the backup folder used (<day>-install-backup, or -2, -3 when an earlier copy that day differs), for the report
      const logs = fwd(path.join(ctx.home, ".claude", "setup-logs")) + "/";
      tally.backupDirs.add(logs + backup.slice(logs.length).split("/")[0]);
    } else tally.added++;
    say(
      `${backup ? "replaced" : "copied"} ${fwd(to)}${backup ? ` (old copy: ${ctx.short(backup)})` : ""}`,
    );
  }
  // copy: false when the file there is one this run made itself (no older version to keep)
  function putJson(file, data, was, { copy = true } = {}) {
    if (JSON.stringify(data) === was && fs.existsSync(file))
      return say(`unchanged ${fwd(file)}`);
    const backup = copy && fs.existsSync(file) ? keepCopy(file) : null;
    if (!DRY) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // written whole under another name, then moved: a stop in the middle can't leave half a file
      fs.writeFileSync(`${file}.part`, JSON.stringify(data, null, 2) + "\n");
      fs.renameSync(`${file}.part`, file);
    }
    say(
      `wrote ${fwd(file)}${backup ? ` (old copy: ${ctx.short(backup)})` : ""}`,
    );
  }
  return { keepCopy, saveCopies, put, putJson };
}
