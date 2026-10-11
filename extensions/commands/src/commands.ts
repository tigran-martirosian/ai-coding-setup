// The buttons, and the one call a button makes.
//
// A button starts a new session in the open project with the command as its first message. The app
// has no call that reaches a session that is already running (read from the app's code, 2026-10-03),
// so /handoff, /ask and /btw, which belong to a running chat, are not here.

import { HIDE, OWN } from './own.ts';
import { t } from './strings.ts';

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
  { id: 'board-cleanup', label: t.commands.boardCleanup.label, prompt: '/board-cleanup', note: t.commands.boardCleanup.note, icon: 'mop' },
  { id: 'next-move', label: t.commands.nextMove.label, prompt: '/next-move', note: t.commands.nextMove.note, icon: 'navigation' },
  { id: 'project-scan', label: t.commands.projectScan.label, prompt: '/project-scan', note: t.commands.projectScan.note, icon: 'troubleshoot' },
  { id: 'setup-audit', label: t.commands.setupAudit.label, prompt: '/setup-audit', note: t.commands.setupAudit.note, icon: 'fact_check' },
  { id: 'usage-report', label: t.commands.usageReport.label, prompt: '/usage-report', note: t.commands.usageReport.note, icon: 'bar_chart' },
  { id: 'chat-review', label: t.commands.chatReview.label, prompt: '/chat-review', note: t.commands.chatReview.note, icon: 'forum', only: 'claude-settings' },
  { id: 'full-review', label: t.commands.fullReview.label, prompt: '/full-review', note: t.commands.fullReview.note, icon: 'rate_review', only: 'claude-settings' },
  ...(SHARE ? [] : OWN),
  { id: 'new-project', label: t.commands.newProject.label, prompt: '/new-project', note: t.commands.newProject.note, icon: 'create_new_folder' },
  { id: 'update-setup', label: t.commands.updateSetup.label, prompt: '/update-setup', note: t.commands.updateSetup.note, icon: 'system_update_alt' },
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
