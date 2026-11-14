#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
// update-check: UserPromptSubmit hook. Every 12 hours it asks GitHub whether a newer version of this setup is
// released (version.json on the main branch, with CHANGELOG.md beside it, same wait) and keeps the answer in
// ~/.claude/update-check.json: the newest version, the changelog lines the user has missed and version.json's
// `releases` labels for them (kind `files` or `setup`, `important`, `headline`; a missed release with no entry
// counts as setup and important). How often the user hears of it is decided from that stored answer:
//   - an important release pending: a grey line about every 8 hours, and about every 24 hours Claude is asked for
//     a short "What the update brings you" section at the end of its reply, with every missed changelog line;
//   - only unimportant ones: a grey line at most once a day, no section;
//   - every missed release is `files` (only hook, skill, agent or worker files: no restart, no question) or
//     `nimbalyst` (a Nimbalyst version the setup checked: its pin and patch files): it
//     starts skills/update-setup/update.mjs --files-only detached, so the prompt never waits, and on a later
//     prompt says once in a grey line that the setup updated itself (or, with the error, that it could not; the
//     same version is not tried again and the reminder covers it). AUTO_UPDATE=off, in the environment or in
//     the "env" of ~/.claude/settings.json (that env may not reach hook processes, so the file is read), stops it.
//     The prompt that says a self-install worked also starts tools/nimbalyst-patch/deliver.mjs --stage detached,
//     which brings Nimbalyst to the pinned version (NIMBALYST_FOLLOW=off, read the same way, stops that).
// Nimbalyst's delivery is said in grey lines too, from deliver.mjs's data folder (below): the result of an install
// once, and a version waiting for a restart once.
// The grey lines name no version numbers (they make every release look like a hotfix): one behind gives the
// release's headline, two or more the date of the installed version and the newest important headlines.
// A heads-up about a release planned soon: version.json's optional `notice` ({id, text, issues?, version?}) is kept
// with the answer and said once per id in a grey line, "Setup notice: <text> Things to be aware of until then: <issues>."
// It comes whether or not an update is pending (after the reminder's line when both come), and not to a setup that
// already has `version`, the release it announces (the id is still marked as said). A notice of the wrong shape is
// crash-logged and left out; version.json with no notice changes nothing.
// The hook itself never downloads or installs anything. The installed version is the one install.mjs wrote to
// ~/.claude/setup-state.json (read only when the stored answer says a line or a self-install is due); a setup
// with no version on record counts as older. Most prompts cost one file read and two stats (the tidy offer and
// Nimbalyst's delivery, below);
// the first prompt in a folder each day also looks for the folder's CLAUDE.md and .git and reads
// ~/.claude/project-pass.json (the project pass and /new-project offers, below).
// Offline, or GitHub not answering within 0.7 seconds (2.5 on the try after a timeout, so a slow line still hears of an
// update): silent to the user, so a prompt never waits long. The failure
// is written into update-check.json (failedAt and error, cleared by the next good answer) and the check is not tried
// again for an hour, so an offline prompt costs one file read, not a wait for every prompt.
// It reads no hook input, so it does not use runHook. The answer stays in ~/.claude, next to setup-state.json
// (SETUP_UPDATE_HOME moves both for the tests), not in hooks/state.
// Fails open. UPDATE_CHECK=off disables it. SETUP_UPDATE_BASE points it at another address (tests).
import { readChangelog, shownDate } from "./lib/changelog.mjs";
import { crashLog } from "./lib/crash-log.mjs";
import { readJson, writeJson } from "./lib/state.mjs";

const HOME = process.env.SETUP_UPDATE_HOME || os.homedir();
const CLAUDE = path.join(HOME, ".claude");
const BASE = process.env.SETUP_UPDATE_BASE;
const RAW =
  BASE ||
  "https://raw.githubusercontent.com/tigran-martirosian/ai-coding-setup/main";
const VERSION_URL = `${RAW}/version.json`;
const CHANGES_URL = `${RAW}/CHANGELOG.md`;
const HOUR = 60 * 60 * 1000;
const EVERY = 12 * HOUR;
const RETRY = HOUR; // after a failed check
const NOTICE_IMPORTANT = 8 * HOUR; // grey line while an important release is pending
const NOTICE_SMALL = 24 * HOUR; // grey line when only unimportant ones are
const SECTION = 24 * HOUR; // Claude's section, important releases only
const AUTO_STALE = 15 * 60 * 1000; // a self-install started longer ago than this is taken as dead
const NOTES_LIMIT = 12000; // characters of release notes for Claude before unimportant lines shrink
const WAIT = 700; // ms a prompt may wait for GitHub
const WAIT_SLOW = 2500; // the same, when the last try ran out of time
const TIMED_OUT = "no answer in time";
const json = (file) => readJson(file, { missing: {} }); // a file that is not JSON is crash-logged, then counts as missing
// 1.10.0 is newer than 1.9.2 and 26.1 newer than 1.0.114: compared number by number, a missing part counts as 0
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) =>
    String(v || "0")
      .split(".")
      .map(Number),
  );
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
// Reads an address, following redirects. Not fetch: on Windows, Node can crash when a process ends
// right after one.
const get = (url, ms, hops = 5) =>
  new Promise((resolve, reject) => {
    const req = (url.startsWith("https:") ? https : http).get(
      url,
      { timeout: ms, headers: { "user-agent": "setup-update" } },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location &&
          hops > 0
        ) {
          res.resume();
          const next = new URL(res.headers.location, url).href;
          // never from https down to plain http
          if (url.startsWith("https:") && !next.startsWith("https:"))
            return reject(new Error(`redirect to ${next} is not https`));
          return resolve(get(next, ms, hops - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const parts = [];
        res.on("data", (d) => parts.push(d));
        res.on("end", () => resolve(Buffer.concat(parts)));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(TIMED_OUT)));
    req.on("error", reject);
  });

// What a release brings, from version.json's `releases`; a release with no entry counts as setup and important
const label = (releases, v) =>
  releases?.[v] || { kind: "setup", important: true };
const SELF_KINDS = ["files", "nimbalyst"]; // releases that install themselves
const headline = (r) =>
  String(r.headline || "")
    .trim()
    .replace(/\.$/, "");

// The stored answer of a check: the newest version, and what the user on `installed` has missed up to it
function answer(latest, changelog, installed) {
  // the changelog's releases, newest first; one it can't read is crash-logged and counts as not read
  let lines = [];
  if (changelog)
    try {
      lines = readChangelog(changelog).map(({ version, date, text }) => ({
        v: version,
        date,
        text,
      }));
    } catch (e) {
      crashLog("update-check", e);
    }
  const inRange = (v) => newer(v, installed) && !newer(v, latest.version);
  const notes = lines.filter((l) => inRange(l.v));
  const releases = Object.fromEntries(
    Object.entries(latest.releases || {}).filter(([v]) => inRange(v)),
  );
  return {
    latest: latest.version,
    summary: latest.summary || "",
    installed,
    releases,
    notes,
    from: lines.find((l) => l.v === installed)?.date || null,
    complete: lines.length > 0, // the changelog was read, so the list of missed releases is whole
    notice: noticeOf(latest.notice),
  };
}

// version.json's `notice`, checked: undefined when there is none or it has the wrong shape (crash-logged)
function noticeOf(n) {
  if (n === undefined) return undefined;
  const ok =
    n &&
    typeof n === "object" &&
    typeof n.id === "string" &&
    n.id &&
    typeof n.text === "string" &&
    n.text.trim() &&
    (n.issues === undefined ||
      (Array.isArray(n.issues) &&
        n.issues.every((i) => typeof i === "string" && i.trim()))) &&
    (n.version === undefined || (typeof n.version === "string" && n.version));
  if (!ok) {
    crashLog(
      "update-check",
      new Error(
        `version.json notice is not {id, text, issues?, version?}, so it is not shown: ${JSON.stringify(n).slice(0, 300)}`,
      ),
    );
    return undefined;
  }
  return {
    id: n.id,
    text: n.text.trim(),
    ...(n.issues?.length ? { issues: n.issues.map((i) => i.trim()) } : {}),
    ...(n.version ? { version: n.version } : {}),
  };
}

// The grey line of a notice
function noticeLine(n) {
  const text = /[.!?]$/.test(n.text) ? n.text : `${n.text}.`;
  const issues = n.issues
    ? ` Things to be aware of until then: ${n.issues.map((i) => i.replace(/[.;]$/, "")).join("; ")}.`
    : "";
  return `Setup notice: ${text}${issues}`;
}

// What is pending for the user on `installed`, from a stored answer
function pending(stored, installed) {
  const notes = (stored.notes || []).filter((l) => newer(l.v, installed));
  const versions = [
    ...new Set([
      stored.latest,
      ...notes.map((l) => l.v),
      ...Object.keys(stored.releases || {}).filter((v) => newer(v, installed)),
    ]),
  ]
    .filter((v) => newer(v, installed) && !newer(v, stored.latest))
    .sort((a, b) => (newer(a, b) ? -1 : 1));
  const labels = versions.map((v) => ({ v, ...label(stored.releases, v) }));
  return {
    versions,
    labels,
    notes,
    important: labels.some((l) => l.important),
    // every missed release known, and each only files
    files:
      stored.complete &&
      stored.installed === installed &&
      installed !== "0" &&
      labels.length > 0 &&
      labels.every((l) => SELF_KINDS.includes(l.kind)),
  };
}

// The grey line of a reminder
function greyLine(stored, installed, p) {
  if (p.versions.length < 2) {
    const what =
      headline(label(stored.releases, stored.latest)) ||
      String(stored.summary || "")
        .trim()
        .replace(/\.$/, ""); // an answer stored by 1.0.108 has no summary
    return `Setup update ready${what ? `: ${what}` : ""}. Type /update-setup; your files are kept.`;
  }
  const date = stored.installed === installed && stored.from;
  const oldest = p.notes.at(-1)?.date;
  const age = date
    ? `Your setup is from ${shownDate(date)}.`
    : oldest
      ? `Your setup is from before ${shownDate(oldest)}.`
      : "Your setup is several releases behind.";
  const named = p.labels.filter((l) => l.important && headline(l)).slice(0, 3);
  const rest = p.labels.filter((l) => !named.includes(l));
  // releases with no headline (from before the labels) are counted, not called smaller fixes
  const more = rest.some((l) => l.important)
    ? `${rest.length} more release${rest.length === 1 ? "" : "s"}`
    : `${rest.length} smaller fix${rest.length === 1 ? "" : "es"}`;
  const news = !named.length
    ? more
    : `${named.map(headline).join(", ")}${rest.length ? `; plus ${more}` : ""}`;
  return `${age} New: ${news}. Type /update-setup.`;
}

// Every missed changelog line in full; over NOTES_LIMIT, unimportant ones shrink to version and headline, oldest first
function releaseNotes(stored, p) {
  const lines = p.notes.map((l) => {
    const r = label(stored.releases, l.v);
    return {
      full: `  - ${l.v}: ${l.text}`,
      short: `  - ${l.v}: ${headline(r) || l.text}`,
      small: !r.important,
      use: "full",
    };
  });
  let size = lines.reduce((n, l) => n + l.full.length + 1, 0);
  let shrunk = 0;
  for (const l of [...lines].reverse()) {
    if (size <= NOTES_LIMIT) break;
    if (!l.small || l.short === l.full) continue;
    size -= l.full.length - l.short.length;
    l.use = "short";
    shrunk++;
  }
  return { lines: lines.map((l) => l[l.use]), shrunk };
}

// <name>=off (AUTO_UPDATE, NIMBALYST_FOLLOW) from the environment or from the "env" of ~/.claude/settings.json. A
// settings file that can't be read throws (the hook then logs why, starts nothing and reminds instead).
function settingOff(name) {
  if ((process.env[name] || "").toLowerCase() === "off") return true;
  const file = path.join(CLAUDE, "settings.json");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `${file} is not valid JSON, so nothing was started (${name} can't be read): ${err.message}`,
    );
  }
  return String(settings.env?.[name] || "").toLowerCase() === "off";
}

// The lock of a self-install: made only if it is not there (two prompts at once start one update.mjs, not two), freed
// by update.mjs when it ends; one older than AUTO_STALE is left from a run that died and is taken over
const LOCK = path.join(CLAUDE, "update-auto.lock");
function lock() {
  for (let i = 0; i < 2; i++) {
    try {
      fs.closeSync(fs.openSync(LOCK, "wx"));
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (Date.now() - fs.statSync(LOCK).mtimeMs < AUTO_STALE) return false;
      fs.rmSync(LOCK, { force: true });
    }
  }
  return false;
}

// Starts update.mjs --files-only on its own, without waiting for it; null when another one is under way
function startSelfInstall(version, installed) {
  const script = path.join(CLAUDE, "skills", "update-setup", "update.mjs");
  if (!fs.existsSync(script))
    return {
      auto: {
        version,
        from: installed,
        at: new Date().toISOString(),
        ok: false,
        error: `${script} is missing`,
      },
    };
  if (!lock()) return null;
  const args = [
    script,
    "--files-only",
    ...(process.env.SETUP_UPDATE_HOME ? ["--home", HOME] : []),
  ];
  spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  // update.mjs replaces this with `auto`, its result
  return {
    autoRun: { version, from: installed, startedAt: new Date().toISOString() },
  };
}

// ---- Nimbalyst, delivered by the setup: tools/nimbalyst-patch/deliver.mjs (Windows) installs the version its pin.json
// names and patches it, when Nimbalyst closes or through /update-setup's restart. Its data folder (%LOCALAPPDATA%\
// ai-coding-setup\nimbalyst; NIMBALYST_DELIVER_DATA moves it) holds status.json, the result of the last install ({at, ok,
// version, override?, error?}), and staged.json, a version waiting for Nimbalyst to close ({version, ...}). Each is
// said once in a grey line: a result once per `at`, a waiting version once per version. Most prompts cost one stat
// (status.json's time); staged.json is read when that changed, in the hour after this hook started a stage, and
// otherwise once an hour.
const DELIVER = path.join(CLAUDE, "tools", "nimbalyst-patch", "deliver.mjs");
const DATA =
  process.env.NIMBALYST_DELIVER_DATA ||
  (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "ai-coding-setup", "nimbalyst")
    : null);

// Starts deliver.mjs --stage on its own: the time it started, or null when NIMBALYST_FOLLOW=off or deliver.mjs is
// missing (logged: the self-install puts it there). deliver.mjs itself also stays still when its off.json exists.
function startStage() {
  if (settingOff("NIMBALYST_FOLLOW")) return null;
  if (!fs.existsSync(DELIVER)) {
    crashLog(
      "update-check",
      new Error(`${DELIVER} is missing, so no Nimbalyst update was staged`),
    );
    return null;
  }
  spawn(process.execPath, [DELIVER, "--stage"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  return new Date().toISOString();
}

// The grey lines of the delivery, each once; `next.nimbalyst` keeps what was seen and said
function nimbalystLines(next, now) {
  if (!DATA) return { next, lines: [] }; // no LOCALAPPDATA: not Windows, nothing is delivered here
  const seen = next.nimbalyst || {};
  const statusFile = path.join(DATA, "status.json");
  let mtime = null;
  try {
    mtime = fs.statSync(statusFile).mtimeMs;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const changed = mtime !== null && mtime !== seen.statusSeen;
  const recent = (at) => now - new Date(at || 0).getTime() < HOUR;
  if (!changed && !recent(seen.stageStarted) && recent(seen.stagedLook))
    return { next, lines: [] };
  const lines = [];
  const nb = { ...seen, stagedLook: new Date(now).toISOString() };
  if (changed) {
    nb.statusSeen = mtime;
    const s = json(statusFile);
    if (s.at && s.at !== seen.statusSaid) {
      nb.statusSaid = s.at;
      const what = `Nimbalyst${s.version ? ` ${s.version}` : ""}${s.override ? " (a trial)" : ""}`;
      lines.push(
        s.ok
          ? `${what} installed with the setup's fixes.`
          : `The update to ${what} stopped${s.error ? `: ${String(s.error).replace(/\.$/, "")}` : ""}.`,
      );
    }
  }
  const staged = json(path.join(DATA, "staged.json"));
  if (staged.version && staged.version !== seen.readySaid) {
    nb.readySaid = staged.version;
    lines.push(
      `Nimbalyst ${staged.version} is ready: /update-setup restarts it to finish.`,
    );
  }
  return { next: { ...next, nimbalyst: nb }, lines };
}

// ---- the tidy offer for the person's own rules: ~/.claude/rules/my-rules.md and each project home's
// .claude/rules/my-rules.md (a home is the folder of a state.written key ending in /CLAUDE.md under state.projects).
// Once per change, after an install, update, self-install or own-rules.mjs wrote setup-state.json, Claude is asked to
// offer the tidy at the end of its reply (an additionalContext note, merged with the release section when both come).
// Checked apart from the reminder chain, so a pending version or a stale `installed` can't hold it back. No note when
// /update-setup already offered it (own-rules.mjs --offered) or the files were tidied or skipped.
// A file is untidied when its sha differs from state.ownTidied[<file>]. The pending key is the first 16 hex of
// sha256 over the sorted lines "<file> <sha>" (absolute, forward slashes) of the untidied files, as
// skills/update-setup/own-rules.mjs --status computes it.
const fwd = (p) => p.replace(/\\/g, "/");
let crypto = null; // loaded only after setup-state.json changed, so most prompts don't load it
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
function ownPending(state) {
  const root = state.projects
    ? fwd(state.projects).replace(/\/$/, "") + "/"
    : null;
  const homes = root
    ? Object.keys(state.written || {})
        .filter((k) => k.endsWith("/CLAUDE.md") && fwd(k).startsWith(root))
        .map((k) => path.dirname(k))
    : [];
  const tidied =
    state.ownTidied && typeof state.ownTidied === "object"
      ? state.ownTidied
      : {};
  const open = [
    path.join(CLAUDE, "rules", "my-rules.md"),
    ...homes.map((h) => path.join(h, ".claude", "rules", "my-rules.md")),
  ]
    .map((f) => path.resolve(f))
    .filter((f) => fs.existsSync(f))
    .map((f) => ({ file: f, text: fs.readFileSync(f, "utf8") }))
    .filter((f) => sha(f.text) !== tidied[fwd(f.file)]);
  if (!open.length) return null;
  return {
    open,
    key: sha(
      open
        .map((f) => `${fwd(f.file)} ${sha(f.text)}`)
        .sort()
        .join("\n"),
    ).slice(0, 16),
  };
}
// Once per change: looked at only when setup-state.json changed since the last look (one stat per prompt; an
// install, update, self-install or own-rules.mjs wrote it); a key is noted once (ownNoted) and never when the tidy
// was already offered inside /update-setup for it (state.ownOffered). No setup-state.json: silent.
async function ownRulesNote(next) {
  let mtime;
  try {
    mtime = fs.statSync(path.join(CLAUDE, "setup-state.json")).mtimeMs;
  } catch (err) {
    if (err.code === "ENOENT") return { next, text: null };
    throw err;
  }
  if (next.ownSeen === mtime) return { next, text: null };
  next = { ...next, ownSeen: mtime };
  crypto ??= await import("node:crypto");
  const state = json(path.join(CLAUDE, "setup-state.json"));
  const p = ownPending(state);
  if (!p || p.key === next.ownNoted || p.key === state.ownOffered)
    return { next, text: null };
  next = { ...next, ownNoted: p.key };
  const global = path.resolve(CLAUDE, "rules", "my-rules.md");
  const mine = p.open.find((f) => f.file === global);
  const homes = p.open.length - (mine ? 1 : 0);
  const what = [
    ...(mine
      ? [
          `~/.claude/rules/my-rules.md (${mine.text.split("\n").length - (mine.text.endsWith("\n") ? 1 : 0)} lines, about ${Math.round(Buffer.byteLength(mine.text) / 4)} tokens loaded in every chat)`,
        ]
      : []),
    ...(homes
      ? [
          `${homes === 1 ? "1 project folder's" : `${homes} project folders'`} own rules`,
        ]
      : []),
  ].join(" and ");
  const OWN = "node ~/.claude/skills/update-setup/own-rules.mjs";
  return {
    next,
    text: [
      `[update-check] Rules this person wrote are not tidied yet: ${what}. Do the user's request first.`,
      "At the end of your reply, in one or two sentences, offer to tidy them: lines the setup already covers or does better go to a vault they can restore from, their own preferences stay, and one command undoes it.",
      `On yes: read ~/.claude/skills/update-setup/tidy.md and follow it. On "not now": run ${OWN} --skip --homes.`,
      "Offer it once; this note doesn't come again for these files.",
    ].join("\n"),
  };
}

// ---- the project pass offer (skills/update-project) and the /new-project offer: in the folder the user works in
// (CLAUDE_PROJECT_DIR, else the process's own), looked at once per folder per day (passNoted, today's entries only).
// Never the home folder itself or a linked worktree (.git is a file). A folder where neither it nor a folder above it
// (up to the home folder or the drive root) has a CLAUDE.md or .git: Claude is asked to offer /new-project on a
// question card at the end of its reply, whether or not ~/.claude/project-pass.json exists, unless that file has the
// folder declined or every folder declined (at any level). A folder with a CLAUDE.md or .git of its own: when
// ~/.claude/project-pass.json (install.mjs starts it, pass.mjs stamps it) has mode on-open and the folder is behind
// its level (no done stamp at the level, not declined at it, not all declined at it), Claude is asked to offer the pass
// on a question card at the end of its reply; no stamp file: silent. A subfolder of a project: silent. A stamp file
// that is not valid JSON: one note a day that it couldn't be read.
const localDay = (ms) =>
  new Date(ms - new Date(ms).getTimezoneOffset() * 6e4)
    .toISOString()
    .slice(0, 10);
function passNote(next, now) {
  const folder = fwd(
    path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd()),
  ).replace(/\/$/, "");
  const day = localDay(now);
  if (next.passNoted?.[folder] === day) return { next, text: null };
  const today = Object.fromEntries(
    Object.entries(next.passNoted || {}).filter(([, d]) => d === day),
  );
  next = { ...next, passNoted: { ...today, [folder]: day } };
  const homeKey = fwd(path.resolve(HOME)).toLowerCase();
  if (folder.toLowerCase() === homeKey) return { next, text: null };
  // a linked worktree (.git is a file) belongs to its main folder, which gets the offers
  if (
    fs.statSync(path.join(folder, ".git"), { throwIfNoEntry: false })?.isFile()
  )
    return { next, text: null };
  const marked = (d) =>
    fs.existsSync(path.join(d, "CLAUDE.md")) ||
    fs.existsSync(path.join(d, ".git"));
  const own = marked(folder);
  // a subfolder of a project is part of it: look up to, not into, the home folder or the drive root
  let inProject = own;
  for (
    let d = path.dirname(folder);
    !inProject && d !== path.dirname(d) && fwd(d).toLowerCase() !== homeKey;
    d = path.dirname(d)
  )
    inProject = marked(d);
  const stampFile = path.join(CLAUDE, "project-pass.json");
  let s = null;
  if (fs.existsSync(stampFile))
    try {
      s = JSON.parse(fs.readFileSync(stampFile, "utf8"));
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      // the folder is noted all the same, so a broken file gives one note a day, not one every prompt
      return {
        next,
        text:
          `[update-check] ~/.claude/project-pass.json could not be read (${err.message}), so the project pass offer can't tell whether this folder is behind. ` +
          "At the end of your reply, tell the user in one sentence that this file is broken and the offer is paused until it is fixed.",
      };
    }
  // a folder's key is as pass.mjs wrote it; Windows paths compare without regard to case
  const at = (map) =>
    Object.entries(map || {}).find(([k]) =>
      process.platform === "win32"
        ? k.toLowerCase() === folder.toLowerCase()
        : k === folder,
    )?.[1];
  const PASS = "node ~/.claude/skills/update-project/pass.mjs";
  if (!inProject) {
    // "never" for this folder or for every folder holds at any level
    if (s && (at(s.declined) !== undefined || s.declinedAll != null))
      return { next, text: null };
    return {
      next,
      text: [
        `[update-check] This folder (${folder}) is not set up as a project: neither it nor a folder above it has a CLAUDE.md or .git. Do the user's request first.`,
        "At the end of your reply, ask on one question card (AskUserQuestion; in Nimbalyst mcp__nimbalyst__AskUserQuestion) whether to set this folder up with /new-project: a notes file, a decisions record, a rules folder and a systems map, so sessions here start with the right context. Options: Yes / Not now / Never here / Never in any folder.",
        `On yes: read ~/.claude/skills/new-project/SKILL.md and follow it. On "not now": nothing to run (asked again another day). On "never here": run ${PASS} --skip "${folder}". On "never in any folder" (this also stops the offer to bring older project folders up to date): run ${PASS} --skip-all.`,
        "Ask once; this note comes at most once a day for this folder.",
      ].join("\n"),
    };
  }
  if (!own || !s || s.mode !== "on-open") return { next, text: null };
  if (
    at(s.folders)?.done >= s.level ||
    at(s.declined) >= s.level ||
    s.declinedAll >= s.level
  )
    return { next, text: null };
  return {
    next,
    text: [
      `[update-check] This project folder (${folder}) was set up before the current setup. Do the user's request first.`,
      "At the end of your reply, ask on one question card (AskUserQuestion; in Nimbalyst mcp__nimbalyst__AskUserQuestion) whether to bring this folder up to the current setup, so sessions here get the current rules, systems map and file layout: about 15 minutes, every change shown first. Options: Yes / Not now / Never, in any folder.",
      `On yes: read ~/.claude/skills/update-project/SKILL.md and follow it. On "not now": run ${PASS} --skip "${folder}". On "never, in any folder": run ${PASS} --skip-all.`,
      "Offer it once; this note comes once for this folder.",
    ].join("\n"),
  };
}

if ((process.env.UPDATE_CHECK || "").toLowerCase() !== "off") {
  try {
    const stateFile = path.join(CLAUDE, "update-check.json");
    const last = json(stateFile);
    let next = last;
    const now = Date.now();
    const within = (at, ms) => now - new Date(at || 0).getTime() < ms;
    const installedNow = () =>
      json(path.join(CLAUDE, "setup-state.json")).version || "0";
    if (!within(last.checkedAt, EVERY) && !within(last.failedAt, RETRY)) {
      try {
        const wait = last.error === TIMED_OUT ? WAIT_SLOW : WAIT;
        const [v, c] = await Promise.allSettled([
          get(VERSION_URL, wait),
          get(CHANGES_URL, wait),
        ]);
        if (v.status === "rejected") throw v.reason;
        const latest = JSON.parse(v.value);
        if (latest?.version) {
          // the changelog only adds detail; the failed answers, and a failure before, are not kept
          const { failedAt, error, ...rest } = last;
          next = {
            ...rest,
            checkedAt: new Date(now).toISOString(),
            ...answer(
              latest,
              c.status === "fulfilled" ? String(c.value) : "",
              installedNow(),
            ),
          };
        }
      } catch (e) {
        // Remember the failure (and why) instead of trying again on every prompt: offline, a timeout or an HTTP
        // error is kept in update-check.json, and not a crash
        next = {
          ...last,
          failedAt: new Date(now).toISOString(),
          error: String(e.message || e),
        };
      }
    }
    let say = null;
    // A self-install that never wrote its result within AUTO_STALE died part way: a failure like any other
    if (next.autoRun && !within(next.autoRun.startedAt, AUTO_STALE)) {
      const { autoRun, ...rest } = next;
      next = {
        ...rest,
        auto: {
          version: autoRun.version,
          from: autoRun.from,
          at: new Date(now).toISOString(),
          ok: false,
          error: `it did not finish within ${AUTO_STALE / 60000} minutes`,
        },
      };
      fs.rmSync(LOCK, { force: true });
    }
    // A self-install that ended: said once, in a grey line, with the count of the user's changed files it left alone
    if (next.auto && !next.auto.told) {
      const { version, headline: what, ok, error, kept = [] } = next.auto;
      const yours = kept.length
        ? ` ${kept.length} file${kept.length === 1 ? "" : "s"} you changed stayed as yours; /update-setup can take the new version of ${kept.length === 1 ? "it" : "them"}.`
        : "";
      say = {
        systemMessage: ok
          ? `Setup updated itself to ${version}${what ? `: ${what}` : ""}.${yours}`
          : `Setup could not update itself to ${version}: ${error}. Type /update-setup to install it.`,
      };
      next = {
        ...next,
        auto: { ...next.auto, told: true },
        noticeAt: new Date(now).toISOString(),
      };
      // the new pin is in place now: Nimbalyst's delivery starts (a failure here is logged; the line above stands)
      if (ok) {
        try {
          const stageStarted = startStage();
          if (stageStarted)
            next = { ...next, nimbalyst: { ...next.nimbalyst, stageStarted } };
        } catch (err) {
          crashLog("update-check", err);
        }
      }
    } else if (
      next.latest &&
      !next.autoRun &&
      newer(next.latest, next.installed || "0")
    ) {
      // from the stored answer first, so most prompts read no second file
      const stored = pending(next, next.installed || "0");
      const grey = !within(
        next.noticeAt,
        stored.important ? NOTICE_IMPORTANT : NOTICE_SMALL,
      );
      const section = stored.important && !within(next.sectionAt, SECTION);
      const canAuto = stored.files && next.auto?.version !== next.latest; // a failed self-install is not tried again for the same version
      if (grey || section || canAuto) {
        const installed = installedNow(); // read only now: the user may have updated since the check
        const p = pending(next, installed);
        // settings.json that can't be read: logged, nothing installs itself, the reminder still comes
        const off = () => {
          try {
            return settingOff("AUTO_UPDATE");
          } catch (err) {
            crashLog("update-check", err);
            return true;
          }
        };
        if (!p.versions.length)
          next = { ...next, installed }; // updated since: nothing pending until the next check
        else if (p.files && canAuto && !off()) {
          const started = startSelfInstall(next.latest, installed);
          if (started) next = { ...next, ...started };
        } else if (grey || section) {
          const yours = installed === "0" ? "an older one" : installed;
          const out = {
            hookSpecificOutput: { hookEventName: "UserPromptSubmit" },
          };
          if (grey) {
            out.systemMessage = greyLine(next, installed, p);
            next = { ...next, noticeAt: new Date(now).toISOString() };
          }
          if (section) {
            const { lines, shrunk } = releaseNotes(next, p);
            out.hookSpecificOutput.additionalContext = [
              `[update-check] A newer version of the Claude Code setup is released: ${next.latest} (installed: ${yours}).`,
              `- Do the user's request first. At the end of your reply, under a short heading "What the update brings you", give three to five plain bullets grouped by theme from the release notes below, each in what the user gains (less usage, fewer mistakes, new commands). Where a release adds a cost (helpers on Opus use more), say it. A figure only as a best-case estimate with its basis, never "x% better at everything". Calm and concrete, no alarm. Then end with: "Type /update-setup (a few minutes, then a Nimbalyst restart); your own files and skills are kept."`,
              `- Don't install it unless the user asks. Don't repeat this on later turns; the reminder comes back by itself.`,
              ...(lines.length
                ? [
                    `Release notes since ${yours}, newest first${shrunk ? ` (${shrunk} smaller one${shrunk === 1 ? "" : "s"} shortened to the headline)` : ""}:`,
                    ...lines,
                  ]
                : []),
            ].join("\n");
            next = { ...next, sectionAt: new Date(now).toISOString() };
          }
          if (out.systemMessage || out.hookSpecificOutput.additionalContext)
            say = out;
        }
      }
    }
    // A notice not said yet: once per id, after the reminder's grey line when both come
    if (next.notice && next.notice.id !== next.noticeShown) {
      const n = next.notice;
      next = { ...next, noticeShown: n.id };
      if (!n.version || newer(n.version, installedNow())) {
        const line = noticeLine(n);
        say ??= {};
        say.systemMessage = say.systemMessage
          ? `${say.systemMessage}\n${line}`
          : line;
      }
    }
    // Nimbalyst's delivery: apart from the chain above, so a pending version can't hold it back
    try {
      const nb = nimbalystLines(next, now);
      next = nb.next;
      if (nb.lines.length) {
        say ??= {};
        say.systemMessage = [say.systemMessage, ...nb.lines]
          .filter(Boolean)
          .join("\n");
      }
    } catch (err) {
      crashLog("update-check", err);
    }
    // Own rules not tidied yet: outside the chain above, so a pending version, a self-install or a stale
    // `installed` can't skip it; an error here is logged and the rest of the answer still stands
    try {
      const own = await ownRulesNote(next);
      next = own.next;
      if (own.text) {
        say ??= {};
        say.hookSpecificOutput ??= { hookEventName: "UserPromptSubmit" };
        const had = say.hookSpecificOutput.additionalContext;
        say.hookSpecificOutput.additionalContext = had
          ? `${had}\n\n${own.text}`
          : own.text;
      }
    } catch (err) {
      crashLog("update-check", err);
    }
    // A project folder behind the pass level, or a folder to set up with /new-project: the same way, apart from the chain and the tidy note
    try {
      const pass = passNote(next, now);
      next = pass.next;
      if (pass.text) {
        say ??= {};
        say.hookSpecificOutput ??= { hookEventName: "UserPromptSubmit" };
        const had = say.hookSpecificOutput.additionalContext;
        say.hookSpecificOutput.additionalContext = had
          ? `${had}\n\n${pass.text}`
          : pass.text;
      }
    } catch (err) {
      crashLog("update-check", err);
    }
    if (next !== last) writeJson(stateFile, next);
    if (say) process.stdout.write(JSON.stringify(say));
  } catch (err) {
    crashLog("update-check", err);
    // fail open
  }
}
