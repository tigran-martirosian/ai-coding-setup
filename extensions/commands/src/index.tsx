/**
 * Commands: the setup's utility commands as buttons, in a popover next to a gutter button.
 *
 * The list and the call a button makes are in commands.ts. This file only draws them.
 */

import { useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { run, visible } from './commands';
import type { Command } from './commands';
import { installPopover, removePopover } from './popover';
import { CSS } from './styles';

type Api = { invoke: (channel: string, args: unknown) => Promise<unknown> };
const api = () => (window as unknown as { electronAPI: Api }).electronAPI;
// The popover has no panel host, so the open project comes from the app's own window value.
const openProject = () => (window as unknown as { workspacePath?: string; __workspacePath?: string }).workspacePath ?? (window as unknown as { __workspacePath?: string }).__workspacePath ?? '';

const Sym = ({ name }: { name: string }) => (
  <span className="material-symbols-outlined cb-sym" aria-hidden="true">
    {name}
  </span>
);

/** The whole view. With a host it is the sidebar panel; without one, the popover. */
function CommandsPanel({ host }: Partial<PanelHostProps>) {
  const [busy, setBusy] = useState('');
  const [started, setStarted] = useState<string[]>([]);
  const [error, setError] = useState('');
  const commands = visible(host?.workspacePath ?? openProject());

  const press = async (command: Command) => {
    setBusy(command.id);
    setError('');
    const refused = await run(command, (channel, args) => api().invoke(channel, args));
    setBusy('');
    if (refused) setError(refused);
    else setStarted((ids) => [...ids, command.id]);
  };

  return (
    <div className="cb" data-command-buttons>
      <style>{CSS}</style>
      <div className="cb-head">
        <div className="cb-title">Commands</div>
        <div className="cb-sub">Each one starts a new session in this project</div>
      </div>
      <div className="cb-list">
        {commands.map((c) => {
          const done = started.includes(c.id);
          return (
            <button key={c.id} className={`cb-item ${done ? 'started' : ''}`} disabled={busy !== '' || done} onClick={() => press(c)} title={c.prompt}>
              <span className="cb-badge">
                <Sym name={done ? 'check' : c.icon} />
              </span>
              <div>
                <div className="cb-label">{c.label}</div>
                <div className="cb-note">{busy === c.id ? 'Starting…' : done ? 'Started: see the sessions list' : c.note}</div>
              </div>
            </button>
          );
        })}
      </div>
      {error && <div className="cb-error">{error}</div>}
    </div>
  );
}

export function activate() {
  installPopover(() => <CommandsPanel />);
}

export function deactivate() {
  removePopover();
}

// The app reads `panels` when it loads the extension, so the button opens the popover from the
// first click even if the app only activates the extension when its panel is opened.
if (typeof window !== 'undefined') installPopover(() => <CommandsPanel />);

export const panels = {
  commands: { component: CommandsPanel },
};
