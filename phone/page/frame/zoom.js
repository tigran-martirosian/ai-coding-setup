// Pinch zoom only on the session's chat; every other screen stays put: no pinch, no double-tap zoom, no dragging
// the zoomed page around (user, 2026-11-16: "you can zoom into the chat, but everything else ... I'm breaking the
// app"). Three layers, as the iPhone web view honours each in different places: the viewport tag's scale limits,
// `touch-action` on the page (page.css, html / html.zoomable), and WebKit's gesture events cancelled while locked.

export const LOCKED =
  "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
export const OPEN =
  "width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover";

let open = false;

// Called on every drawn screen: true lets the page zoom, false snaps it back to scale 1 and locks it.
export function setZoom(allow) {
  const tag = document.querySelector('meta[name="viewport"]');
  if (!tag) throw new Error("The page has no viewport tag to lock zoom with.");
  open = Boolean(allow);
  tag.setAttribute("content", open ? OPEN : LOCKED);
  document.documentElement.classList.toggle("zoomable", open);
}

// Once at start-up: cancels WebKit's pinch gestures and two-finger moves while the screen is locked.
export function lockGestures() {
  const stop = (e) => {
    if (!open) e.preventDefault();
  };
  document.addEventListener("gesturestart", stop, { passive: false });
  document.addEventListener("gesturechange", stop, { passive: false });
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!open && e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
}
