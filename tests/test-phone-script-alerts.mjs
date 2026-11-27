// Tests for the PC program's script door (skills/phone-bot/pc/core/script-alerts.mjs and its use in
// actions/alerts.mjs): a script on this PC, such as a nightly run whose mail is refused, asks for a "needs you" alert
// in the bot chat by writing one small file; the PC program sends it through the relay, in the text the relay
// accepts, and removes the file once the relay socket took it.
// Run: node tests/test-phone-script-alerts.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
// The relay socket stand-in: keeps each frame and says it took it.
let frames = [];
const collect = (f) => {
  frames.push(f);
  return true;
};
const show = (v) => JSON.stringify(v)?.slice(0, 400);

// A temp home: the app folder (~/.phone-app) is read through os.homedir().
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-script-alerts-"));
const home = path.join(tmp, "home");
fs.mkdirSync(home, { recursive: true });
Object.assign(process.env, { HOME: home, USERPROFILE: home });

const PC = new URL("../skills/phone-bot/pc/", import.meta.url);
const door = await import(new URL("core/script-alerts.mjs", PC).href);
const alerts = await import(new URL("actions/alerts.mjs", PC).href);
const { readState, updateState } = await import(
  new URL("core/state.mjs", PC).href
);
// The relay's own pattern for alert text (phone/relay/src/hub.mjs ALERT_TEXT): the frame must pass it.
const hubText = fs.readFileSync(
  new URL("../phone/relay/src/hub.mjs", import.meta.url),
  "utf8",
);
const ALERT_TEXT = new RegExp(
  /const ALERT_TEXT =\s*\/(.*)\/u;/.exec(hubText)[1],
  "u",
);

const dir = door.scriptAlertDir();
check(
  "the door is the alert-in folder inside the PC program's app folder",
  dir === path.join(home, ".phone-app", "alert-in"),
  dir,
);

// 1. A script asks; the PC program sends one alert frame the relay accepts, and the file goes.
const asked = door.askAlert({ project: "my-scripts", title: "nightly run" });
check(
  "askAlert writes one .json file in the door",
  fs.existsSync(asked) &&
    path.dirname(asked) === dir &&
    asked.endsWith(".json"),
  asked,
);
let sent = alerts.sendScriptAlerts(collect);
check(
  "one script alert is sent as an alert frame: needs-you text, buzzing (the default mode), with an Open handle",
  sent === 1 &&
    frames.length === 1 &&
    frames[0].t === "alert" &&
    frames[0].text === "my-scripts · nightly run: needs you" &&
    frames[0].silent === false &&
    /^[A-Za-z0-9_-]{1,16}$/.test(frames[0].open),
  show(frames),
);
check(
  "the frame's text passes the relay's own alert pattern",
  ALERT_TEXT.test(frames[0]?.text ?? ""),
  frames[0]?.text,
);
check(
  "the file is removed once the relay socket took the alert",
  !fs.existsSync(asked),
  fs.readdirSync(dir).join(","),
);
const h = readState().handles?.[frames[0]?.open];
check(
  "its Open handle is kept as a script alert (no session, so the watcher never removes it)",
  h?.script === true && !h.shown && h.session === null,
  show(h),
);

// 2. The Open button of a script alert says so instead of opening a session.
const reg = {
  actions: {},
  add(a) {
    this.actions[a.name] = a;
  },
};
alerts.register(reg);
let why = null;
try {
  reg.actions["alerts.resolve"].run({ handle: frames[0].open });
} catch (e) {
  why = e.err;
}
check(
  "alerts.resolve on a script alert's handle answers from-a-script",
  why === "from-a-script",
  why,
);

// 3. The relay away: the file stays and goes out at the next look.
const second = door.askAlert({ project: "my-scripts", title: "nightly run" });
frames = [];
sent = alerts.sendScriptAlerts(() => false);
check(
  "with the relay away nothing counts as sent and the file stays for the next look",
  sent === 0 && fs.existsSync(second),
  `${sent}`,
);
sent = alerts.sendScriptAlerts(collect);
check(
  "the next look sends it",
  sent === 1 && frames.length === 1 && !fs.existsSync(second),
  show(frames),
);

// 4. Characters the relay refuses become "-", and long words are cut, as for session alerts.
door.askAlert({ project: "Café/ops", title: "night: run.ok <b>" });
frames = [];
alerts.sendScriptAlerts(collect);
check(
  "odd characters are made safe and still pass the relay's pattern",
  frames.length === 1 && ALERT_TEXT.test(frames[0].text),
  show(frames),
);

// 5. A file that is not a valid ask is moved aside with a reason, never sent and never retried.
fs.writeFileSync(path.join(dir, "broken.json"), "{not json");
fs.writeFileSync(
  path.join(dir, "empty.json"),
  JSON.stringify({ project: "", title: "x" }),
);
frames = [];
sent = alerts.sendScriptAlerts(collect);
const left = fs.readdirSync(dir).sort();
check(
  "a broken or empty ask is moved to .bad, nothing is sent",
  sent === 0 &&
    frames.length === 0 &&
    left.join(",") === "broken.json.bad,empty.json.bad",
  `${sent} ${left.join(",")}`,
);

// 6. The user's choice for needs-you alerts holds: off sends nothing and drops the ask; silent sends silently.
updateState((s) => {
  s.alerts = { "session-needs-you": "off" };
});
const off = door.askAlert({ project: "my-scripts", title: "nightly run" });
frames = [];
alerts.sendScriptAlerts(collect);
check(
  "needs-you alerts off: nothing is sent and the ask is dropped",
  frames.length === 0 && !fs.existsSync(off),
  show(frames),
);
updateState((s) => {
  s.alerts = { "session-needs-you": "silent" };
});
door.askAlert({ project: "my-scripts", title: "nightly run" });
frames = [];
alerts.sendScriptAlerts(collect);
check(
  "needs-you alerts silent: sent silently",
  frames.length === 1 && frames[0].silent === true,
  show(frames),
);

// 7. A partly written file is never read: askAlert writes a temp name and renames it into place.
fs.writeFileSync(path.join(dir, "half.json.tmp"), "{");
frames = [];
sent = alerts.sendScriptAlerts(collect);
check(
  "a .tmp file is left alone",
  sent === 0 && fs.existsSync(path.join(dir, "half.json.tmp")),
  `${sent}`,
);

// 8. No door folder at all: nothing to send, no error.
fs.rmSync(dir, { recursive: true, force: true });
check(
  "no door folder: nothing sent, no error",
  alerts.sendScriptAlerts(() => true) === 0,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
