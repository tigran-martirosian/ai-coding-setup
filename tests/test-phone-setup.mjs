// Tests for skills/phone-bot/setup.mjs (dry mode: nothing is started, stopped or sent).
// Run: node tests/test-phone-setup.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SETUP = fileURLToPath(new URL("../skills/phone-bot/setup.mjs", import.meta.url));
const TOKEN = "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789";

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};

const home = fs.mkdtempSync(path.join(os.tmpdir(), "phone-setup-"));
const secretsPath = path.join(home, ".telegram-control", "secrets.json");
const skillPath = path.join(home, ".claude", "skills", "phone", "SKILL.md");

function run(args, platform) {
  const env = {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    PHONE_BOT_DRY: "1",
  };
  if (platform) env.PHONE_BOT_PLATFORM = platform;
  else delete env.PHONE_BOT_PLATFORM;
  const r = spawnSync(process.execPath, [SETUP, ...args], { encoding: "utf8", env });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

try {
  let r = run([]);
  check("no argument prints the usage", r.code === 0 && r.out.includes("Usage: node setup.mjs"), r.out);

  r = run(["--token", "not-a-token"]);
  check("malformed token exits 1", r.code === 1, r.out);
  check("malformed token writes nothing", !fs.existsSync(path.join(home, ".telegram-control")) && !fs.existsSync(path.join(home, "phone-inbox")));

  r = run(["--status"]);
  check("status with no token exits 1 and says so", r.code === 1 && r.out.includes("token: not saved"), r.out);

  r = run(["--restart"]);
  check("restart with no token exits 1", r.code === 1 && r.out.includes("No token is saved"), r.out);

  r = run(["--token", TOKEN]);
  check("--token exits 0", r.code === 0, r.out);
  check("secrets.json has the token", fs.existsSync(secretsPath) && JSON.parse(fs.readFileSync(secretsPath, "utf8")).token === TOKEN);
  check("phone-inbox created", fs.existsSync(path.join(home, "phone-inbox")));
  check("phone skill copied with the marker", fs.existsSync(skillPath) && fs.readFileSync(skillPath, "utf8").includes("<!-- phone-bot: installed by /phone-bot -->"));
  check("prints would run: lines", r.out.includes("would run:"), r.out);
  check("never prints the token", !r.out.includes(TOKEN));
  check("prints the bot username", r.out.includes("@dry_bot"), r.out);

  fs.writeFileSync(secretsPath, JSON.stringify({ token: TOKEN, ownerId: 4242 }));
  r = run(["--token", TOKEN]);
  check("existing ownerId survives a second --token", JSON.parse(fs.readFileSync(secretsPath, "utf8")).ownerId === 4242, r.out);

  fs.writeFileSync(skillPath, "my own phone skill\n");
  r = run(["--token", TOKEN]);
  check("own phone skill without the marker is kept", fs.readFileSync(skillPath, "utf8") === "my own phone skill\n" && r.out.includes("kept your own phone skill"), r.out);

  r = run(["--remove"]);
  check("--remove deletes secrets.json", r.code === 0 && !fs.existsSync(secretsPath), r.out);
  check("--remove keeps the inbox", fs.existsSync(path.join(home, "phone-inbox")));

  r = run(["--token", TOKEN], "darwin");
  const plist = path.join(home, "Library", "LaunchAgents", "com.ai-coding-setup.phone-bot.plist");
  check("darwin writes a plist", fs.existsSync(plist), r.out);
  check("darwin only prints launchctl", r.out.includes("would run: launchctl load -w"), r.out);

  r = run(["--token", TOKEN], "linux");
  check("linux says to start again after a restart", r.out.includes("after a restart of the computer"), r.out);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
