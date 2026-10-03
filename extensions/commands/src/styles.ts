// Panel styles. Colours come from Nimbalyst's theme variables, so the panel follows the app theme.
export const CSS = `
.cb { display: flex; flex-direction: column; gap: 10px; height: 100%; box-sizing: border-box; padding: 14px 10px 12px;
  overflow-y: auto; font-size: 13px; line-height: 1.35; color: var(--nim-text); }
.cb *, .cb *::before { box-sizing: border-box; }
.cb-sym { font-size: 18px; line-height: 1; }

.cb-head { padding: 0 4px; }
.cb-title { font-size: 14px; font-weight: 600; }
.cb-sub { font-size: 11px; color: var(--nim-text-faint); }

.cb-list { display: flex; flex-direction: column; gap: 2px; }
.cb-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px; border: 0; border-radius: 8px;
  background: transparent; color: var(--nim-text); font: inherit; text-align: left; cursor: pointer; }
.cb-item:hover { background: var(--nim-bg-tertiary); }
.cb-item:disabled { cursor: default; }
.cb-badge { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px;
  color: var(--nim-primary); background: color-mix(in srgb, var(--nim-primary) 14%, transparent); }
.cb-item.started .cb-badge { color: var(--nim-success); background: color-mix(in srgb, var(--nim-success) 14%, transparent); }
.cb-label { font-weight: 600; }
.cb-note { font-size: 11px; color: var(--nim-text-faint); }
.cb-error { padding: 0 4px; font-size: 12px; color: var(--nim-error); white-space: pre-wrap; overflow-wrap: anywhere; }

#command-buttons-popover { position: fixed; z-index: 10000; width: 290px; max-height: calc(100vh - 16px); overflow-y: auto;
  border: 1px solid var(--nim-border); border-radius: 12px; background: var(--nim-bg); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4); }
#command-buttons-popover .cb { height: auto; }
`;
