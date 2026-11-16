// The paired devices (PC program design, actions 21 and 22; pipe design, section 15 "What the PC keeps per device").
// devices.list reads the key file's entries, oldest first: `client` is the kind the page sent at pairing (null for an
// entry written before device join: the page says "kind not recorded"), `lastSeen` the last hello (null before the
// first one). devices.remove deletes one entry through the device join's remove(by, dev), which holds the rule that a
// device may remove only itself and devices paired after it (else not-allowed); that also ends the device's channel
// session and drops its later frames. Removing the asking device is Settings' "Unpair this PC": the channel still
// sends that answer, sealed with the session that just ended. main.mjs hands this file the keys and the device join
// with bindDevices before the link starts.
const DEV = /^[A-Za-z0-9_-]{22}$/;

let bound = null;

export function bindDevices({ keys, join }) {
  if (!Array.isArray(keys?.devices))
    throw new Error("devices: bindDevices needs the keys with their devices");
  if (typeof join?.remove !== "function")
    throw new Error("devices: bindDevices needs the device join's remove");
  bound = { keys, join };
}

function held() {
  if (!bound)
    throw new Error(
      "devices: an action ran before main.mjs called bindDevices",
    );
  return bound;
}

export function listDevices(keys, asker) {
  return [...keys.devices]
    .sort((a, b) => (a.pairedAt < b.pairedAt ? -1 : 1))
    .map((d) => ({
      device: d.device,
      client: d.kind ?? null,
      pairedAt: d.pairedAt,
      lastSeen: d.lastSeen ?? null,
      thisOne: d.device === asker,
    }));
}

export function register(registry) {
  registry.add({
    name: "devices.list",
    run: (_d, ctx) => listDevices(held().keys, ctx.device),
  });
  registry.add({
    name: "devices.remove",
    input: { device: { type: "string", min: 22, max: 22, pattern: DEV } },
    run: (d, ctx) => held().join.remove(ctx.device, d.device),
  });
}
