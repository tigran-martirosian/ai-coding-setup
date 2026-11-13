import React from "react";
import { AbsoluteFill } from "remotion";
import { Camera, Count, Field, Head, Marquee, pop, Rise, Typed, useTick, Window } from "./kit";
import { color, FLOOR, MARGIN, mono, partColor, TIGHT } from "./look";
import { HOOKS, Shot, SKILLS } from "./script";
import { need } from "./need";

const ink = partColor.Install;

/** The real output of a dry run, with the home folder taken off the front. */
const OUTPUT = [...HOOKS.slice(0, 7).map((hook) => `hooks/${hook}.mjs`), "agents/planner.md", "agents/worker.md", "skills/ask/SKILL.md", "skills/blind-review/SKILL.md", "skills/btw/SKILL.md", "skills/court/SKILL.md"].map((file) => `[dry run] copied ${file}`);

/** The command typed in half a second, its output pouring out, the options beside it all at once. */
export const Install: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { code, rows } = need(shot.body, "install");
  const startAt = 14;
  const shown = Math.floor(Math.max(0, t - startAt) * 0.7);
  const pitch = 53;
  const fits = 10;
  const lines = OUTPUT.slice(0, Math.min(shown, OUTPUT.length));
  const moved = Math.max(0, (Math.max(0, t - startAt) * 0.7 - fits) * pitch);
  return (
    <Field bg={ink.bg} on={ink.on}>
      <Camera>
        <Head title={shot.title} sub={shot.sub} size={100} style={{ top: 34 }} subStyle={{ fontSize: 40, color: "#c9c9cf" }} />
        <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: 232, bottom: 1080 - FLOOR + 8, display: "flex", gap: 16 }}>
          <Window label="Terminal" style={{ flex: 1.25, background: "#000", transform: `translateY(${(1 - pop(t, 0)) * 900}px)`, border: `2px solid ${color.line}` }} bodyStyle={{ fontFamily: mono, fontSize: 33 }}>
            <div style={{ fontSize: 46, fontWeight: 600, whiteSpace: "nowrap", marginBottom: 12 }}>
              <span style={{ color: color.dim }}>$ </span>
              <Typed text={code} at={1} speed={2} cursor />
            </div>
            <div style={{ height: 556, overflow: "hidden", lineHeight: `${pitch}px` }}>
              <div style={{ transform: `translateY(${-Math.min(moved, Math.max(0, (OUTPUT.length - fits) * pitch))}px)` }}>
                {lines.map((line, i) => (
                  <div key={line} style={{ whiteSpace: "nowrap", color: i === lines.length - 1 ? color.white : color.dim }}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </Window>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((row, i) => (
              <div key={row.text} style={{ flex: 1, background: i === 0 ? color.lime : color.paper, color: color.ink, borderRadius: 16, padding: "14px 30px", display: "flex", flexDirection: "column", justifyContent: "center", transform: `translateX(${(1 - pop(t, 2 + i * 1.5)) * 1000}px)` }}>
                <div style={{ fontFamily: mono, fontSize: 54, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.1 }}>{row.text}</div>
                <div style={{ fontSize: 44, fontWeight: 500, lineHeight: 1.1 }}>{row.note}</div>
              </div>
            ))}
          </div>
        </div>
      </Camera>
    </Field>
  );
};

/** The numbers fill the screen as they run up. */
export const Proof: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { stats, line } = need(shot.body, "stats");
  const [replies, sent, tests] = stats;
  return (
    <Field bg={ink.bg} on={ink.on}>
      <Camera>
        <Head title={shot.title} size={100} style={{ top: 36 }} />
        <div style={{ position: "absolute", left: MARGIN, top: 170, fontSize: 340, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.025em", transform: `scale(${1 + (1 - pop(t, 0)) * 0.3})`, transformOrigin: "0 50%" }}>
          <Count to={replies.value} at={0} len={46} />
        </div>
        <div style={{ position: "absolute", left: MARGIN + 6, top: 500, fontSize: 60, fontWeight: 700, letterSpacing: "-0.02em" }}>{replies.unit}</div>
        <div style={{ position: "absolute", left: MARGIN, top: 620, right: MARGIN, display: "flex", gap: 16 }}>
          {[sent, tests].map((stat, i) => (
            <div key={stat.unit} style={{ flex: 1, background: i ? color.blue : color.red, borderRadius: 16, padding: "14px 34px 22px", display: "flex", alignItems: "baseline", gap: 26, transform: `translateY(${(1 - pop(t, 6 + i * 2)) * 600}px)` }}>
              <span style={{ fontSize: 170, fontWeight: 700, letterSpacing: TIGHT, lineHeight: 1 }}>
                <Count to={stat.value} at={6} len={36} />
              </span>
              <span style={{ fontSize: 52, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em" }}>{stat.unit}</span>
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: 886, fontSize: 49, fontWeight: 500, lineHeight: 1.1, whiteSpace: "nowrap" }}>
          <Rise text={line} at={26} gap={0.5} />
        </div>
      </Camera>
    </Field>
  );
};

/** The name, large, with the whole setup still running behind it. */
export const End: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { line, name, link } = need(shot.body, "end");
  return (
    <Field bg={color.ink}>
      <Marquee text={HOOKS.slice(0, 10).join("  ")} top={40} size={110} speed={-9} tint="#1c1c1f" weight={700} />
      <Marquee text={SKILLS.join("  ")} top={160} size={110} speed={8} start={-2400} tint="#1c1c1f" weight={700} />
      <Marquee text={HOOKS.slice(10).join("  ")} top={820} size={110} speed={-8} tint="#1c1c1f" weight={700} />
      <Marquee text={SKILLS.slice(6).join("  ")} top={940} size={110} speed={7} start={-2000} tint="#1c1c1f" weight={700} />
      <Camera>
        <AbsoluteFill style={{ justifyContent: "center", padding: `0 ${MARGIN}px` }}>
          <div style={{ fontSize: 228, fontWeight: 700, lineHeight: 1, letterSpacing: TIGHT, whiteSpace: "nowrap" }}>
            <Rise text={shot.title} at={0} />
          </div>
          <div style={{ fontSize: 66, fontWeight: 500, marginTop: 18 }}>
            <Rise text={line} at={6} gap={0.8} />
          </div>
          <div style={{ fontFamily: mono, fontSize: 62, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 32, color: color.lime, whiteSpace: "nowrap" }}>
            <Typed text={link} at={14} speed={3} />
          </div>
          <div style={{ fontSize: 40, marginTop: 10, color: "#c9c9cf", opacity: t > 30 ? 1 : 0 }}>{name}</div>
        </AbsoluteFill>
      </Camera>
    </Field>
  );
};
