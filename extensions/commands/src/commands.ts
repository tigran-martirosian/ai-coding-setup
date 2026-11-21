// The buttons, and the one call a button makes.
//
// A button starts a new session in the open project with the command as its first message. The app
// has no call that reaches a session that is already running (read from the app's code),
// so /handoff and /btw, which belong to a running chat, are not here.

import type { Invoke } from "../../shared/host.ts";
import { hostInvoke, REFUSAL_MS, startSession } from "../../shared/host.ts";
import { HIDE, OWN } from "./own.ts";
import { t } from "./strings.ts";

export interface Command {
  id: string;
  label: string;
  /** The first message of the new session; empty for a row with a pick, which sends nothing. */
  prompt: string;
  note: string;
  /** None on a pick's option: the names tell the options apart. */
  icon?: string;
  /** The list's group, 1 to 4; groups are drawn in this order, apart by a hairline. */
  group: 1 | 2 | 3 | 4;
  /** Shown only when the open project's folder has one of these names; a name ending in * is a prefix. */
  only?: string[];
  /** The options the row opens under it in place (a disclosure row, DESIGN.md); each starts its own session. */
  pick?: Command[];
}

// `npm run build:share` sets this: the build that goes to other people leaves out the buttons in
// own.ts, whose skills exist only on this computer.
declare const __SHARE__: boolean | undefined;
const SHARE = typeof __SHARE__ !== "undefined" && __SHARE__;
// The skills installed on the computer that built this list (vite.config.ts); null only outside a build (the tests).
declare const __SKILLS__: string[] | undefined;
const SKILLS = typeof __SKILLS__ !== "undefined" ? __SKILLS__ : null;

/** The own buttons whose skill (the prompt's first word) is installed, so another computer's build leaves them out. */
export const ownFor = (own: Command[], skills: string[] | null): Command[] =>
  skills === null
    ? own
    : own.filter((c) =>
        skills.includes(c.prompt.replace(/^\//, "").split(/\s/)[0]),
      );

// The folder that holds the setup: claude-settings for a new install, or a folder named like it.
const SETUP_FOLDERS = ["claude-set*"];

// The checks under Setup audit, most-used first. The two that end in a tick list of changes to the setup
// itself show only in the setup folder. A typed /setup-audit with no word still runs the health check.
const SETUP_CHECKS: Command[] = [
  {
    id: "setup-health",
    label: t.commands.setupHealth.label,
    prompt: "/setup-audit",
    note: t.commands.setupHealth.note,
    group: 3,
  },
  {
    id: "usage-report",
    label: t.commands.usageReport.label,
    prompt: "/setup-audit usage",
    note: t.commands.usageReport.note,
    group: 3,
  },
  {
    id: "prompt-audit",
    label: t.commands.promptAudit.label,
    prompt: "/setup-audit prompt",
    note: t.commands.promptAudit.note,
    group: 3,
  },
  {
    id: "project-scan",
    label: t.commands.projectScan.label,
    prompt: "/setup-audit scan",
    note: t.commands.projectScan.note,
    group: 3,
  },
  {
    id: "chat-review",
    label: t.commands.chatReview.label,
    prompt: "/setup-audit chat",
    note: t.commands.chatReview.note,
    group: 3,
    only: SETUP_FOLDERS,
  },
  {
    id: "full-review",
    label: t.commands.fullReview.label,
    prompt: "/setup-audit full",
    note: t.commands.fullReview.note,
    group: 3,
    only: SETUP_FOLDERS,
  },
];

// Most-used first, in four groups that the list sets apart with a hairline (no headings: the user's choice,
// recorded in shared/DESIGN.md). own.ts adds its buttons at the end of the last group.
const ALL: Command[] = [
  {
    id: "lead",
    label: t.commands.lead.label,
    prompt: "/lead",
    note: t.commands.lead.note,
    icon: "rocket_launch",
    group: 1,
  },
  {
    id: "grill-me",
    label: t.commands.grillMe.label,
    prompt: "/grilling",
    note: t.commands.grillMe.note,
    icon: "quiz",
    group: 1,
  },
  {
    id: "next-move",
    label: t.commands.nextMove.label,
    prompt: "/next-move",
    note: t.commands.nextMove.note,
    icon: "navigation",
    group: 1,
  },
  {
    id: "where-are-we",
    label: t.commands.whereAreWe.label,
    prompt: "/where-are-we",
    note: t.commands.whereAreWe.note,
    icon: "explore",
    group: 1,
  },
  {
    id: "board-cleanup",
    label: t.commands.boardCleanup.label,
    prompt: "/board-cleanup",
    note: t.commands.boardCleanup.note,
    icon: "mop",
    group: 1,
  },
  {
    id: "new-project",
    label: t.commands.newProject.label,
    prompt: "/new-project",
    note: t.commands.newProject.note,
    icon: "create_new_folder",
    group: 2,
  },
  {
    id: "update-project",
    label: t.commands.updateProject.label,
    prompt: "/update-project",
    note: t.commands.updateProject.note,
    icon: "upgrade",
    group: 2,
  },
  {
    id: "systems-map",
    label: t.commands.systemsMap.label,
    prompt: "/systems-map",
    note: t.commands.systemsMap.note,
    icon: "hub",
    group: 2,
  },
  {
    id: "untangle",
    label: t.commands.untangle.label,
    prompt: "/untangle-codebase",
    note: t.commands.untangle.note,
    icon: "account_tree",
    group: 2,
  },
  {
    id: "setup-audit",
    label: t.commands.setupAudit.label,
    prompt: "",
    note: t.commands.setupAudit.note,
    icon: "fact_check",
    group: 3,
    pick: SETUP_CHECKS,
  },
  {
    id: "update-setup",
    label: t.commands.updateSetup.label,
    prompt: "/update-setup",
    note: t.commands.updateSetup.note,
    icon: "system_update_alt",
    group: 3,
  },
  {
    id: "backup",
    label: t.commands.backup.label,
    prompt: "/backup",
    note: t.commands.backup.note,
    icon: "backup",
    group: 3,
  },
  {
    id: "pc-tidy",
    label: t.commands.pcTidy.label,
    prompt: "/pc-tidy",
    note: t.commands.pcTidy.note,
    icon: "memory",
    group: 4,
  },
  {
    id: "disk-tidy",
    label: t.commands.diskTidy.label,
    prompt: "/disk-tidy",
    note: t.commands.diskTidy.note,
    icon: "hard_drive",
    group: 4,
  },
  ...(SHARE ? [] : ownFor(OWN, SKILLS)),
];

// own.ts can hide a button or a pick's option whose skill is not on this computer; the build for other people has them all.
const shown = (c: Command) => SHARE || !HIDE.includes(c.id);
export const COMMANDS: Command[] = ALL.filter(shown).map((c) =>
  c.pick ? { ...c, pick: c.pick.filter(shown) } : c,
);

const folderName = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() ?? "";

/** The buttons for the open project, or with `commands` a row's pick, the options for it. */
export function visible(
  workspacePath: string,
  commands: Command[] = COMMANDS,
): Command[] {
  const name = folderName(workspacePath).toLowerCase();
  const fits = (o: string) =>
    o.endsWith("*")
      ? name.startsWith(o.slice(0, -1).toLowerCase())
      : o.toLowerCase() === name;
  return commands.filter((c) => !c.only || c.only.some(fits));
}

/** The buttons split into their groups, in list order; a group with no button is left out. */
export function grouped(commands: Command[]): Command[][] {
  const groups = new Map<number, Command[]>();
  for (const c of commands)
    groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, g]) => g);
}

/** Starts the session. Returns '' once it is running, or the reason the app refused. */
export function run(
  command: Command,
  invoke: Invoke,
  wait = REFUSAL_MS,
): Promise<string> {
  if (!command.prompt)
    throw new Error(`${command.id} opens a pick and starts no session`);
  return startSession(invoke, command.prompt, command.label, wait, (e) =>
    e instanceof Error ? e.message : String(e),
  );
}

/** What the list shows: one command can be starting, or asking whether to start again. */
export interface LauncherState {
  /** The command whose session is being started; every row waits for it. */
  starting: string;
  /** When each started command was pressed (ms). Kept here, not in the popover, so closing it forgets nothing. */
  started: Record<string, number>;
  /** The started command whose second press is waiting for an answer. */
  asking: string;
  error: string;
}

/**
 * The press logic apart from the drawing. A command already started asks first: the second press only
 * opens the question, `confirm` starts it again.
 */
export function createLauncher(
  invoke: Invoke,
  now: () => number = Date.now,
  wait = REFUSAL_MS,
) {
  let state: LauncherState = {
    starting: "",
    started: {},
    asking: "",
    error: "",
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<LauncherState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const start = async (command: Command) => {
    set({ starting: command.id, asking: "", error: "" });
    const refused = await run(command, invoke, wait);
    set(
      refused
        ? { starting: "", error: refused }
        : { starting: "", started: { ...state.started, [command.id]: now() } },
    );
  };
  return {
    get: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /** The row's button. Returns what it did, so the caller can move focus. */
    async press(command: Command): Promise<"ignored" | "asking" | "started"> {
      if (state.starting) return "ignored";
      if (state.started[command.id]) {
        set({ asking: command.id, error: "" });
        return "asking";
      }
      await start(command);
      return "started";
    },
    async confirm(command: Command) {
      if (state.starting || state.asking !== command.id) return;
      await start(command);
    },
    cancel() {
      if (state.asking) set({ asking: "" });
    },
  };
}

export const launcher = createLauncher(hostInvoke);

/**
 * What one Esc closes inside the list, innermost first: the question, then the open pick. "" leaves it to
 * the popover, which skips its own Esc while either is open (popover.tsx).
 */
export const escCloses = (
  state: LauncherState,
  pickOpen: boolean,
): "question" | "pick" | "" =>
  state.asking ? "question" : pickOpen ? "pick" : "";

/** The open pick ("" for none) after a press on the row `id`: it opens or closes; while a session starts, every row waits. */
export const togglePick = (open: string, id: string, state: LauncherState) =>
  state.starting ? open : open === id ? "" : id;

/** The newest started option of a pick, which its closed row shows so a start is never hidden. */
export function newestStart(
  options: Command[],
  started: Record<string, number>,
): { option: Command; at: number } | undefined {
  let newest: { option: Command; at: number } | undefined;
  for (const option of options) {
    const at = started[option.id];
    if (at && (!newest || at > newest.at)) newest = { option, at };
  }
  return newest;
}
