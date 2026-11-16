// Projects (DS1 section 3, `projects`, `projects-empty`) and a project's sessions (`sessions`, `sessions-empty`).
// The Projects tab lists the PC's projects, Pinned above Recent, newest use first, with a search field. A project
// opens its sessions: New session on top, then Needs you, Working and Earlier, 20 at a time; the next 20 load as
// the list's last line comes into view. Each session row opens the session screen. Holding a project or session
// row opens Pin or Unpin: a project pin is the phone's own, a session pin is Nimbalyst's (sessions.pin), and the
// sessions Nimbalyst has pinned sit in a Pinned group on top.
import { el, ICONS, icon } from "../frame/dom.js";
import { registerScreen } from "../frame/screens.js";
import { KIND } from "./home-sessions.js";

const GLYPHS = {
  plus: ["M12 5v14M5 12h14"],
  search: ["M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z", "m15.5 15.5 4 4"],
};

// The PC's refusal word, with its reason after it when the answer has one (the door's own error text).
export const errWord = (r) =>
  r?.err
    ? r.message
      ? `${r.err} (${r.message})`
      : r.err
    : (r?.code ?? r?.message ?? "no answer");

// The last projects.list answer, so the tab draws at once when it is opened again; also the names the session
// screen shows.
export const kept = { projects: null };
export const projectName = (handle) =>
  kept.projects?.find((p) => p.project === handle)?.name ?? null;

const DAY = 24 * 3600 * 1000;

// When something was last used, short: "now", "22m", "3h" (today), "yesterday", "Tue" (this week), "12 Nov".
export function when(t, now = new Date()) {
  const d = new Date(t);
  const m = Math.floor((now - d) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (d >= midnight) return `${Math.floor(m / 60)}h`;
  if (d >= midnight - DAY) return "yesterday";
  if (d >= midnight - 6 * DAY)
    return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

// Two letters for the tile: the first letters of the first two words, else the name's first two.
export function initials(name) {
  const words = name.split(/[\s\-_.]+/).filter(Boolean);
  const two =
    words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "").slice(0, 2);
  return two.toLowerCase();
}

const chev = () => el("i.chev", { "aria-hidden": "true" });

const joined = (parts) =>
  parts.filter(Boolean).flatMap((p, i) => (i ? [" · ", p] : [p]));

// ---- holding a row (PC program design, "Session pins"): about 500 ms without moving opens its small menu
const HOLD_MS = 500;
const HOLD_SLOP_PX = 10;

// The row's listeners, and wasHeld(): true once for the click that ends a hold, so that click opens nothing.
function holdable(onHold) {
  let timer = null;
  let from = null;
  let held = false;
  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };
  return {
    on: {
      onpointerdown: (e) => {
        stop();
        held = false;
        from = [e.clientX, e.clientY];
        timer = setTimeout(() => {
          timer = null;
          held = true;
          onHold();
        }, HOLD_MS);
      },
      onpointermove: (e) => {
        if (
          timer &&
          Math.hypot(e.clientX - from[0], e.clientY - from[1]) > HOLD_SLOP_PX
        )
          stop();
      },
      onpointerup: stop,
      onpointercancel: stop,
      // The phone's own long-press menu stays away; the hold menu replaces it.
      oncontextmenu: (e) => e.preventDefault(),
    },
    wasHeld: () => {
      const h = held;
      held = false;
      return h;
    },
  };
}

// The menu under a held row: Pin or Unpin (the word fits the row), greyed with the reason when it cannot work.
function holdMenu({ pinned, ready, why, onPick, onCancel }) {
  return el(
    "div.hold-menu",
    { role: "menu" },
    el(
      "div.hold-acts",
      el(
        "button.hold-pick",
        {
          type: "button",
          role: "menuitem",
          disabled: !ready,
          "aria-disabled": ready ? null : "true",
          onclick: () => {
            if (ready) onPick();
          },
        },
        pinned ? "Unpin" : "Pin",
      ),
      el("button.hold-cancel", { type: "button", onclick: onCancel }, "Cancel"),
    ),
    why ? el("div.hold-why", why) : null,
  );
}

const DOOR_PATCH_LINE = "Pin needs the door patch on the PC";

// The line under the heading when the PC refused a pin; the row has moved back by then.
const pinRefused = (r, pinned) =>
  r?.err === "needs-door-patch"
    ? DOOR_PATCH_LINE
    : `Could not ${pinned ? "pin" : "unpin"} it: ${errWord(r)}`;

async function askPc(ctx, action, data) {
  try {
    return await ctx.ask(action, data);
  } catch (e) {
    return e;
  }
}

function projectRow(ctx, p, onHold) {
  const counts = joined([
    p.needsYou ? el("span.w-needs", `${p.needsYou} needs you`) : null,
    p.working ? el("span.w-run", `${p.working} working`) : null,
  ]);
  const hold = holdable(onHold);
  return el(
    `div.row.proj${p.pinned ? ".pinned" : ""}`,
    {
      role: "button",
      tabindex: "0",
      "data-project": p.project,
      ...hold.on,
      onclick: () => {
        if (hold.wasHeld()) return;
        ctx.go("project", { project: p.project, name: p.name });
      },
    },
    el("span.tile", { "aria-hidden": "true" }, initials(p.name)),
    el(
      "div.row-text",
      el("div.name", p.name),
      el("div.meta", counts.length ? counts : "nothing working"),
    ),
    el("div.right", p.lastUsed ? when(p.lastUsed) : null, chev()),
  );
}

function renderProjects(ctx) {
  const box = el("div.projects");
  // menu: the project whose hold menu is open; note: why the PC refused the last pin.
  const state = { error: null, query: "", menu: null, note: null };
  const list = el("div");

  // A project pin is the phone's own (projects.pin): it moves at once and back when the PC refuses.
  async function pin(p) {
    const want = !p.pinned;
    state.menu = null;
    state.note = null;
    p.pinned = want;
    drawList();
    const r = await askPc(ctx, "projects.pin", {
      project: p.project,
      pinned: want,
    });
    if (r?.ok) return;
    p.pinned = !want;
    state.note = pinRefused(r, want);
    drawList();
  }

  const rowOf = (p) => [
    projectRow(ctx, p, () => {
      ctx.haptic("select");
      state.menu = p.project;
      drawList();
    }),
    state.menu === p.project
      ? holdMenu({
          pinned: p.pinned,
          ready: true,
          onPick: () => pin(p),
          onCancel: () => {
            state.menu = null;
            drawList();
          },
        })
      : null,
  ];

  const byUse = (a, b) =>
    (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "") ||
    a.name.localeCompare(b.name);

  function drawList() {
    const q = state.query.trim().toLowerCase();
    const shown = kept.projects
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort(byUse);
    const pinned = shown.filter((p) => p.pinned);
    const recent = shown.filter((p) => !p.pinned);
    const group = (head, items, foot) =>
      items.length
        ? el(
            "div.group",
            el("div.g-head", head),
            el("div.block.list-block", items.flatMap(rowOf)),
            foot ? el("div.g-foot", foot) : null,
          )
        : null;
    list.replaceChildren(
      ...[
        state.note ? el("p.frame-line.pin-note", state.note) : null,
        group("Pinned", pinned),
        group("Recent", recent, "Sorted by last used."),
        shown.length
          ? null
          : el("div.block.list-block", el("div.empty", "No project matches.")),
      ].filter(Boolean),
    );
  }

  function draw() {
    const parts = [];
    if (state.error)
      parts.push(
        el("p.frame-line", `Could not read the projects: ${state.error}`),
      );
    if (!kept.projects) {
      if (!state.error && ctx.connected)
        parts.push(el("p.frame-line", "Asking the PC…"));
      return box.replaceChildren(...parts);
    }
    if (!kept.projects.length) {
      parts.push(
        el(
          "div.block.empty-hero",
          el("div.hero-icon", icon(ICONS.projects, 26)),
          el("div.hero-title", "No projects yet"),
          el(
            "div.hero-text",
            "Open a project folder in Nimbalyst on your PC. It shows here by itself.",
          ),
        ),
      );
      return box.replaceChildren(...parts);
    }
    parts.push(
      el(
        "label.search",
        icon(GLYPHS.search, 18),
        el("input", {
          type: "search",
          placeholder: "Search projects",
          "aria-label": "Search projects",
          value: state.query,
          oninput: (e) => {
            state.query = e.target.value;
            drawList();
          },
        }),
      ),
      list,
    );
    drawList();
    box.replaceChildren(...parts);
  }

  async function load() {
    let r;
    try {
      r = await ctx.ask("projects.list", {});
    } catch (e) {
      r = e;
    }
    if (r?.ok) {
      kept.projects = r.d;
      state.error = null;
    } else state.error = errWord(r);
    draw();
  }

  draw();
  if (ctx.connected) load();
  return box;
}

registerScreen({
  id: "projects",
  tab: "projects",
  title: "Projects",
  render: renderProjects,
  actions: ["projects.list", "projects.pin"],
});

// ---- a project's sessions

// What each project's list last held, so it draws at once when opened again: project -> { items, total }.
const keptLists = new Map();

function sessionRow(ctx, project, s, onHold) {
  const look = {
    waiting: ["needs", el("span.orb.listen", { "aria-hidden": "true" })],
    running: ["running", el("span.orb.think", { "aria-hidden": "true" })],
    idle: ["done", el("span.done-mark", { "aria-hidden": "true" })],
  }[s.state];
  if (!look) throw new Error(`session ${s.session}: unknown state ${s.state}`);
  // A finished session has no state line: its group's heading, Earlier, and the tick say it.
  const meta =
    s.state === "waiting"
      ? el("span.w", KIND[s.kind] ?? s.kind)
      : s.state === "running"
        ? el("span.w", "Working")
        : null;
  const hold = holdable(onHold);
  return el(
    `div.row.${look[0]}`,
    {
      role: "button",
      tabindex: "0",
      "data-session": s.session,
      ...hold.on,
      onclick: () => {
        if (hold.wasHeld()) return;
        ctx.go("session", { session: s.session, project, title: s.title });
      },
    },
    look[1],
    el("div.row-text", el("div.name", s.title), meta && el("div.meta", meta)),
    el("div.right", when(s.updatedAt), chev()),
  );
}

function renderProject(ctx) {
  const { project } = ctx.params;
  const box = el("div.project");
  const st = keptLists.get(project) ?? { items: [], total: null };
  let page = st.total === null ? 0 : Math.ceil(st.items.length / 20);
  let loading = false;
  let error = null;
  // The open hold menu: { session, ready, why }; ready is null while pc.status is asked. note: why the PC
  // refused the last pin.
  let menu = null;
  let note = null;
  // The last line, watched: when it comes into view the next page loads.
  const watcher = new IntersectionObserver((seen) => {
    if (seen.some((s) => s.isIntersecting)) more();
  });

  const newButton = el(
    "button.btn-main.new-session",
    {
      type: "button",
      "data-action": "session.new",
      onclick: () => {
        ctx.haptic("light");
        ctx.go("session", { project, name: ctx.params.name });
      },
    },
    icon(GLYPHS.plus, 20),
    "New session",
  );

  // The menu asks pc.status first: without the door patch's set_session_pinned, Pin and Unpin stay greyed.
  async function hold(s) {
    ctx.haptic("select");
    menu = { session: s.session, ready: null, why: "Asking the PC…" };
    draw();
    const r = await askPc(ctx, "pc.status", {});
    if (menu?.session !== s.session) return;
    if (!r?.ok)
      menu = {
        session: s.session,
        ready: false,
        why: `Could not ask the PC: ${errWord(r)}`,
      };
    else if (!r.d.door)
      menu = {
        session: s.session,
        ready: false,
        why: "Pin needs Nimbalyst open on the PC",
      };
    else if (r.d.door.setSessionPinned !== true)
      menu = { session: s.session, ready: false, why: DOOR_PATCH_LINE };
    else menu = { session: s.session, ready: true, why: null };
    draw();
  }

  // The row moves into or out of Pinned at once, and back when the PC refuses.
  async function pin(s) {
    const want = !s.pinned;
    menu = null;
    note = null;
    s.pinned = want;
    draw();
    const r = await askPc(ctx, "sessions.pin", {
      session: s.session,
      pinned: want,
    });
    if (r?.ok) return;
    s.pinned = !want;
    note = pinRefused(r, want);
    draw();
  }

  const rowOf = (s) => [
    sessionRow(ctx, project, s, () => hold(s)),
    menu?.session === s.session
      ? holdMenu({
          pinned: s.pinned,
          ready: menu.ready === true,
          why: menu.why,
          onPick: () => pin(s),
          onCancel: () => {
            menu = null;
            draw();
          },
        })
      : null,
  ];

  function draw() {
    watcher.disconnect();
    const parts = [newButton];
    if (error)
      parts.push(el("p.frame-line", `Could not read the sessions: ${error}`));
    if (note) parts.push(el("p.frame-line.pin-note", note));
    if (st.total === null) {
      if (!error && ctx.connected)
        parts.push(el("p.frame-line", "Asking the PC…"));
      return box.replaceChildren(...parts);
    }
    if (!st.items.length) {
      parts.push(
        el(
          "div.block.empty-hero",
          el("div.hero-title", "No sessions yet"),
          el(
            "div.hero-text",
            "Start one with New session. It runs on your PC, in this project's folder.",
          ),
        ),
      );
      return box.replaceChildren(...parts);
    }
    const newest = (a, b) => b.updatedAt.localeCompare(a.updatedAt);
    const pinned = st.items.filter((s) => s.pinned).sort(newest);
    const of = (state) =>
      st.items.filter((s) => !s.pinned && s.state === state);
    const group = (head, items, cls, foot) =>
      items.length
        ? el(
            `div.group.g-${cls}`,
            el(
              "div.g-head",
              head,
              cls === "needs" || cls === "running"
                ? el("span.n", String(items.length))
                : null,
            ),
            el(
              `div.block.list-block${cls === "needs" ? ".needs-block" : ""}`,
              items.flatMap(rowOf),
            ),
            foot,
          )
        : null;
    const left = st.total - st.items.length;
    const foot =
      left > 0
        ? el(
            "div.g-foot.more",
            loading
              ? "Loading the next 20…"
              : `${st.items.length} of ${st.total} shown · more load as you scroll`,
          )
        : null;
    const groups = [
      group("Pinned", pinned, "pinned"),
      group("Needs you", of("waiting"), "needs"),
      group("Working", of("running"), "running"),
      group("Earlier", of("idle"), "earlier"),
    ].filter(Boolean);
    // The count line closes the last group, whichever it is.
    if (foot) groups[groups.length - 1].append(foot);
    box.replaceChildren(...parts, ...groups);
    if (foot && !loading && ctx.connected) watcher.observe(foot);
  }

  // Asks for pages `from` to `to` and draws once they all came: from page 1 they replace the list, else they
  // add to it. On return the kept rows stay drawn until the fresh ones replace them, so the place holds.
  async function load(from, to = from) {
    loading = true;
    const got = [];
    let total;
    let r;
    for (let n = from; n <= to; n++) {
      try {
        r = await ctx.ask("sessions.list", { project, page: n });
      } catch (e) {
        r = e;
      }
      if (!r?.ok) break;
      got.push(...r.d.items);
      total = r.d.total;
    }
    loading = false;
    if (!r?.ok) {
      error = errWord(r);
      return draw();
    }
    error = null;
    const items = from === 1 ? [] : [...st.items];
    const have = new Set(items.map((s) => s.session));
    for (const s of got) {
      if (have.has(s.session)) continue;
      have.add(s.session);
      items.push(s);
    }
    st.items = items;
    st.total = total;
    page = to;
    keptLists.set(project, st);
    draw();
  }

  function more() {
    if (loading || st.items.length >= st.total) return;
    load(page + 1);
    draw();
  }

  draw();
  // Every page the list already holds comes again, not page 1 only.
  if (ctx.connected) load(1, Math.max(page, 1));
  return box;
}

registerScreen({
  id: "project",
  tab: null,
  title: (params) => params.name ?? projectName(params.project) ?? "Project",
  render: renderProject,
  actions: ["sessions.list", "sessions.pin"],
});
