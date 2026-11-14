// Source of orbs.js: a plain-script mount (no React) for the thinking-orbs 0.3.2 drawing engine (MIT, Jakub Antalik).
// Build with `node build.mjs`: it fetches the package and bundles this file with it ("thinking-orbs-chunk" is
// the package's dist/index-B8WsUNf5.js, mapped by the build).
//
// Use: <script src="orbs.js"></script>, then <canvas data-orb="searching" data-orb-px="24"></canvas>.
// The ink is the canvas's CSS `color`; --orb-dark must be 1 on dark themes and 0 on light ones (tokens.css sets
// both). --orb-dot-size / --orb-dots (or data-orb-dot-size / data-orb-dots) scale the dots, data-orb-speed scales
// the speed, data-orb-still draws one still frame, data-orb-size="64" takes the large design.
// One copy runs per window: a second load of this file only scans for new canvases.
import {
  M as MODE_FRAMES,
  p as paintFrame,
  r as resolvePreset,
  s as scaleCounts,
  a as scaleRadii,
} from "thinking-orbs-chunk";

const VERSION = "0.3.2";
const STATES = [
  "working",
  "searching",
  "solving",
  "listening",
  "connecting",
  "weaving",
  "composing",
  "breathing",
  "shaping",
];

if (window.Orbs) {
  if (window.Orbs.version !== VERSION)
    console.error(
      `orbs.js: version ${VERSION} loaded where version ${window.Orbs.version} already runs; the first one is kept`,
    );
  window.Orbs.scan();
} else {
  const orbs = new Set();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const probe = document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });

  // The canvas's computed `color` as r, g, b, whatever colour syntax the page used (oklab from color-mix too)
  function readInk(color) {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    if (a === 0) throw new Error(`the canvas colour "${color}" is transparent`);
    return { r, g, b };
  }

  // The page's look: dark or light, and the ink. Throws when the page does not say.
  function readLook(o) {
    const cs = getComputedStyle(o.canvas);
    const dark = cs.getPropertyValue("--orb-dark").trim();
    if (dark !== "0" && dark !== "1")
      throw new Error(
        `--orb-dark is "${dark}", must be 0 (light theme) or 1 (dark theme)`,
      );
    o.dark = dark === "1";
    o.tint = readInk(cs.color);
  }

  function number(name, value) {
    const n = +value;
    if (!Number.isFinite(n) || n <= 0)
      throw new Error(`${name} is "${value}", must be a number above 0`);
    return n;
  }

  function setup(o) {
    const c = o.canvas;
    const state = c.dataset.orb;
    if (!STATES.includes(state))
      throw new Error(
        `unknown data-orb state "${state}"; known: ${STATES.join(", ")}`,
      );
    const size =
      number("data-orb-size", c.dataset.orbSize || 20) >= 40 ? 64 : 20;
    const px = number("data-orb-px", c.dataset.orbPx || size);
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = Math.round(px * dpr);
    c.height = Math.round(px * dpr);
    c.style.width = c.style.height = px + "px";
    c.setAttribute("role", "img");
    const cs = getComputedStyle(c);
    const dots = number(
      "dots",
      c.dataset.orbDots || cs.getPropertyValue("--orb-dots").trim() || 1,
    );
    const dotSize = number(
      "dot size",
      c.dataset.orbDotSize || cs.getPropertyValue("--orb-dot-size").trim() || 1,
    );
    let { mode, speed, opts } = resolvePreset(state, size);
    if (dots !== 1) opts = scaleCounts(opts, dots);
    if (dotSize !== 1) opts = scaleRadii(opts, dotSize);
    opts = { ...opts };
    if (c.dataset.orbShape) opts.shape = +c.dataset.orbShape;
    const pace = number("data-orb-speed", c.dataset.orbSpeed || 1);
    Object.assign(o, {
      state,
      size,
      px,
      dpr,
      mode,
      speed: speed * pace,
      opts,
      still: c.hasAttribute("data-orb-still"),
    });
    readLook(o);
  }

  // Runs one step for an orb; a bad orb logs its error once and stays blank until its attributes change
  function guard(o, step) {
    try {
      step();
      o.bad = false;
    } catch (e) {
      if (!o.bad) console.error("orbs.js:", e.message, o.canvas);
      o.bad = true;
    }
  }

  function draw(o, now) {
    if (o.bad) return;
    const ctx = o.canvas.getContext("2d");
    const t = o.still || motion.matches ? 0.6 : (now / 1000) * o.speed;
    ctx.setTransform(
      (o.dpr * o.px) / o.size,
      0,
      0,
      (o.dpr * o.px) / o.size,
      0,
      0,
    );
    ctx.clearRect(0, 0, o.size, o.size);
    paintFrame(ctx, MODE_FRAMES[o.mode](o.size, t, o.opts), o.dark, o.tint);
  }

  const redo = (o) => {
    guard(o, () => setup(o));
    draw(o, performance.now());
  };
  const relook = (o) => {
    if (o.state) guard(o, () => readLook(o));
    draw(o, performance.now());
  };

  // A canvas that left the page and came back is taken up again (and redrawn), never left blank
  function mount(canvas) {
    let o = canvas.__orb;
    if (o && orbs.has(o)) return;
    if (!o) {
      o = { canvas };
      canvas.__orb = o;
    }
    orbs.add(o);
    redo(o);
  }

  function scan(root = document) {
    for (const o of orbs) if (!o.canvas.isConnected) orbs.delete(o);
    root.querySelectorAll("canvas[data-orb]").forEach(mount);
  }

  function refresh() {
    for (const o of orbs) redo(o);
  }

  function loop(now) {
    if (document.visibilityState !== "hidden" && !motion.matches)
      for (const o of orbs)
        if (!o.still && o.canvas.offsetParent !== null) draw(o, now);
    requestAnimationFrame(loop);
  }

  // A move to a screen of another pixel density redraws every orb at the new density
  function watchDensity() {
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener(
      "change",
      () => {
        refresh();
        watchDensity();
      },
      { once: true },
    );
  }

  function start() {
    scan();
    new MutationObserver((ms) => {
      let restyle = false,
        added = false;
      for (const m of ms) {
        if (m.type === "childList") {
          if (m.addedNodes.length) added = true;
          continue;
        }
        const orb = m.target.tagName === "CANVAS" && m.target.__orb;
        // The canvas's own size and style are written by setup, so they only re-read its look
        if (orb && m.attributeName.startsWith("data-orb")) redo(orb);
        else if (orb) relook(orb);
        else if (m.target.tagName !== "CANVAS") restyle = true;
      }
      if (added) scan();
      if (restyle) for (const o of orbs) relook(o);
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "class",
        "data-theme",
        "data-orb",
        "data-orb-still",
        "data-orb-speed",
        "data-orb-px",
        "data-orb-size",
        "data-orb-dot-size",
        "data-orb-dots",
        "data-orb-shape",
        "style",
      ],
    });
    motion.addEventListener("change", refresh);
    watchDensity();
    requestAnimationFrame(loop);
  }

  window.Orbs = { version: VERSION, states: STATES, scan, refresh, mount };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
}
