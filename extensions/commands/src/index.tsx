/**
 * Commands: the setup's utility commands as buttons, in a popover next to a gutter button.
 *
 * The list, the call a button makes and the press logic are in commands.ts. This file only draws them.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PanelHostProps } from "@nimbalyst/extension-sdk";
import { launcher, visible } from "./commands";
import { installPopover, removePopover } from "./popover";
import { CSS } from "./styles";
import "../../shared/tokens.css";
import "./chat-wrap.css";
import "./note.css";
import { t } from "./strings";
import { NoteBridge } from "./host";

// The popover has no panel host, so the open project comes from the app's own window value.
const openProject = () =>
  (window as unknown as { workspacePath?: string; __workspacePath?: string })
    .workspacePath ??
  (window as unknown as { __workspacePath?: string }).__workspacePath ??
  "";

const Sym = ({ name }: { name: string }) => (
  <span className="material-symbols-outlined cb-sym" aria-hidden="true">
    {name}
  </span>
);

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The whole view. With a host it is the sidebar panel; without one, the popover. */
function CommandsPanel({ host }: Partial<PanelHostProps>) {
  const s = useSyncExternalStore(launcher.subscribe, launcher.get);
  const [hint, setHint] = useState("");
  const commands = visible(host?.workspacePath ?? openProject());
  const rows = useRef(new Map<string, HTMLElement>());
  const cancel = useRef<HTMLButtonElement>(null);
  const asked = useRef("");

  // The question takes the focus (on Cancel, so a double click cannot confirm it); closing it gives the focus back to the row
  useEffect(() => {
    if (s.asking) {
      asked.current = s.asking;
      cancel.current?.focus();
    } else if (asked.current) {
      rows.current.get(asked.current)?.focus();
      asked.current = "";
    }
  }, [s.asking]);

  return (
    <div className="cb" data-command-buttons>
      <style>{CSS}</style>
      <div className="cb-title">{t.title}</div>
      <div className="cb-list">
        {commands.map((c) => {
          const at = s.started[c.id];
          if (s.asking === c.id) {
            return (
              <div
                key={c.id}
                className="cb-ask"
                data-asking
                role="group"
                aria-label={c.label}
                onKeyDown={(e) => e.key === "Escape" && launcher.cancel()}
              >
                <Sym name={c.icon} />
                <div className="cb-ask-text">
                  <div>{c.label}</div>
                  <div className="cb-ask-note">{t.askAgain(clock(at))}</div>
                </div>
                <button
                  ref={cancel}
                  className="cb-btn"
                  onClick={() => launcher.cancel()}
                >
                  {t.cancel}
                </button>
                <button
                  className="cb-btn primary"
                  onClick={() => launcher.confirm(c)}
                >
                  {t.again}
                </button>
              </div>
            );
          }
          return (
            <button
              key={c.id}
              ref={(el) =>
                void (el
                  ? rows.current.set(c.id, el)
                  : rows.current.delete(c.id))
              }
              className="cb-row"
              aria-disabled={s.starting !== ""}
              onClick={() => launcher.press(c)}
              onMouseEnter={() => setHint(c.note)}
              onMouseLeave={() => setHint("")}
              onFocus={() => setHint(c.note)}
              onBlur={() => setHint("")}
            >
              <Sym name={c.icon} />
              <span className="cb-label">{c.label}</span>
              {s.starting === c.id ? (
                <span className="cb-status">{t.starting}</span>
              ) : (
                at && (
                  <span className="cb-status" title={t.startedHint}>
                    <span className="cb-dot" />
                    {t.started(clock(at))}
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
      <div className="cb-hint">{hint || t.subtitle}</div>
      {s.error && (
        <div className="cb-error" role="alert">
          {s.error}
        </div>
      )}
    </div>
  );
}

export function activate() {
  installPopover(() => <CommandsPanel />, t.title);
}

export function deactivate() {
  removePopover();
}

// The app reads `panels` when it loads the extension, so the button opens the popover from the
// first click even if the app only activates the extension when its panel is opened.
if (typeof window !== "undefined")
  installPopover(() => <CommandsPanel />, t.title);

export const panels = {
  commands: { component: CommandsPanel },
};

export const hostComponents = { NoteBridge };
