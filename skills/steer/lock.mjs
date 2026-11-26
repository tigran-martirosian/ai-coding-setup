// steer's lock on ~/.claude/steer. The inboxes, the outbox, receipts.json and moved.json are read, changed and
// rewritten by every session's hook, by steer's commands and by compact-self, so changes take turns. The lock is
// the folder .lock with one empty file in it named "<process id>.<random>" by its holder, and only that holder
// removes it. No holder keeps it long (fn only reads and rewrites small files), so a lock is stale when its holder
// is gone, when that name was written more than STALE ago (its process id may since belong to an unrelated live
// process), or when it has had no name in it for 3 s. A stale lock is renamed aside, which only one copy can win,
// and removed. A hook must never hang, so after a short wait it goes on without the change: locked() then returns
// false and fn does not run. Commands wait longer (WAIT_CMD); a one-shot command that must not fail for a lock that
// is only slow to go waits WAIT_LONG, longer than a stale lock lives.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LOCK = path.join(os.homedir(), ".claude", "steer", ".lock");
const STALE = 10e3;
export const WAIT_CMD = 3000;
export const WAIT_LONG = STALE + 2000;
export const sleep = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
// The age is the holder's name file's (its write time), or the folder's while no name is in it.
const stale = (dir) => {
  let age, holder;
  try {
    holder = fs.readdirSync(dir).find((n) => /^\d+\./.test(n));
    age =
      Date.now() - fs.statSync(holder ? path.join(dir, holder) : dir).mtimeMs;
  } catch {
    return false;
  }
  if (!holder) return age > 3000;
  return age > STALE || !alive(Number(holder.split(".")[0]));
};
// Codes that mean another copy holds the lock or is making, moving or removing it at this moment: wait. On Windows
// a folder in mid-rename or mid-removal gives EPERM or EACCES; the lock moved away between this copy's two steps
// gives ENOENT.
const BUSY = new Set([
  "EEXIST",
  "ENOENT",
  ...(process.platform === "win32" ? ["EPERM", "EACCES"] : []),
]);
// Makes the lock with this copy's name in it; false while another copy has it. Only a real setup error throws: the
// steer folder missing and not creatable, or a code no other copy causes.
const take = (me) => {
  try {
    fs.mkdirSync(LOCK);
  } catch (e) {
    if (e.code === "ENOENT" && !fs.existsSync(path.dirname(LOCK))) {
      fs.mkdirSync(path.dirname(LOCK), { recursive: true });
      return take(me);
    }
    if (BUSY.has(e.code)) return false;
    throw e;
  }
  try {
    fs.writeFileSync(path.join(LOCK, me), "");
    return true;
  } catch (e) {
    // The empty folder this copy made goes again (not one with another copy's name in it by now).
    try {
      fs.rmdirSync(LOCK);
    } catch {}
    if (BUSY.has(e.code)) return false;
    throw e;
  }
};
export const locked = (fn, wait = 800) => {
  const me = `${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  const end = Date.now() + wait;
  // A live holder's lock this copy moved aside and could not put back yet. It is never removed while it is live,
  // and this copy takes no lock of its own before it is back: its holder may still be running.
  let aside = null;
  for (;;) {
    if (aside) {
      if (stale(aside)) fs.rmSync(aside, { recursive: true, force: true });
      else
        try {
          fs.renameSync(aside, LOCK);
        } catch {}
      if (!fs.existsSync(aside)) aside = null;
    }
    if (!aside && take(me)) break;
    if (Date.now() > end) return false;
    if (!aside && stale(LOCK)) {
      const to = `${LOCK}.${me}`;
      try {
        fs.renameSync(LOCK, to);
      } catch {
        sleep(15);
        continue;
      }
      // Another copy may have taken the old lock away and made a new one since the look above: a fresh lock
      // that was moved aside is that copy's, so it goes back (above, until that works).
      if (stale(to)) fs.rmSync(to, { recursive: true, force: true });
      else aside = to;
      continue;
    }
    sleep(15);
  }
  try {
    fn();
    return true;
  } finally {
    try {
      fs.unlinkSync(path.join(LOCK, me));
      fs.rmdirSync(LOCK);
    } catch {}
  }
};
