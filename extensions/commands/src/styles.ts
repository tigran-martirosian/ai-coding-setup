// Panel styles. Everything derives from the shared tokens (../../shared/tokens.css, bundled by index.tsx),
// so the panel follows the app theme and the Ink shell's type.
export const CSS = `
.cb { display: flex; flex-direction: column; gap: var(--x-space-2); height: 100%; box-sizing: border-box; padding: var(--x-space-3) var(--x-space-2) var(--x-space-2);
  overflow-y: auto; font: var(--x-body); color: var(--x-text); }
.cb *, .cb *::before { box-sizing: border-box; }
.cb-sym { font-size: 16px; line-height: 1; font-variation-settings: var(--x-icon-settings); color: var(--x-text-muted); }

.cb-title { padding: 0 var(--x-space-2); font: var(--x-title); }

.cb-list { display: flex; flex-direction: column; gap: var(--x-space-1); }
.cb-row { display: flex; align-items: center; gap: var(--x-space-2); width: 100%; min-height: 36px; padding: 0 var(--x-space-2); border: 0;
  border-radius: var(--x-radius-control); background: transparent; color: var(--x-text); font: var(--x-body); text-align: left; cursor: pointer;
  transition: background var(--x-motion-fast) var(--x-ease); }
.cb-row:hover { background: var(--x-overlay-hover); }
.cb-row:focus-visible { outline: none; box-shadow: var(--x-focus-ring); }
.cb-row:active { background: var(--x-overlay-selected); box-shadow: inset 0 1px 0 var(--x-hairline); }
.cb-row[aria-disabled='true'] { color: var(--x-text-muted); cursor: default; background: transparent; box-shadow: none; }
.cb-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-status { display: inline-flex; align-items: center; gap: var(--x-space-2); flex: none; font: var(--x-caption); color: var(--x-text-muted); }
.cb-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--x-success); }

.cb-ask { display: flex; align-items: center; gap: var(--x-space-2); padding: var(--x-space-2); border-radius: var(--x-radius-control); background: var(--x-surface-1);
  border: 1px solid var(--x-hairline); }
.cb-ask-text { flex: 1; min-width: 0; }
.cb-ask-note { font: var(--x-caption); color: var(--x-text-muted); }
.cb-btn { flex: none; height: 28px; padding: 0 var(--x-space-3); border: 1px solid var(--x-hairline); border-radius: var(--x-radius-control); background: transparent;
  color: var(--x-text); font: var(--x-caption); cursor: pointer; transition: background var(--x-motion-fast) var(--x-ease); }
.cb-btn:hover { background: var(--x-overlay-hover); }
.cb-btn:focus-visible { outline: none; box-shadow: var(--x-focus-ring); }
.cb-btn:active { background: var(--x-overlay-selected); box-shadow: inset 0 1px 0 var(--x-hairline); }
.cb-btn.primary { border-color: transparent; background: var(--x-accent); color: var(--x-on-accent); }
.cb-btn.primary:hover { background: color-mix(in oklab, var(--x-accent), var(--x-on-accent) 12%); }

.cb-hint { min-height: 32px; padding: 0 var(--x-space-2); font: var(--x-caption); color: var(--x-text-muted); }
.cb-error { padding: 0 var(--x-space-2); font: var(--x-caption); color: var(--x-error); white-space: pre-wrap; overflow-wrap: anywhere; }

#command-buttons-popover { position: fixed; z-index: 10000; width: 320px; max-height: calc(100vh - 16px); overflow-y: auto;
  border: 1px solid var(--x-hairline); border-radius: var(--x-radius-window); background: var(--x-surface-0); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
  animation: cb-rise var(--x-motion-base) var(--x-ease); }
#command-buttons-popover:focus { outline: none; }
#command-buttons-popover .cb { height: auto; }
@keyframes cb-rise { from { opacity: 0; transform: translateY(4px); } }
`;
