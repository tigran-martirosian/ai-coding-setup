import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { color, FLOOR, HEIGHT, MARGIN, mono, partColor, sans, TIGHT, WIDTH } from "./look";
import { FPS, Part, PARTS, TICKS, timeline } from "./script";

/** The time inside a shot, in ticks, thirty to the second. */
export const useTick = (): number => (useCurrentFrame() * TICKS) / FPS;

export const clamp = (x: number, low = 0, high = 1): number => Math.min(high, Math.max(low, x));

/** A damped spring from 0 to 1, starting at tick `at`. */
const spring = (t: number, at: number, damping: number, speed: number): number => {
  if (t <= at) return 0;
  const x = (t - at) / TICKS;
  const ringing = speed * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * speed * x) * (Math.cos(ringing * x) + ((damping * speed) / ringing) * Math.sin(ringing * x));
};
/** Lands fast and overshoots a little. */
export const pop = (t: number, at = 0): number => spring(t, at, 0.55, 30);
/** Lands fast without bouncing back. */
export const snap = (t: number, at = 0): number => spring(t, at, 0.88, 34);

/** Eases out over `len` ticks: quick at first, then settling. */
export const ease = (t: number, at: number, len: number): number => 1 - Math.pow(1 - clamp((t - at) / len), 4);

/** A shot's slow camera push, plus any jolts. Everything in a shot sits inside it, so nothing is ever still. */
export const Camera: React.FC<{ jolts?: { at: number; size: number }[]; drift?: number; origin?: string; children: React.ReactNode }> = ({ jolts = [], drift = 1, origin = "50% 45%", children }) => {
  const t = useTick();
  const jolt = jolts.reduce((sum, j) => {
    const x = t - j.at;
    return x < 0 ? sum : sum + j.size * Math.exp(-x / 5) * Math.sin(x * 1.9);
  }, 0);
  return (
    <AbsoluteFill style={{ transform: `translate(${jolt}px, ${jolt * 0.6}px) scale(${1 + t * 0.00035 * drift}) rotate(${jolt * 0.012}deg)`, transformOrigin: origin }}>
      {children}
    </AbsoluteFill>
  );
};

/** A flat colour, edge to edge. */
export const Field: React.FC<{ bg: string; on?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ bg, on = color.white, style, children }) => (
  <AbsoluteFill style={{ background: bg, color: on, fontFamily: sans, overflow: "hidden", ...style }}>{children}</AbsoluteFill>
);

/** Words rise out of a mask together, each a beat after the one before. */
export const Rise: React.FC<{ text: string; at?: number; gap?: number; style?: React.CSSProperties }> = ({ text, at = 0, gap = 1.2, style }) => {
  const t = useTick();
  return (
    <span style={style}>
      {text.split(" ").map((word, i) => (
        <React.Fragment key={i}>
          <span style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: "0.2em", marginBottom: "-0.2em", paddingRight: "0.06em", marginRight: "-0.06em" }}>
            <span style={{ display: "inline-block", transform: `translateY(${(1 - snap(t, at + i * gap)) * 118}%)` }}>{word}</span>
          </span>{" "}
        </React.Fragment>
      ))}
    </span>
  );
};

/** A shot's headline, top left, with its one line below. */
export const Head: React.FC<{ title: string; sub?: string; size?: number; at?: number; style?: React.CSSProperties; subStyle?: React.CSSProperties }> = ({ title, sub, size = 92, at = 0, style, subStyle }) => (
  <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: 56, ...style }}>
    <div style={{ fontSize: size, fontWeight: 700, lineHeight: 1.02, letterSpacing: TIGHT }}>
      <Rise text={title} at={at} />
    </div>
    {sub ? (
      <div style={{ fontSize: 38, fontWeight: 500, lineHeight: 1.2, marginTop: 14, ...subStyle }}>
        <Rise text={sub} at={at + 4} gap={0.5} />
      </div>
    ) : null}
  </div>
);

/** A number running up to its value. */
export const Count: React.FC<{ to: number; at?: number; len?: number; suffix?: string }> = ({ to, at = 0, len = 26, suffix = "" }) => {
  const t = useTick();
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {Math.round(to * ease(t, at, len)).toLocaleString("en-US")}
      {suffix}
    </span>
  );
};

/** Text being typed at a set speed, with a cursor while it runs. */
export const Typed: React.FC<{ text: string; at?: number; speed?: number; cursor?: boolean }> = ({ text, at = 0, speed = 2, cursor }) => {
  const t = useTick();
  const shown = Math.round(clamp((t - at) * speed, 0, text.length));
  const running = t >= at && shown < text.length;
  return (
    <span>
      {text.slice(0, shown)}
      {cursor && running ? <span style={{ opacity: 0.8 }}>▌</span> : null}
    </span>
  );
};

/** Cuts in big and lands in a few ticks, as a stamp does. */
export const Stamp: React.FC<{ at: number; text: string; ink: string; size?: number; tilt?: number; style?: React.CSSProperties }> = ({ at, text, ink, size = 48, tilt = -3, style }) => {
  const t = useTick();
  if (t < at) return null;
  const scale = 1 + (1 - pop(t, at)) * 1.6;
  return (
    <span
      style={{
        display: "inline-block",
        whiteSpace: "nowrap",
        fontFamily: mono,
        fontSize: size,
        fontWeight: 600,
        color: ink,
        border: `${Math.max(3, size * 0.07)}px solid ${ink}`,
        borderRadius: size * 0.12,
        padding: "0.12em 0.42em",
        lineHeight: 1.2,
        transform: `rotate(${tilt}deg) scale(${scale})`,
        ...style,
      }}
    >
      {text}
    </span>
  );
};

/** A dark window, as the tools are seen in. */
export const Window: React.FC<{ label?: string; labelInk?: string; style?: React.CSSProperties; bodyStyle?: React.CSSProperties; children: React.ReactNode }> = ({ label, labelInk = color.dim, style, bodyStyle, children }) => (
  <div style={{ background: color.window, color: color.white, borderRadius: 18, overflow: "hidden", display: "flex", flexDirection: "column", ...style }}>
    {label !== undefined ? (
      <div style={{ fontFamily: mono, fontSize: 32, color: labelInk, padding: "14px 28px", borderBottom: `2px solid ${labelInk === color.dim ? color.line : labelInk}`, whiteSpace: "nowrap" }}>{label}</div>
    ) : null}
    <div style={{ padding: "22px 28px", flex: 1, position: "relative", overflow: "hidden", ...bodyStyle }}>{children}</div>
  </div>
);

export const LOG_LINES = [
  "Read src/api/login.ts", "Grep \"rate limit\" src", "Edit src/api/limits.ts", "Bash npm test", "Read docs/api.md", "Bash git diff --stat",
  "Edit tests/login.test.ts", "Glob src/**/*.ts", "Read package.json", "Bash npm run build", "WebFetch api.example.com/docs", "Edit src/db/schema.sql",
  "Grep \"TODO\" src", "Read README.md", "Bash npm run lint", "Edit src/ui/form.tsx", "Read src/auth/session.ts", "Bash npm test -- login",
  "Edit docs/DECISIONS.md", "Read HANDOFF.md", "Agent worker: add tests", "Write src/api/login.test.ts", "Bash node --test", "Read src/db/users.sql",
];

/** Columns of the tool-call log running up the screen, behind everything. */
export const LogField: React.FC<{ tint: string; speed?: number; size?: number; columns?: number; at?: number; lines?: string[] }> = ({ tint, speed = 7, size = 30, columns = 4, lines = LOG_LINES }) => {
  const t = useTick();
  const pitch = size * 1.5;
  const rows = Math.ceil(HEIGHT / pitch) + 2;
  return (
    <AbsoluteFill style={{ fontFamily: mono, fontSize: size, color: tint, lineHeight: `${pitch}px`, whiteSpace: "nowrap", overflow: "hidden" }}>
      {Array.from({ length: columns }, (_, c) => {
        const rate = speed * (1 + (c % 3) * 0.28);
        const moved = t * rate + c * 137;
        const first = Math.floor(moved / pitch);
        return (
          <div key={c} style={{ position: "absolute", left: 24 + (c * WIDTH) / columns, top: -(moved % pitch) }}>
            {Array.from({ length: rows }, (_, r) => (
              <div key={r}>{lines[(first + r + c * 5) % lines.length]}</div>
            ))}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** One line of text running sideways across the screen, repeated so it never runs out. */
export const Marquee: React.FC<{ text: string; top: number; size: number; speed: number; tint: string; start?: number; weight?: number; font?: string }> = ({ text, top, size, speed, tint, start = 0, weight = 700, font = sans }) => {
  const t = useTick();
  return (
    <div style={{ position: "absolute", top, left: 0, whiteSpace: "nowrap", fontFamily: font, fontSize: size, fontWeight: weight, lineHeight: 1, letterSpacing: TIGHT, color: tint, transform: `translateX(${start + t * speed}px)` }}>
      {Array.from({ length: 12 }, () => text).join("   ")}
    </div>
  );
};

/** Hard-edged stripes sliding along a bar, so a bar still looks alive once it has stopped growing. */
export const Stripes: React.FC<{ tint: string; speed?: number }> = ({ tint, speed = 3 }) => {
  const t = useTick();
  const period = 62;
  return <div style={{ position: "absolute", top: 0, bottom: 0, left: -period, right: -period, background: `repeating-linear-gradient(90deg, ${tint} 0 ${period * 0.4}px, transparent ${period * 0.4}px ${period}px)`, transform: `translateX(${((t * speed) % period) - period / 2}px) skewX(-25deg)` }} />;
};

/** A ring filling up, for the week's use. */
export const Ring: React.FC<{ share: number; size: number; stroke: number; ink: string; track: string; children?: React.ReactNode }> = ({ share, size, stroke, ink, track, children }) => {
  const r = (size - stroke) / 2;
  const around = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ink} strokeWidth={stroke} strokeDasharray={`${around * share} ${around}`} />
      </svg>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>{children}</AbsoluteFill>
    </div>
  );
};

/** Fades running text out at the top and bottom of its window, so no line is ever seen cut in half. */
export const SOFT_EDGES: React.CSSProperties = { maskImage: "linear-gradient(to bottom, transparent, black 26px, black calc(100% - 26px), transparent)" };

/** The chapter bar: six short segments along the bottom edge and the name of the one playing. */
export const Rail: React.FC = () => {
  const frame = useCurrentFrame();
  const items = timeline();
  const now = [...items].reverse().find((item) => item.from <= frame) ?? items[0];
  const hidden = now.id === "title" || now.id === "end" || now.id.startsWith("chapter-");
  if (hidden) return null;
  const part = now.part as Part;
  const on = now.shot?.id === "catch" || now.shot?.id === "editor" ? color.white : partColor[part].on;
  const start = (p: Part) => items.find((item) => item.part === p)!.from;
  const end = (p: Part) => {
    const last = [...items].reverse().find((item) => item.part === p)!;
    return last.from + last.frames;
  };
  return (
    <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: FLOOR + 14, display: "flex", alignItems: "center", gap: 10, fontFamily: mono, fontSize: 24, color: on, mixBlendMode: now.shot?.id === "editor" ? "difference" : "normal" }}>
      <div style={{ width: 190, whiteSpace: "nowrap" }}>
        {PARTS.indexOf(part) + 1}/6 {part}
      </div>
      {PARTS.map((p) => {
        const done = clamp((frame - start(p)) / (end(p) - start(p)));
        return (
          <div key={p} style={{ flex: 1, height: 6, background: `${on}33` }}>
            <div style={{ height: 6, width: `${done * 100}%`, background: on }} />
          </div>
        );
      })}
    </div>
  );
};
