// The panel as a small popover next to the gutter button, the same way Usage Plan does it.
//
// Nimbalyst opens a sidebar panel by switching to Files mode, which leaves the sessions list (read
// from the app's code, 2026-10-02). So the click on the gutter button is caught before the app sees
// it and the same view is drawn in a popover instead. If the app ever changes its button, the click
// goes through and the sidebar panel opens as before.

import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

export const BUTTON = 'button[data-panel-id*="commandbuttons"]';
const ID = 'command-buttons-popover';
const GAP = 8;

let view: (() => ReactNode) | undefined;
let root: Root | undefined;
let box: HTMLDivElement | undefined;
let sized: ResizeObserver | undefined;
let anchored: Element | undefined;

const button = (target: EventTarget | null) => (target instanceof Element ? target.closest(BUTTON) : null);

function place(anchor: Element) {
  if (!box) return;
  const r = anchor.getBoundingClientRect();
  box.style.left = `${Math.round(r.right + GAP)}px`;
  box.style.top = `${Math.round(Math.max(GAP, Math.min(r.top, window.innerHeight - box.offsetHeight - GAP)))}px`;
}

export function closePopover() {
  sized?.disconnect();
  root?.unmount();
  box?.remove();
  sized = root = box = anchored = undefined;
}

function open(anchor: Element) {
  anchored = anchor;
  box = document.createElement('div');
  box.id = ID;
  document.body.appendChild(box);
  root = createRoot(box);
  root.render(view!());
  place(anchor);
  sized = new ResizeObserver(() => place(anchor));
  sized.observe(box);
}

function onClick(e: MouseEvent) {
  const anchor = button(e.target);
  if (!anchor || !view) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (box) closePopover();
  else open(anchor);
}

function onDown(e: MouseEvent) {
  if (box && !button(e.target) && !(e.target instanceof Node && box.contains(e.target))) closePopover();
}

const onResize = () => {
  if (anchored) place(anchored);
};

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') closePopover();
};

export function installPopover(render: () => ReactNode) {
  if (view) return;
  view = render;
  window.addEventListener('click', onClick, true);
  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
}

export function removePopover() {
  closePopover();
  view = undefined;
  window.removeEventListener('click', onClick, true);
  window.removeEventListener('mousedown', onDown, true);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
}
