// Home (DS1 section 3, `home`, `home-empty`, `nimbalyst-closed`, `nimbalyst-starting`, `nimbalyst-failed`, `pc-off`):
// the PC's state first, then the version line, then the sessions that need the user and the ones working
// (home-sessions.js). The Home screen asks the PC and hands the answers to every Home part as ctx.home. The last
// answers stay in memory, so with the PC off or Nimbalyst closed Home still shows what it last knew.
import { el, ICONS, icon } from "../frame/dom.js";
import {
  homeParts,
  registerHomePart,
  registerScreen,
} from "../frame/screens.js";

// The last good answers, kept for the "last known" Home: { status, statusAt, sessions, names, sessionsAt }.
const kept = {
  status: null,
  statusAt: null,
  sessions: null,
  names: null,
  sessionsAt: null,
};
// A start of Nimbalyst asked from this page: { at, error }.
let start = null;

export const hhmm = (t) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const errWord = (r) => r?.err ?? r?.code ?? r?.message ?? "no answer";

function render(ctx) {
  const box = el("div.home");
  const home = {
    kept,
    error: null, // why pc.status could not be read on this connection
    fresh: false, // pc.status answered on this connection
    start,
    startNimbalyst,
  };
  const draw = () =>
    box.replaceChildren(
      ...homeParts()
        .map((p) => p.render({ ...ctx, home }))
        .filter(Boolean),
    );

  async function load() {
    let r;
    try {
      r = await ctx.ask("pc.status", {});
    } catch (e) {
      r = e;
    }
    if (!r?.ok) {
      home.error = errWord(r);
      return draw();
    }
    home.error = null;
    home.fresh = true;
    kept.status = r.d;
    kept.statusAt = r.d.asOf;
    if (r.d.nimbalyst === "open") start = home.start = null;
    if (r.d.nimbalyst === "open" && ctx.offered("home.sessions")) {
      const [s, p] = await Promise.all([
        ctx.ask("home.sessions", {}).catch((e) => e),
        ctx.offered("projects.list")
          ? ctx.ask("projects.list", {}).catch((e) => e)
          : null,
      ]);
      if (s?.ok) {
        kept.sessions = s.d;
        kept.sessionsAt = r.d.asOf;
        // Project names for the rows; without an answer the rows say no project, never a guess.
        kept.names = p?.ok
          ? Object.fromEntries(p.d.map((x) => [x.project, x.name]))
          : null;
      } else home.error = `sessions: ${errWord(s)}`;
    }
    draw();
  }

  async function startNimbalyst() {
    ctx.haptic("light");
    start = home.start = { at: new Date().toISOString(), error: null };
    draw();
    let r;
    try {
      r = await ctx.ask("nimbalyst.start", {});
    } catch (e) {
      r = e;
    }
    if (r?.ok) {
      kept.status = { ...kept.status, nimbalyst: r.d.state };
      return draw();
    }
    if (r?.err === "already-open") return load();
    start = home.start = { ...start, error: errWord(r) };
    draw();
  }

  ctx.onEvent((body) => {
    if (body.e === "status") load();
  });
  draw();
  if (ctx.connected) load();
  return box;
}

registerScreen({
  id: "home",
  tab: "home",
  title: "Home",
  render,
  actions: ["pc.status"],
});

// ---- PC status (order 10)

const sessionsWord = (n) =>
  n === 0
    ? "no sessions open"
    : n === 1
      ? "1 session open"
      : `${n} sessions open`;

function pcBlock(tone, title, meta, ...more) {
  return el(
    "div.group.home-pc",
    el(
      "div.block.pc-block",
      el(
        "div.pc",
        el(`span.pc-icon${tone ? `.${tone}` : ""}`, icon(ICONS.pc)),
        el("div", el("div.pc-title", title), el("div.pc-meta", meta)),
      ),
      ...more,
    ),
  );
}

const startButton = (home, text, busy) =>
  el(
    "div.pc-action",
    el(
      "button.btn-main",
      {
        type: "button",
        disabled: busy,
        "data-action": "nimbalyst.start",
        onclick: busy ? null : () => home.startNimbalyst(),
      },
      busy ? el("span.orb.on-accent", { "aria-hidden": "true" }) : null,
      text,
    ),
  );

function renderPc(ctx) {
  // With no link to the PC the frame's own block says so (PC off, or connecting): nothing to add here.
  if (!ctx.connected) return null;
  const { home } = ctx;
  const s = home.kept.status;
  if (!home.fresh) {
    if (home.error)
      return pcBlock(
        "bad",
        "PC on",
        `Could not read its status: ${home.error}`,
      );
    return pcBlock(null, "PC on", "Asking the PC…");
  }
  const startError = home.start?.error
    ? el("p.err", `Could not start Nimbalyst: ${home.start.error}`)
    : null;
  if (s.nimbalyst === "open") {
    const parts = [s.pcName];
    if (s.sessionsOpen !== null) parts.push(sessionsWord(s.sessionsOpen));
    parts.push(`as of ${hhmm(s.asOf)}`);
    return pcBlock(
      "ok",
      "PC on · Nimbalyst open",
      parts.join(" · "),
      home.error
        ? el("p.err", `Could not read the sessions: ${home.error}`)
        : null,
    );
  }
  if (s.nimbalyst === "starting")
    return pcBlock(
      "warn",
      "PC on · Nimbalyst starting",
      home.start
        ? `Asked at ${hhmm(home.start.at)} · Home fills in as it comes up`
        : "Home fills in as it comes up",
      startButton(home, "Starting…", true),
    );
  if (s.nimbalyst === "failed")
    return pcBlock(
      "bad",
      "Nimbalyst did not start",
      home.start ? `PC on · tried at ${hhmm(home.start.at)}` : "PC on",
      el(
        "p.err",
        "The PC opened it, but it closed again or did not come up within 2 minutes. Open it on the PC to see why.",
      ),
      startError,
      startButton(home, "Try again", false),
    );
  return pcBlock(
    "warn",
    "PC on · Nimbalyst closed",
    "No session can work until it starts.",
    startError,
    startButton(home, "Start Nimbalyst", false),
  );
}

registerHomePart({ id: "pc-status", order: 10, render: renderPc });

// ---- version line (order 20): the version this PC is on, and the newer one when there is one

export function versionText(status) {
  const on = `You're on setup ${status.setupVersion}${
    status.nimbalystVersion ? ` · Nimbalyst ${status.nimbalystVersion}` : ""
  }`;
  return {
    on,
    available: status.update
      ? `Setup ${status.update.version} available`
      : null,
  };
}

function renderVersion(ctx) {
  const s = ctx.home.kept.status;
  if (!s) return null;
  const v = versionText(s);
  return el(
    "div.version",
    el("span.version-on", v.on),
    v.available ? el("span.version-new", v.available) : null,
  );
}

registerHomePart({ id: "version", order: 20, render: renderVersion });
