import React from "react";
import { AbsoluteFill, interpolateColors, useCurrentFrame } from "remotion";
import { accent, color, FLOOR, MARGIN, mono, TYPE } from "./look";
import { FPS, Part, PARTS, TICKS, timeline } from "./script";

// The calm kit. Every shot follows the same rules: the headline is there from the first frame in one place, one
// thing moves at a time, an element lands within about a second and then stays put, nothing flashes, and the
// background never changes colour.

/** The time inside a shot, in ticks, 24 to the second. */
export const useTick = (): number => (useCurrentFrame() * TICKS) / FPS;

/** Seconds in ticks, so a shot can say "at 1.5 s" plainly. */
export const sec = (s: number): number => s * TICKS;

export const clamp = (x: number, low = 0, high = 1): number => Math.min(high, Math.max(low, x));

/** Eases out over `len` ticks: quick at first, then settling. */
export const ease = (t: number, at: number, len: number): number => 1 - Math.pow(1 - clamp((t - at) / len), 3);

/** Eases in and out over `len` ticks, for something travelling from one place to the next. */
export const glide = (t: number, at: number, len: number): number => {
  const x = clamp((t - at) / len);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** One colour turning into another as `x` runs from 0 to 1. */
export const mix = (from: string, to: string, x: number): string => interpolateColors(clamp(x), [0, 1], [from, to]);

/** How long a fade takes: 0.4 s. */
export const FADE = sec(0.4);

/** Fades its children in over `len` ticks from tick `at`, and stays. */
export const Fade: React.FC<{ at?: number; len?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ at = 0, len = FADE, style, children }) => {
  const t = useTick();
  return <div style={{ opacity: ease(t, at, len), ...style }}>{children}</div>;
};

/** The film's background, edge to edge, in the film's one typeface. */
export const Field: React.FC<{ style?: React.CSSProperties; children: React.ReactNode }> = ({ style, children }) => (
  <AbsoluteFill style={{ background: color.bg, color: color.text, fontFamily: mono, overflow: "hidden", ...style }}>{children}</AbsoluteFill>
);

/** A shot's headline, top left, with its one line below. Both are there from the first frame and never move. */
export const Head: React.FC<{ title: string; sub?: string; ink?: string }> = ({ title, sub, ink = color.faint }) => (
  <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: 64 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 22, fontSize: TYPE.head, fontWeight: 600, lineHeight: 1.1, color: color.text }}>
      <span style={{ color: ink }}>›</span>
      {title}
    </div>
    {sub ? <div style={{ fontSize: TYPE.sub, lineHeight: 1.3, marginTop: 14, marginLeft: TYPE.head * 0.6 + 22, color: color.dim }}>{sub}</div> : null}
  </div>
);

/** A number running up to its value once, over about 1.2 s, then still. */
export const Count: React.FC<{ to: number; at?: number; len?: number; suffix?: string }> = ({ to, at = 0, len = sec(1.2), suffix = "" }) => {
  const t = useTick();
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {Math.round(to * ease(t, at, len)).toLocaleString("en-US")}
      {suffix}
    </span>
  );
};

/** Text being typed at `speed` characters a tick, with a steady cursor while it runs (and after, when `cursor` is "stay"). */
export const Typed: React.FC<{ text: string; at?: number; speed?: number; cursor?: boolean | "stay" }> = ({ text, at = 0, speed = 1, cursor }) => {
  const t = useTick();
  const shown = Math.round(clamp((t - at) * speed, 0, text.length));
  const running = t >= at && shown < text.length;
  return (
    <span>
      {text.slice(0, shown)}
      {(cursor && running) || (cursor === "stay" && t >= at) ? <span style={{ opacity: 0.6 }}>▌</span> : null}
    </span>
  );
};

/** A small outlined label that fades in at `at`. Upright and its own size: no tilt, no scale. */
export const Stamp: React.FC<{ at: number; text: string; ink: string; size?: number; style?: React.CSSProperties }> = ({ at, text, ink, size = TYPE.body, style }) => {
  const t = useTick();
  return (
    <span
      style={{
        display: "inline-block",
        whiteSpace: "nowrap",
        fontSize: size,
        fontWeight: 600,
        color: ink,
        border: `2px solid ${ink}`,
        borderRadius: size * 0.16,
        padding: "0.1em 0.42em",
        lineHeight: 1.2,
        opacity: ease(t, at, FADE),
        ...style,
      }}
    >
      {text}
    </span>
  );
};

/** A small square in a chapter's colour, the kind of mark accents are for. */
export const Dot: React.FC<{ ink: string; size?: number; style?: React.CSSProperties }> = ({ ink, size = 12, style }) => (
  <span style={{ display: "inline-block", width: size, height: size, borderRadius: 2, background: ink, flexShrink: 0, ...style }} />
);

/** A window with a thin outline and a small label on top, placed by absolute position. */
export const Window: React.FC<{ label?: string; labelInk?: string; edge?: string; style?: React.CSSProperties; bodyStyle?: React.CSSProperties; children: React.ReactNode }> = ({
  label,
  labelInk = color.dim,
  edge = color.line,
  style,
  bodyStyle,
  children,
}) => (
  <div style={{ position: "absolute", background: color.window, color: color.text, border: `2px solid ${edge}`, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", ...style }}>
    {label !== undefined ? <div style={{ fontSize: TYPE.label, color: labelInk, padding: "14px 28px", borderBottom: `1px solid ${color.line}`, whiteSpace: "nowrap" }}>{label}</div> : null}
    <div style={{ padding: "22px 28px", flex: 1, position: "relative", overflow: "hidden", ...bodyStyle }}>{children}</div>
  </div>
);

export type Point = { x: number; y: number };

/** A point along the gentle S-curve `Wire` draws from `a` to `b`, at share `p` of the way. */
export const along = (a: Point, b: Point, p: number): Point => {
  const mid = (a.x + b.x) / 2;
  const u = 1 - p;
  const x = u * u * u * a.x + 3 * u * u * p * mid + 3 * u * p * p * mid + p * p * p * b.x;
  const y = u * u * u * a.y + 3 * u * u * p * a.y + 3 * u * p * p * b.y + p * p * p * b.y;
  return { x, y };
};

/** A line drawing itself from `a` to `b` as `draw` runs from 0 to 1: straight across when they're level, an S-curve
 * when they're not. Coordinates are the frame's own, 1920x1080. */
export const Wire: React.FC<{ a: Point; b: Point; draw: number; ink: string; width?: number; dashed?: boolean }> = ({ a, b, draw, ink, width = 3, dashed }) => {
  const mid = (a.x + b.x) / 2;
  const d = `M ${a.x} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`;
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
      {dashed ? (
        <path d={d} fill="none" stroke={ink} strokeWidth={width} strokeDasharray="10 10" opacity={clamp(draw * 3)} />
      ) : (
        <path d={d} fill="none" stroke={ink} strokeWidth={width} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - clamp(draw)} />
      )}
    </svg>
  );
};

/** The chapter bar along the bottom edge: a small "2/6 Checks" label and six thin segments. The label fades over quietly when the chapter changes. */
export const Rail: React.FC = () => {
  const frame = useCurrentFrame();
  const items = timeline();
  // Each segment runs from a chapter's first shot to its last, so the chapters must come in PARTS order, each in one run.
  const order = items.map((item) => item.part).filter((p, i, all): p is Part => p !== null && p !== all[i - 1]);
  if (order.join() !== PARTS.join()) throw new Error(`The shots reach the chapters as ${order.join(", ")}, not as PARTS: ${PARTS.join(", ")}.`);
  const now = [...items].reverse().find((item) => item.from <= frame) ?? items[0];
  if (now.part === null) return null;
  const part = now.part;
  const start = (p: Part) => items.find((item) => item.part === p)!.from;
  const end = (p: Part) => {
    const last = [...items].reverse().find((item) => item.part === p)!;
    return last.from + last.frames;
  };
  const shown = clamp((frame - start(part)) / ((FADE * FPS) / TICKS));
  return (
    <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: FLOOR + 18, display: "flex", alignItems: "center", gap: 10, fontFamily: mono, fontSize: 22, color: color.dim }}>
      <div style={{ width: 230, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 12, opacity: shown }}>
        <Dot ink={accent[part]} size={10} />
        {PARTS.indexOf(part) + 1}/{PARTS.length} {part}
      </div>
      {PARTS.map((p) => {
        const done = clamp((frame - start(p)) / (end(p) - start(p)));
        return (
          <div key={p} style={{ flex: 1, height: 3, background: color.line }}>
            <div style={{ height: 3, width: `${done * 100}%`, background: p === part ? accent[p] : color.faint }} />
          </div>
        );
      })}
    </div>
  );
};
