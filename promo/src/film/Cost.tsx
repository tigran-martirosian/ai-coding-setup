import React from "react";
import { Camera, clamp, Count, ease, Field, Head, pop, Ring, Rise, snap, SOFT_EDGES, Stripes, Typed, useTick, Window } from "./kit";
import { color, FLOOR, MARGIN, mono, partColor, TIGHT } from "./look";
import { Shot, USAGE_LABEL } from "./script";
import { need } from "./need";

const lime = partColor.Cost;

/** Two bars race; one stops almost at once. */
export const Compact: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { bars, times: multiple } = need(shot.body, "bars");
  const widest = bars[1].value;
  const full = 1920 - MARGIN * 2;
  const race = 4;
  const len = 40;
  const times = 62;
  return (
    <Field bg={lime.bg} on={lime.on}>
      <Camera jolts={[{ at: times, size: 16 }]}>
        <Head title={shot.title} size={100} />
        <div style={{ position: "absolute", left: MARGIN, top: 214, right: MARGIN }}>
          {bars.map((bar, i) => {
            const width = ((bar.value / widest) * full - 0) * ease(t, race, len);
            const value = Math.round(bar.value * ease(t, race, len));
            const big = i === 1;
            return (
              <div key={bar.name} style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 52, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  <span>{bar.name}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 72, fontWeight: 700, letterSpacing: TIGHT }}>
                    {value}
                    {bar.label}
                  </span>
                </div>
                <div style={{ position: "relative", height: 150, width, background: big ? color.red : color.ink, overflow: "hidden", borderRadius: 8 }}>
                  {big ? <Stripes tint="#ff6a43" speed={6} /> : null}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: MARGIN, right: 620, top: 800, fontSize: 50, fontWeight: 500, lineHeight: 1.12 }}>
          <Rise text={shot.sub ?? ""} at={30} gap={0.5} />
        </div>
        {t >= times ? (
          <div style={{ position: "absolute", right: MARGIN, top: 690, fontSize: 300, fontWeight: 700, letterSpacing: TIGHT, lineHeight: 1, transform: `scale(${1 + (1 - pop(t, times)) * 1.2}) rotate(-3deg)` }}>{multiple}</div>
        ) : null}
      </Camera>
    </Field>
  );
};

const STREAMS = [
  ["Read full-export.csv", "Read app.log", "Read bundle.js", "Read schema.sql", "Read dump.json", "Read vendor.js"],
  ["turn 21 of 25", "turn 22 of 25", "turn 23 of 25", "turn 24 of 25", "turn 25 of 25", "stopped"],
  ["summary.md", "notes.txt", "report.pdf", "transcript.txt", "changelog.md", "spec.docx"],
];

const Stream: React.FC<{ lines: string[]; tint: string }> = ({ lines, tint }) => {
  const t = useTick();
  const pitch = 44;
  const moved = t * 5 + 900;
  const first = Math.floor(moved / pitch);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 130, bottom: 140, fontFamily: mono, fontSize: 30, lineHeight: `${pitch}px`, color: tint, padding: "0 30px", overflow: "hidden", ...SOFT_EDGES }}>
      <div style={{ transform: `translateY(${-(moved % pitch)}px)` }}>
        {Array.from({ length: 22 }, (_, r) => (
          <div key={r}>{lines[(first + r) % lines.length]}</div>
        ))}
      </div>
    </div>
  );
};

/** Three columns rise together, each with the one figure that matters and its own stream behind. */
export const Reads: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { rows } = need(shot.body, "rows");
  const dropAt = 60;
  const dropped = snap(t, dropAt);
  return (
    <Field bg={lime.bg} on={lime.on}>
      <Camera>
        <Head title={shot.title} size={100} />
        <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: 196, bottom: 1080 - FLOOR + 8, display: "flex", gap: 14 }}>
          {rows.map((row, i) => (
            <div key={row.text} style={{ flex: 1, position: "relative", overflow: "hidden", background: color.ink, color: color.white, borderRadius: 16, transform: `translateY(${(1 - pop(t, i * 2.5)) * 860}px)` }}>
              <Stream lines={STREAMS[i]} tint="#2b2b30" />
              <div style={{ position: "absolute", left: 30, right: 30, top: 24, fontSize: 56, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em" }}>{row.text}</div>
              <div style={{ position: "absolute", left: 30, right: 20, top: 220, height: 280, overflow: "hidden", fontSize: 200, fontWeight: 700, lineHeight: 1.1, letterSpacing: TIGHT, color: i === 2 ? color.lime : color.red, whiteSpace: "nowrap" }}>
                {i === 0 ? <Count to={Number(row.big)} at={4} len={38} /> : null}
                {i === 1 ? (
                  <span>
                    <span style={{ display: "inline-block", transform: `translateY(${dropped * -280}px)` }}>{row.big}</span>
                    <span style={{ position: "absolute", left: 0, top: 0, color: color.lime, transform: `translateY(${(1 - dropped) * 280}px)` }}>25</span>
                  </span>
                ) : null}
                {i === 2 ? (
                  <span style={{ fontSize: 130 }}>
                    <div>GPT</div>
                    <div style={{ color: color.white, fontSize: 120 }}>Gemini</div>
                  </span>
                ) : null}
              </div>
              <div style={{ position: "absolute", left: 30, right: 30, bottom: 26, fontSize: 44, fontWeight: 500, lineHeight: 1.1 }}>
                <Rise text={row.note ?? ""} at={8 + i * 2} gap={0.5} />
              </div>
            </div>
          ))}
        </div>
      </Camera>
    </Field>
  );
};

const DAYS = [0.34, 0.62, 0.48, 0.9, 0.72, 0.4, 0.56];

/** The word goes in; the whole page opens at once. */
export const Usage: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { projects, forecast } = need(shot.body, "usage");
  const openAt = 20;
  const open = pop(t, openAt);
  const tilt = (1 - snap(t, 0)) * 16 - t * 0.02;
  return (
    <Field bg={lime.bg} on={lime.on}>
      <Camera>
        <Head title={shot.title} sub={shot.sub} size={84} style={{ top: 34 }} subStyle={{ fontSize: 40 }} />
        <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: 208, bottom: 1080 - FLOOR + 8, transform: `perspective(1800px) rotateX(${tilt}deg)`, transformOrigin: "50% 100%" }}>
          <Window label={t < openAt ? "> " : USAGE_LABEL} style={{ height: "100%" }} bodyStyle={{ padding: 0 }}>
            {t < openAt ? (
              <div style={{ position: "absolute", left: 40, top: 200, fontFamily: mono, fontSize: 140, fontWeight: 600 }}>
                <span style={{ color: color.dim }}>&gt; </span>
                <Typed text="usage" at={3} speed={0.6} cursor />
              </div>
            ) : (
              <div style={{ position: "absolute", inset: 0, padding: "26px 36px", display: "grid", gridTemplateColumns: "1fr 1fr 330px", gap: 48, transform: `scale(${0.86 + open * 0.14})`, opacity: clamp((t - openAt) / 3) }}>
                <div>
                  <div style={{ fontFamily: mono, fontSize: 30, color: color.dim, marginBottom: 14 }}>By project</div>
                  {projects.map((p, i) => (
                    <div key={p.name} style={{ marginBottom: 20 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 44, fontWeight: 700 }}>
                        <span>{p.name}</span>
                        <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(p.share * 100 * ease(t, openAt + i * 2, 24))}%</span>
                      </div>
                      <div style={{ height: 30, borderRadius: 6, marginTop: 6, background: [color.lime, color.yellow, color.violet][i], width: `${p.share * 200 * ease(t, openAt + i * 2, 24)}%` }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ fontFamily: mono, fontSize: 30, color: color.dim, marginBottom: 14 }}>By day</div>
                  <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 14, maxHeight: 330 }}>
                    {DAYS.map((d, i) => (
                      <div key={i} style={{ flex: 1, height: `${d * 100 * ease(t, openAt + 2 + i, 20)}%`, background: i === 3 ? color.lime : "#46464e", borderRadius: 6 }} />
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ring share={0.68 * ease(t, openAt, 30)} size={300} stroke={34} ink={color.lime} track={color.raised}>
                    <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: TIGHT }}>
                      <Count to={68} at={openAt} len={30} suffix="%" />
                    </div>
                  </Ring>
                </div>
                <div style={{ gridColumn: "1 / -1", fontSize: 54, fontWeight: 700, letterSpacing: "-0.02em", color: color.lime, alignSelf: "end", paddingBottom: 8 }}>
                  <Rise text={forecast} at={openAt + 16} gap={0.6} />
                </div>
              </div>
            )}
          </Window>
        </div>
      </Camera>
    </Field>
  );
};
