// The buttons, and the one call a button makes.
//
// A button starts a new session in the open project with the command as its first message. The app
// has no call that reaches a session that is already running (read from the app's code, 2026-10-03),
// so /handoff, /ask and /btw, which belong to a running chat, are not here.

import { HIDE, OWN } from './own.ts';

export interface Command {
  id: string;
  label: string;
  /** The first message of the new session. */
  prompt: string;
  note: string;
  icon: string;
  /** Shown only when the open project's folder has this name. */
  only?: string;
}

// `npm run build:share` sets this: the build that goes to other people leaves out the buttons in
// own.ts, whose skills exist only on this computer.
declare const __SHARE__: boolean | undefined;
const SHARE = typeof __SHARE__ !== 'undefined' && __SHARE__;

const ALL: Command[] = [
  { id: 'board-cleanup', label: 'Board cleanup', prompt: '/board-cleanup', note: 'Move finished sessions to Complete', icon: 'mop' },
  { id: 'next-move', label: 'Next move', prompt: '/next-move', note: 'The most useful thing to do next here', icon: 'navigation' },
  { id: 'project-scan', label: 'Project scan', prompt: '/project-scan', note: "Check this project's Claude setup", icon: 'troubleshoot' },
  { id: 'setup-audit', label: 'Setup audit', prompt: '/setup-audit', note: 'Full check of the global setup', icon: 'fact_check' },
  { id: 'usage-report', label: 'Usage report', prompt: '/usage-report', note: 'Where the tokens went, and the forecast', icon: 'bar_chart' },
  { id: 'chat-review', label: 'Chat review', prompt: '/chat-review', note: 'What your chats show is missing', icon: 'forum', only: 'claude-settings' },
  { id: 'full-review', label: 'Full review', prompt: '/full-review', note: 'How the work went, and what to change', icon: 'rate_review', only: 'claude-settings' },
  ...(SHARE ? [] : OWN),
  { id: 'new-project', label: 'New project', prompt: '/new-project', note: 'Set this folder up for Claude', icon: 'create_new_folder' },
  { id: 'update-setup', label: 'Update setup', prompt: '/update-setup', note: 'Install the newest version of the setup', icon: 'system_update_alt' },
];

// own.ts can hide a button whose skill is not on this computer; the build for other people has them all.
export const COMMANDS: Command[] = ALL.filter((c) => SHARE || !HIDE.includes(c.id));

// Every button starts on Sonnet, whatever model was picked last in the app.
export const MODEL = 'claude-code:sonnet';

const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';

/** The buttons for the open project. */
export function visible(workspacePath: string, commands: Command[] = COMMANDS): Command[] {
  const name = folderName(workspacePath).toLowerCase();
  return commands.filter((c) => !c.only || c.only.toLowerCase() === name);
}

type Invoke = (channel: string, args: unknown) => Promise<unknown>;

// A refusal (no project open, provider off) comes back at once; the reply itself takes minutes.
const REFUSAL_MS = 2000;

/** Starts the session. Returns '' once it is running, or the reason the app refused. */
export function run(command: Command, invoke: Invoke, wait = REFUSAL_MS): Promise<string> {
  const sent = invoke('extensions:ai-send-prompt', { prompt: command.prompt, sessionName: command.label, model: MODEL });
  return Promise.race([
    sent.then(
      () => '',
      (e) => (e instanceof Error ? e.message : String(e))
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve(''), wait)),
  ]);
}
