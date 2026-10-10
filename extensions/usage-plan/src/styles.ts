// Panel styles. Colours come from Nimbalyst's theme variables, so the panel follows the app theme.
export const CSS = `
.up { --up-tone: var(--nim-success); display: flex; flex-direction: column; gap: 18px; height: 100%; box-sizing: border-box;
  padding: 14px 14px 16px; overflow-y: auto; font-size: 13px; line-height: 1.35; color: var(--nim-text); }
.up *, .up *::before { box-sizing: border-box; }
.up .success { --up-tone: var(--nim-success); }
.up .warning { --up-tone: var(--nim-warning); }
.up .error { --up-tone: var(--nim-error); }
.up .info { --up-tone: var(--nim-primary); }
.up-sym { font-size: 16px; line-height: 1; }

.up-head { display: flex; align-items: center; justify-content: space-between; }
.up-title { font-size: 14px; font-weight: 600; }
.up-iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0;
  border: 0; border-radius: 6px; background: transparent; color: var(--nim-text-faint); cursor: pointer; }
.up-iconbtn:hover { background: var(--nim-bg-tertiary); color: var(--nim-text); }
.up-iconbtn:disabled { cursor: default; }
.up-spin { animation: up-spin 0.9s linear infinite; }
@keyframes up-spin { to { transform: rotate(360deg); } }

.up-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.up-name { font-weight: 600; }
.up-sub { font-size: 11px; color: var(--nim-text-faint); }
.up-pct { font-size: 18px; font-weight: 700; line-height: 1.1; text-align: right; color: var(--up-tone); font-variant-numeric: tabular-nums; }
.up-used { font-size: 10px; text-align: right; color: var(--up-tone); }
.up-bar { position: relative; height: 6px; margin: 8px 0 7px; border-radius: 3px; background: var(--nim-bg-tertiary); }
.up-fill { height: 100%; border-radius: 3px; background: var(--up-tone); transition: width 0.3s; }
.up-tick { position: absolute; top: -2px; width: 2px; height: 10px; margin-left: -1px; border-radius: 1px; background: var(--nim-text-muted); }
.up-meta { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--nim-text-faint); }
.up-meta .up-sym { font-size: 13px; }
.up-meta.alert { color: var(--nim-error); }

.up-card { border: 1px solid var(--nim-border); border-radius: 10px; background: var(--nim-bg-secondary); }
.up-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.up-item + .up-item, .up-stats { border-top: 1px solid var(--nim-border); }
.up-badge { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px;
  color: var(--up-tone); background: color-mix(in srgb, var(--up-tone) 14%, transparent); }
.up-badge .up-sym { font-size: 18px; }
.up-label { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--nim-text-faint); }
.up-value { font-weight: 600; }
.up-note { font-size: 11px; color: var(--nim-text-faint); }

.up-stats { display: flex; }
.up-stat { flex: 1; padding: 9px 12px; }
.up-stat + .up-stat { border-left: 1px solid var(--nim-border); }
.up-num { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.up-num small { font-size: 10px; font-weight: 400; color: var(--nim-text-faint); }
.up-num.over { color: var(--nim-error); }

.up-foot { display: flex; flex-direction: column; gap: 8px; margin-top: auto; }
.up-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 7px 10px; border-radius: 8px;
  border: 1px solid var(--nim-border); background: var(--nim-bg-secondary); color: var(--nim-text); font: inherit; font-size: 12px; cursor: pointer; }
.up-btn:hover { background: var(--nim-bg-tertiary); }
.up-btn:disabled { color: var(--nim-text-faint); cursor: default; }
.up-updated { font-size: 11px; color: var(--nim-text-faint); }
.up-error { font-size: 12px; color: var(--nim-error); white-space: pre-wrap; overflow-wrap: anywhere; }
.up-empty { color: var(--nim-text-muted); }
.up-group { display: flex; flex-direction: column; gap: 10px; }
.up-who { display: grid; grid-template-columns: 1fr 40px 40px; align-items: baseline; gap: 4px 8px; }
.up-col { text-align: right; font-size: 10px; color: var(--nim-text-faint); }
.up-who-num { text-align: right; font-variant-numeric: tabular-nums; }
.up-dim { color: var(--nim-text-faint); }

#usage-plan-popover { position: fixed; z-index: 10000; width: 290px; max-height: calc(100vh - 16px); overflow-y: auto;
  border: 1px solid var(--nim-border); border-radius: 12px; background: var(--nim-bg); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4); }
#usage-plan-popover .up { height: auto; }
`;
