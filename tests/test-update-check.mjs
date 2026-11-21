// Tests for hooks/update-check.mjs against a small local server that stands in for GitHub.
// Run: node tests/test-update-check.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { key } from "../scripts/blocks.mjs";

const HOOK = fileURLToPath(
  new URL("../hooks/update-check.mjs", import.meta.url),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "update-check-test-"));
let pass = 0,
  fail = 0;
const check = (name, ok) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};

// The server answers /version.json with whatever `released` holds and counts the requests
let released = { version: "1.2.0", summary: "A new thing." };
let asked = 0;
let changelog = null; // null: no CHANGELOG.md (404), as an old release had
let tarball = null; // T7: the archive served as /v<version>.tar.gz, as update.mjs asks for it
const server = http.createServer((req, res) => {
  if (tarball && req.url === `/${path.basename(tarball)}`)
    return res.end(fs.readFileSync(tarball));
  if (req.url === "/CHANGELOG.md") {
    if (changelog === null) {
      res.statusCode = 404;
      return res.end();
    }
    return res.end(changelog);
  }
  asked++;
  if (req.url !== "/version.json") {
    res.statusCode = 404;
    return res.end();
  }
  res.end(JSON.stringify(released));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// A home folder with this version installed (none: no setup-state.json version)
const home = (name, version) => {
  const dir = path.join(tmp, name, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "setup-state.json"),
    JSON.stringify(version ? { version } : {}),
  );
  return path.join(tmp, name);
};
// The server runs in this process, so the hook is started without blocking it. Nimbalyst's delivery data is the
// home's own folder, never this computer's
const dataOf = (h) => path.join(h, "nimbalyst-data");
const run = (h, env = {}) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [HOOK], {
      env: {
        ...process.env,
        UPDATE_CHECK: "",
        SETUP_UPDATE_HOME: h,
        SETUP_UPDATE_BASE: BASE,
        NIMBALYST_DELIVER_DATA: dataOf(h),
        NIMBALYST_FOLLOW: "",
        // the folder worked in is the home folder, which gets no project offer, unless a test names one
        CLAUDE_PROJECT_DIR: h,
        ...env,
      },
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
    p.stdin.end(JSON.stringify({ prompt: "hello" }));
  });
const kept = (h) => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(h, ".claude", "update-check.json"), "utf8"),
    );
  } catch {
    return null;
  }
};

const old = home("old", "1.0.0");
const first = await run(old);
const said = first.out ? JSON.parse(first.out) : {};
check(
  "a newer release is announced in one line, with no version number",
  said.systemMessage ===
    "Setup update ready: A new thing. Type /update-setup; your files are kept.",
);
check(
  "Claude is told to mention /update-setup and not to install by itself",
  /\/update-setup/.test(said.hookSpecificOutput?.additionalContext || "") &&
    /Don't install it unless the user asks/.test(
      said.hookSpecificOutput.additionalContext,
    ),
);
check(
  "the event name is UserPromptSubmit",
  said.hookSpecificOutput?.hookEventName === "UserPromptSubmit",
);
check("the check is recorded", kept(old)?.latest === "1.2.0");
const before = asked;
const second = await run(old);
check(
  "a second prompt within 12 hours is silent and asks nobody",
  second.out === "" && asked === before,
);

fs.writeFileSync(
  path.join(old, ".claude", "update-check.json"),
  JSON.stringify({
    checkedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
    latest: "1.2.0",
  }),
);
check("13 hours later it says it again", /1\.2\.0/.test((await run(old)).out));

check(
  "the same version installed: silent",
  (await run(home("same", "1.2.0"))).out === "",
);
check(
  "a newer version installed than released: silent",
  (await run(home("ahead", "1.3.0"))).out === "",
);
released = { version: "1.10.0" };
check(
  "1.10.0 is newer than 1.9.2",
  /released: 1\.10\.0 \(installed: 1\.9\.2\)/.test(
    (await run(home("nine", "1.9.2"))).out,
  ),
);
check(
  "a setup with no version on record counts as older",
  /an older one/.test((await run(home("none"))).out),
);

// With the changelog: how far behind, and what came in since. This one is in the old form, a line per version
// ("- 1.0.4 (Nov 3, 2026): text", the changelog up to 26.1), which still reads
released = { version: "1.0.5", summary: "Hotfix for one thing." };
changelog = [
  "# Changelog",
  "",
  "- 1.0.6 (Nov 5, 2026): Not released yet, must not be counted.",
  "- 1.0.5 (Nov 4, 2026): Hotfix for one thing.",
  "- 1.0.4 (Nov 3, 2026): Reviews cost half as much.",
  "- 1.0.3 (Nov 2, 2026): A new command that tidies the board.",
  "- 1.0.2 (Nov 1, 2026): Installed already.",
  "",
].join("\n");
const behind = JSON.parse((await run(home("behind", "1.0.2"))).out || "{}");
const ctx = behind.hookSpecificOutput?.additionalContext || "";
// spec 6: the grey line names the installed version's date from the changelog, not "3 releases behind (on 1.0.2)"
check(
  "three releases behind: the grey line names the installed version's date, no version number",
  behind.systemMessage ===
    "Your setup is from Nov 1, 2026. New: 3 more releases. Type /update-setup.",
);
check(
  "Claude gets the release notes since the installed version, and only those",
  /1\.0\.5: Hotfix/.test(ctx) &&
    /1\.0\.4: Reviews cost half/.test(ctx) &&
    /1\.0\.3: A new command/.test(ctx) &&
    !/1\.0\.6/.test(ctx) &&
    !/1\.0\.2:/.test(ctx),
);
check(
  "Claude is asked for a short calm list of what the update brings, and still not to install it",
  /three to five plain bullets/.test(ctx) &&
    /no alarm/.test(ctx) &&
    /Don't install it unless the user asks/.test(ctx),
);
const one = JSON.parse((await run(home("onebehind", "1.0.4"))).out || "{}");
// a release with no `releases` entry counts as important, so Claude's section comes with its one line
check(
  "one release behind: the grey line with the summary, and Claude's section with that release's line",
  one.systemMessage ===
    "Setup update ready: Hotfix for one thing. Type /update-setup; your files are kept." &&
    /1\.0\.5: Hotfix for one thing\./.test(
      one.hookSpecificOutput?.additionalContext || "",
    ),
);
changelog = Array.from(
  { length: 20 },
  (_, i) => `- 1.0.${20 - i} (Nov 1, 2026): Change ${20 - i}.`,
).join("\n");
released = { version: "1.0.20" };
const far =
  JSON.parse((await run(home("far", "1.0.0"))).out || "{}").hookSpecificOutput
    ?.additionalContext || "";
check(
  "twenty behind: all twenty notes reach Claude in full",
  Array.from(
    { length: 20 },
    (_, i) => `  - 1.0.${i + 1}: Change ${i + 1}.`,
  ).every((l) => far.split(/\r?\n/).includes(l)),
);

// The changelog's form from 26.2 on: a heading per version, its bullets one note; the Unreleased section and the
// "Before" section hold no version
changelog = [
  "# Changelog",
  "",
  "Versions are year.release.fix.",
  "",
  "## [Unreleased]",
  "",
  "- Not released yet, must not be counted.",
  "",
  "## [1.0.5] - 2026-11-04",
  "",
  "- Hotfix for one thing",
  "- A second fix.",
  "",
  "## [1.0.4] - 2026-11-03",
  "",
  "Reviews cost half as much.",
  "",
  "## [1.0.3] - 2026-11-02",
  "",
  "- A new command that tidies the board.",
  "",
  "## [1.0.2] - 2026-11-01",
  "",
  "- Installed already.",
  "",
  "## Before 1.0.0 - 2026-10-02 to 2026-10-04",
  "",
  "the first public setup.",
  "",
].join("\n");
released = { version: "1.0.5", summary: "Hotfix for one thing." };
const headed = JSON.parse((await run(home("headed", "1.0.2"))).out || "{}");
const headedCtx = (headed.hookSpecificOutput?.additionalContext || "").split(
  /\r?\n/,
);
check(
  "heading form: the grey line names the installed version's date in words",
  headed.systemMessage ===
    "Your setup is from Nov 1, 2026. New: 3 more releases. Type /update-setup.",
);
check(
  "heading form: Claude gets each missed version's bullets as one note, and only those",
  headedCtx.includes("  - 1.0.5: Hotfix for one thing. A second fix.") &&
    headedCtx.includes("  - 1.0.4: Reviews cost half as much.") &&
    headedCtx.includes("  - 1.0.3: A new command that tidies the board.") &&
    !headedCtx.some((l) => /Not released|1\.0\.2:|first public/.test(l)),
);
// a heading the reader does not know: crash-logged, no notes, the update still named
const unreadLog = path.join(tmp, "unreadable-changelog-crash.log");
changelog = "# Changelog\n\n## [1.0.5] - Nov 4, 2026\n\n- Hotfix.\n";
const unread = JSON.parse(
  (await run(home("unreadable", "1.0.2"), { HOOK_ERRORS_LOG: unreadLog }))
    .out || "{}",
);
check(
  "a changelog with a heading it can't read: crash-logged with the line, no notes, the update still named",
  unread.systemMessage ===
    "Setup update ready: Hotfix for one thing. Type /update-setup; your files are kept." &&
    !/1\.0\.5:/.test(unread.hookSpecificOutput?.additionalContext || "") &&
    /line 3: the heading "## \[1\.0\.5\] - Nov 4, 2026"/.test(
      fs.existsSync(unreadLog) ? fs.readFileSync(unreadLog, "utf8") : "",
    ),
);

// ---- spec section 7: labels from version.json `releases`, how often, and the self-install of `files` releases
const ago = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const stored = (h) => kept(h) || {};
const restore = (h, extra) =>
  fs.writeFileSync(
    path.join(h, ".claude", "update-check.json"),
    JSON.stringify({ ...stored(h), ...extra }),
  );
// a changelog in the heading form: version 1.0.N is dated Nov N, 2026
const log = (lines) =>
  [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    ...lines.flatMap(([v, text]) => [
      `## [${v}] - 2026-11-${v.split(".")[2].padStart(2, "0")}`,
      "",
      `- ${text}`,
      "",
    ]),
  ].join("\n");
changelog = log([
  ["1.0.5", "Reviews cost half as much on long builds."],
  ["1.0.4", "Installed already."],
]);
released = {
  version: "1.0.5",
  summary: "Long summary.",
  releases: {
    "1.0.5": {
      kind: "setup",
      important: true,
      headline: "Reviews cost half as much on long builds.",
    },
  },
};
const imp = home("important-one", "1.0.4");
const impSaid = JSON.parse((await run(imp)).out || "{}");
check(
  "1. one behind, important: the grey line with the headline and no version number",
  impSaid.systemMessage ===
    "Setup update ready: Reviews cost half as much on long builds. Type /update-setup; your files are kept." &&
    !/\d+\.\d+\.\d+/.test(impSaid.systemMessage),
);
check(
  "1. and Claude's section is asked for, with the closing line",
  /What the update brings you/.test(
    impSaid.hookSpecificOutput?.additionalContext || "",
  ) &&
    /Type \/update-setup \(a few minutes, then a Nimbalyst restart\); your own files and skills are kept\./.test(
      impSaid.hookSpecificOutput.additionalContext,
    ),
);
check("3. right after: silent", (await run(imp)).out === "");
restore(imp, { noticeAt: ago(9), sectionAt: ago(9) });
const nine = JSON.parse((await run(imp)).out || "{}");
check(
  "3. important pending, 9 hours after the last grey line: the grey line again, no section",
  /^Setup update ready:/.test(nine.systemMessage || "") &&
    !nine.hookSpecificOutput?.additionalContext,
);
restore(imp, { noticeAt: ago(9), sectionAt: ago(25) });
check(
  "3. 24 hours after the last section: the section again",
  /What the update brings you/.test(
    JSON.parse((await run(imp)).out || "{}").hookSpecificOutput
      ?.additionalContext || "",
  ),
);

released = {
  version: "1.0.5",
  releases: {
    "1.0.5": { kind: "setup", important: false, headline: "A colour fix" },
  },
};
const small = home("unimportant-one", "1.0.4");
const smallSaid = JSON.parse((await run(small)).out || "{}");
check(
  "2. one behind, unimportant: the grey line only",
  smallSaid.systemMessage ===
    "Setup update ready: A colour fix. Type /update-setup; your files are kept." &&
    !smallSaid.hookSpecificOutput?.additionalContext,
);
restore(small, { noticeAt: ago(20) });
check(
  "2. a prompt within 24 hours of it is silent",
  (await run(small)).out === "",
);
restore(small, { noticeAt: ago(25) });
const dayLater = JSON.parse((await run(small)).out || "{}");
check(
  "2. after 24 hours: the grey line again, still no section",
  /A colour fix/.test(dayLater.systemMessage || "") &&
    !dayLater.hookSpecificOutput?.additionalContext,
);

// 4. twenty behind, each line 700 characters: over the 12,000 limit, unimportant lines shrink, oldest first
const long = (v) => `Change ${v}. ${"More words about it. ".repeat(33)}`.trim();
changelog = log(
  Array.from({ length: 21 }, (_, i) => [
    `1.0.${20 - i}`,
    long(`1.0.${20 - i}`),
  ]),
);
released = {
  version: "1.0.20",
  releases: Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [
      `1.0.${i + 1}`,
      { kind: "setup", important: i % 2 === 1, headline: `Headline ${i + 1}` },
    ]),
  ),
};
const big =
  JSON.parse((await run(home("twenty-long", "1.0.0"))).out || "{}")
    .hookSpecificOutput?.additionalContext || "";
const bigLines = big.split(/\r?\n/);
check(
  "4. twenty behind: every important line reaches Claude in full",
  [2, 4, 6, 8, 10, 12, 14, 16, 18, 20].every((n) =>
    bigLines.includes(`  - 1.0.${n}: ${long(`1.0.${n}`)}`),
  ),
);
check(
  "4. over the size limit the oldest unimportant ones shrink to their headline, the newest stay whole",
  bigLines.includes("  - 1.0.1: Headline 1") &&
    bigLines.includes("  - 1.0.3: Headline 3") &&
    bigLines.includes(`  - 1.0.19: ${long("1.0.19")}`) &&
    /shortened to the headline/.test(big),
);
const mixed = JSON.parse(
  (await run(home("twenty-mixed", "1.0.17"))).out || "{}",
);
check(
  "6. the grey line for many behind names the installed version's date and the important headlines",
  mixed.systemMessage ===
    "Your setup is from Nov 17, 2026. New: Headline 20, Headline 18; plus 1 smaller fix. Type /update-setup.",
);

// 5 and 9: the self-install. A stand-in for update.mjs in the home writes what it was started with and then, after a
// while, its result as update.mjs --files-only does (STUB_RESULT: ok or the error). While a file named `hold` is in
// the home's .claude it waits for the test to delete it (30 s at most), so a check can know it still runs.
const stubHome = (name, version) => {
  const h = home(name, version);
  const stub = path.join(h, ".claude", "skills", "update-setup", "update.mjs");
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  fs.writeFileSync(
    stub,
    `import fs from "node:fs";
import path from "node:path";
const claude = path.join(process.argv[process.argv.indexOf("--home") + 1], ".claude");
fs.writeFileSync(path.join(claude, "started.json"), JSON.stringify(process.argv.slice(2)));
process.on("exit", () => fs.writeFileSync(path.join(claude, "exited"), ""));
const hold = path.join(claude, "hold");
const holdEnd = Date.now() + 30000;
const held = () => fs.existsSync(hold) && Date.now() < holdEnd ? setTimeout(held, 50) : finish();
const finish = () => {
  const file = path.join(claude, "update-check.json");
  const kept = JSON.parse(fs.readFileSync(file, "utf8"));
  const ok = process.env.STUB_RESULT === "ok";
  kept.auto = { version: kept.autoRun.version, from: kept.autoRun.from, headline: "A faster link check", at: new Date().toISOString(), ok, ...(ok ? {} : { error: process.env.STUB_RESULT }) };
  delete kept.autoRun;
  fs.writeFileSync(file, JSON.stringify(kept));
  if (ok) fs.writeFileSync(path.join(claude, "setup-state.json"), JSON.stringify({ version: kept.auto.version }));
  fs.writeFileSync(path.join(claude, "ended"), "");
};
fs.existsSync(hold) ? held() : setTimeout(finish, 1500);
`,
  );
  return h;
};
const at = (h, f) => path.join(h, ".claude", f);
const waitFor = async (file, ms) => {
  for (
    const end = Date.now() + ms;
    Date.now() < end;
    await new Promise((r) => setTimeout(r, 100))
  )
    if (fs.existsSync(file)) return true;
  return false;
};
changelog = log([
  ["1.0.7", "A faster link check."],
  ["1.0.6", "A clearer hook message."],
  ["1.0.5", "Installed already."],
]);
const filesOnly = {
  "1.0.7": { kind: "files", important: false, headline: "A faster link check" },
  "1.0.6": {
    kind: "files",
    important: true,
    headline: "A clearer hook message",
  },
};
released = { version: "1.0.7", releases: filesOnly };
const autoOk = stubHome("auto-ok", "1.0.5");
// The prompt must not wait for the self-install: the stand-in is held until the test lets it go, so a prompt
// that waited for it would come back only after the stand-in has exited
fs.writeFileSync(at(autoOk, "hold"), "");
const started = await run(autoOk, { STUB_RESULT: "ok" });
check(
  "9. all missed releases are files: the prompt returns while update.mjs still runs (not held up) and says nothing yet",
  started.out === "" && !fs.existsSync(at(autoOk, "exited")),
);
check(
  "9. update.mjs --files-only was started on its own",
  (await waitFor(at(autoOk, "started.json"), 5000)) &&
    JSON.parse(fs.readFileSync(at(autoOk, "started.json"), "utf8")).includes(
      "--files-only",
    ),
);
fs.rmSync(at(autoOk, "started.json"));
const during = await run(autoOk, { STUB_RESULT: "ok" });
check(
  "9. while it runs, a prompt is silent and starts no second one",
  during.out === "" && !fs.existsSync(at(autoOk, "started.json")),
);
fs.rmSync(at(autoOk, "hold"));
await waitFor(at(autoOk, "ended"), 5000);
const doneSaid = JSON.parse((await run(autoOk)).out || "{}");
check(
  "9. the next prompt: one grey line that the setup updated itself, no section",
  doneSaid.systemMessage ===
    "Setup updated itself to 1.0.7: A faster link check." &&
    !doneSaid.hookSpecificOutput?.additionalContext,
);
check("9. said once", (await run(autoOk)).out === "");

// the stub's failure: said once with its error, not tried again for that version, the reminder takes over
const autoBad = stubHome("auto-fail", "1.0.5");
await run(autoBad, {
  STUB_RESULT: "could not download v1.0.7.tar.gz (HTTP 404)",
});
await waitFor(at(autoBad, "ended"), 5000);
fs.rmSync(at(autoBad, "started.json"));
const failSaid = JSON.parse((await run(autoBad)).out || "{}");
check(
  "9. a failed self-install: one grey line with the error",
  failSaid.systemMessage ===
    "Setup could not update itself to 1.0.7: could not download v1.0.7.tar.gz (HTTP 404). Type /update-setup to install it.",
);
restore(autoBad, { noticeAt: ago(9), sectionAt: ago(25) });
const afterFail = JSON.parse((await run(autoBad)).out || "{}");
await new Promise((r) => setTimeout(r, 700));
check(
  "9. it is not tried again for the same version; the reminder covers it",
  !fs.existsSync(at(autoBad, "started.json")) &&
    /^Your setup is from Nov 5, 2026\. New: A clearer hook message; plus 1 smaller fix\./.test(
      afterFail.systemMessage || "",
    ) &&
    !/could not update/.test(afterFail.systemMessage),
);

const stale = stubHome("auto-stale", "1.0.5");
await run(stale, { AUTO_UPDATE: "off" }); // the check is stored; a self-install started an hour ago never came back
restore(stale, {
  autoRun: { version: "1.0.7", from: "1.0.5", startedAt: ago(1) },
});
check(
  "9. a self-install that never wrote its result in 15 minutes counts as failed, said once",
  /^Setup could not update itself to 1\.0\.7: it did not finish within 15 minutes\./.test(
    JSON.parse((await run(stale)).out || "{}").systemMessage || "",
  ),
);
// review fixes: the kept files are counted, a lock stops a second start, a broken settings.json still reminds,
// and an answer stored by 1.0.108 (no summary) still reminds
const keptHome = stubHome("auto-kept", "1.0.5");
await run(keptHome, { AUTO_UPDATE: "off" });
restore(keptHome, {
  auto: {
    version: "1.0.7",
    from: "1.0.5",
    headline: "A faster link check",
    at: ago(0),
    ok: true,
    kept: ["hooks/link-gate.mjs", "skills/x/SKILL.md"],
  },
});
check(
  "a self-install that left changed files names how many stayed theirs and /update-setup",
  JSON.parse((await run(keptHome)).out || "{}").systemMessage ===
    "Setup updated itself to 1.0.7: A faster link check. 2 files you changed stayed as yours; /update-setup can take the new version of them.",
);
const locked = stubHome("auto-locked", "1.0.5");
fs.writeFileSync(at(locked, "update-auto.lock"), "");
await run(locked);
await new Promise((r) => setTimeout(r, 700));
check(
  "a self-install lock held by another prompt: nothing started",
  !fs.existsSync(at(locked, "started.json")),
);
const staleLock = stubHome("auto-stale-lock", "1.0.5");
fs.writeFileSync(at(staleLock, "update-auto.lock"), "");
fs.utimesSync(
  at(staleLock, "update-auto.lock"),
  new Date(Date.now() - 3600000),
  new Date(Date.now() - 3600000),
);
await run(staleLock, { STUB_RESULT: "ok" });
check(
  "a lock older than 15 minutes is taken over and the self-install starts",
  await waitFor(at(staleLock, "started.json"), 5000),
);
const badSettingsLog = path.join(tmp, "bad-settings-crash.log");
const badSettings = stubHome("auto-bad-settings", "1.0.5");
fs.writeFileSync(at(badSettings, "settings.json"), "{ not json");
const badOut = JSON.parse(
  (await run(badSettings, { HOOK_ERRORS_LOG: badSettingsLog })).out || "{}",
);
await new Promise((r) => setTimeout(r, 700));
check(
  "settings.json that is not JSON: crash-logged, nothing started, the reminder still shows",
  !fs.existsSync(at(badSettings, "started.json")) &&
    /^Your setup is from/.test(badOut.systemMessage || "") &&
    /not valid JSON/.test(
      fs.existsSync(badSettingsLog)
        ? fs.readFileSync(badSettingsLog, "utf8")
        : "",
    ),
);
const oldShape = home("old-shape", "1.0.5");
fs.writeFileSync(
  at(oldShape, "update-check.json"),
  JSON.stringify({ checkedAt: ago(1), latest: "1.0.7" }),
);
check(
  "an update-check.json from 1.0.108 (no summary): the reminder still shows",
  JSON.parse((await run(oldShape)).out || "{}").systemMessage ===
    "Setup update ready. Type /update-setup; your files are kept.",
);
const noStart = async (name, env, extra) => {
  const h = stubHome(name, "1.0.5");
  extra?.(h);
  const out = JSON.parse((await run(h, env)).out || "{}");
  await new Promise((r) => setTimeout(r, 700));
  return { started: fs.existsSync(at(h, "started.json")), out };
};
const offEnv = await noStart("auto-off-env", { AUTO_UPDATE: "off" });
check(
  "9. AUTO_UPDATE=off in the environment: nothing started, the reminder instead",
  !offEnv.started && /^Your setup is from/.test(offEnv.out.systemMessage || ""),
);
const offSet = await noStart("auto-off-settings", {}, (h) =>
  fs.writeFileSync(
    at(h, "settings.json"),
    JSON.stringify({ env: { AUTO_UPDATE: "off" } }),
  ),
);
check(
  "9. AUTO_UPDATE=off in settings.json env: nothing started",
  !offSet.started && /^Your setup is from/.test(offSet.out.systemMessage || ""),
);
released = {
  version: "1.0.7",
  releases: {
    ...filesOnly,
    "1.0.6": { kind: "setup", important: true, headline: "A new command" },
  },
};
const oneSetup = await noStart("auto-one-setup", {});
check(
  "9. one setup release among the missed: nothing started, the reminder covers all",
  !oneSetup.started &&
    /New: A new command; plus 1 smaller fix/.test(
      oneSetup.out.systemMessage || "",
    ),
);
released = { version: "1.0.7", releases: { "1.0.7": filesOnly["1.0.7"] } };
const noEntry = await noStart("auto-no-entry", {});
check(
  "5. a missed release with no entry counts as setup and important: nothing started, Claude's section asked for",
  !noEntry.started &&
    /What the update brings you/.test(
      noEntry.out.hookSpecificOutput?.additionalContext || "",
    ),
);
released = { version: "1.0.7" };
const oldServer = await noStart("old-server", {});
check(
  "7. version.json without releases (an old server): reminds as before, nothing started",
  !oldServer.started &&
    /^Your setup is from Nov 5, 2026\. New: 2 more releases\./.test(
      oldServer.out.systemMessage || "",
    ) &&
    /1\.0\.7: A faster link check\./.test(
      oldServer.out.hookSpecificOutput?.additionalContext || "",
    ),
);

// ---- NB4: `nimbalyst` releases and Nimbalyst's delivery. A stand-in deliver.mjs in the home writes what it was
// started with and touches no Nimbalyst
const deliverStub = (h) => {
  const stub = at(h, path.join("tools", "nimbalyst-patch", "deliver.mjs"));
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  fs.writeFileSync(
    stub,
    `import fs from "node:fs";\nfs.writeFileSync(new URL("./started.json", import.meta.url), JSON.stringify(process.argv.slice(2)));\n`,
  );
  return path.join(path.dirname(stub), "started.json");
};
released = {
  version: "1.0.7",
  releases: {
    "1.0.7": {
      kind: "nimbalyst",
      important: false,
      headline: "Nimbalyst 0.84.0 with the setup's fixes",
    },
    "1.0.6": filesOnly["1.0.6"],
  },
};
const nbHome = stubHome("nb-auto", "1.0.5");
const nbStarted = deliverStub(nbHome);
await run(nbHome, { STUB_RESULT: "ok" });
check(
  "NB4. a run of files and nimbalyst releases installs itself: update.mjs --files-only is started",
  (await waitFor(at(nbHome, "started.json"), 5000)) &&
    JSON.parse(fs.readFileSync(at(nbHome, "started.json"), "utf8")).includes(
      "--files-only",
    ),
);
check(
  "NB4. deliver.mjs is not started before the self-install ended",
  !fs.existsSync(nbStarted),
);
await waitFor(at(nbHome, "ended"), 5000);
const nbDone = JSON.parse((await run(nbHome)).out || "{}");
check(
  "NB4. the prompt that says the self-install starts deliver.mjs --stage, with no yes on record",
  /^Setup updated itself to 1\.0\.7/.test(nbDone.systemMessage || "") &&
    (await waitFor(nbStarted, 5000)) &&
    fs.readFileSync(nbStarted, "utf8") === JSON.stringify(["--stage"]) &&
    !fs.existsSync(dataOf(nbHome)),
);
fs.rmSync(nbStarted);
await run(nbHome);
await new Promise((r) => setTimeout(r, 700));
check("NB4. the next prompt starts no second stage", !fs.existsSync(nbStarted));
const nbOff = async (name, env, extra) => {
  const h = stubHome(name, "1.0.5");
  const started = deliverStub(h);
  extra?.(h);
  await run(h, { STUB_RESULT: "ok", ...env });
  await waitFor(at(h, "ended"), 5000);
  const out = JSON.parse((await run(h, env)).out || "{}");
  await new Promise((r) => setTimeout(r, 700));
  return { started: fs.existsSync(started), out };
};
const nbOffEnv = await nbOff("nb-off-env", { NIMBALYST_FOLLOW: "off" });
check(
  "NB4. NIMBALYST_FOLLOW=off in the environment: the self-install runs, deliver.mjs is not started",
  !nbOffEnv.started &&
    /^Setup updated itself to 1\.0\.7/.test(nbOffEnv.out.systemMessage || ""),
);
const nbOffSet = await nbOff("nb-off-settings", {}, (h) =>
  fs.writeFileSync(
    at(h, "settings.json"),
    JSON.stringify({ env: { NIMBALYST_FOLLOW: "off" } }),
  ),
);
check(
  "NB4. NIMBALYST_FOLLOW=off in settings.json env: deliver.mjs is not started",
  !nbOffSet.started &&
    /^Setup updated itself/.test(nbOffSet.out.systemMessage || ""),
);
const nbMissingLog = path.join(tmp, "nb-missing-crash.log");
const nbMissing = stubHome("nb-missing", "1.0.5");
await run(nbMissing, { STUB_RESULT: "ok" });
await waitFor(at(nbMissing, "ended"), 5000);
const nbMissingOut = JSON.parse(
  (await run(nbMissing, { HOOK_ERRORS_LOG: nbMissingLog })).out || "{}",
);
check(
  "NB4. no deliver.mjs in the home: the grey line still comes and the missing file is logged",
  /^Setup updated itself to 1\.0\.7/.test(nbMissingOut.systemMessage || "") &&
    /deliver\.mjs is missing/.test(
      fs.existsSync(nbMissingLog) ? fs.readFileSync(nbMissingLog, "utf8") : "",
    ),
);

// the grey lines of the delivery, each said once
const nbLines = home("nb-lines", "1.0.7"); // on the newest, so no reminder comes with them
const nbData = dataOf(nbLines);
const nbJson = (f, v) => {
  fs.mkdirSync(nbData, { recursive: true });
  fs.writeFileSync(path.join(nbData, f), JSON.stringify(v));
};
const nbSay = async () =>
  JSON.parse((await run(nbLines)).out || "{}").systemMessage || "";
const lookedAgo = (hours) =>
  restore(nbLines, {
    nimbalyst: { ...stored(nbLines).nimbalyst, stagedLook: ago(hours) },
  });
nbJson("staged.json", {
  version: "0.84.0",
  installer: "staged/Nimbalyst-Setup-0.84.0.exe",
});
check(
  "NB4. a staged version: one grey line that /update-setup restarts it",
  (await nbSay()) ===
    "Nimbalyst 0.84.0 is ready: /update-setup restarts it to finish.",
);
check("NB4. the ready line is said once", (await nbSay()) === "");
lookedAgo(2);
check(
  "NB4. and not again at the hourly look for the same version",
  (await nbSay()) === "",
);
nbJson("staged.json", { version: "0.85.0", installer: null });
check(
  "NB4. within the hour of the last look staged.json is not read (one stat a prompt)",
  (await nbSay()) === "",
);
lookedAgo(2);
check(
  "NB4. the hourly look says a newly staged version",
  (await nbSay()) ===
    "Nimbalyst 0.85.0 is ready: /update-setup restarts it to finish.",
);
fs.rmSync(path.join(nbData, "staged.json"));
nbJson("status.json", {
  at: new Date().toISOString(),
  ok: true,
  version: "0.85.0",
  patches: 3,
});
check(
  "NB4. an install's result: one grey line",
  (await nbSay()) === "Nimbalyst 0.85.0 installed with the setup's fixes.",
);
check("NB4. the result is said once", (await nbSay()) === "");
nbJson("status.json", {
  at: new Date(Date.now() + 1000).toISOString(),
  ok: false,
  version: "0.85.0",
  error: "the installer ended with exit code 2.",
});
check(
  "NB4. a failed install: one grey line with the error",
  (await nbSay()) ===
    "The update to Nimbalyst 0.85.0 stopped: the installer ended with exit code 2.",
);
check("NB4. the error is said once", (await nbSay()) === "");

// D4: project moves queued while Nimbalyst runs (move-project.mjs --queue writes moves.json in the same data folder)
const mvHome = home("nb-moves", "1.0.7");
const mvFile = path.join(dataOf(mvHome), "moves.json");
const mvWrite = (text) => {
  fs.mkdirSync(dataOf(mvHome), { recursive: true });
  fs.writeFileSync(mvFile, text);
};
const mvRun = async () => {
  const r = await run(mvHome);
  return { code: r.code, said: JSON.parse(r.out || "{}").systemMessage || "" };
};
check("D4. no moves.json: no moves line", (await mvRun()).said === "");
const queued = [
  { from: "C:\\Projects\\old-a", to: "C:\\Projects\\new-a", at: ago(1) },
  { from: "C:\\Projects\\old-b", to: "C:\\Projects\\new-b", at: ago(1) },
];
mvWrite(JSON.stringify({ moves: queued }));
check(
  "D4. moves waiting for Nimbalyst to close are said, each named",
  (await mvRun()).said ===
    "2 project moves wait for Nimbalyst to close: C:\\Projects\\old-a -> C:\\Projects\\new-a; C:\\Projects\\old-b -> C:\\Projects\\new-b.",
);
check(
  "D4. the waiting moves are said once, not again with the same moves.json",
  (await mvRun()).said === "",
);
mvWrite(JSON.stringify({ moves: queued }, null, 2));
check(
  "D4. moves.json written again with the same moves: not said again",
  (await mvRun()).said === "",
);
mvWrite(
  JSON.stringify({
    moves: [],
    refused: [
      {
        ...queued[0],
        when: ago(0),
        exit: 1,
        why: "move-project refused: C:\\Projects\\new-a exists already.",
      },
    ],
  }),
);
check(
  "D4. a refused move is said with the reason and where it is kept",
  (await mvRun()).said ===
    `The queued move C:\\Projects\\old-a -> C:\\Projects\\new-a was refused: C:\\Projects\\new-a exists already (kept in ${mvFile} until that project is queued again or moved; delete it there to drop it).`,
);
mvWrite(JSON.stringify({ moves: [] }));
check("D4. an empty moves list: no moves line", (await mvRun()).said === "");
fs.rmSync(mvFile);
check("D4. moves.json gone: no moves line", (await mvRun()).said === "");
mvWrite(JSON.stringify({ moves: queued.slice(0, 1) }));
check(
  "D4. a move queued again after the file was gone is said again",
  (await mvRun()).said ===
    "1 project move waits for Nimbalyst to close: C:\\Projects\\old-a -> C:\\Projects\\new-a.",
);
mvWrite("{ not json");
const mvBroken = await mvRun();
check(
  "D4. a moves.json that is not JSON: no crash, a short note naming the file",
  mvBroken.code === 0 &&
    mvBroken.said.startsWith(
      `The queued project moves in ${mvFile} can't be read: `,
    ) &&
    mvBroken.said.endsWith("; fix or delete it."),
);
check("D4. the broken file is said once", (await mvRun()).said === "");
mvWrite(JSON.stringify({ moves: "x" }));
check(
  "D4. a moves.json with no moves list: the short note",
  (await mvRun()).said ===
    `The queued project moves in ${mvFile} can't be read: it has no "moves" list; fix or delete it.`,
);

// ---- T5: `quiet` releases (plan 2026-11-15-quiet-updates). The stand-in update.mjs above writes what it was started
// with; one missed release or two, as the changelog lists them
const quietKinds = (...kinds) => {
  const vs = kinds.length === 1 ? ["1.0.7"] : ["1.0.7", "1.0.6"];
  changelog = log([
    ...vs.map((v) => [v, `Release ${v}.`]),
    ["1.0.5", "Installed already."],
  ]);
  released = {
    version: "1.0.7",
    releases: Object.fromEntries(
      vs.map((v, i) => [
        v,
        { kind: kinds[i], important: false, headline: `Release ${v}` },
      ]),
    ),
  };
};
const argsOf = (h) =>
  JSON.parse(fs.readFileSync(at(h, "started.json"), "utf8"));
quietKinds("quiet");
const q1 = await noStart("quiet-one", {});
const q1Home = path.join(tmp, "quiet-one");
check(
  "T5. [quiet]: update.mjs --quiet is started, not --files-only",
  q1.started &&
    argsOf(q1Home).includes("--quiet") &&
    !argsOf(q1Home).includes("--files-only") &&
    stored(q1Home).autoRun?.mode === "quiet",
);
quietKinds("quiet", "files");
const q2 = await noStart("quiet-files", {});
check(
  "T5. [files, quiet]: update.mjs --quiet is started",
  q2.started && argsOf(path.join(tmp, "quiet-files")).includes("--quiet"),
);
quietKinds("quiet", "setup");
const q3 = await noStart("quiet-setup", {});
check(
  "T5. [quiet, setup]: nothing started, the reminder instead",
  !q3.started && /^Your setup is from/.test(q3.out.systemMessage || ""),
);
quietKinds("quiet", "files");
const q4 = await noStart("quiet-off", { AUTO_UPDATE: "off" });
check(
  "T5. [files, quiet] with AUTO_UPDATE=off: nothing started, the reminder instead",
  !q4.started && /^Your setup is from/.test(q4.out.systemMessage || ""),
);
quietKinds("later-kind");
const q5 = await noStart("quiet-unknown", {});
check(
  "T5. an unknown kind: nothing started, it reminds",
  !q5.started && /^Setup update ready/.test(q5.out.systemMessage || ""),
);
// a quiet run under way: alive at 16 minutes, dead at 46
const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
quietKinds("quiet");
const qAlive = stubHome("quiet-alive", "1.0.5");
await run(qAlive, { AUTO_UPDATE: "off" });
restore(qAlive, {
  autoRun: {
    version: "1.0.7",
    from: "1.0.5",
    mode: "quiet",
    startedAt: minsAgo(16),
  },
});
const aliveOut = await run(qAlive);
check(
  "T5. a quiet run started 16 minutes ago is alive: silent, still under way",
  aliveOut.out === "" && stored(qAlive).autoRun?.mode === "quiet",
);
restore(qAlive, {
  autoRun: { ...stored(qAlive).autoRun, startedAt: minsAgo(46) },
});
check(
  "T5. a quiet run started 46 minutes ago is dead: said once as not finished within 45 minutes",
  /^Setup could not update itself to 1\.0\.7: it did not finish within 45 minutes\./.test(
    JSON.parse((await run(qAlive)).out || "{}").systemMessage || "",
  ) && !stored(qAlive).autoRun,
);
const qLock = stubHome("quiet-lock", "1.0.5");
fs.writeFileSync(at(qLock, "update-auto.lock"), "quiet");
const lockAt = new Date(Date.now() - 20 * 60000);
fs.utimesSync(at(qLock, "update-auto.lock"), lockAt, lockAt);
await run(qLock);
await new Promise((r) => setTimeout(r, 700));
check(
  "T5. a quiet run's lock 20 minutes old is still held: nothing started",
  !fs.existsSync(at(qLock, "started.json")),
);

// ---- T6: the grey line of a quiet run from update.mjs's `auto`, and the Nimbalyst line from staged.json
const quietSaid = async (name, extra) => {
  const h = stubHome(name, "1.0.5");
  await run(h, { AUTO_UPDATE: "off" });
  restore(h, {
    auto: {
      version: "1.0.7",
      from: "1.0.5",
      headline: "The job tracker says more",
      at: ago(0),
      ok: true,
      kept: [],
      extFailed: [],
      ...extra,
    },
  });
  return JSON.parse((await run(h, { AUTO_UPDATE: "off" })).out || "{}")
    .systemMessage;
};
const QUIET_LINE = "Setup updated itself to 1.0.7: The job tracker says more.";
const startsNext = "The panels change the next time Nimbalyst starts.";
check(
  'T6. panels "in": the panels change at the next start',
  (await quietSaid("t6-in", { panels: "in" })) ===
    `${QUIET_LINE} ${startsNext}`,
);
check(
  'T6. panels "at-close": the same sentence',
  (await quietSaid("t6-at-close", { panels: "at-close" })) ===
    `${QUIET_LINE} ${startsNext}`,
);
check(
  'T6. panels "waiting": /update-setup puts them in',
  (await quietSaid("t6-waiting", { panels: "waiting" })) ===
    `${QUIET_LINE} New panels are waiting: type /update-setup to put them in (Nimbalyst restarts).`,
);
check(
  "T6. panels null: no panel sentence",
  (await quietSaid("t6-null", { panels: null })) === QUIET_LINE,
);
check(
  "T6. a panel whose build failed is named after the others' sentence, with the retry",
  (await quietSaid("t6-failed", {
    panels: "in",
    extFailed: ["job-tracker"],
  })) ===
    `${QUIET_LINE} ${startsNext} Panel job-tracker could not be updated; the old one still works, and /update-setup tries again.`,
);
check(
  "T6. two failed panels: the plural sentence",
  (await quietSaid("t6-failed-two", {
    panels: "in",
    extFailed: ["job-tracker", "sessions"],
  })) ===
    `${QUIET_LINE} ${startsNext} Panels job-tracker, sessions could not be updated; the old ones still work, and /update-setup tries again.`,
);
check(
  "T6. a quiet run's kept files are counted as the files-only line does",
  (await quietSaid("t6-kept", {
    panels: null,
    kept: ["hooks/link-gate.mjs"],
  })) ===
    `${QUIET_LINE} 1 file you changed stayed as yours; /update-setup can take the new version of it.`,
);
const atCloseHome = home("t6-nb-at-close", "1.0.7");
fs.mkdirSync(dataOf(atCloseHome), { recursive: true });
fs.writeFileSync(
  path.join(dataOf(atCloseHome), "staged.json"),
  JSON.stringify({ version: "0.86.0", installer: null, atClose: true }),
);
check(
  "T6. a staged Nimbalyst with atClose: it goes in the next time Nimbalyst is closed",
  JSON.parse((await run(atCloseHome)).out || "{}").systemMessage ===
    "Nimbalyst 0.86.0 is ready: it goes in the next time you close Nimbalyst.",
);
const markerHome = home("t6-nb-marker", "1.0.7");
fs.mkdirSync(dataOf(markerHome), { recursive: true });
fs.writeFileSync(
  path.join(dataOf(markerHome), "staged.json"),
  JSON.stringify({
    extensions: true,
    installer: null,
    at: ago(0),
    atClose: true,
  }),
);
check(
  "T6. a marker job (no version): no Nimbalyst line",
  (await run(markerHome)).out === "",
);

changelog = null;
released = { version: "1.10.0" };

const off = home("off", "1.0.0");
const askedBeforeOff = asked;
check(
  "UPDATE_CHECK=off: silent, asks nobody",
  (await run(off, { UPDATE_CHECK: "off" })).out === "" &&
    asked === askedBeforeOff &&
    kept(off) === null,
);

const down = home("down", "1.0.0");
const offline = await run(down, { SETUP_UPDATE_BASE: "http://127.0.0.1:9" });
check(
  "GitHub not reachable: silent, exits cleanly",
  offline.out === "" && offline.code === 0,
);
check(
  "the failure and its reason are kept, no check is recorded",
  !!kept(down)?.failedAt &&
    /\S/.test(kept(down)?.error || "") &&
    !kept(down)?.checkedAt,
);
const missing = home("missing", "1.0.0");
const notFound = await run(missing, { SETUP_UPDATE_BASE: `${BASE}/nowhere` });
check(
  "an address that answers 404: silent, and the reason (HTTP 404) is kept",
  notFound.out === "" &&
    notFound.code === 0 &&
    kept(missing)?.error === "HTTP 404",
);
// Offline, a refused connection and an HTTP error are the hourly retry's business, not crashes: they leave no line in the crash log
const crashLogFile = path.join(
  os.tmpdir(),
  `update-check-crash-${process.pid}.log`,
);
fs.rmSync(crashLogFile, { force: true });
await run(home("quiet404", "1.0.0"), {
  SETUP_UPDATE_BASE: `${BASE}/nowhere`,
  HOOK_ERRORS_LOG: crashLogFile,
});
await run(home("quietdown", "1.0.0"), {
  SETUP_UPDATE_BASE: "http://127.0.0.1:9",
  HOOK_ERRORS_LOG: crashLogFile,
});
check(
  "a 404 and a refused connection leave no line in the crash log",
  !fs.existsSync(crashLogFile),
);

// An address that never answers (a dropped connection, as with no network): a prompt must not wait long
let hung = 0,
  hangAsked = 0;
const hang = http.createServer((req) => {
  hangAsked++;
  if (req.url === "/version.json") hung++;
}); // the changelog is asked beside it
await new Promise((r) => hang.listen(0, "127.0.0.1", r));
const HANG = `http://127.0.0.1:${hang.address().port}`;
// The first prompt gives up on GitHub in under a second: this one answers a newer version 1 s after each request,
// so a prompt that waited a second or more would hear it and announce it. Timed by the two clocks of the wait
// itself, not by the prompt's run, which a busy computer stretches with node's start.
const lateLine = http.createServer((req, res) =>
  setTimeout(() => {
    if (req.url !== "/version.json") res.statusCode = 404;
    res.end(req.url === "/version.json" ? '{"version":"1.10.0"}' : "");
  }, 1000),
);
await new Promise((r) => lateLine.listen(0, "127.0.0.1", r));
const stuck = home("stuck", "1.0.0");
const slow = await run(stuck, {
  SETUP_UPDATE_BASE: `http://127.0.0.1:${lateLine.address().port}`,
});
check(
  "no answer within a second: the first prompt gives up before it (does not hear the late 1.10.0), silent, exit 0",
  slow.out === "" && slow.code === 0 && !kept(stuck)?.latest,
);
check(
  "no answer: the reason is kept",
  /no answer in time/.test(kept(stuck)?.error || ""),
);
lateLine.closeAllConnections?.();
lateLine.close();
// The next prompts cost a file read, not a wait on the network: they ask nothing at all
const again = await run(stuck, { SETUP_UPDATE_BASE: HANG });
check(
  "the next prompts do not ask again for an hour (no request of any kind, so no wait on the network)",
  again.out === "" && hangAsked === 0,
);
const hungBefore = hung;
fs.writeFileSync(
  path.join(stuck, ".claude", "update-check.json"),
  JSON.stringify({
    failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    error: "no answer in time",
  }),
);
await run(stuck, { SETUP_UPDATE_BASE: HANG });
check("two hours after a failure it asks again", hung === hungBefore + 1);
fs.writeFileSync(
  path.join(stuck, ".claude", "update-check.json"),
  JSON.stringify({
    failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    error: "no answer in time",
  }),
);
const back = await run(stuck);
check(
  "a good answer after a failure announces the update and clears the failure",
  /1\.10\.0/.test(back.out) &&
    kept(stuck)?.latest === "1.10.0" &&
    !kept(stuck)?.failedAt,
);
hang.closeAllConnections?.();
hang.close();

// A slow line: an answer that takes 1.2 seconds is missed at the short wait and heard on the try after a timeout
const slowLine = http.createServer((_req, res) =>
  setTimeout(() => res.end(JSON.stringify({ version: "1.11.0" })), 1200),
);
await new Promise((r) => slowLine.listen(0, "127.0.0.1", r));
const SLOW = `http://127.0.0.1:${slowLine.address().port}`;
const late = home("late-line", "1.0.0");
fs.writeFileSync(
  path.join(late, ".claude", "update-check.json"),
  JSON.stringify({
    failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    error: "no answer in time",
  }),
);
const heard = await run(late, { SETUP_UPDATE_BASE: SLOW });
check(
  "after a timeout the next try waits longer, so a slow line still hears of an update",
  /1\.11\.0/.test(heard.out) && kept(late)?.latest === "1.11.0",
);
slowLine.closeAllConnections?.();
slowLine.close();

// ---- the tidy offer: own rules not tidied yet are noted once per change, outside the reminder chain
const OWN = fileURLToPath(
  new URL("../skills/update-setup/own-rules.mjs", import.meta.url),
);
const ownRun = (h, ...flags) =>
  spawnSync(process.execPath, [OWN, "--home", h, ...flags], {
    encoding: "utf8",
  });
const MINE = "## Mine\n\n- Prices in cents.\n";
// a home on 1.2.0 with my-rules.md (none when text is null), a fresh check on record, and the given state and answer
const rulesHome = (name, { state = {}, answer = {}, text = MINE } = {}) => {
  const c = path.join(home(name, "1.2.0"), ".claude");
  if (text !== null) {
    fs.mkdirSync(path.join(c, "rules"), { recursive: true });
    fs.writeFileSync(path.join(c, "rules", "my-rules.md"), text);
  }
  fs.writeFileSync(
    path.join(c, "setup-state.json"),
    JSON.stringify({ version: "1.2.0", ...state }),
  );
  fs.writeFileSync(
    path.join(c, "update-check.json"),
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      latest: "1.2.0",
      installed: "1.2.0",
      ...answer,
    }),
  );
  return path.dirname(c);
};
const noteOf = (r) => {
  try {
    return JSON.parse(r.out).hookSpecificOutput?.additionalContext || "";
  } catch {
    return "";
  }
};
// what an install, update or own-rules.mjs does to setup-state.json: a new modification time
const touch = (h) => {
  const t = new Date(Date.now() + 60000 * Math.random() + 1000);
  fs.utimesSync(path.join(h, ".claude", "setup-state.json"), t, t);
};
const pendingOf = (h) =>
  ownRun(h, "--status", "--homes").stdout.match(/^pending: (\w+)$/m)?.[1];

const carved = rulesHome("own-carve");
const n1 = noteOf(await run(carved));
check(
  "own rules left by a carve: the next prompt asks Claude to offer the tidy, naming size, tidy.md and --skip --homes",
  /^\[update-check\] Rules this person wrote are not tidied yet: ~\/\.claude\/rules\/my-rules\.md \(3 lines, about \d+ tokens loaded in every chat\)/.test(
    n1,
  ) &&
    /tidy\.md/.test(n1) &&
    /own-rules\.mjs --skip --homes/.test(n1),
);
check(
  "the hook's pending key is the one own-rules.mjs --status prints",
  !!kept(carved)?.ownNoted && kept(carved).ownNoted === pendingOf(carved),
);
const n2 = await run(carved);
touch(carved);
const n3 = await run(carved);
check(
  "once per change: silent on the next prompt, and after another state write with the same files",
  n2.out === "" && n3.out === "",
);
fs.appendFileSync(
  path.join(carved, ".claude", "rules", "my-rules.md"),
  "- Metric units.\n",
);
touch(carved);
check(
  "a changed file after the next state write is noted again",
  /not tidied yet/.test(noteOf(await run(carved))),
);

const staleOwn = rulesHome("own-stale", {
  answer: { latest: "1.2.0", installed: "1.0.0" },
});
const staleOwnOut = await run(staleOwn);
check(
  "a stale installed (updated since the check) doesn't swallow the note",
  /not tidied yet/.test(noteOf(staleOwnOut)) &&
    kept(staleOwn)?.installed === "1.2.0",
);
const behindOwn = rulesHome("own-old-text", {
  state: { version: "1.0.0" },
  answer: { latest: "1.2.0", installed: "1.0.0" },
});
const both = JSON.parse((await run(behindOwn)).out || "{}");
check(
  "an old-text updater with a version pending: the note comes merged after the release section, the grey line kept",
  /A newer version of the Claude Code setup is released[\s\S]*\n\n\[update-check\] Rules this person wrote are not tidied yet/.test(
    both.hookSpecificOutput?.additionalContext || "",
  ) && !!both.systemMessage,
);

const offeredHome = rulesHome("own-offered");
check(
  "no note once /update-setup made the offer (own-rules.mjs --offered)",
  ownRun(offeredHome, "--offered").status === 0 &&
    (await run(offeredHome)).out === "",
);
const skippedHome = rulesHome("own-skipped");
check(
  "no note after --skip --homes",
  ownRun(skippedHome, "--skip", "--homes").status === 0 &&
    (await run(skippedHome)).out === "",
);
const appliedHome = rulesHome("own-applied");
const ledgerOut = path.join(tmp, "own-applied.out.md");
fs.writeFileSync(ledgerOut, MINE);
const mineFile = path
  .join(appliedHome, ".claude", "rules", "my-rules.md")
  .replace(/\\/g, "/");
fs.writeFileSync(
  path.join(tmp, "own-applied.json"),
  JSON.stringify({
    ledger: 1,
    files: [
      {
        file: mineFile,
        sha: crypto.createHash("sha256").update(MINE).digest("hex"),
        out: ledgerOut,
        blocks: [
          { id: "B1", key: key("## Mine"), kind: "heading", verdict: "keep" },
          {
            id: "B2",
            key: key("- Prices in cents."),
            kind: "own",
            verdict: "keep",
          },
        ],
      },
    ],
  }),
);
check(
  "no note after --apply <ledger>",
  ownRun(appliedHome, "--apply", path.join(tmp, "own-applied.json")).status ===
    0 && (await run(appliedHome)).out === "",
);
const noRules = rulesHome("own-none", { text: null });
check(
  "no my-rules.md: silent, nothing noted",
  (await run(noRules)).out === "" && !kept(noRules)?.ownNoted,
);

const projs = path.join(tmp, "own-projects");
const thesis = path.join(projs, "thesis");
fs.mkdirSync(path.join(thesis, ".claude", "rules"), { recursive: true });
fs.writeFileSync(
  path.join(thesis, ".claude", "rules", "my-rules.md"),
  "- Cite in APA 7.\n",
);
const homeOnly = rulesHome("own-home", {
  text: null,
  state: {
    projects: projs.replace(/\\/g, "/"),
    written: { [path.join(thesis, "CLAUDE.md").replace(/\\/g, "/")]: "0" },
  },
});
const hn = noteOf(await run(homeOnly));
check(
  "a project home's own rules alone are noted, and the key matches own-rules.mjs --status --homes",
  /not tidied yet: 1 project folder's own rules\./.test(hn) &&
    kept(homeOnly)?.ownNoted === pendingOf(homeOnly),
);

// ---- the 26.x versions: compared number by number, so 26.1 comes after 1.0.113 and 26.1.1 after 26.1
changelog = null;
const greyOf = (r) => (r.out ? JSON.parse(r.out).systemMessage || "" : "");
released = { version: "26.1", summary: "The new numbering." };
check(
  "26.1 is newer than 1.0.113",
  /^Setup update ready: The new numbering\./.test(
    greyOf(await run(home("v26-from-1", "1.0.113"))),
  ),
);
released = { version: "26.1.1", summary: "A fix." };
check(
  "26.1.1 is newer than 26.1",
  /^Setup update ready: A fix\./.test(
    greyOf(await run(home("v26-patch", "26.1"))),
  ),
);
released = { version: "26.1" };
check(
  "26.1 installed and released: not newer, silent",
  (await run(home("v26-same", "26.1"))).out === "",
);
released = { version: "1.0.114" };
check(
  "26.1 installed, 1.0.114 released: not newer, silent",
  (await run(home("v26-ahead", "26.1"))).out === "",
);

// ---- version.json `notice`: a heads-up about a release planned soon, said once per id
const NOTICE = {
  id: "big-release-1",
  text: "A full update lands before Thursday morning",
  issues: ["Long builds can stop early.", "The panel shows no effort yet"],
};
const NOTICE_LINE =
  "Setup notice: A full update lands before Thursday morning. Things to be aware of until then: Long builds can stop early; The panel shows no effort yet.";
released = { version: "1.2.0", summary: "A new thing.", notice: NOTICE };
const noticed = home("notice-current", "1.2.0");
const firstNotice = await run(noticed);
check(
  "a notice to an up-to-date setup: one grey line, with the known issues",
  greyOf(firstNotice) === NOTICE_LINE &&
    kept(noticed)?.noticeShown === "big-release-1",
);
restore(noticed, { checkedAt: ago(13) });
check(
  "the same notice is not said again, also after the next check",
  (await run(noticed)).out === "" &&
    kept(noticed)?.notice?.id === "big-release-1",
);
released = {
  version: "1.2.0",
  summary: "A new thing.",
  notice: { ...NOTICE, id: "big-release-2" },
};
restore(noticed, { checkedAt: ago(13) });
check(
  "a notice with a new id is said once more",
  greyOf(await run(noticed)) === NOTICE_LINE,
);
released = { version: "1.2.0", summary: "A new thing.", notice: NOTICE };
check(
  "a notice and a pending update: the reminder's line first, then the notice",
  greyOf(await run(home("notice-behind", "1.0.0"))) ===
    `Setup update ready: A new thing. Type /update-setup; your files are kept.\n${NOTICE_LINE}`,
);
released = { version: "1.2.0", notice: { ...NOTICE, version: "1.2.0" } };
const had = home("notice-installed", "1.2.0");
check(
  "a notice for a release already installed: silent, marked as said",
  (await run(had)).out === "" && kept(had)?.noticeShown === "big-release-1",
);
released = { version: "1.2.0", notice: { text: "No id." } };
const badNotice = home("notice-bad", "1.2.0");
check(
  "a notice with no id: left out, silent",
  (await run(badNotice)).out === "" &&
    kept(badNotice)?.notice === undefined &&
    kept(badNotice)?.latest === "1.2.0",
);
released = { version: "1.2.0", summary: "A new thing." };
const plain = home("notice-none", "1.0.0");
const plainOut = await run(plain);
check(
  "no notice field: the output is the reminder alone, nothing about a notice kept",
  greyOf(plainOut) ===
    "Setup update ready: A new thing. Type /update-setup; your files are kept." &&
    !("notice" in kept(plain)) &&
    !("noticeShown" in kept(plain)),
);
check(
  "no notice field, up to date: silent",
  (await run(home("notice-none-current", "1.2.0"))).out === "",
);

// ---- the project pass offer: once per folder per day, in a folder behind the level of ~/.claude/project-pass.json
{
  const fwdP = (p) => path.resolve(p).replace(/\\/g, "/");
  const passHome = (name, stamp, { claudeMd = true } = {}) => {
    const h = home(name, "1.2.0");
    const folder = path.join(tmp, name, "work");
    fs.mkdirSync(folder, { recursive: true });
    if (claudeMd) fs.writeFileSync(path.join(folder, "CLAUDE.md"), "# Work\n");
    if (stamp)
      fs.writeFileSync(
        path.join(h, ".claude", "project-pass.json"),
        JSON.stringify({
          level: 1,
          folders: {},
          declined: {},
          declinedAll: null,
          mode: "on-open",
          ...stamp(fwdP(folder)),
        }),
      );
    return { h, env: { CLAUDE_PROJECT_DIR: folder }, folder: fwdP(folder) };
  };
  const ctxOf = (r) =>
    r.out ? JSON.parse(r.out).hookSpecificOutput?.additionalContext || "" : "";
  const behind = passHome("pass-behind", () => ({}));
  const offer = await run(behind.h, behind.env);
  check(
    "a project folder behind the pass level: Claude is asked to offer the pass on a card, why it matters, with the skill and the skip commands",
    /set up before the current setup/.test(ctxOf(offer)) &&
      /one question card .*Options: Yes \/ Not now \/ Never, in any folder\./.test(
        ctxOf(offer),
      ) &&
      /current rules, systems map and file layout/.test(ctxOf(offer)) &&
      ctxOf(offer).includes("update-project/SKILL.md") &&
      ctxOf(offer).includes(`--skip "${behind.folder}"`) &&
      /On "never, in any folder": run .*--skip-all/.test(ctxOf(offer)) &&
      !JSON.parse(offer.out).systemMessage,
  );
  check(
    "and the folder is noted for today",
    Object.keys(kept(behind.h)?.passNoted || {}).length === 1 &&
      Object.keys(kept(behind.h).passNoted)[0] === behind.folder,
  );
  check(
    "the same folder the same day: silent",
    (await run(behind.h, behind.env)).out === "",
  );
  const stale = passHome("pass-noted-yesterday", () => ({}));
  fs.writeFileSync(
    path.join(stale.h, ".claude", "update-check.json"),
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      latest: "1.2.0",
      passNoted: { [stale.folder]: "2000-01-01", "C:/elsewhere": "2000-01-01" },
    }),
  );
  check(
    "a folder noted on an earlier day: offered again, and old days' entries are dropped",
    /set up before the current setup/.test(
      ctxOf(await run(stale.h, stale.env)),
    ) && Object.keys(kept(stale.h).passNoted).join() === stale.folder,
  );
  const done = passHome("pass-done", (f) => ({
    folders: { [f]: { done: 1, date: "2026-11-12", kept: [] } },
  }));
  check(
    "a folder stamped done at the level: silent",
    (await run(done.h, done.env)).out === "",
  );
  const doneOld = passHome("pass-done-old", (f) => ({
    level: 2,
    folders: { [f]: { done: 1, date: "2026-11-12", kept: [] } },
  }));
  check(
    "a folder stamped at a lower level: offered",
    /set up before the current setup/.test(
      ctxOf(await run(doneOld.h, doneOld.env)),
    ),
  );
  const declined = passHome("pass-declined", (f) => ({ declined: { [f]: 1 } }));
  check(
    "a folder declined at the level: silent",
    (await run(declined.h, declined.env)).out === "",
  );
  const all = passHome("pass-declined-all", () => ({ declinedAll: 1 }));
  check(
    "every folder declined at the level: silent",
    (await run(all.h, all.env)).out === "",
  );
  const off = passHome("pass-mode-off", () => ({ mode: "off" }));
  check("mode off: silent", (await run(off.h, off.env)).out === "");
  // A folder with no CLAUDE.md and no .git: /new-project is offered on a card, once a day, whatever the stamp file says
  const bare = passHome("pass-not-a-project", () => ({}), { claudeMd: false });
  const setUp = ctxOf(await run(bare.h, bare.env));
  check(
    "a folder with no CLAUDE.md and no .git: Claude is asked to offer /new-project on a card, with the skill",
    /is not set up as a project/.test(setUp) &&
      setUp.includes(bare.folder) &&
      /one question card .*\/new-project.*Options: Yes \/ Not now \/ Never here \/ Never in any folder\./.test(
        setUp,
      ) &&
      setUp.includes("new-project/SKILL.md") &&
      setUp.includes(
        `On "never here": run node ~/.claude/skills/update-project/pass.mjs --skip "${bare.folder}"`,
      ) &&
      /On "never in any folder".*--skip-all/.test(setUp) &&
      !/set up before the current setup/.test(setUp),
  );
  check(
    "and the same folder the same day: silent",
    (await run(bare.h, bare.env)).out === "",
  );
  const bareNextDay = passHome("new-project-next-day", () => ({}), {
    claudeMd: false,
  });
  fs.writeFileSync(
    path.join(bareNextDay.h, ".claude", "update-check.json"),
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      latest: "1.2.0",
      passNoted: { [bareNextDay.folder]: "2000-01-01" },
    }),
  );
  check(
    "a folder with no CLAUDE.md and no .git noted on an earlier day: /new-project is offered again",
    /is not set up as a project/.test(
      ctxOf(await run(bareNextDay.h, bareNextDay.env)),
    ),
  );
  const sub = passHome("new-project-subfolder", () => ({}));
  const subDir = path.join(sub.env.CLAUDE_PROJECT_DIR, "src", "parts");
  fs.mkdirSync(subDir, { recursive: true });
  check(
    "a subfolder of a project (CLAUDE.md two folders up): no note",
    (await run(sub.h, { CLAUDE_PROJECT_DIR: subDir })).out === "",
  );
  const neverHere = passHome(
    "new-project-declined",
    (f) => ({ level: 2, declined: { [f]: 1 } }),
    { claudeMd: false },
  );
  check(
    "a folder declined (at an older level) with no CLAUDE.md and no .git: no /new-project note",
    (await run(neverHere.h, neverHere.env)).out === "",
  );
  const neverAny = passHome(
    "new-project-declined-all",
    () => ({ level: 2, declinedAll: 1 }),
    { claudeMd: false },
  );
  check(
    "every folder declined (at an older level): no /new-project note",
    (await run(neverAny.h, neverAny.env)).out === "",
  );
  const gitOnly = passHome("pass-git-only", () => ({}), { claudeMd: false });
  fs.mkdirSync(path.join(gitOnly.env.CLAUDE_PROJECT_DIR, ".git"));
  const gitCtx = ctxOf(await run(gitOnly.h, gitOnly.env));
  check(
    "a folder with only .git: the pass card (its never option for every folder), not /new-project",
    /set up before the current setup/.test(gitCtx) &&
      /Never, in any folder\./.test(gitCtx) &&
      !/new-project/.test(gitCtx),
  );
  const worktree = passHome("pass-worktree", () => ({}), { claudeMd: false });
  fs.writeFileSync(
    path.join(worktree.env.CLAUDE_PROJECT_DIR, ".git"),
    "gitdir: C:/elsewhere/.git/worktrees/work\n",
  );
  check(
    "a linked worktree (.git is a file): no note",
    (await run(worktree.h, worktree.env)).out === "",
  );
  const bareNone = passHome("new-project-no-stamp", null, { claudeMd: false });
  check(
    "a folder with no CLAUDE.md and no .git, and no project-pass.json: /new-project is offered all the same",
    /is not set up as a project/.test(
      ctxOf(await run(bareNone.h, bareNone.env)),
    ),
  );
  const atHome = passHome("new-project-home", () => ({}), { claudeMd: false });
  check(
    "the home folder itself: no /new-project offer",
    (await run(atHome.h, { CLAUDE_PROJECT_DIR: atHome.h })).out === "",
  );
  const none = passHome("pass-no-stamp", null);
  check(
    "no project-pass.json: silent",
    (await run(none.h, none.env)).out === "",
  );
  const broken = passHome("pass-broken", null);
  fs.writeFileSync(
    path.join(broken.h, ".claude", "project-pass.json"),
    "{ not json",
  );
  check(
    "a project-pass.json that is not valid JSON: the note says it couldn't be read",
    /project-pass\.json could not be read/.test(
      ctxOf(await run(broken.h, broken.env)),
    ),
  );
  check(
    "and the folder is noted, so the next prompt is silent",
    (await run(broken.h, broken.env)).out === "",
  );
}

// ---- T7: the whole chain with no stand-in: the hook starts the installed update.mjs --quiet, which downloads a
// `quiet` release from this server and runs its full installer; the next prompt says it. The release changes a hook
// and the plain extension job-tracker. Nimbalyst's folder is inside the test home (APPDATA, HOME), Nimbalyst counts
// as closed through a file that does not exist, NIMBALYST_FOLLOW=off keeps deliver.mjs still, and Claude Code is not
// checked, so nothing touches this computer's setup
{
  const REPO = fileURLToPath(new URL("..", import.meta.url));
  const repoMeta = JSON.parse(
    fs.readFileSync(path.join(REPO, "version.json"), "utf8"),
  );
  const thisVersion = repoMeta.version;
  const QV = "99.9.12";
  const SKIP = [".git", "node_modules", "promo", "dist", "img"];
  const copyRepo = (to) =>
    fs.cpSync(REPO, to, {
      recursive: true,
      filter: (src) => !SKIP.includes(path.basename(src)),
    });
  const pack = path.join(tmp, "t7-pack", `ai-coding-setup-${QV}`);
  copyRepo(pack);
  const meta = {
    version: QV,
    projectPass: repoMeta.projectPass,
    claudeCodeMin: repoMeta.claudeCodeMin,
  };
  fs.writeFileSync(path.join(pack, "version.json"), JSON.stringify(meta));
  const packLog = fs
    .readFileSync(path.join(pack, "CHANGELOG.md"), "utf8")
    .replace(
      /^## \[\d/m,
      (head) =>
        `## [${QV}] - 2026-11-16\n\n- The job tracker says more.\n\n${head}`,
    );
  fs.writeFileSync(path.join(pack, "CHANGELOG.md"), packLog);
  fs.appendFileSync(
    path.join(pack, "hooks", "sql-guard.mjs"),
    "\n// quiet release\n",
  );
  fs.appendFileSync(
    path.join(pack, "extensions", "job-tracker", "src", "index.js"),
    "\n// quiet release\n",
  );
  const winTar = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "tar.exe",
  );
  const tar =
    process.platform === "win32" && fs.existsSync(winTar) ? winTar : "tar";
  fs.mkdirSync(path.join(tmp, "t7-served"));
  const packed = spawnSync(
    tar,
    [
      "-czf",
      path.join("..", "t7-served", `v${QV}.tar.gz`),
      `ai-coding-setup-${QV}`,
    ],
    { cwd: path.join(tmp, "t7-pack"), encoding: "utf8" },
  );
  tarball = path.join(tmp, "t7-served", `v${QV}.tar.gz`);
  check("T7. the test archive was made", packed.status === 0);

  // this version installed from a copy, with job-tracker in the test Nimbalyst folder
  const h = path.join(tmp, "t7-home");
  const darwin = process.platform === "darwin";
  const nbData = darwin
    ? path.join(h, "Library", "Application Support", "@nimbalyst", "electron")
    : path.join(h, "AppData", "Roaming", "@nimbalyst", "electron");
  fs.mkdirSync(nbData, { recursive: true });
  const live = path.join(nbData, "extensions", "jobtracker");
  const safe = {
    HOME: h,
    ...(darwin ? {} : { APPDATA: path.join(h, "AppData", "Roaming") }),
    SETUP_EXTENSIONS: "job-tracker",
    SETUP_NIMBALYST_OPEN: "no",
    SETUP_NIMBALYST_OPEN_FILE: path.join(h, "nimbalyst-runs"),
    SETUP_CC_CHECK: "off",
    NIMBALYST_FOLLOW: "off",
    NIMBALYST_DELIVER_DATA: dataOf(h),
  };
  const base = path.join(tmp, "t7-base");
  copyRepo(base);
  const baseRun = spawnSync(
    process.execPath,
    [
      path.join(base, "install.mjs"),
      "--home",
      h,
      "--codex",
      "no",
      "--extensions",
      "yes",
    ],
    { encoding: "utf8", env: { ...process.env, ...safe } },
  );
  const liveIndex = () =>
    fs.existsSync(path.join(live, "dist", "index.js"))
      ? fs.readFileSync(path.join(live, "dist", "index.js"), "utf8")
      : "";
  check(
    "T7. this version installs with job-tracker in the test Nimbalyst folder",
    baseRun.status === 0 &&
      liveIndex() !== "" &&
      !liveIndex().includes("quiet release"),
  );

  changelog = packLog;
  released = {
    ...meta,
    releases: {
      [QV]: {
        kind: "quiet",
        important: false,
        headline: "The job tracker says more.",
      },
    },
  };
  const started = await run(h, safe);
  check(
    "T7. the hook says nothing yet and records a quiet run under way",
    started.out === "" && stored(h).autoRun?.mode === "quiet",
  );
  // the run builds a panel: allow it a few minutes
  for (
    const end = Date.now() + 5 * 60000;
    Date.now() < end && !stored(h).auto;
    await new Promise((r) => setTimeout(r, 500))
  );
  // The hook passes --home here (SETUP_UPDATE_HOME) and no --extensions, and install.mjs builds no panels into
  // another home unless told to: the run is --quiet (its own `panels` and `extFailed` are on record) and leaves the
  // panel as it was, so the line has no panel sentence. The panel half is T1 in test-update.mjs and T6 above.
  const result = stored(h).auto;
  const said = JSON.parse((await run(h, safe)).out || "{}").systemMessage;
  check(
    `T7. the next prompt says the quiet update (${JSON.stringify(result)})`,
    said === `Setup updated itself to ${QV}: The job tracker says more.` &&
      result.ok === true &&
      result.from === thisVersion &&
      result.panels === null &&
      Array.isArray(result.extFailed),
  );
  const state = JSON.parse(fs.readFileSync(at(h, "setup-state.json"), "utf8"));
  check(
    "T7. the release is installed from the download: the version, the hook, the lock freed, the panel left as it was",
    state.version === QV &&
      fs
        .readFileSync(at(h, path.join("hooks", "sql-guard.mjs")), "utf8")
        .includes("// quiet release") &&
      fs.existsSync(at(h, path.join("setup-source", `v${QV}`))) &&
      !fs.existsSync(at(h, "update-auto.lock")) &&
      liveIndex() !== "" &&
      !liveIndex().includes("quiet release"),
  );
  check("T7. said once", (await run(h, safe)).out === "");
}
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
