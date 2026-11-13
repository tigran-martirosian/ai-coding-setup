// Styles of the Usage dashboard panel. Everything derives from the shared tokens (../../shared/tokens.css), so a
// theme changes colour only. One accent; the chart's second and third series are the accent weakened and the muted
// text colour; green / yellow / red appear only as the state of a limit, always beside words.
export const DASHBOARD_CSS = `
.ud { --s1: var(--x-accent); --s2: color-mix(in oklab, var(--x-accent) 55%, var(--x-text)); --s3: color-mix(in oklab, var(--x-text-muted) 60%, var(--x-surface-0)); --s0: var(--x-surface-3);
  height: 100%; overflow-y: auto; box-sizing: border-box; background: var(--x-surface-0); color: var(--x-text); font: var(--x-body); }
.ud *, .ud *::before, .ud *::after { box-sizing: border-box; }
.ud-wrap { max-width: 1200px; padding: var(--x-space-4) var(--x-space-5) 64px; }
.ud button, .ud input { font: inherit; color: inherit; }
.ud p { margin: 0; }
.ud h1 { margin: 0; font: var(--x-title); }
.ud h2 { margin: 0; font: var(--x-title); }
.ud-muted { color: var(--x-text-muted); }
.ud .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ud .nowrap { white-space: nowrap; }
.ud .strong { font-weight: 550; }
.ud .good { color: var(--x-success); } .ud .warn { color: var(--x-warning); } .ud .bad { color: var(--x-error); }
.ud-ic { vertical-align: -1px; flex: none; }
.ud :focus-visible { outline: none; box-shadow: var(--x-focus-ring); }

/* header: title, the data's age, then the controls on the right */
.ud-top { display: flex; align-items: baseline; gap: var(--x-space-3); min-height: 36px; }
.ud-top { align-items: center; }
.ud-scope { font: var(--x-caption); }
.ud-spacer { flex: 1; }
.ud-busy { font: var(--x-caption); font-variant-numeric: tabular-nums; }
.ud-btn { height: 36px; padding: 0 var(--x-space-3); border: 1px solid var(--x-hairline); border-radius: var(--x-radius-control); background: transparent; color: var(--x-text);
  cursor: pointer; transition: background var(--x-motion-fast) var(--x-ease); }
.ud-btn:hover { background: var(--x-overlay-hover); }
.ud-btn:active { background: var(--x-overlay-selected); box-shadow: inset 0 1px 0 var(--x-hairline); }
.ud-btn:disabled { color: var(--x-text-muted); cursor: default; background: transparent; box-shadow: none; }

/* the progress of a rebuild: thin, under the header; the old data stays below it */
.ud-progress { position: relative; height: 3px; margin: var(--x-space-1) 0 var(--x-space-3); overflow: hidden; border-radius: 2px; background: var(--x-surface-3); }
.ud-progress i { position: absolute; inset: 0; background: var(--x-accent); transform-origin: left; transition: transform 500ms linear; }
.ud-progress i.indeterminate { right: auto; width: 30%; transition: none; animation: ud-slide 1.4s var(--x-ease) infinite; }
@keyframes ud-slide { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
@media (prefers-reduced-motion: reduce) { .ud-progress i.indeterminate { animation: none; width: 100%; opacity: .5; } }

.ud-error { display: flex; align-items: center; justify-content: space-between; gap: var(--x-space-3); margin-bottom: var(--x-space-3); color: var(--x-error); font: var(--x-caption); }
.ud-nodata { padding: 64px 0; display: flex; flex-direction: column; gap: var(--x-space-2); }
.ud-empty { color: var(--x-text-muted); }

/* sections: a hairline and space between groups, no cards */
.ud-sec { margin-top: var(--x-space-4); padding-top: var(--x-space-4); border-top: 1px solid var(--x-hairline); min-width: 0; }
.ud-head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--x-space-4); margin-bottom: var(--x-space-3); }
.ud-note { color: var(--x-text-muted); font: var(--x-caption); text-align: right; }
.ud-cols2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 var(--x-space-5); }
.ud-after { color: var(--x-text-muted); font: var(--x-caption); margin-top: var(--x-space-3); }
.ud-gap { margin-bottom: var(--x-space-4); }

.ud-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: var(--x-space-2); background: var(--x-surface-3); }
.ud .s1 { background: var(--s1); } .ud .s2 { background: var(--s2); } .ud .s3 { background: var(--s3); } .ud .s0 { background: var(--s0); }
.ud-dot.line { height: 4px; border-radius: 2px; background: var(--x-warning); }
.ud-legend { display: flex; gap: var(--x-space-4); flex-wrap: wrap; color: var(--x-text-muted); font: var(--x-caption); }
.ud-chartlegend { margin-bottom: var(--x-space-3); }

/* range, sum and search: they drive everything below the forecast */
.ud-controls { display: flex; gap: var(--x-space-3); align-items: center; flex-wrap: wrap; margin-top: var(--x-space-5); }
.ud-seg { display: flex; gap: 2px; padding: 2px; height: 28px; background: var(--x-surface-1); border: 1px solid var(--x-hairline); border-radius: var(--x-radius-control); }
.ud-seg button { border: 0; background: none; padding: 0 var(--x-space-3); border-radius: var(--x-radius-inner); color: var(--x-text-muted); cursor: pointer; font: var(--x-caption);
  transition: background var(--x-motion-fast) var(--x-ease); }
.ud-seg button:hover { background: var(--x-overlay-hover); color: var(--x-text); }
.ud-seg button.on { background: var(--x-surface-3); color: var(--x-text); font-weight: 550; }
.ud-controls .sum { margin-right: auto; color: var(--x-text-muted); font-variant-numeric: tabular-nums; }
.ud-controls input { height: 36px; width: 240px; padding: 0 var(--x-space-3); background: transparent; border: 1px solid var(--x-hairline); border-radius: var(--x-radius-control); }
.ud-controls input::placeholder { color: var(--x-text-muted); }
.ud-chips { display: flex; gap: var(--x-space-2); flex-wrap: wrap; margin-top: var(--x-space-3); }
.ud-chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 var(--x-space-3); border: 1px solid var(--x-accent); border-radius: var(--x-radius-control);
  background: none; color: var(--x-text); cursor: pointer; font: var(--x-caption); }
.ud-chip:hover { background: var(--x-overlay-hover); }

/* plan ahead */
.ud-plan { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--x-space-4) 48px; }
.ud-limit + .ud-limit { margin-top: var(--x-space-5); }
.ud-limit .top { display: flex; justify-content: space-between; align-items: flex-end; gap: var(--x-space-4); }
.ud-limit .name { font-weight: 550; }
.ud-limit .sub { color: var(--x-text-muted); font: var(--x-caption); }
.ud-limit .pct { font: 600 32px/36px var(--x-font-ui); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.ud-track { height: 8px; border-radius: 4px; background: var(--x-surface-3); margin: var(--x-space-2) 0; overflow: hidden; color: var(--x-accent); }
.ud .ud-track.good { color: var(--x-accent); }
.ud .ud-track.warn { color: var(--x-warning); }
.ud .ud-track.bad { color: var(--x-error); }
.ud-track i { display: block; height: 100%; border-radius: 4px; background: currentColor; }
.ud-limit .pct.good, .ud-limit .pct.warn { color: var(--x-text); }
.ud-limit .foot { display: flex; justify-content: space-between; gap: var(--x-space-4); font: var(--x-caption); color: var(--x-text-muted); }
.ud-limit .foot .bad, .ud-limit .foot .warn { font-weight: 550; }
.ud-advice { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px var(--x-space-4); margin: var(--x-space-5) 0 0; }
.ud-advice dt { color: var(--x-text-muted); white-space: nowrap; }
.ud-advice dd { margin: 0; text-wrap: pretty; }
.ud-outlook td.barcell { width: 38%; }
.ud-outlook .ud-track { margin: 0; }
.ud-outlook tr:last-child th, .ud-outlook tr:last-child td { border-bottom: 0; }

/* folds */
.ud summary { list-style: none; cursor: pointer; border-radius: var(--x-radius-control); }
.ud summary::-webkit-details-marker { display: none; }
.ud-fold > summary { display: flex; justify-content: space-between; align-items: baseline; gap: var(--x-space-4); }
.ud-fold > summary h2 { display: flex; align-items: center; }
.ud summary .ud-ic { color: var(--x-text-muted); margin-right: var(--x-space-2); transition: transform var(--x-motion-base) var(--x-ease); }
.ud details[open] > summary .ud-ic { transform: rotate(90deg); }
.ud-fold[open] > summary { margin-bottom: var(--x-space-3); }
.ud-subfold { margin-top: var(--x-space-4); padding-top: var(--x-space-3); border-top: 1px solid var(--x-hairline); }
.ud-subfold summary { color: var(--x-text-muted); }
.ud-subfold[open] summary { margin-bottom: var(--x-space-3); }
.ud-hours { display: grid; grid-template-columns: repeat(24, 1fr); gap: 3px; }
.ud-hours .hr { display: flex; flex-direction: column; min-width: 0; }
.ud-hours .col { height: 96px; display: flex; flex-direction: column; justify-content: flex-end; gap: 1px; border-bottom: 1px solid var(--s0); }
.ud-hours .hr.busy .col { background: var(--x-overlay-hover); }
.ud-hours .col i { display: block; flex: none; }
.ud-hours .mark { height: 4px; margin-top: 3px; border-radius: 2px; }
.ud-hours .hr.busy .mark { background: var(--x-warning); }
.ud-hours b { font: var(--x-micro); color: var(--x-text-muted); text-align: center; height: 22px; }

/* who used the plan */
.ud-who { display: flex; justify-content: space-between; gap: var(--x-space-5); }
.ud-who > div:last-child:not(:first-child) { text-align: right; }
.ud-who .name { color: var(--x-text-muted); }
.ud-who b { font: var(--x-figure); font-variant-numeric: tabular-nums; margin-right: var(--x-space-2); }
.ud-who .fig span { color: var(--x-text-muted); font: var(--x-caption); white-space: nowrap; }
.ud-share { display: flex; gap: 2px; height: 8px; border-radius: 4px; overflow: hidden; background: var(--x-surface-3); margin-top: var(--x-space-3); }

/* tables */
.ud-scroll { overflow-x: auto; }
.ud table { width: 100%; border-collapse: collapse; font: var(--x-caption); font-variant-numeric: tabular-nums; }
.ud th, .ud td { padding: 8px var(--x-space-3) 8px 0; text-align: left; border-bottom: 1px solid var(--x-hairline); vertical-align: middle; }
.ud th:last-child, .ud td:last-child { padding-right: 0; }
.ud thead th { font: var(--x-micro); font-weight: 400; color: var(--x-text-muted); white-space: nowrap; padding-top: 0; }
.ud thead th.num { text-align: right; }
.ud thead th .ud-dot { margin-left: var(--x-space-3); }
.ud thead th .ud-dot:first-child { margin-left: 0; }
.ud th button { display: inline-flex; align-items: center; gap: 4px; border: 0; background: none; color: inherit; cursor: pointer; padding: 0; }
.ud th button:hover, .ud th button.on { color: var(--x-text); }
.ud tbody th { font-weight: 400; white-space: nowrap; }
.ud-bar { display: block; height: 8px; min-width: 2px; border-radius: 4px; }

/* tokens per day */
.ud-chart { display: grid; grid-template-columns: 52px 1fr; }
.ud-chart .yaxis, .ud-chart .plot { position: relative; height: 130px; }
.ud-chart .yaxis span { position: absolute; right: 10px; transform: translateY(50%); font: var(--x-micro); color: var(--x-text-muted); font-variant-numeric: tabular-nums; }
.ud-chart .gridline { position: absolute; left: 0; right: 0; height: 1px; background: var(--x-hairline); }
.ud-chart .gridline.base { background: var(--s0); }
.ud-chart .days { position: absolute; inset: 0; display: flex; }
.ud-chart .day { flex: 1; min-width: 0; height: 100%; border: 0; padding: 0; background: none; cursor: pointer; display: flex; justify-content: center; align-items: flex-end;
  transition: background var(--x-motion-fast) var(--x-ease); }
.ud-chart .day:hover { background: var(--x-overlay-hover); }
.ud-chart .stack { width: 70%; max-width: 28px; min-width: 2px; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; }
.ud-chart .seg { display: block; flex: none; min-height: 2px; transition: opacity var(--x-motion-base) var(--x-ease); }
.ud-chart .seg:first-child { border-radius: 3px 3px 0 0; }
.ud-chart .days.picked .day:not(.on) .seg { opacity: .3; }
.ud-chart .xaxis { display: flex; padding-top: 6px; }
.ud-chart .xaxis span { flex: 1; min-width: 0; display: flex; justify-content: center; }
.ud-chart .xaxis b { font: var(--x-micro); color: var(--x-text-muted); white-space: nowrap; }

/* ranked lists */
.ud-rank { display: grid; grid-template-columns: minmax(90px, 170px) 1fr 64px 120px; gap: var(--x-space-3); align-items: center; width: 100%; min-height: 36px; padding: 0 var(--x-space-2);
  border: 0; border-radius: var(--x-radius-control); background: none; text-align: left; font: var(--x-caption); }
.ud button.ud-rank { cursor: pointer; transition: background var(--x-motion-fast) var(--x-ease); }
.ud button.ud-rank:hover { background: var(--x-overlay-hover); }
.ud-rank .lab { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ud-rank .val { text-align: right; font-variant-numeric: tabular-nums; font-weight: 550; }
.ud-rank .note { color: var(--x-text-muted); font: var(--x-micro); white-space: nowrap; }
.ud-rank .ud-bar { transition: opacity var(--x-motion-base) var(--x-ease); }
.ud-ranks.picked .ud-rank:not(.on) .ud-bar { opacity: .3; }
.ud-ranks.picked .ud-rank.on .lab { font-weight: 550; }

/* chats */
.ud tr.row { cursor: pointer; transition: background var(--x-motion-fast) var(--x-ease); }
.ud tr.row:hover, .ud tr.row.open { background: var(--x-overlay-hover); }
.ud td.t { max-width: 440px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ud td.t .ud-ic { color: var(--x-text-muted); margin: 0 var(--x-space-2) 0 2px; transition: transform var(--x-motion-base) var(--x-ease); }
.ud tr.open td.t .ud-ic { transform: rotate(90deg); }
.ud .split { display: flex; gap: 2px; height: 8px; min-width: 3px; border-radius: 4px; overflow: hidden; }
.ud .split i { min-width: 1px; }
.ud td.splitcell { width: 220px; }
.ud tr.detail > td { background: var(--x-surface-1); padding: var(--x-space-3) var(--x-space-4) var(--x-space-4) var(--x-space-5); }
.ud .detail .meta { color: var(--x-text-muted); font: var(--x-caption); margin-bottom: var(--x-space-2); }
.ud code { font: 12px var(--ink-mono, ui-monospace, Consolas, monospace); }
.ud .detail h3 { font: var(--x-body); font-weight: 550; margin: var(--x-space-4) 0 var(--x-space-1); }
.ud .detail ul { margin: 0; padding-left: 18px; color: var(--x-text-muted); font: var(--x-caption); }
.ud .desc { color: var(--x-text-muted); max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ud-state { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; color: var(--x-text-muted); }
.ud-state.bad { font-weight: 550; color: var(--x-error); }
.ud-more { margin-top: var(--x-space-3); height: 28px; padding: 0 var(--x-space-3); border: 1px solid var(--x-hairline); border-radius: var(--x-radius-control); background: none; cursor: pointer; font: var(--x-caption);
  transition: background var(--x-motion-fast) var(--x-ease); }
.ud-more:hover { background: var(--x-overlay-hover); }

/* the hover card of a day */
.ud-tip { position: fixed; z-index: 10000; pointer-events: none; min-width: 180px; padding: var(--x-space-2) var(--x-space-3); background: var(--x-surface-0); border: 1px solid var(--x-hairline);
  border-radius: var(--x-radius-control); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24); font: var(--x-caption); font-variant-numeric: tabular-nums; }
.ud-tip div { display: flex; justify-content: space-between; gap: var(--x-space-4); }
.ud-tip .h { font-weight: 550; margin-bottom: var(--x-space-1); }

@media (max-width: 900px) {
  .ud-wrap { padding: var(--x-space-3) var(--x-space-3) 48px; }
  .ud-cols2, .ud-plan { grid-template-columns: minmax(0, 1fr); }
  .ud-controls input { width: 100%; }
  .ud-rank { grid-template-columns: minmax(80px, 1fr) 1fr 64px; }
  .ud-rank .note { display: none; }
}
`;
