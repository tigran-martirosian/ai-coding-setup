import React from "react";
import { Camera, Count, ease, Field, Head, LOG_LINES, pop, Ring, Rise, SOFT_EDGES, useTick } from "./kit";
import { color, FLOOR, MARGIN, mono, partColor, sans, TIGHT } from "./look";
import { COMMANDS, Shot, THEMES } from "./script";
import { need } from "./need";

const yellow = partColor.Tools;

/** Six tools hit the frame on a beat, from alternating sides, until it is full. */
export const Everyday: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { tiles } = need(shot.body, "tiles");
  return (
    <Field bg={yellow.bg} on={yellow.on}>
      <Camera jolts={tiles.map((_, i) => ({ at: 2 + i * 7, size: 5 }))}>
        <Head title={shot.title} size={100} style={{ top: 36 }} />
        <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: 180, bottom: 1080 - FLOOR + 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 14 }}>
          {tiles.map((tile, i) => {
            const land = pop(t, 2 + i * 7);
            const dark = i % 2 === 0;
            return (
              <div key={tile.name} style={{ background: dark ? color.ink : color.paper, color: dark ? color.white : color.ink, borderRadius: 16, padding: "26px 32px", display: "flex", flexDirection: "column", justifyContent: "flex-end", transform: `translateX(${(1 - land) * (i % 2 ? 1500 : -1500)}px)`, visibility: t < 2 + i * 7 ? "hidden" : "visible" }}>
                <div style={{ fontFamily: tile.name.startsWith("/") ? mono : sans, fontSize: 80, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, whiteSpace: "nowrap" }}>{tile.name}</div>
                <div style={{ fontSize: 50, fontWeight: 500, marginTop: 12, lineHeight: 1.08 }}>{tile.note}</div>
              </div>
            );
          })}
        </div>
      </Camera>
    </Field>
  );
};

const HIT = 25;

/** Four commands, one hard cut each. The fastest stretch of the film. */
export const Audits: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { rows } = need(shot.body, "rows");
  const i = Math.min(rows.length - 1, Math.floor(t / HIT));
  const row = rows[i];
  const at = i * HIT;
  const light = i % 2 === 1;
  const bg = light ? yellow.bg : color.ink;
  const on = light ? color.ink : color.white;
  return (
    <Field bg={bg} on={on}>
      <Camera drift={2}>
        <Head title={shot.title} size={72} style={{ top: 44 }} />
        <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: 300 }}>
          <div style={{ fontFamily: mono, fontSize: 190, fontWeight: 600, letterSpacing: "-0.06em", lineHeight: 1, whiteSpace: "nowrap", color: light ? color.ink : color.yellow, transform: `scale(${1.14 - pop(t, at) * 0.14})`, transformOrigin: "0 50%" }}>{row.text}</div>
          <div style={{ fontSize: 92, fontWeight: 700, letterSpacing: TIGHT, lineHeight: 1.04, marginTop: 34 }}>
            <Rise key={i} text={row.note ?? ""} at={at} gap={0.5} />
          </div>
        </div>
      </Camera>
    </Field>
  );
};

const FILES = ["sources.md", "findings.md", "HANDOFF.md", "DECISIONS.md", "CLAUDE.md", "notes.md", "input.csv", "output.csv"];

/** Four folders in from the corners, their contents running inside. */
export const Projects: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { tiles } = need(shot.body, "tiles");
  const tints = [color.ink, color.paper, color.ink, color.paper];
  return (
    <Field bg={yellow.bg} on={yellow.on}>
      <Camera>
        <Head title={shot.title} size={100} style={{ top: 36 }} />
        <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: 180, bottom: 1080 - FLOOR + 8, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 18 }}>
          {tiles.map((tile, i) => {
            const land = pop(t, i * 1.5);
            const dark = tints[i] === color.ink;
            return (
              <div key={tile.name} style={{ position: "relative", transform: `translate(${(1 - land) * (i % 2 ? 1100 : -1100)}px, ${(1 - land) * (i < 2 ? -500 : 500)}px)` }}>
                <div style={{ position: "absolute", left: 0, top: 0, width: 300, height: 60, background: tints[i], borderRadius: "14px 14px 0 0" }} />
                <div style={{ position: "absolute", inset: "36px 0 0 0", background: tints[i], color: dark ? color.white : color.ink, borderRadius: "0 14px 14px 14px", padding: "20px 32px", overflow: "hidden" }}>
                  <div style={{ position: "absolute", right: 28, top: 14, fontFamily: mono, fontSize: 28, lineHeight: "40px", color: dark ? "#55555c" : "#b5b4ae", textAlign: "right", transform: `translateY(${-((t * 3) % 40)}px)` }}>
                    {Array.from({ length: 10 }, (_, r) => (
                      <div key={r}>{FILES[(r + i * 3 + Math.floor((t * 3) / 40)) % FILES.length]}</div>
                    ))}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 68, fontWeight: 600, letterSpacing: "-0.04em", position: "relative" }}>{tile.name}</div>
                  <div style={{ fontSize: 52, fontWeight: 500, lineHeight: 1.08, marginTop: 14, position: "relative", maxWidth: 590 }}>{tile.note}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Camera>
    </Field>
  );
};

const THEME_TICKS = 9;

/** The editor itself, flipping through all eleven themes while its panels run. */
export const Editor: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { tiles } = need(shot.body, "tiles");
  const theme = THEMES[Math.min(THEMES.length - 1, Math.floor(t / THEME_TICKS))];
  const pitch = 44;
  const moved = t * 2;
  const first = Math.floor(moved / pitch);
  const panel: React.CSSProperties = { background: theme.panel, borderRadius: 16, padding: "22px 28px", position: "relative", overflow: "hidden" };
  const name: React.CSSProperties = { fontSize: 66, fontWeight: 700, letterSpacing: TIGHT, lineHeight: 1 };
  const note: React.CSSProperties = { fontSize: 42, fontWeight: 500, color: theme.muted, marginTop: 8, lineHeight: 1.08 };
  return (
    <Field bg={theme.bg} on={theme.text}>
      <Camera>
        <Head title={shot.title} size={100} style={{ top: 36 }} />
        <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: 176, bottom: 1080 - FLOOR + 8, display: "grid", gridTemplateColumns: "1fr 1.1fr 1.1fr", gridTemplateRows: "1fr 1fr", gap: 14 }}>
          <div style={{ ...panel, gridRow: "1 / 3", display: "flex", flexDirection: "column", transform: `translateY(${(1 - pop(t, 0)) * 900}px)` }}>
            <div style={name}>{tiles[0].name}</div>
            <div style={note}>{tiles[0].note}</div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Ring share={0.74 * ease(t, 2, 40)} size={420} stroke={46} ink={theme.primary} track={theme.bg}>
                <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: TIGHT }}>
                  <Count to={74} at={2} len={40} suffix="%" />
                </div>
              </Ring>
            </div>
          </div>
          <div style={{ ...panel, gridRow: "1 / 3", transform: `translateY(${(1 - pop(t, 2)) * 900}px)` }}>
            <div style={name}>{tiles[1].name}</div>
            <div style={note}>{tiles[1].note}</div>
            <div style={{ marginTop: 20 }}>
              {COMMANDS.map((command, i) => {
                const on = pop(t, 10 + i * 2);
                return (
                  <div key={command} style={{ fontSize: 44, fontWeight: 700, padding: "9px 18px", marginBottom: 7, borderRadius: 10, background: Math.floor(t / 8) % 7 === i ? theme.primary : theme.bg, color: Math.floor(t / 8) % 7 === i ? (theme.name === "Noir" ? "#101010" : "#ffffff") : theme.text, transform: `translateX(${(1 - on) * 500}px)`, whiteSpace: "nowrap" }}>
                    {command}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ ...panel, transform: `translateY(${(1 - pop(t, 4)) * -900}px)` }}>
            <div style={name}>{tiles[2].name}</div>
            <div style={note}>{tiles[2].note}</div>
            <div style={{ position: "absolute", left: 28, right: 28, top: 186, bottom: 12, fontFamily: mono, fontSize: 28, lineHeight: `${pitch}px`, color: theme.muted, overflow: "hidden", ...SOFT_EDGES }}>
              <div style={{ transform: `translateY(${-(moved % pitch)}px)` }}>
                {Array.from({ length: 8 }, (_, r) => (
                  <div key={r}>{LOG_LINES[(first + r) % LOG_LINES.length]}</div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ ...panel, background: theme.primary, color: theme.name === "Noir" ? "#101010" : "#ffffff", transform: `translateY(${(1 - pop(t, 6)) * 900}px)` }}>
            <div style={name}>{tiles[3].name}</div>
            <div style={{ ...note, color: "inherit" }}>{tiles[3].note}</div>
            <div style={{ position: "absolute", left: 28, bottom: 16, fontSize: 96, fontWeight: 700, letterSpacing: TIGHT }}>{theme.name}</div>
          </div>
        </div>
      </Camera>
    </Field>
  );
};
