// Panel styles. Everything derives from the shared tokens (../../shared/tokens.css, bundled by index.tsx),
// so the panel follows the app theme and the Ink shell's type. One accent: the bar's fill; red only
// when the forecast runs out.
export const CSS = `
.up { --up-tone: var(--x-success); display: flex; flex-direction: column; gap: var(--x-space-4); height: 100%; box-sizing: border-box;
  padding: var(--x-space-4); overflow-y: auto; font: var(--x-body); color: var(--x-text); }
.up *, .up *::before { box-sizing: border-box; }
.up .success { --up-tone: var(--x-success); }
.up .warning { --up-tone: var(--x-warning); }
.up .error { --up-tone: var(--x-error); }
.up-sym { font-size: 16px; line-height: 1; font-variation-settings: var(--x-icon-settings); }

.up-head { display: flex; align-items: center; gap: var(--x-space-2); }
.up-title { flex: 1; font: var(--x-title); }
.up-busy { font: var(--x-caption); color: var(--x-text-muted); }
.up-iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0;
  border-radius: var(--x-radius-control); background: transparent; color: var(--x-text-muted); cursor: pointer;
  transition: background var(--x-motion-fast) var(--x-ease); }
.up-iconbtn:hover { background: var(--x-overlay-hover); color: var(--x-text); }
.up-iconbtn:focus-visible { outline: none; box-shadow: var(--x-focus-ring); }
.up-iconbtn:active { background: var(--x-overlay-selected); box-shadow: inset 0 1px 0 var(--x-hairline); }
.up-iconbtn:disabled { color: var(--x-text-muted); cursor: default; background: transparent; box-shadow: none; }

/* A limit: label and reset time on one line, the figure big, then the bar and the time left */
.up-group { display: flex; flex-direction: column; gap: var(--x-space-3); }
.up-group + .up-group { padding-top: var(--x-space-4); border-top: 1px solid var(--x-hairline); }
.up-limit { display: flex; flex-direction: column; }
.up-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--x-space-2); }
.up-label { font: var(--x-caption); font-weight: 550; color: var(--x-text-muted); }
.up-figline { display: flex; align-items: baseline; gap: var(--x-space-1); margin-top: 2px; }
.up-fig { font: 600 32px/36px var(--x-font-ui); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.up-limit.small .up-fig { font: var(--x-figure); }
.up-unit { font: var(--x-caption); color: var(--x-text-muted); margin-left: 3px; }
.up-cap { font: var(--x-caption); color: var(--x-text-muted); }

/* The bar: a track with the fill drawn by scaleX, and the labelled tick for the time that has passed.
   8px for the week, 4px for the 5-hour window. */
.up-bar { --up-h: 8px; position: relative; height: calc(var(--up-h) + 8px); margin-top: var(--x-space-2); }
.up-limit.small .up-bar { --up-h: 4px; }
.up-track { position: absolute; top: 4px; left: 0; right: 0; height: var(--up-h); overflow: hidden; border-radius: calc(var(--up-h) / 2); background: var(--x-surface-3); }
.up-fill { width: 100%; height: 100%; background: var(--x-accent); transform-origin: left; transition: transform var(--x-motion-base) var(--x-ease); }
.up-fill.error { background: var(--x-error); }
.up-tick { position: absolute; top: 0; width: 2px; height: 100%; margin-left: -1px; border-radius: 1px; background: var(--x-text); }
.up-tick::after { content: ''; position: absolute; inset: -2px -6px; }
.up-now { position: relative; height: 14px; margin-bottom: var(--x-space-1); font: var(--x-micro); color: var(--x-text-muted); }
.up-now span { position: absolute; top: 0; transform: translateX(-50%); }

/* The forecast: one tinted line in the tone's colour, then budget and pace side by side */
.up-forecast { display: flex; align-items: baseline; gap: var(--x-space-2); padding: var(--x-space-2) var(--x-space-3);
  border-radius: var(--x-radius-control); background: color-mix(in oklab, var(--up-tone) 12%, transparent); }
.up-verdict { font-weight: 550; }
.up-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--up-tone); transform: translateY(-1px); }
.up-stats { display: grid; grid-template-columns: 1fr 1fr; gap: var(--x-space-2); }
.up-stat { display: flex; flex-direction: column; gap: 2px; padding: var(--x-space-2) var(--x-space-3); border-radius: var(--x-radius-control); background: var(--x-surface-1); }
.up-stat-fig { font: var(--x-figure); font-variant-numeric: tabular-nums; }
.up-stat.warning .up-stat-fig { color: var(--x-warning); }
.up-stat.error .up-stat-fig { color: var(--x-error); }
.up-num { font-variant-numeric: tabular-nums; }

/* Other limits (per model and the like): name, reset, figure on one row */
.up-extras { display: flex; flex-direction: column; }
.up-extra { display: grid; grid-template-columns: auto 1fr auto; align-items: baseline; gap: var(--x-space-2); min-height: 28px; }
.up-extra .up-num { font-weight: 550; }

.up-foot { display: flex; flex-direction: column; gap: var(--x-space-2); margin-top: auto; }
.up-btn { display: flex; align-items: center; justify-content: center; gap: var(--x-space-2); width: 100%; height: 36px; padding: 0 var(--x-space-3);
  border: 1px solid var(--x-hairline); border-radius: var(--x-radius-control); background: transparent; color: var(--x-text); font: var(--x-body); cursor: pointer;
  transition: background var(--x-motion-fast) var(--x-ease); }
.up-btn:hover { background: var(--x-overlay-hover); }
.up-btn:focus-visible { outline: none; box-shadow: var(--x-focus-ring); }
.up-btn:active { background: var(--x-overlay-selected); box-shadow: inset 0 1px 0 var(--x-hairline); }
.up-btn:disabled { color: var(--x-text-muted); cursor: default; background: transparent; box-shadow: none; }
.up-btn .up-sym { color: var(--x-text-muted); }
.up-error { display: flex; align-items: center; justify-content: space-between; gap: var(--x-space-2); font: var(--x-caption); color: var(--x-error); }
.up-error button { flex: none; height: 28px; padding: 0 var(--x-space-3); border: 1px solid var(--x-hairline); border-radius: var(--x-radius-control);
  background: transparent; color: var(--x-text); font: var(--x-caption); cursor: pointer; }
.up-error button:hover { background: var(--x-overlay-hover); }
.up-error button:focus-visible { outline: none; box-shadow: var(--x-focus-ring); }
.up-empty { color: var(--x-text-muted); }

#usage-plan-popover { position: fixed; z-index: 10000; width: 320px; max-height: calc(100vh - 16px); overflow-y: auto;
  border: 1px solid var(--x-hairline); border-radius: var(--x-radius-window); background: var(--x-surface-0); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
  animation: up-rise var(--x-motion-base) var(--x-ease); }
#usage-plan-popover:focus { outline: none; }
#usage-plan-popover .up { height: auto; }
@keyframes up-rise { from { opacity: 0; transform: translateY(4px); } }
`;
