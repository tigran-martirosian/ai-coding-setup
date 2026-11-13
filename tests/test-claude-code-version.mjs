// Tests for scripts/claude-code-version.mjs with every command stubbed: no network, no real update.
// Run: node tests/test-claude-code-version.mjs
import { checkClaudeCode, compareVersions, parseVersion, nimbalystCandidates, updateCommand, childEnv } from "../scripts/claude-code-version.mjs";

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

process.exit(fails ? 1 : 0);
