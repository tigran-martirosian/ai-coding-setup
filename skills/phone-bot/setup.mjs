// Sets up, checks, restarts and removes your own Telegram inbox bot.
// Run: node setup.mjs --token <token> | --status | --restart | --remove
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOT = path.join(HERE, "bot", "inbox-bot.mjs");
const SKILL_SRC = path.join(HERE, "phone-skill", "SKILL.md");
const MARKER = "<!-- phone-bot: installed by /phone-bot -->";
const HOME = os.homedir();
const CTRL = path.join(HOME, ".telegram-control");
const SECRETS = path.join(CTRL, "secrets.json");
const LOG = path.join(CTRL, "inbox-bot.log");
const INBOX = path.join(HOME, "phone-inbox");
const SKILL_DST = path.join(HOME, ".claude", "skills", "phone", "SKILL.md");
const PLATFORM = process.env.PHONE_BOT_PLATFORM || process.platform;
const DRY = process.env.PHONE_BOT_DRY === "1";
const APPDATA = process.env.APPDATA || path.join(HOME, "AppData", "Roaming");
const VBS = path.join(APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "phone-bot.vbs");
const PLIST = path.join(HOME, "Library", "LaunchAgents", "com.ai-coding-setup.phone-bot.plist");
const SOCK = path.join(CTRL, "bot.sock");
const PIPE = "\\\\.\\pipe\\phone-inbox-bot";

const USAGE = `Usage: node setup.mjs --token <token> | --status | --restart | --remove
  --token <token>  save the token from @BotFather, install and start the bot
  --status         show whether the bot is set up and running
  --restart        stop the bot, refresh the phone skill, start it again
  --remove         stop the bot, remove start at log-on, delete the saved token`;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const q = (a) => (/[\s"]/.test(a) ? `"${a}"` : a);

// Runs a command. In dry mode only prints it.
function run(cmd, args) {
  if (DRY) {
    console.log(`would run: ${[cmd, ...args].map(q).join(" ")}`);
    return;
  }
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error) fail(`${cmd} failed: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} failed: ${(r.stderr || r.stdout || `exit code ${r.status}`).trim()}`);
}

// Same, but a failure is not an error (used to stop things that may not exist).
function tryRun(cmd, args) {
  if (DRY) {
    console.log(`would run: ${[cmd, ...args].map(q).join(" ")}`);
    return;
  }
  spawnSync(cmd, args, { encoding: "utf8" });
}

function readSecrets() {
  if (!fs.existsSync(SECRETS)) return null;
  try {
    return JSON.parse(fs.readFileSync(SECRETS, "utf8"));
  } catch (e) {
    fail(`${SECRETS} is not valid JSON: ${e.message}`);
  }
}

function requireBotFile() {
  if (!DRY && !fs.existsSync(BOT)) fail(`The bot file is missing: ${BOT}`);
}

function installPhoneSkill() {
  if (!fs.existsSync(SKILL_SRC)) fail(`The phone skill file is missing: ${SKILL_SRC}`);
  const src = fs.readFileSync(SKILL_SRC, "utf8");
  if (fs.existsSync(SKILL_DST)) {
    const cur = fs.readFileSync(SKILL_DST, "utf8");
    if (cur !== src && !cur.includes(MARKER)) {
      console.log("kept your own phone skill");
      return;
    }
  }
  fs.mkdirSync(path.dirname(SKILL_DST), { recursive: true });
  fs.writeFileSync(SKILL_DST, src);
}

function stopBot() {
  if (PLATFORM === "win32") {
    const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${BOT.replace(/'/g, "''")}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
    run("powershell", ["-NoProfile", "-Command", ps]);
  } else if (PLATFORM === "darwin") {
    tryRun("launchctl", ["unload", "-w", PLIST]);
  } else {
    tryRun("pkill", ["-f", BOT]);
  }
}

function startBot() {
  requireBotFile();
  if (PLATFORM === "win32") {
    run("wscript", [VBS]);
  } else if (PLATFORM === "darwin") {
    run("launchctl", ["load", "-w", PLIST]);
  } else if (DRY) {
    console.log(`would run: ${q(process.execPath)} ${q(BOT)} (detached)`);
  } else {
    const child = spawn(process.execPath, [BOT], { detached: true, stdio: "ignore" });
    child.unref();
  }
}

function enableLogon() {
  if (PLATFORM === "win32") {
    fs.mkdirSync(path.dirname(VBS), { recursive: true });
    fs.writeFileSync(
      VBS,
      `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${BOT}""", 0, False\r\n`,
    );
    run("schtasks", ["/create", "/tn", "Phone bot", "/sc", "minute", "/mo", "5", "/f", "/tr", `wscript.exe "${VBS}"`]);
  } else if (PLATFORM === "darwin") {
    fs.mkdirSync(path.dirname(PLIST), { recursive: true });
    fs.writeFileSync(
      PLIST,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ai-coding-setup.phone-bot</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${BOT}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>${path.join(CTRL, "launchd-error.log")}</string>
</dict>
</plist>
`,
    );
  } else {
    console.log("This system has no start at log-on set up here: after a restart of the computer, run `node setup.mjs --restart` to start the bot again.");
  }
}

function disableLogon() {
  if (PLATFORM === "win32") {
    fs.rmSync(VBS, { force: true });
    tryRun("schtasks", ["/delete", "/tn", "Phone bot", "/f"]);
  } else if (PLATFORM === "darwin") {
    fs.rmSync(PLIST, { force: true });
  }
}

function logonSetUp() {
  if (PLATFORM === "win32") return fs.existsSync(VBS);
  if (PLATFORM === "darwin") return fs.existsSync(PLIST);
  return false;
}

function isRunning() {
  return new Promise((resolve) => {
    if (DRY) return resolve(false); // dry mode never looks at a real running bot
    const target = PLATFORM === "win32" ? PIPE : SOCK;
    if (PLATFORM !== "win32" && !fs.existsSync(SOCK)) return resolve(false);
    const s = net.connect(target);
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(2000, () => done(false));
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
  });
}

async function getMe(token) {
  if (DRY) return { ok: true, result: { username: "dry_bot" } };
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  } catch (e) {
    fail(`Could not reach Telegram: ${e.message}`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    fail(`Telegram answered with something that is not JSON (HTTP ${res.status}).`);
  }
  return body;
}

async function cmdToken(token) {
  if (!token || !/^\d+:[A-Za-z0-9_-]{35,}$/.test(token)) {
    fail("That does not look like a bot token. It looks like 123456789:ABC... (digits, a colon, then 35 or more letters, digits, _ or -).");
  }
  const me = await getMe(token);
  if (!me.ok) fail(`Telegram refused the token: ${me.description || "no reason given"}`);
  fs.mkdirSync(CTRL, { recursive: true });
  const old = readSecrets();
  const secrets = { token };
  if (old && old.ownerId !== undefined) secrets.ownerId = old.ownerId;
  fs.writeFileSync(SECRETS, JSON.stringify(secrets, null, 2) + "\n", { mode: 0o600 });
  fs.mkdirSync(INBOX, { recursive: true });
  installPhoneSkill();
  stopBot();
  enableLogon();
  startBot();
  console.log(`Bot ready: @${me.result.username}`);
  console.log("Send it any message now: the first person who writes becomes the owner.");
  console.log(`Inbox folder: ${INBOX}`);
  console.log(`Log: ${LOG}`);
}

async function cmdStatus() {
  const s = readSecrets();
  const running = await isRunning();
  console.log(`token: ${s && s.token ? "saved" : "not saved"}`);
  console.log(`owner: ${s && s.ownerId !== undefined ? "locked" : "nobody has written yet"}`);
  console.log(`running: ${running ? "yes" : "no"}`);
  console.log(`start at log-on: ${logonSetUp() ? "set up" : "not set up"}`);
  if (fs.existsSync(LOG)) {
    const lines = fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter(Boolean).slice(-5);
    console.log("last log lines:");
    for (const l of lines) console.log(`  ${l}`);
  } else {
    console.log("last log lines: no log yet");
  }
  process.exit(running ? 0 : 1);
}

function cmdRestart() {
  const s = readSecrets();
  if (!s || !s.token) fail("No token is saved. Run: node setup.mjs --token <token>");
  // A bot that was started some other way is not this script's to restart.
  if ((PLATFORM === "win32" || PLATFORM === "darwin") && !logonSetUp()) {
    fail("The bot was not set up with /phone-bot on this computer, so there is nothing to restart. Run: node setup.mjs --token <token>");
  }
  stopBot();
  installPhoneSkill();
  startBot();
  console.log("Bot restarted.");
}

function cmdRemove() {
  stopBot();
  disableLogon();
  fs.rmSync(SECRETS, { force: true });
  console.log("Bot stopped, start at log-on removed, saved token deleted.");
  console.log(`${INBOX} stays as it is.`);
  console.log("Send /revoke to @BotFather in Telegram to make the old token useless.");
}

const args = process.argv.slice(2);
if (args[0] === "--token") await cmdToken(args[1]);
else if (args[0] === "--status") await cmdStatus();
else if (args[0] === "--restart") cmdRestart();
else if (args[0] === "--remove") cmdRemove();
else console.log(USAGE);
