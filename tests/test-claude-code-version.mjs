// Tests for scripts/claude-code-version.mjs with every command stubbed: no network, no real update.
// Run: node tests/test-claude-code-version.mjs
import { checkClaudeCode, pointNimbalyst, compareVersions, parseVersion, nimbalystCandidates, updateCommand, childEnv } from "../scripts/claude-code-version.mjs";

let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

ok("parses the CLI output", parseVersion("2.1.312 (Claude Code)\n"), "2.1.312");
ok("no version in the output", parseVersion("command not found"), null);
ok("2.1.9 is behind 2.1.10", compareVersions("2.1.9", "2.1.10"), -1);
ok("equal versions", compareVersions("2.1.296", "2.1.296"), 0);
ok("newer major", compareVersions("3.0.0", "2.9.9"), 1);
ok("npm install gets the npm command", updateCommand("D:/tools/npm/claude.cmd")[0], "npm");
ok("native install gets claude update", updateCommand("D:/tools/bin/claude.exe"), ["claude", ["update"]]);
ok("Windows candidate", nimbalystCandidates("win32", { LOCALAPPDATA: "C:/L" }, "x64").length, 1);

const NIM = "/Applications/Nimbalyst.app/Contents/resources/claude-runtime/darwin-arm64/claude";
// A stub world: versions per command, a log of every command run
function world({ cli, latest, nim, afterUpdate }) {
  const calls = [];
  let updated = false;
  const run = (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd === "npm" && args[0] === "view") return latest ? { status: 0, stdout: latest + "\n", stderr: "" } : { status: 1, stdout: "", stderr: "ENOTFOUND" };
    if (cmd === "which") return { status: 0, stdout: "/usr/local/bin/claude\n", stderr: "" };
    if (cmd === "claude" && args[0] === "update") { updated = true; return { status: 0, stdout: "", stderr: "" }; }
    if (cmd === "claude") return cli ? { status: 0, stdout: `${updated && afterUpdate ? afterUpdate : cli} (Claude Code)\n`, stderr: "" } : { status: 1, stdout: "", stderr: "", error: new Error("ENOENT") };
    if (cmd.replaceAll(String.fromCharCode(92), "/") === NIM) return { status: 0, stdout: `${nim} (Claude Code)\n`, stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };
  const out = [];
  const go = (extra = {}) => {
    const r = checkClaudeCode({ min: "2.1.296", run, exists: (p) => p.replaceAll(String.fromCharCode(92), "/") === NIM && !!nim, platform: "darwin", arch: "arm64", env: { HOME: "/h" }, log: (s) => out.push(s), ...extra });
    return { ...r, out: out.join("\n"), calls };
  };
  return go;
}

let r = world({ cli: "2.1.312", latest: "2.1.312" })();
ok("current CLI: no update run", r.calls.some((c) => c === "claude update"), false);
ok("current CLI: no stop", r.stop, null);

r = world({ cli: "2.1.300", latest: "2.1.312", afterUpdate: "2.1.312" })();
ok("behind npm: runs claude update", r.calls.includes("claude update"));
ok("behind npm: prints the new version", r.out.includes("Claude Code is now 2.1.312."));

r = world({ cli: "2.1.300", latest: "2.1.312" })({ dry: true });
ok("dry run: no update", r.calls.includes("claude update"), false);

r = world({ cli: "2.1.200", latest: "2.1.312" })();
ok("below the minimum after the update: stops", /older than 2\.1\.296/.test(r.stop || ""));

r = world({ cli: "2.1.200", latest: null, afterUpdate: "2.1.310" })();
ok("no network: said plainly", r.out.includes("could not ask npm"));
ok("no network, below the minimum: still tries to update, then passes", r.calls.includes("claude update") && r.stop === null);

r = world({ cli: "2.1.300", latest: null })();
ok("no network, above the minimum: goes on", r.stop === null && r.out.includes("could not ask npm"));

r = world({ cli: null, latest: "2.1.312" })();
ok("no claude on the PATH: said, not a stop", r.stop === null && r.out.includes("not found on the PATH"));

const msg = "Nimbalyst runs its own Claude Code (2.1.290). Install Nimbalyst updates as soon as they appear: its sessions get Claude Code fixes only through them.";
r = world({ cli: "2.1.312", latest: "2.1.312", nim: "2.1.290" })();
ok("Nimbalyst below the minimum: message", r.out.includes(msg));
r = world({ cli: "2.1.312", latest: "2.1.320", afterUpdate: "2.1.320", nim: "2.1.312" })();
ok("Nimbalyst behind npm: message", r.out.includes("Nimbalyst runs its own Claude Code (2.1.312)."));
r = world({ cli: "2.1.312", latest: "2.1.312", nim: "2.1.312" })();
ok("Nimbalyst current: version, no message", r.out.includes("Nimbalyst's Claude Code: 2.1.312.") && !r.out.includes("Install Nimbalyst updates"));

r = world({ cli: "2.1.200", latest: "2.1.312" })({ env: { HOME: "/h", SETUP_CC_CHECK: "off" } });
ok("SETUP_CC_CHECK=off: runs nothing, says so in one line", r.calls.length === 0 && r.stop === null && r.out === "Claude Code: version check skipped (SETUP_CC_CHECK=off).");
r = world({ cli: "2.1.200", latest: "2.1.312" })({ env: { HOME: "/h", SETUP_CC_CHECK: "done" } });
ok("SETUP_CC_CHECK=done: runs nothing, says nothing", r.calls.length === 0 && r.stop === null && r.out === "");

r = world({ cli: "2.1.200", latest: "2.1.312" })();
ok("stop text tells to close Claude and update in a plain terminal", (r.stop || "").includes("could not update itself while it is running. Close Claude, run `claude update`"));

// an update command that fails: the plain message
{
  const run = (cmd, a) => {
    if (cmd === "npm") return { status: 0, stdout: "2.1.312\n", stderr: "" };
    if (cmd === "which") return { status: 0, stdout: "/usr/local/bin/claude\n", stderr: "" };
    if (a[0] === "update") return { status: 1, stdout: "", stderr: "EBUSY: resource busy or locked" };
    return { status: 0, stdout: "2.1.300 (Claude Code)\n", stderr: "" };
  };
  const out = [];
  checkClaudeCode({ min: "2.1.296", run, exists: () => false, platform: "darwin", arch: "arm64", env: { HOME: "/h" }, log: (s) => out.push(s) });
  ok("failed update command: plain message with the reason", out.some((l) => l.includes("could not update itself while it is running") && l.includes("EBUSY")));
}

{
  const e = childEnv({ DISABLE_UPDATES: "1", DISABLE_AUTOUPDATER: "1", PATH: "/bin" });
  ok("update runs without Nimbalyst's update blocks, other settings kept", !("DISABLE_UPDATES" in e) && !("DISABLE_AUTOUPDATER" in e) && e.PATH === "/bin");
}

// ---- pointNimbalyst: Nimbalyst's chats on the person's own Claude Code
{
  const AI = "C:/A/@nimbalyst/electron/ai-settings.json";
  const BUN = "C:/L/Programs/Nimbalyst/resources/claude-runtime/win32-x64/claude.exe";
  const OWN = "C:/U/.local/bin/claude.exe";
  const point = ({ field = "", own = "2.1.318", bundled = "2.1.314", where = `C:/U/npm/claude.cmd\n${OWN}\n`, previous = null, env = {}, dry = false, file = true, text = null }) => {
    let saved = text ?? JSON.stringify({ customClaudeCodePath: field, other: 1 });
    const out = [];
    const run = (cmd) => {
      const c = cmd.replaceAll(String.fromCharCode(92), "/");
      if (c === "where") return where ? { status: 0, stdout: where } : { status: 1, stdout: "" };
      if (c === BUN) return { status: 0, stdout: `${bundled} (Claude Code)\n` };
      if (c === OWN) return own ? { status: 0, stdout: `${own} (Claude Code)\n` } : { status: 1, stdout: "" };
      return { status: 1, stdout: "" };
    };
    const exists = (p) => { const c = p.replaceAll(String.fromCharCode(92), "/"); return c === BUN || (file && c === AI); };
    const r = pointNimbalyst({ file: AI, min: "2.1.296", previous, dry, run, exists, platform: "win32", arch: "x64", env: { LOCALAPPDATA: "C:/L", Path: "C:\\U\\npm;C:\\U\\.local\\bin\\", ...env },
      log: (s) => out.push(s), read: () => saved, write: (f, t) => { saved = t; } });
    let ai = null; try { ai = JSON.parse(saved); } catch {}
    return { ...r, path: ai?.customClaudeCodePath, other: ai?.other, out: out.join("\n") };
  };
  let p = point({});
  ok("own newer than bundled: Nimbalyst points at it, other settings kept", [p.path, p.set, p.other], [OWN, OWN, 1]);
  ok("says it in a line with the undo", /now yours, 2\.1\.318, instead of its own 2\.1\.314.*SETUP_NIMBALYST_CLAUDE=off/.test(p.out));
  p = point({ field: OWN, previous: OWN });
  ok("already pointed: left, still on record", [p.path, p.set, /yours, 2\.1\.318/.test(p.out)], [OWN, OWN, true]);
  p = point({ field: "D:/my/claude.exe" });
  ok("a path the person set is never touched", [p.path, p.set, /you set D:\/my\/claude\.exe yourself/.test(p.out)], ["D:/my/claude.exe", null, true]);
  p = point({ own: "2.1.310" });
  ok("own older than bundled: not pointed", [p.path, p.set], ["", null]);
  p = point({ own: "2.1.310", field: OWN, previous: OWN });
  ok("own fell behind a newer Nimbalyst: back to bundled", [p.path, p.set, /back to its own \(2\.1\.314\)/.test(p.out)], ["", null, true]);
  p = point({ own: "2.2.0" });
  ok("a newer line than the bundled one waits for Nimbalyst", [p.path, p.set, /newer line/.test(p.out)], ["", null, true]);
  p = point({ own: "2.2.0", field: OWN, previous: OWN });
  ok("a newer line after being pointed: back to bundled", [p.path, p.set], ["", null]);
  p = point({ where: "C:/U/npm/claude.cmd\n" });
  ok("only an npm shim: not pointed, says why", [p.path, p.set, /no native Claude Code/.test(p.out)], ["", null, true]);
  p = point({ where: `C:/Projects/x/claude.exe\n${OWN}\n` });
  ok("a claude.exe in the current folder, not on the PATH, is skipped", [p.path, p.set], [OWN, OWN]);
  p = point({ where: "C:/Projects/x/claude.exe\n" });
  ok("only a current-folder claude.exe: not pointed", [p.path, p.set], ["", null]);
  ok("commands run with the current folder left out of the search", childEnv({}).NoDefaultCurrentDirectoryInExePath, "1");
  p = point({ own: null });
  ok("own gives no version: not pointed", [p.path, p.set], ["", null]);
  p = point({ dry: true });
  ok("dry run: writes nothing", [p.path, p.set, /a real run sets it/.test(p.out)], ["", null, true]);
  p = point({ env: { SETUP_NIMBALYST_CLAUDE: "off" } });
  ok("SETUP_NIMBALYST_CLAUDE=off: left as it is", [p.path, /SETUP_NIMBALYST_CLAUDE=off/.test(p.out)], ["", true]);
  p = point({ file: false });
  ok("no Nimbalyst settings file: nothing, no line", [p.set, p.out], [null, ""]);
  p = point({ text: "{oops" });
  ok("broken settings file: left, said", [p.set, /not valid JSON/.test(p.out)], [null, true]);
}

process.exit(fails ? 1 : 0);
