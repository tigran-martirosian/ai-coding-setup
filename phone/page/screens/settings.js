// Settings (DS1 section 3, `settings`, `settings-lower`): which alerts in the bot chat buzz, which arrive silent
// and which are off (kept on the PC: alerts.get, alerts.set), the PC this phone is paired with, and the Telegram
// account linked to it. The PC connection block lists the devices paired with the PC (devices.list), with Remove on
// the others (one line asks first) and "Unpair this PC" (Telegram's popup asks first); after Unpair the frame
// forgets the stored key and shows pairing (ctx.unpaired).
import { KINDS } from "../../shared/seal.mjs";
import { el, ICONS, icon } from "../frame/dom.js";
import { registerScreen } from "../frame/screens.js";

// The kinds the PC watches, named with the state word; `words` end the alert line
// ("my-project · Fix the login page: needs you"). Handed off is a session that ended by handing its work to a new one.
const KIND_WORDS = {
  "session-needs-you": { name: "A session: Needs you", words: "needs you" },
  "session-finished": { name: "A session: Finished", words: "finished" },
  "session-handed-off": {
    name: "A session: Handed off",
    words: "handed off, continuing",
  },
};
const SAMPLE = "my-project · Fix the login page";
const MODES = [
  { mode: "buzz", word: "Buzz" },
  { mode: "silent", word: "Silent" },
  { mode: "off", word: "Off" },
];

const errWord = (r) => r?.err ?? r?.code ?? r?.message ?? "no answer";

const UNPAIR_TEXT =
  "This phone stops reaching the PC. Sessions on the PC keep going. To use the app again, pair from the PC.";
const REFUSED = {
  "not-allowed":
    "Only the device itself, or one paired before it, can remove it.",
};

// A device's kind as the pipe design names it; an entry from before device join has none.
const kindName = (client) =>
  client === null ? "Kind not recorded" : (KINDS[client] ?? client);
const hhmm = (t) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (t) =>
  new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });

// "today 14:02", "yesterday 09:15", else the day: "12 Nov".
export function seenWords(t, now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const d = new Date(t);
  if (d >= midnight) return `today ${hhmm(t)}`;
  if (d >= midnight - 24 * 3600 * 1000) return `yesterday ${hhmm(t)}`;
  return day(t);
}

export const deviceMeta = (d) =>
  `paired ${day(d.pairedAt)} · ${d.lastSeen ? `last seen ${seenWords(d.lastSeen)}` : "not seen yet"}`;

// The last choices the PC gave, kept in memory and in local storage, so a later open draws them at once and
// asks the PC behind. Only these choices are kept here; no key or session text.
const KEPT_KEY = "settings.alerts";
let kept = null;

function readKept() {
  if (kept) return kept;
  const raw = localStorage.getItem(KEPT_KEY);
  if (raw === null) return null;
  try {
    const list = JSON.parse(raw);
    if (Array.isArray(list) && list.every((x) => x?.kind && x?.mode))
      kept = list;
  } catch {}
  if (!kept) {
    console.error(
      `settings: dropped kept alert choices that do not read: ${raw.slice(0, 80)}`,
    );
    localStorage.removeItem(KEPT_KEY);
  }
  return kept;
}

function keep(list) {
  kept = list;
  localStorage.setItem(KEPT_KEY, JSON.stringify(list));
}

function render(ctx) {
  const box = el("div.settings");
  // alerts: [{ kind, mode }], kept or read; saving: kind -> the mode the PC is asked for; errors per kind or
  // for the list.
  const st = { alerts: readKept(), error: null, saving: {}, rowError: {} };
  let pc = null;
  let pcError = null;
  // The devices: the list the PC gave, its error, the device whose Remove asks now, the one being removed, a
  // refusal per device, and Unpair's state.
  const dv = {
    list: null,
    error: null,
    asking: null,
    removing: null,
    rowError: {},
    unpairing: false,
    unpairError: null,
  };
  const draw = () =>
    box.replaceChildren(alertsGroup(), pcGroup(), accountGroup());

  function loadDevices() {
    ctx
      .ask("devices.list", {})
      .catch((e) => e)
      .then((r) => {
        if (r?.ok) {
          dv.list = r.d;
          dv.error = null;
        } else dv.error = errWord(r);
        draw();
      });
  }

  // Each answer draws as it comes: the choices do not wait for the PC's status.
  function load() {
    ctx
      .ask("alerts.get", {})
      .catch((e) => e)
      .then((a) => {
        if (a?.ok) {
          keep(a.d);
          st.error = null;
          // A choice still being saved keeps the mode the user tapped.
          st.alerts = a.d.map((x) =>
            x.kind in st.saving ? { kind: x.kind, mode: st.saving[x.kind] } : x,
          );
        } else st.error = errWord(a);
        draw();
      });
    ctx
      .ask("pc.status", {})
      .catch((e) => e)
      .then((s) => {
        if (s?.ok) pc = s.d;
        else pcError = errWord(s);
        draw();
      });
    loadDevices();
  }

  const setMode = (kind, mode) => {
    st.alerts = st.alerts.map((x) => (x.kind === kind ? { kind, mode } : x));
  };

  // The tap marks at once; if the PC refuses, the mark goes back and the row says why.
  async function choose(kind, mode, was) {
    if (kind in st.saving) return;
    ctx.haptic("select");
    st.saving[kind] = mode;
    delete st.rowError[kind];
    setMode(kind, mode);
    draw();
    let r;
    try {
      r = await ctx.ask("alerts.set", { kind, mode });
    } catch (e) {
      r = e;
    }
    delete st.saving[kind];
    if (r?.ok) {
      setMode(r.d.kind, r.d.mode);
      keep(
        kept.map((x) =>
          x.kind === r.d.kind ? { kind: x.kind, mode: r.d.mode } : x,
        ),
      );
    } else {
      setMode(kind, was);
      st.rowError[kind] = errWord(r);
    }
    draw();
  }

  function kindRow({ kind, mode }) {
    const k = KIND_WORDS[kind];
    return el(
      "div.set",
      el("div.set-name", k ? k.name : kind),
      k ? el("div.set-meta", `“${SAMPLE}: ${k.words}”`) : null,
      el(
        "div.seg",
        { role: "radiogroup", "aria-label": k ? k.name : kind },
        MODES.map((m) =>
          el(
            "button",
            {
              type: "button",
              role: "radio",
              "aria-checked": String(m.mode === mode),
              "data-action": "alerts.set",
              onclick:
                m.mode === mode ? null : () => choose(kind, m.mode, mode),
            },
            m.word,
          ),
        ),
      ),
      st.rowError[kind]
        ? el("p.err", `Could not change it: ${st.rowError[kind]}`)
        : null,
    );
  }

  function alertsGroup() {
    let body;
    if (st.alerts && st.error)
      body = [
        st.alerts.map(kindRow),
        el("p.err", `Could not refresh the alert choices: ${st.error}`),
      ];
    else if (st.alerts) body = st.alerts.map(kindRow);
    else if (st.error)
      body = el("p.err", `Could not read the alert choices: ${st.error}`);
    else if (!ctx.connected)
      body = el("p.empty", "The choices show when the PC is connected.");
    else body = el("p.empty", "Asking the PC…");
    return el(
      "div.group",
      el("div.g-head", "Alerts in the bot chat"),
      el(
        "div.g-sub",
        "The bot sends one message, with a button that opens the right place.",
      ),
      el("div.block", body),
      el(
        "div.g-foot",
        "Buzz: sound and banner. Silent: arrives with no sound. Off: no message.",
      ),
    );
  }

  // Remove on another device: the first tap opens one line that asks, its Remove asks the PC.
  async function remove(device) {
    if (dv.removing) return;
    ctx.haptic("select");
    dv.removing = device;
    delete dv.rowError[device];
    draw();
    let r;
    try {
      r = await ctx.ask("devices.remove", { device });
    } catch (e) {
      r = e;
    }
    dv.removing = null;
    dv.asking = null;
    if (r?.ok) dv.list = dv.list.filter((d) => d.device !== r.d.removed);
    else dv.rowError[device] = REFUSED[r?.err] ?? errWord(r);
    draw();
    if (r?.ok) loadDevices();
  }

  // Unpair this PC: Telegram's own popup asks once; Cancel changes nothing.
  function askUnpair() {
    const tg = ctx.tg;
    if (typeof tg?.showPopup !== "function") {
      dv.unpairError = "Telegram cannot ask here: open the app in Telegram.";
      return draw();
    }
    const name = (pc?.pcName ?? "your PC").slice(0, 48);
    tg.showPopup(
      {
        title: `Unpair ${name}?`,
        message: UNPAIR_TEXT,
        buttons: [
          { id: "cancel", type: "cancel" },
          { id: "unpair", type: "destructive", text: "Unpair" },
        ],
      },
      (id) => {
        if (id === "unpair") unpair();
      },
    );
  }

  // The PC forgets this device first; only then does the frame drop the stored key and show pairing.
  async function unpair() {
    if (dv.unpairing) return;
    dv.unpairing = true;
    dv.unpairError = null;
    draw();
    try {
      const r = await ctx.ask("devices.remove", { device: ctx.pairing.dev });
      if (!r?.ok) throw r;
      await ctx.unpaired();
    } catch (e) {
      dv.unpairing = false;
      dv.unpairError = `Could not unpair: ${REFUSED[e?.err] ?? errWord(e)}`;
      draw();
    }
  }

  function deviceRow(d) {
    const asking = dv.asking === d.device;
    const busy = dv.removing === d.device;
    return el(
      "div.dev",
      { "data-device": d.device },
      el(
        "div.set-row.dev-row",
        el(
          "div.row-text",
          el(
            "div.set-name",
            kindName(d.client),
            d.thisOne ? el("span.dev-this", "This device") : null,
          ),
          el("div.set-meta", deviceMeta(d)),
        ),
        d.thisOne || asking
          ? null
          : el(
              "button.dev-remove",
              {
                type: "button",
                "data-action": "devices.remove",
                disabled: !ctx.connected || Boolean(dv.removing),
                onclick: () => {
                  dv.asking = d.device;
                  delete dv.rowError[d.device];
                  draw();
                },
              },
              "Remove",
            ),
      ),
      asking
        ? el(
            "div.dev-ask",
            el("span.dev-ask-text", "Remove it? It stops reaching this PC."),
            el(
              "button.dev-cancel",
              {
                type: "button",
                disabled: busy,
                onclick: () => {
                  dv.asking = null;
                  draw();
                },
              },
              "Cancel",
            ),
            el(
              "button.dev-remove.dev-yes",
              {
                type: "button",
                disabled: busy,
                onclick: () => remove(d.device),
              },
              busy ? "Removing…" : "Remove",
            ),
          )
        : null,
      dv.rowError[d.device]
        ? el("p.err", `Could not remove it: ${dv.rowError[d.device]}`)
        : null,
    );
  }

  function devicesPart() {
    if (dv.list) {
      const rows = dv.list.map(deviceRow);
      return dv.error
        ? [rows, el("p.err", `Could not refresh the devices: ${dv.error}`)]
        : rows;
    }
    if (dv.error) return el("p.err", `Could not read the devices: ${dv.error}`);
    if (!ctx.connected) return null;
    return el("p.empty.dev-wait", "Asking the PC for its devices…");
  }

  function pcGroup() {
    let tone = "bad";
    let name = "Your PC";
    let meta = "Not connected";
    const me = dv.list?.find((d) => d.thisOne);
    if (ctx.connected && pc) {
      tone = "ok";
      name = pc.pcName;
      meta = me ? `Connected · paired ${day(me.pairedAt)}` : "Connected";
    } else if (ctx.connected && pcError) meta = `Connected · ${pcError}`;
    else if (ctx.connected) meta = "Connected · asking the PC…";
    return el(
      "div.group",
      el("div.g-head", "PC connection"),
      el(
        "div.block",
        el(
          "div.set-row",
          el(`span.pc-icon.${tone}`, icon(ICONS.pc, 18)),
          el(
            "div.row-text",
            el("div.set-name", name),
            el("div.set-meta", meta),
          ),
        ),
        devicesPart(),
        el(
          "button.set-row.unpair",
          {
            type: "button",
            "data-action": "devices.remove",
            disabled: !ctx.connected || dv.unpairing,
            onclick: askUnpair,
          },
          dv.unpairing ? "Unpairing…" : "Unpair this PC",
        ),
        dv.unpairError ? el("p.err", dv.unpairError) : null,
      ),
      el(
        "div.g-foot",
        "Unpair if you change phones or lose this one. You can pair again from the PC.",
      ),
    );
  }

  function accountGroup() {
    const u = ctx.tg?.initDataUnsafe?.user;
    const body = u
      ? el(
          "div.set-row",
          el(
            "span.account-tile",
            { "aria-hidden": "true" },
            (u.first_name || u.username || "?").slice(0, 1).toUpperCase(),
          ),
          el(
            "div.row-text",
            el(
              "div.set-name",
              [u.first_name, u.last_name].filter(Boolean).join(" ") +
                (u.username ? ` · @${u.username}` : ""),
            ),
            el("div.set-meta", "Only this Telegram account can reach your PC"),
          ),
        )
      : el("p.err", "Telegram did not name the account that opened this page.");
    return el(
      "div.group",
      el("div.g-head", "Linked account"),
      el("div.block", body),
    );
  }

  draw();
  if (ctx.connected) load();
  return box;
}

registerScreen({
  id: "settings",
  tab: "settings",
  title: "Settings",
  render,
  actions: ["alerts.get", "alerts.set", "devices.list", "devices.remove"],
});
