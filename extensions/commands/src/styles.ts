// Panel styles. Everything derives from the shared tokens (../../shared/tokens.css, bundled by index.tsx),
// so the panel follows the app theme and the Ink shell's type.
export const CSS = `
.cb { display: flex; flex-direction: column; gap: var(--x-space-2); height: 100%; box-sizing: border-box; padding: var(--x-space-3) var(--x-space-2) var(--x-space-2);
  overflow-y: auto; font: var(--x-body); color: var(--x-text); }
.cb *, .cb *::before { box-sizing: border-box; }
.cb-sym { font-size: 16px; line-height: 1; font-variation-settings: var(--x-icon-settings); color: var(--x-text-muted); }

/* The title and the hint line are styled here only: the Ink theme no longer sets them */
.cb-title { padding: 0 var(--x-space-2); font: var(--x-title); }

.cb-list { display: flex; flex-direction: column; }
/* Groups are set apart by a hairline with 8 px above and below it, and have no heading (DESIGN.md, the Commands exception) */
.cb-group { display: flex; flex-direction: column; gap: var(--x-space-1); }
.cb-group + .cb-group { margin-top: var(--x-space-2); padding-top: var(--x-space-2); border-top: 1px solid var(--x-hairline); }
.cb-row { display: flex; align-items: center; gap: var(--x-space-2); width: 100%; min-height: 36px; padding: 0 var(--x-space-2); border: 0;
  border-radius: var(--x-radius-control); background: transparent; color: var(--x-text); font: var(--x-body); text-align: left; cursor: pointer;
  transition: background var(--x-motion-fast) var(--x-ease); }
.cb-row:hover { background: var(--x-overlay-hover); }
.cb-row:focus-visible { outline: none; box-shadow: var(--x-focus-ring); }
.cb-row:active { background: var(--x-overlay-selected); box-shadow: inset 0 1px 0 var(--x-hairline); }
.cb-row[aria-disabled='true'] { color: var(--x-text-muted); cursor: default; background: transparent; box-shadow: none; }
.cb-label { flex: 1; font: var(--x-row-title); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-status { display: inline-flex; align-items: center; gap: var(--x-space-2); flex: none; font: var(--x-meta); color: var(--x-text-muted); }
.cb-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--x-success); }

/* A disclosure row (DESIGN.md, Rows and lists): aria-expanded is the hook. While open, the row and its options
   share one block raised by tone; the options are dense rows whose names start under the row's name */
.cb-pick { display: flex; flex-direction: column; gap: var(--x-space-1); border-radius: var(--x-radius-control); }
.cb-pick:has(> [aria-expanded='true']) { background: var(--x-surface-1); }
.cb-arrow { transition: transform var(--x-motion-base) var(--x-ease); }
.cb-row[aria-expanded='true'] .cb-arrow { transform: rotate(180deg); }
.cb-options { display: flex; flex-direction: column; gap: var(--x-space-1); }
.cb-option { min-height: 28px; padding-left: calc(var(--x-space-2) * 2 + 16px); }

.cb-ask { display: flex; align-items: center; gap: var(--x-space-2); padding: var(--x-space-2); border-radius: var(--x-radius-control); background: var(--x-surface-1);
  border: 1px solid var(--x-hairline); }
.cb-ask-text { flex: 1; min-width: 0; font: var(--x-row-title); }
.cb-ask-note { font: var(--x-meta); color: var(--x-text-muted); }
.cb-btn { flex: none; height: var(--x-control-height); padding: 0 var(--x-space-3); border: 1px solid var(--x-hairline); border-radius: var(--x-radius-control); background: transparent;
  color: var(--x-text); font: var(--x-row-title); cursor: pointer; transition: background var(--x-motion-fast) var(--x-ease); }
.cb-btn:hover { background: var(--x-overlay-hover); }
.cb-btn:focus-visible { outline: none; box-shadow: var(--x-focus-ring); }
.cb-btn:active { background: var(--x-overlay-selected); box-shadow: inset 0 1px 0 var(--x-hairline); }
.cb-btn.primary { border-color: transparent; background: var(--x-accent); color: var(--x-on-accent); }
.cb-btn.primary:hover { background: color-mix(in oklab, var(--x-accent), var(--x-on-accent) 12%); }

.cb-hint { min-height: 32px; padding: 0 var(--x-space-2); font: var(--x-meta); color: var(--x-text-muted); }
.cb-error { padding: 0 var(--x-space-2); font: var(--x-meta); color: var(--x-state-failed); white-space: pre-wrap; overflow-wrap: anywhere; }

#command-buttons-popover { position: fixed; z-index: 10000; width: 320px; max-height: calc(100vh - 16px); overflow-y: auto;
  border: 1px solid var(--x-hairline); border-radius: var(--x-radius-window); background: var(--x-surface-0); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
  animation: cb-rise var(--x-motion-base) var(--x-ease); }
#command-buttons-popover:focus { outline: none; }
#command-buttons-popover .cb { height: auto; }
@keyframes cb-rise { from { opacity: 0; transform: translateY(4px); } }
`;
