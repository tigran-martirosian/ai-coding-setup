import React from "react";
import { AbsoluteFill } from "remotion";
import { Camera, clamp, Count, Field, Head, LogField, Marquee, pop, Rise, SOFT_EDGES, snap, useTick } from "./kit";
import { color, MARGIN, mono, TIGHT } from "./look";
import { AGENTS, ALONE_LABEL, EXTENSIONS, HOOKS, PROJECTS, RULES, SETUP_LABEL, Shot, SKILLS } from "./script";
import { need } from "./need";

/** Three hard cuts on the problem, then the name. The first words are up before the viewer has settled. */
export const Title: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { lines } = need(shot.body, "open");
  const [name, what] = shot.title.split(/ (?=for )/);
  const [first, second, third] = lines;
  if (t < 28)
    return (
      <Field bg={color.ink}>
        <LogField tint="#34343a" speed={16} />
        <Camera drift={2.5} origin="0% 50%">
          <div style={{ position: "absolute", left: MARGIN, top: 150, right: 200, fontSize: 290, fontWeight: 700, lineHeight: 0.96, letterSpacing: TIGHT }}>
            <Rise text={first} at={-5} gap={1.5} />
          </div>
        </Camera>
      </Field>
    );
  if (t < 62)
    return (
      <Field bg={color.red}>
        <LogField tint="#ff6a43" speed={20} />
        <Camera drift={2.5} origin="0% 50%">
          <div style={{ position: "absolute", left: MARGIN, top: 96, right: 120, fontSize: 250, fontWeight: 700, lineHeight: 0.96, letterSpacing: TIGHT }}>
            <Rise text={second} at={28} gap={1.5} />
          </div>
        </Camera>
      </Field>
    );
  if (t < 88)
    return (
      <Field bg={color.paper} on={color.ink}>
        <Camera drift={2.5} origin="0% 50%">
          <div style={{ position: "absolute", left: MARGIN, top: 240, right: 120, fontSize: 280, fontWeight: 700, lineHeight: 0.96, letterSpacing: TIGHT }}>
            <Rise text={third} at={62} gap={1.4} />
          </div>
        </Camera>
      </Field>
    );
  const land = pop(t, 88);
  return (
    <Field bg={color.blue}>
      <Marquee text={HOOKS.slice(0, 8).join("  ")} top={22} size={120} speed={-22} tint="#3a57ff" weight={700} />
      <Marquee text={HOOKS.slice(8, 16).join("  ")} top={160} size={120} speed={18} start={-1800} tint="#3a57ff" weight={700} />
      <Marquee text={HOOKS.slice(16).join("  ")} top={800} size={120} speed={-20} tint="#3a57ff" weight={700} />
      <Marquee text={SKILLS.join("  ")} top={938} size={120} speed={16} start={-2200} tint="#3a57ff" weight={700} />
      <Camera drift={1} origin="0% 50%">
        <AbsoluteFill style={{ justifyContent: "center", padding: `0 ${MARGIN}px`, transform: `scale(${1.25 - land * 0.25})`, transformOrigin: "0% 50%" }}>
          <div style={{ fontSize: 232, fontWeight: 700, lineHeight: 0.98, letterSpacing: TIGHT, whiteSpace: "nowrap" }}>
            {name}
            <br />
            <span style={{ fontSize: 150 }}>{what}</span>
          </div>
        </AbsoluteFill>
      </Camera>
    </Field>
  );
};

const STEP = 24;
const LEAD_IN = 8;
const CELLS = [
  { bg: color.red, on: color.white, names: HOOKS },
  { bg: color.lime, on: color.ink, names: SKILLS },
  { bg: color.yellow, on: color.ink, names: EXTENSIONS },
  { bg: color.paper, on: color.ink, names: PROJECTS },
  { bg: color.violet, on: color.white, names: AGENTS },
  { bg: color.ink, on: color.white, names: RULES },
];

const NameList: React.FC<{ names: string[]; on: string; open: number }> = ({ names, on, open }) => {
  const t = useTick();
  const pitch = 40;
  const runs = names.length > 8;
  const moved = runs ? t * 2.4 + 300 : 0;
  const first = Math.floor(moved / pitch);
  return (
    <div style={{ position: "absolute", right: 28, top: 22, height: 150, width: 380, overflow: "hidden", fontFamily: mono, fontSize: 28, lineHeight: `${pitch}px`, textAlign: "right", opacity: open > 0.6 ? 1 : 0, ...SOFT_EDGES }}>
      <div style={{ transform: `translateY(${-(moved % pitch)}px)`, color: on }}>
        {Array.from({ length: runs ? 20 : names.length }, (_, r) => (
          <div key={r}>{names[(first + r) % names.length]}</div>
        ))}
      </div>
    </div>
  );
};

/** Everything lands at once. Then the focus runs across the grid: each cell grows and says what it holds. */
export const Contents: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { tiles } = need(shot.body, "tiles");
  const step = (k: number) => LEAD_IN + k * STEP;
  const focus = (k: number) => snap(t, step(k)) - (k < tiles.length - 1 ? snap(t, step(k + 1)) : 0);
  const column = (c: number) => 1 + 0.95 * (focus(c) + focus(c + 3));
  const row = (r: number) => 1 + 0.75 * [0, 1, 2].reduce((sum, c) => sum + focus(c + r * 3), 0);
  return (
    <Field bg={color.blue}>
      <Camera drift={0.25}>
        <Head title={shot.title} size={96} style={{ top: 34 }} />
        <div
          style={{
            position: "absolute",
            left: MARGIN,
            right: MARGIN,
            top: 158,
            bottom: 96,
            display: "grid",
            gap: 12,
            gridTemplateColumns: `${column(0)}fr ${column(1)}fr ${column(2)}fr`,
            gridTemplateRows: `${row(0)}fr ${row(1)}fr`,
          }}
        >
          {tiles.map((tile, i) => {
            const open = clamp(focus(i));
            const land = pop(t, i * 1.5);
            const [number, ...label] = tile.name.split(" ");
            const cell = CELLS[i];
            return (
              <div key={tile.name} style={{ position: "relative", overflow: "hidden", borderRadius: 14, background: cell.bg, color: cell.on, transform: `translateY(${(1 - land) * 760}px)` }}>
                <NameList names={cell.names} on={cell.on} open={open} />
                <div style={{ position: "absolute", left: 28, bottom: 18, right: 28 }}>
                  <div style={{ fontSize: 44, fontWeight: 500, lineHeight: 1.1, height: open > 0.02 ? 56 : 0, opacity: open, whiteSpace: "nowrap" }}>{tile.note}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 18, fontWeight: 700, letterSpacing: TIGHT, lineHeight: 1 }}>
                    <span style={{ fontSize: 150 + open * 120 }}>
                      <Count to={Number(number)} at={i * 1.5} len={18} />
                    </span>
                    <span style={{ fontSize: 50 + open * 30 }}>{label.join(" ")}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Camera>
    </Field>
  );
};

const ROW = 134;

/** The whole table lands at once and stays readable. A bright band then runs down it, one row a second. */
export const Compare: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { rows } = need(shot.body, "compare");
  const split = 900;
  const place = rows.reduce((sum, _, i) => sum + (i ? snap(t, 10 + i * 30) : 0), 0);
  return (
    <Field bg={color.ink}>
      <AbsoluteFill style={{ left: split, background: color.blue }} />
      <Camera drift={0.5}>
        <Head title={shot.title} size={100} style={{ right: 1920 - split + 20 }} />
        <div style={{ position: "absolute", left: split + 40, top: 56, right: MARGIN, fontSize: 42, fontWeight: 500, lineHeight: 1.16 }}>
          <Rise text={shot.sub ?? ""} at={2} gap={0.4} />
        </div>
        <div style={{ position: "absolute", top: 228, left: MARGIN, fontFamily: mono, fontSize: 34, color: "#b7b7bd" }}>{ALONE_LABEL}</div>
        <div style={{ position: "absolute", top: 228, left: split + 40, fontFamily: mono, fontSize: 34, fontWeight: 600 }}>{SETUP_LABEL}</div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 286 + place * ROW, height: ROW, background: color.white, opacity: pop(t, 8) }} />
        {rows.map((row, i) => {
          const land = pop(t, 2 + i * 1.5);
          const lit = clamp(1 - Math.abs(i - place) * 2.5);
          const ink = (dim: string, bright: string) => (lit > 0.5 ? bright : dim);
          return (
            <div key={row.topic} style={{ position: "absolute", left: 0, right: 0, top: 286 + i * ROW, height: ROW, transform: `translateY(${(1 - land) * 700}px)` }}>
              <div style={{ position: "absolute", left: MARGIN, width: split - MARGIN - 30, top: 12, color: ink("#e4e4e8", color.ink) }}>
                <div style={{ fontFamily: mono, fontSize: 28, opacity: 0.75 }}>{row.topic}</div>
                <div style={{ fontSize: 46, fontWeight: 500, lineHeight: 1.05, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{row.alone}</div>
              </div>
              <div style={{ position: "absolute", left: split + 40, right: MARGIN - 30, top: 0, height: ROW, display: "flex", alignItems: "center", color: ink(color.white, color.blue) }}>
                <div style={{ fontSize: 50, fontWeight: 700, lineHeight: 1.02, letterSpacing: TIGHT }}>{row.setup}</div>
              </div>
            </div>
          );
        })}
      </Camera>
    </Field>
  );
};
