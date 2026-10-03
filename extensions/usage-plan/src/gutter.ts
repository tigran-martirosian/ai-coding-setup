// The week's percent as a ring on the gutter button, like Nimbalyst's own usage buttons.
//
// Nimbalyst draws an extension's gutter button itself, from the manifest icon: it keeps a panel's
// `gutterButton` export but never renders it (read from the app's code, 2026-10-02). So the ring is
// a style rule on that button. None of the app's elements are touched, and if the app ever changes
// its button the plain icon simply stays.

// (.ts in the path so the test can load this file with plain node)
import { weekTone } from './format.ts';
import type { Plan, Tone } from './format.ts';

// The colours of the app's own usage rings.
const COLOR: Record<Tone, string> = { success: '#22c55e', warning: '#eab308', error: '#ef4444' };
const RING = 2 * Math.PI * 12;
export const BUTTON = 'button[data-panel-id*="usageplan"]';
const STYLE_ID = 'usage-plan-gutter-ring';

/** The style rules for the ring, or '' while there are no numbers (the plain icon shows). */
export function gutterCss(plan: Plan | null): string {
  if (plan?.status !== 'ok' || !plan.week) return '';
  const used = Math.max(0, Math.min(100, plan.week.used));
  const arc =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='12' fill='none' ` +
    `stroke='${COLOR[weekTone(plan)]}' stroke-width='3' stroke-linecap='round' stroke-dasharray='${RING.toFixed(2)}' ` +
    `stroke-dashoffset='${(RING * (1 - used / 100)).toFixed(2)}' transform='rotate(-90 16 16)'/></svg>`;
  const track = 'radial-gradient(circle closest-side, transparent 10.25px, var(--nim-bg-tertiary) 10.75px 13.25px, transparent 13.75px)';
  return [
    `${BUTTON} > .material-symbols-outlined { display: none; }`,
    `${BUTTON}::before { content: ""; position: absolute; inset: 2px; pointer-events: none; background: url("data:image/svg+xml,${encodeURIComponent(arc)}") center / 100% 100% no-repeat, ${track}; }`,
    `${BUTTON}::after { content: "${Math.round(plan.week.used)}%"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; font-size: 9px; font-weight: 600; line-height: 1; color: var(--nim-text); }`,
    `${BUTTON}.active::after { color: inherit; }`,
  ].join('\n');
}

export function paintGutter(plan: Plan | null) {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  const css = gutterCss(plan);
  if (style.textContent !== css) style.textContent = css;
}

export function clearGutter() {
  document.getElementById(STYLE_ID)?.remove();
}
