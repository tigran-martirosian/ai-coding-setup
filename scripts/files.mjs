// The installer's file helpers: reading, hashing, listing, and writing with a dated copy of what was there.
// A replaced file is kept as <name>.before-install-<date>, -2, -3 on the same day: backupName makes that
// name and BACKUP reads it back (--uninstall). install.mjs, update.mjs and app-settings.mjs share these.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const fwd = (p) => p.replace(/\\/g, "/");
export const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
export const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
export const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
export const backupName = (file, day, n = 1) => `${file}.before-install-${day}${n > 1 ? `-${n}` : ""}`;
export const BACKUP = /^(.*)\.before-install-(\d{8})(?:-(\d+))?$/;
// The folders under ~/.claude that hold the setup's own files, each from the repo folder of the same name
export const OWN_FOLDERS = ["hooks", "agents", "skills", "workers"];
// The script paths a hook command starts: "<path>" or a bare <path> ending in a script extension
export const SCRIPT_PATHS = /"([^"]+\.(?:mjs|cjs|js|sh|py|ps1))"|(\S+\.(?:mjs|cjs|js|sh|py|ps1))(?=\s|$)/g;

export function filesIn(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]);
}
// Like filesIn, without what a build makes (node_modules, dist): an extension's source
export const sourceOf = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !["node_modules", "dist"].includes(e.name))
  .flatMap((e) => (e.isDirectory() ? sourceOf(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]));

// Settings that can't be read stop the install before anything is copied.
export function readJson(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch {
    console.log(`${fwd(file)} is not valid JSON, so the install stopped here. Fix it and run this again.`);
    process.exit(1);
  }
}

// The writers of one run, over its ctx (DRY, say, userCopies, filesWritten, onRecord, asked, short, tally)
export function writers(ctx) {
  const { DRY, say } = ctx;
  const day = today();
  // A dated copy of a file as it is now, made before it is changed. A copy already made today stays as
  // it is (it is the older one); a second change on the same day gets -2, -3, ...
  // user: the file being copied is the user's own (not one the setup wrote earlier). Such a copy goes on
  // record in state.userCopies, and only those are put back by --uninstall: every update also copies the
  // setup's own older files, and those must not come back.
  function keepCopy(file, user = false) {
    let copy = backupName(file, day);
    for (let n = 2; fs.existsSync(copy); n++) {
      if (fs.readFileSync(copy).equals(fs.readFileSync(file))) { if (user) ctx.userCopies.add(fwd(copy)); return path.basename(copy); }
      copy = backupName(file, day, n);
    }
    if (!DRY) fs.copyFileSync(file, copy);
    if (user) ctx.userCopies.add(fwd(copy));
    return path.basename(copy);
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
    if (there && own && ctx.onRecord && filesWritten[fwd(to)] !== sha(now) && !ctx.asked(to)) {
      tally.yours.push(ctx.short(to));
      return say(`kept yours ${fwd(to)} (it differs from the setup's version)`);
    }
    // The user's own unless it is exactly what the setup last wrote there (or it can't be told: no record)
    const backup = there ? keepCopy(to, ctx.onRecord && !(own && filesWritten[fwd(to)] === sha(now))) : null;
    if (!DRY) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, data);
    }
    if (own) filesWritten[fwd(to)] = sha(data);
    if (backup) tally.replaced.push(ctx.short(to)); else tally.added++;
    say(`${backup ? "replaced" : "copied"} ${fwd(to)}${backup ? ` (old copy: ${backup})` : ""}`);
  }
  function putJson(file, data, was) {
    if (JSON.stringify(data) === was && fs.existsSync(file)) return say(`unchanged ${fwd(file)}`);
    const backup = fs.existsSync(file) ? keepCopy(file) : null;
    if (!DRY) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // written whole under another name, then moved: a stop in the middle can't leave half a file
      fs.writeFileSync(`${file}.part`, JSON.stringify(data, null, 2) + "\n");
      fs.renameSync(`${file}.part`, file);
    }
    say(`wrote ${fwd(file)}${backup ? ` (old copy: ${backup})` : ""}`);
  }
  return { keepCopy, put, putJson };
}
