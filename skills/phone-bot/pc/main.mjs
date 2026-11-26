// The PC program: one copy at a time (the named pipe is the lock and the control channel for setup.mjs),
// loads every action module in actions/, dials out to the relay and answers the paired phone's sealed frames.
// Run: node main.mjs (started at log-on by keep.mjs, which starts it again when it ends; it ends with
// STOP_CODE when another copy already runs, or when setup.mjs asks it to stop, so that keep.mjs stops too)
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAlerts } from "./actions/alerts.mjs";
import { bindDevices } from "./actions/devices.mjs";
import { bindFolder, folderFrame, relayReady } from "./actions/folder.mjs";
import { createIntake, inboxDir } from "./actions/saved.mjs";
import { createChannel } from "./core/channel.mjs";
import { loadKeys, saveKeys } from "./core/keys.mjs";
import { openLink } from "./core/link.mjs";
import { log } from "./core/log.mjs";
import { pipeName } from "./core/mode.mjs";
import { createJoin, createPairing } from "./core/pairing.mjs";
import { createRegistry } from "./core/registry.mjs";
import { STOP_CODE } from "./keep.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOIN_TICK_MS = 10 * 1000;

// keep.mjs starts the program hidden, so an error that ends it (a missing key file, an action that does not load)
// goes to pc.log, or nobody sees it.
process.on("uncaughtException", (e) => {
  log("error", `the program ended: ${e.message}`);
  process.exit(1);
});

// The setup version this copy belongs to: version.json three folders up (the repo, or ~/.claude when installed).
function setupVersion() {
  const file = path.join(HERE, "..", "..", "..", "version.json");
  let v;
  try {
    v = JSON.parse(fs.readFileSync(file, "utf8")).version;
  } catch (e) {
    throw new Error(`Cannot read the setup version from ${file}: ${e.message}`);
  }
  if (typeof v !== "string") throw new Error(`${file} has no "version"`);
  return v;
}

// Resolves with the server, or null when another copy already holds the pipe.
function takeLock(name) {
  return new Promise((resolve, reject) => {
    const probe = net.connect(name);
    probe.on("connect", () => {
      probe.destroy();
      resolve(null);
    });
    probe.on("error", () => {
      if (process.platform !== "win32") fs.rmSync(name, { force: true });
      const server = net.createServer();
      server.on("error", (e) =>
        e.code === "EADDRINUSE" ? resolve(null) : reject(e),
      );
      server.listen(name, () => resolve(server));
    });
  });
}

const server = await takeLock(pipeName());
if (!server) process.exit(STOP_CODE);

const keys = loadKeys();
const version = setupVersion();
const registry = createRegistry();
await registry.load(path.join(HERE, "actions"));

// The PC no longer checks the page; pages before 26.3.2 grey out unless the hello says "ok".
const page = "ok";
const link = openLink({
  keys,
  version,
  saveKeys,
  onReady,
  onFrame,
});
// Bot forwards held on the relay: opened and saved by actions/saved.mjs.
const intake = createIntake({ keys, send: link.send, dir: inboxDir() });
const pairing = createPairing({
  keys,
  saveKeys,
  send: link.send,
  onAdded: (entry, tgId) => join.added(entry, tgId),
});
// Short alerts in the bot chat when a session needs the user or finishes.
const alerts = createAlerts({ send: link.send });
const channel = createChannel({
  keys,
  send: link.send,
  registry,
  pcVersion: version,
  context: () => ({ page, setupVersion: version }),
  onHello: (dev) => join.onHello(dev),
});
// A further device joins by an OK on a paired device; its answers come as the actions device.answer and device.seen.
const join = createJoin({
  keys,
  saveKeys,
  send: link.send,
  channel,
  now: Date.now,
});
join.register(registry);
// The devices list and Remove (actions/devices.mjs) read the same keys and remove through the join's rule.
bindDevices({ keys, join });
// The Files tab's Send to chat and download link (actions/folder.mjs) post to the relay and use its socket.
bindFolder({ keys, send: link.send });

function onReady(f) {
  relayReady(f);
  if (typeof f.botId === "number" && keys.botId !== f.botId) {
    if (keys.botId === null) {
      keys.botId = f.botId;
      saveKeys(keys);
    } else log("bot-id", "the relay named another bot: kept the first one");
  }
}

function onFrame(f) {
  const done = (p) => p?.catch?.((e) => log("error", `${f.t}: ${e.message}`));
  if (f.t === "pair") done(pairing.onPair(f));
  else if (f.t === "join-ask") done(join.onAsk(f));
  else if (f.t === "join-reveal") done(join.onReveal(f));
  else if (f.t === "join-cancel") done(join.onCancel(f));
  else if (f.t === "app") done(channel.onApp(f));
  else if (f.t === "held" || f.t === "file") done(intake.onFrame(f));
  else if (
    ["dl-made", "dl-pull", "dl-fail"].includes(f.t) ||
    (f.t === "error" && f.e === "files-rate")
  )
    done(folderFrame(f));
  else if (["offline", "limit", "error"].includes(f.t))
    log(f.t, String(f.e || f.resetAt || "").slice(0, 40));
  else log("drop", `relay frame ${String(f.t).slice(0, 12)}`);
}

// Control channel: one JSON line in, one JSON line out. {"cmd":"pair"}, {"cmd":"status"} or {"cmd":"stop"}.
server.on("connection", (sock) => {
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("error", () => {});
  sock.on("data", async (chunk) => {
    buf += chunk;
    const nl = buf.indexOf("\n");
    if (nl < 0) return;
    let answer;
    try {
      const { cmd } = JSON.parse(buf.slice(0, nl));
      if (cmd === "pair") {
        link.start();
        answer = await pairing.start();
      } else if (cmd === "status")
        answer = {
          devices: keys.devices.length,
          owner: keys.ownerTgId !== null,
          joined: keys.joined,
          page,
          actions: registry.names().length,
          pid: process.pid,
        };
      else if (cmd === "stop") {
        // setup.mjs join and remove: whichever copy holds the pipe (installed or a work copy) ends, and its keep.mjs
        // with it.
        log("stop", "asked by setup.mjs");
        link.stop();
        sock.end(
          `${JSON.stringify({ stopping: true })}
`,
          () => process.exit(STOP_CODE),
        );
        return;
      } else answer = { error: `unknown command ${String(cmd).slice(0, 20)}` };
    } catch (e) {
      answer = { error: e.message };
    }
    sock.end(`${JSON.stringify(answer)}\n`);
  });
});

setInterval(
  () => join.tick().catch((e) => log("error", `join tick: ${e.message}`)),
  JOIN_TICK_MS,
);
log("start", `${registry.names().length} actions`);
link.start();
alerts.start();
