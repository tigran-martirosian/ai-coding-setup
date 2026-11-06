// The buttons, and the one call a button makes.
//
// A button starts a new session in the open project with the command as its first message. The app
// has no call that reaches a session that is already running (read from the app's code),
// so /handoff and /btw, which belong to a running chat, are not here.

import { REFUSAL_MS, hostInvoke, startSession } from '../../shared/host.ts';
import type { Invoke } from '../../shared/host.ts';
import { HIDE, OWN } from './own.ts';
import { t } from './strings.ts';

export interface Command {
  id: string;
  label: string;
  /** The first message of the new session. */
  prompt: string;
  note: string;
  icon: string;
  /** Shown only when the open project's folder has one of these names; a name ending in * is a prefix. */
  only?: string[];
}

// `npm run build:share` sets this: the build that goes to other people leaves out the buttons in
// own.ts, whose skills exist only on this computer.
declare const __SHARE__: boolean | undefined;
const SHARE = typeof __SHARE__ !== 'undefined' && __SHARE__;

// The folder that holds the setup: claude-settings for a new install, or a folder named like it.
const SETUP_FOLDERS = ['claude-set*'];

const ALL: Command[] = [
  { id: 'board-cleanup', label: t.commands.boardCleanup.label, prompt: '/board-cleanup', note: t.commands.boardCleanup.note, icon: 'mop' },
  { id: 'next-move', label: t.commands.nextMove.label, prompt: '/next-move', note: t.commands.nextMove.note, icon: 'navigation' },
  { id: 'project-scan', label: t.commands.projectScan.label, prompt: '/setup-audit scan', note: t.commands.projectScan.note, icon: 'troubleshoot' },
  { id: 'setup-audit', label: t.commands.setupAudit.label, prompt: '/setup-audit', note: t.commands.setupAudit.note, icon: 'fact_check' },
  { id: 'usage-report', label: t.commands.usageReport.label, prompt: '/setup-audit usage', note: t.commands.usageReport.note, icon: 'bar_chart' },
  { id: 'pc-tidy', label: t.commands.pcTidy.label, prompt: '/pc-tidy', note: t.commands.pcTidy.note, icon: 'memory' },
  { id: 'chat-review', label: t.commands.chatReview.label, prompt: '/setup-audit chat', note: t.commands.chatReview.note, icon: 'forum', only: SETUP_FOLDERS },
  { id: 'full-review', label: t.commands.fullReview.label, prompt: '/setup-audit full', note: t.commands.fullReview.note, icon: 'rate_review', only: SETUP_FOLDERS },
  { id: 'untangle', label: t.commands.untangle.label, prompt: '/untangle-codebase', note: t.commands.untangle.note, icon: 'account_tree' },
  { id: 'systems-map', label: t.commands.systemsMap.label, prompt: '/systems-map', note: t.commands.systemsMap.note, icon: 'hub' },
  ...(SHARE ? [] : OWN),
  { id: 'new-project', label: t.commands.newProject.label, prompt: '/new-project', note: t.commands.newProject.note, icon: 'create_new_folder' },
  { id: 'update-setup', label: t.commands.updateSetup.label, prompt: '/update-setup', note: t.commands.updateSetup.note, icon: 'system_update_alt' },
];

// own.ts can hide a button whose skill is not on this computer; the build for other people has them all.
export const COMMANDS: Command[] = ALL.filter((c) => SHARE || !HIDE.includes(c.id));

const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';

/** The buttons for the open project. */
export function visible(workspacePath: string, commands: Command[] = COMMANDS): Command[] {
  const name = folderName(workspacePath).toLowerCase();
  const fits = (o: string) => (o.endsWith('*') ? name.startsWith(o.slice(0, -1).toLowerCase()) : o.toLowerCase() === name);
  return commands.filter((c) => !c.only || c.only.some(fits));
}

/** Starts the session. Returns '' once it is running, or the reason the app refused. */
export function run(command: Command, invoke: Invoke, wait = REFUSAL_MS): Promise<string> {
  return startSession(invoke, command.prompt, command.label, wait, (e) => (e instanceof Error ? e.message : String(e)));
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
export function createLauncher(invoke: Invoke, now: () => number = Date.now, wait = REFUSAL_MS) {
  let state: LauncherState = { starting: '', started: {}, asking: '', error: '' };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<LauncherState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const start = async (command: Command) => {
    set({ starting: command.id, asking: '', error: '' });
    const refused = await run(command, invoke, wait);
    set(refused ? { starting: '', error: refused } : { starting: '', started: { ...state.started, [command.id]: now() } });
  };
  return {
    get: () => state,
    subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
    /** The row's button. Returns what it did, so the caller can move focus. */
    async press(command: Command): Promise<'ignored' | 'asking' | 'started'> {
      if (state.starting) return 'ignored';
      if (state.started[command.id]) {
        set({ asking: command.id, error: '' });
        return 'asking';
      }
      await start(command);
      return 'started';
    },
    async confirm(command: Command) {
      if (state.starting || state.asking !== command.id) return;
      await start(command);
    },
    cancel() {
      if (state.asking) set({ asking: '' });
    },
  };
}

export const launcher = createLauncher(hostInvoke);
