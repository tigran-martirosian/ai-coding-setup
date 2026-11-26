/**
 * Commands: the setup's utility commands as buttons, in a popover next to a gutter button.
 *
 * The list, the call a button makes and the press logic are in commands.ts. This file only draws them.
 */

import type { PanelHostProps } from "@nimbalyst/extension-sdk";
// Host-provided module, kept out of the bundle by the SDK's vite config; it ships no types, so the two calls are typed below.
// biome-ignore format: @ts-expect-error covers only the next line, so the import stays on one line
// @ts-expect-error no type declarations for @nimbalyst/runtime
import { clearTranscriptMarkdownContributions, setTranscriptMarkdownContributions } from "@nimbalyst/runtime";
import type { ComponentType, KeyboardEvent, RefObject } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Command, LauncherState } from "./commands";
import {
  escCloses,
  grouped,
  launcher,
  newestStart,
  togglePick,
  visible,
} from "./commands";
import { installPopover, removePopover } from "./popover";
import { CSS } from "./styles";
import "../../shared/tokens.css";
import "./chat-wrap.css";
import "./note.css";
import "./copy-row.css";
import "./diff-comments.css";
import {
  COPY_TAG,
  CopyRow,
  rehypeCopyRow,
  stopWatchingTurns,
} from "./copy-row";
import { NoteBridge } from "./host";
import { setExtensionFolder } from "./note";
import { t } from "./strings";

const SOURCE = "com.local.commandbuttons";

const setContribution: (
  source: string,
  contribution: {
    rehypePlugins: unknown[];
    components: Record<string, ComponentType<any>>;
  },
) => void = setTranscriptMarkdownContributions;
const clearContribution: (source: string) => void =
  clearTranscriptMarkdownContributions;

// The popover has no panel host, so the open project comes from the app's own window value.
const openProject = () =>
  (window as unknown as { workspacePath?: string; __workspacePath?: string })
    .workspacePath ??
  (window as unknown as { __workspacePath?: string }).__workspacePath ??
  "";

const Sym = ({ name, arrow }: { name: string; arrow?: boolean }) => (
  <span
    className={`material-symbols-outlined cb-sym${arrow ? " cb-arrow" : ""}`}
    aria-hidden="true"
  >
    {name}
  </span>
);

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** What the list's buttons do; the panel gives the real ones, a test its own. */
export interface ListActions {
  press: (c: Command) => void;
  /** Opens or closes a row's pick. */
  toggle: (c: Command) => void;
  confirm: (c: Command) => void;
  cancel: () => void;
  /** Esc on a row of a pick or in a question box. */
  esc: (e: KeyboardEvent) => void;
  hint: (text: string) => void;
  row: (id: string, el: HTMLElement | null) => void;
  cancelRef: RefObject<HTMLButtonElement | null>;
}

/** The list as it looks for one state: `open` is the id of the row whose pick is open, or "". */
export function CommandsView({
  path,
  s,
  open,
  hint,
  act,
}: {
  path: string;
  s: LauncherState;
  open: string;
  hint: string;
  act: ListActions;
}) {
  const commands = visible(path);
  const disabled = s.starting !== "";
  const status = (c: Command) => {
    const at = s.started[c.id];
    if (s.starting === c.id)
      return <span className="cb-status">{t.starting}</span>;
    return (
      at && (
        <span className="cb-status" title={t.startedHint}>
          <span className="cb-dot" />
          {t.started(clock(at))}
        </span>
      )
    );
  };
  // The question box takes the place of the row it asks about
  const ask = (c: Command) => (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings its own border and padding; the group role keeps the look
    <div
      key={c.id}
      className="cb-ask"
      data-asking
      role="group"
      aria-label={c.label}
    >
      {c.icon && <Sym name={c.icon} />}
      <div className="cb-ask-text">
        <div>{c.label}</div>
        <div className="cb-ask-note">{t.askAgain(clock(s.started[c.id]))}</div>
      </div>
      <button
        type="button"
        ref={act.cancelRef}
        className="cb-btn"
        onClick={act.cancel}
      >
        {t.cancel}
      </button>
      <button
        type="button"
        className="cb-btn primary"
        onClick={() => act.confirm(c)}
      >
        {t.again}
      </button>
    </div>
  );
  const row = (c: Command, option = false) =>
    s.asking === c.id ? (
      ask(c)
    ) : (
      <button
        type="button"
        key={c.id}
        ref={(el) => act.row(c.id, el)}
        className={option ? "cb-row cb-option" : "cb-row"}
        aria-disabled={disabled}
        onClick={() => act.press(c)}
        onMouseEnter={() => act.hint(c.note)}
        onMouseLeave={() => act.hint("")}
        onFocus={() => act.hint(c.note)}
        onBlur={() => act.hint("")}
      >
        {c.icon && <Sym name={c.icon} />}
        <span className="cb-label">{c.label}</span>
        {status(c)}
      </button>
    );
  // A disclosure row: it sends nothing, it opens its options under it in place
  const pick = (c: Command, options: Command[]) => {
    const isOpen = open === c.id;
    const block = `cb-${c.id}-options`;
    const starting = options.find((o) => o.id === s.starting);
    const newest = newestStart(options, s.started);
    return (
      <div key={c.id} className="cb-pick">
        <button
          type="button"
          ref={(el) => act.row(c.id, el)}
          className="cb-row"
          aria-disabled={disabled}
          aria-expanded={isOpen}
          aria-controls={isOpen ? block : undefined}
          onClick={() => act.toggle(c)}
          onMouseEnter={() => act.hint(c.note)}
          onMouseLeave={() => act.hint("")}
          onFocus={() => act.hint(c.note)}
          onBlur={() => act.hint("")}
        >
          {c.icon && <Sym name={c.icon} />}
          <span className="cb-label">{c.label}</span>
          {/* Closed, it shows its options' start, so a start is never hidden */}
          {!isOpen &&
            (starting ? (
              <span className="cb-status">{t.starting}</span>
            ) : (
              newest && (
                <span
                  className="cb-status"
                  title={t.startedOption(newest.option.label, clock(newest.at))}
                >
                  <span className="cb-dot" />
                  {t.started(clock(newest.at))}
                </span>
              )
            ))}
          <Sym name="expand_more" arrow />
        </button>
        {isOpen && (
          <div id={block} className="cb-options">
            {options.map((o) => row(o, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    // One Esc handler for the whole list, so Esc works wherever the focus is in it
    // biome-ignore lint/a11y/noStaticElementInteractions: it only catches Esc bubbling up from the rows inside
    <div className="cb" data-command-buttons onKeyDown={act.esc}>
      <style>{CSS}</style>
      <div className="cb-title">{t.title}</div>
      <div className="cb-list">
        {grouped(commands).map((group) => (
          <div key={group[0].group} className="cb-group">
            {group.map((c) =>
              c.pick ? pick(c, visible(path, c.pick)) : row(c),
            )}
          </div>
        ))}
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

/** The whole view. With a host it is the sidebar panel; without one, the popover. */
export function CommandsPanel({ host }: Partial<PanelHostProps>) {
  const s = useSyncExternalStore(
    launcher.subscribe,
    launcher.get,
    launcher.get,
  );
  const [hint, setHint] = useState("");
  // The open pick lives here, not in the launcher: a popover closed and opened again shows it closed
  const [open, setOpen] = useState("");
  const path = host?.workspacePath ?? openProject();
  const rows = useRef(new Map<string, HTMLElement>());
  const cancelRef = useRef<HTMLButtonElement>(null);
  const asked = useRef("");

  // The question takes the focus (on Cancel, so a double click cannot confirm it); closing it gives the focus back to the row
  useEffect(() => {
    if (s.asking) {
      asked.current = s.asking;
      cancelRef.current?.focus();
    } else if (asked.current) {
      rows.current.get(asked.current)?.focus();
      asked.current = "";
    }
  }, [s.asking]);

  // A pick that closes takes its open question with it, also when the popover closes
  const dropQuestionOf = (id: string) => {
    const c = visible(path).find((c) => c.id === id);
    if (c?.pick?.some((o) => o.id === launcher.get().asking)) launcher.cancel();
  };
  const openRef = useRef(open);
  openRef.current = open;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on unmount, with the pick open then
  useEffect(() => () => dropQuestionOf(openRef.current), []);

  const act: ListActions = {
    press: (c) => void launcher.press(c),
    toggle: (c) => {
      const next = togglePick(open, c.id, s);
      if (next === open) return;
      if (open) dropQuestionOf(open);
      setOpen(next);
    },
    confirm: (c) => void launcher.confirm(c),
    cancel: () => launcher.cancel(),
    esc: (e) => {
      if (e.key !== "Escape") return;
      const what = escCloses(s, open !== "");
      if (!what) return;
      e.stopPropagation();
      if (what === "question") launcher.cancel();
      else {
        rows.current.get(open)?.focus();
        setOpen("");
      }
    },
    hint: setHint,
    row: (id, el) =>
      void (el ? rows.current.set(id, el) : rows.current.delete(id)),
    cancelRef,
  };

  return <CommandsView path={path} s={s} open={open} hint={hint} act={act} />;
}

export function activate(context: { extensionPath: string }) {
  // Nimbalyst activates the extension as it loads it, before any button can be pressed
  setExtensionFolder(context.extensionPath);
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

/**
 * Mounted by the app once (the manifest names it NoteBridge): the Note button, plus the copy row under replies
 * through the transcript markdown contribution. Its styles come with dist/index.css (copy-row.css above).
 */
function ChatHost() {
  useEffect(() => {
    setContribution(SOURCE, {
      rehypePlugins: [rehypeCopyRow],
      components: { [COPY_TAG]: CopyRow },
    });
    return () => {
      clearContribution(SOURCE);
      stopWatchingTurns();
    };
  }, []);
  return <NoteBridge />;
}

export const hostComponents = { NoteBridge: ChatHost };
