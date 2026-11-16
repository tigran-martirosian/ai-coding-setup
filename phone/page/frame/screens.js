// The screen list (PC program design, section 2). Each file in screens/ calls registerScreen or registerHomePart
// when it is imported; the build's screens.generated.js imports every such file, so a new screen is a new file
// and no frame file changes.
//   registerScreen({ id, tab, title, render, actions })
//     tab: "home", "projects", "settings" (that tab's top screen) or null; title: text or (params) => text;
//     render(ctx) returns an element, or { content, bottom } where `bottom` sits above Telegram's main button;
//     actions: the PC actions the screen uses, so the frame can grey it when the PC does not offer them.
//   registerHomePart({ id, order, render }): a block on Home; order from DS1's list (PC status 10, version 20,
//     needs you 30, working 40, jobs 50, usage 60). render(ctx) returns an element or null.

export const TABS = [
  { tab: "home", word: "Home" },
  { tab: "projects", word: "Projects" },
  { tab: "settings", word: "Settings" },
];

const ID = /^[a-z][a-z0-9-]*$/;
const screens = new Map();
const parts = new Map();

export function registerScreen({ id, tab = null, title, render, actions }) {
  if (!ID.test(String(id)))
    throw new Error(`registerScreen: "${id}" is not a screen id`);
  if (screens.has(id))
    throw new Error(`registerScreen: "${id}" is registered twice`);
  if (tab !== null && !TABS.some((t) => t.tab === tab))
    throw new Error(`registerScreen ${id}: tab "${tab}" is not a tab`);
  if (tab !== null) {
    const other = [...screens.values()].find((s) => s.tab === tab);
    if (other)
      throw new Error(
        `registerScreen ${id}: tab "${tab}" already has ${other.id}`,
      );
  }
  if (typeof title !== "string" && typeof title !== "function")
    throw new Error(`registerScreen ${id}: title is text or a function`);
  if (typeof render !== "function")
    throw new Error(`registerScreen ${id}: render is not a function`);
  if (!Array.isArray(actions) || actions.some((a) => typeof a !== "string"))
    throw new Error(`registerScreen ${id}: actions is a list of action names`);
  screens.set(id, { id, tab, title, render, actions });
}

export function registerHomePart({ id, order, render }) {
  if (!ID.test(String(id)))
    throw new Error(`registerHomePart: "${id}" is not a part id`);
  if (parts.has(id))
    throw new Error(`registerHomePart: "${id}" is registered twice`);
  if (!Number.isInteger(order))
    throw new Error(`registerHomePart ${id}: order is a whole number`);
  if (typeof render !== "function")
    throw new Error(`registerHomePart ${id}: render is not a function`);
  parts.set(id, { id, order, render });
}

export function screen(id) {
  const s = screens.get(id);
  if (!s) throw new Error(`no screen "${id}" in this build`);
  return s;
}

export const hasScreen = (id) => screens.has(id);

// The tabs that have a top screen in this build, in the bar's order.
export const tabScreens = () =>
  TABS.map((t) => ({
    ...t,
    screen: [...screens.values()].find((s) => s.tab === t.tab),
  })).filter((t) => t.screen);

export const homeParts = () =>
  [...parts.values()].sort(
    (a, b) => a.order - b.order || (a.id < b.id ? -1 : 1),
  );
