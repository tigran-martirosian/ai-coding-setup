// Tests for hooks/update-check.mjs against a small local server that stands in for GitHub.
// Run: node tests/test-update-check.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { key } from "../scripts/blocks.mjs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const server = http.createServer((req, res) => {
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

// With the changelog: how far behind, and what came in since
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

// ---- spec section 7: labels from version.json `releases`, how often, and the self-install of `files` releases
const ago = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const stored = (h) => kept(h) || {};
const restore = (h, extra) =>
  fs.writeFileSync(
    path.join(h, ".claude", "update-check.json"),
    JSON.stringify({ ...stored(h), ...extra }),
  );
const log = (lines) =>
  [
    "# Changelog",
    "",
    ...lines.map(
      ([v, text]) => `- ${v} (Nov ${v.split(".")[2]}, 2026): ${text}`,
    ),
    "",
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
// while, its result as update.mjs --files-only does (STUB_RESULT: ok or the error)
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
setTimeout(() => {
  const file = path.join(claude, "update-check.json");
  const kept = JSON.parse(fs.readFileSync(file, "utf8"));
  const ok = process.env.STUB_RESULT === "ok";
  kept.auto = { version: kept.autoRun.version, from: kept.autoRun.from, headline: "A faster link check", at: new Date().toISOString(), ok, ...(ok ? {} : { error: process.env.STUB_RESULT }) };
  delete kept.autoRun;
  fs.writeFileSync(file, JSON.stringify(kept));
  if (ok) fs.writeFileSync(path.join(claude, "setup-state.json"), JSON.stringify({ version: kept.auto.version }));
  fs.writeFileSync(path.join(claude, "ended"), "");
}, 1500);
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
const autoStart = Date.now();
const started = await run(autoOk, { STUB_RESULT: "ok" });
const startMs = Date.now() - autoStart;
check(
  `9. all missed releases are files: the prompt is not held up (${startMs} ms) and says nothing yet`,
  started.out === "" && !fs.existsSync(at(autoOk, "ended")) && startMs < 1500,
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
let hung = 0;
const hang = http.createServer((req) => {
  if (req.url === "/version.json") hung++;
}); // the changelog is asked beside it
await new Promise((r) => hang.listen(0, "127.0.0.1", r));
const HANG = `http://127.0.0.1:${hang.address().port}`;
const stuck = home("stuck", "1.0.0");
let t0 = Date.now();
const slow = await run(stuck, { SETUP_UPDATE_BASE: HANG });
const firstMs = Date.now() - t0;
check(
  `no answer: the first prompt waits under a second (${firstMs} ms), silent, exit 0`,
  firstMs < 1000 && slow.out === "" && slow.code === 0,
);
check(
  "no answer: the reason is kept",
  /no answer in time/.test(kept(stuck)?.error || ""),
);
const hungBefore = hung;
t0 = Date.now();
const again = await run(stuck, { SETUP_UPDATE_BASE: HANG });
const againMs = Date.now() - t0;
check(
  `the next prompts do not ask again for an hour (${againMs} ms, no request)`,
  again.out === "" && hung === hungBefore && againMs < 500,
);
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
const slowLine = http.createServer((req, res) =>
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
check(
  "26.1 installed, 1.0.114 released: not newer, silent",
  ((released = { version: "1.0.114" }),
  (await run(home("v26-ahead", "26.1"))).out === ""),
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
      /one question card .*Options: Yes \/ Not now \/ Never, in any folder\./.test(ctxOf(offer)) &&
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
      /one question card .*\/new-project.*Options: Yes \/ Not now \/ Never here \/ Never in any folder\./.test(setUp) &&
      setUp.includes("new-project/SKILL.md") &&
      setUp.includes(`On "never here": run node ~/.claude/skills/update-project/pass.mjs --skip "${bare.folder}"`) &&
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
    /is not set up as a project/.test(ctxOf(await run(bareNone.h, bareNone.env))),
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
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
