import React from "react";
import { along, clamp, ease, FADE, Field, glide, Head, mix, sec, Typed, useTick, Wire } from "./kit";
import { accent, color, MARGIN, TOP, TYPE } from "./look";
import { Shot } from "./script";
import { need } from "./need";

const ink = accent.Ask;

/** A box in a diagram, placed by its top left corner. `lit` brings its edge from grey to `edge`. */
const Node: React.FC<{ x: number; y: number; w: number; h: number; lit?: number; edge?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ x, y, w, h, lit = 0, edge = ink, style, children }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: h,
      borderRadius: 10,
      border: `2px solid ${mix(color.line, edge, lit)}`,
      background: color.window,
      display: "flex",
      alignItems: "center",
      padding: "0 26px",
      fontSize: 40,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </div>
);

const MID = 620;
const CMD = { x: MARGIN, y: MID - 120, w: 440, h: 240 };
const PLAN = { x: 580, y: MID - 55, w: 240, h: 110 };
const STEP = { x: 900, w: 560, h: 110, gap: 180 };
const REVIEW = { x: 1560, y: MID - 55, w: 1920 - MARGIN - 1560, h: 110 };

/** A plain chat message types in; a wire carries it to the planner, which fans the job out into numbered steps; a
 * helper's dot leaves each step for the reviewer, and the reviewer ticks the result. */
export const Lead: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { label, ask, steps, helper, reviewer, done } = need(shot.body, "lead");
  const typed = sec(0.3) + ask.length / 0.9;
  const toPlan = glide(t, typed + sec(0.2), sec(0.6));
  const planned = typed + sec(0.8);
  const stepY = (i: number) => MID - ((steps.length - 1) * STEP.gap) / 2 + i * STEP.gap - STEP.h / 2;
  const fanAt = (i: number) => planned + i * sec(0.25);
  const runAt = (i: number) => planned + sec(1.1) + i * sec(0.3);
  const checked = runAt(steps.length - 1) + sec(1.1);
  const reviewIn = { x: REVIEW.x, y: MID };
  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={ink} />
      <div style={{ position: "absolute", left: CMD.x, top: CMD.y - 46, fontSize: TYPE.label, color: color.dim }}>{label}</div>
      <Node x={CMD.x} y={CMD.y} w={CMD.w} h={CMD.h} lit={1 - ease(t, planned, sec(0.6))} style={{ whiteSpace: "normal", lineHeight: 1.4, fontSize: 36 }}>
        <span style={{ color: color.text }}>
          <span style={{ color: ink }}>{"> "}</span>
          <Typed text={ask} at={sec(0.3)} speed={0.9} cursor />
        </span>
      </Node>
      <Wire a={{ x: CMD.x + CMD.w, y: MID }} b={{ x: PLAN.x, y: MID }} draw={toPlan} ink={color.faint} />
      <Node x={PLAN.x} y={PLAN.y} w={PLAN.w} h={PLAN.h} lit={ease(t, planned - sec(0.2), FADE)} style={{ justifyContent: "center" }}>
        Planner
      </Node>
      <div style={{ position: "absolute", left: STEP.x, top: stepY(0) - 56, fontSize: 30, color: color.dim, opacity: ease(t, fanAt(0), FADE) }}>Steps, each run by a {helper}</div>
      {steps.map((step, i) => {
        const y = stepY(i);
        const out = { x: STEP.x + STEP.w, y: y + STEP.h / 2 };
        const run = glide(t, runAt(i), sec(1));
        const dot = along(out, reviewIn, run);
        const left = t >= runAt(i);
        return (
          <React.Fragment key={step}>
            <Wire a={{ x: PLAN.x + PLAN.w, y: MID }} b={{ x: STEP.x, y: out.y }} draw={glide(t, fanAt(i), sec(0.5))} ink={color.faint} />
            <Wire a={out} b={reviewIn} draw={ease(t, fanAt(i) + sec(0.4), FADE)} ink={color.line} dashed />
            <Node x={STEP.x} y={y} w={STEP.w} h={STEP.h} lit={ease(t, runAt(i), FADE)} style={{ opacity: ease(t, fanAt(i) + sec(0.3), FADE), gap: 24 }}>
              <span style={{ color: left ? ink : color.dim }}>{i + 1}</span>
              {step}
            </Node>
            {t >= runAt(i) && run < 1 ? <div style={{ position: "absolute", left: dot.x - 14, top: dot.y - 14, width: 28, height: 28, borderRadius: 14, background: ink }} /> : null}
          </React.Fragment>
        );
      })}
      <Node x={REVIEW.x} y={REVIEW.y} w={REVIEW.w} h={REVIEW.h} lit={ease(t, checked, sec(0.5))} edge={color.good} style={{ justifyContent: "center", padding: 0 }}>
        {reviewer}
      </Node>
      <div style={{ position: "absolute", left: REVIEW.x, width: REVIEW.w, top: REVIEW.y + REVIEW.h + 24, textAlign: "center", fontSize: 40, color: color.good, opacity: ease(t, checked, sec(0.5)) }}>✓ {done}</div>
    </Field>
  );
};

const SHOT = { x: MARGIN, y: TOP, w: 1080, h: 690 };
const NOTES = { x: 1260, w: 1920 - MARGIN - 1260 };
const LABEL_H = 62;

/** One screenshot of a sign-in page with three flaws ringed in red. Each round fixes the worst left: the ring turns
 * green and the flaw itself is put right on the page. */
export const BlindReview: React.FC<{ shot: Shot }> = ({ shot }) => {
  // The review is one of the checks, so it takes their colour.
  const ink = accent.Checks;
  const t = useTick();
  const { flaws, rounds, clean } = need(shot.body, "review");
  const markAt = (i: number) => sec(0.5 + i * 0.4);
  /** The round each flaw is fixed in: the button in round 2, the other two in round 3. */
  const roundAt = (r: number) => sec(r === 1 ? 2.4 : 3.9);
  const fixAt = [roundAt(1), roundAt(2), roundAt(2) + sec(0.3)];
  const fix = fixAt.map((at) => glide(t, at, sec(0.8)));
  const round = glide(t, roundAt(1) - sec(0.3), sec(0.5)) + glide(t, roundAt(2) - sec(0.3), sec(0.5));
  const cleanAt = roundAt(2) + sec(1.3);
  const page = { x: SHOT.x + 60, y: SHOT.y + LABEL_H + 50 };
  const buttonX = page.x + 840 - fix[0] * 840;
  const rings = [
    { x: buttonX - 24, y: page.y + 404, w: 300, h: 116 },
    { x: page.x - 28, y: page.y - 20, w: 500, h: 110 },
    { x: page.x - 28, y: page.y + 92, w: 600, h: 76 },
  ];
  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={ink} />
      <div style={{ position: "absolute", left: SHOT.x, top: SHOT.y, width: SHOT.w, height: SHOT.h, border: `2px solid ${color.line}`, borderRadius: 12, background: color.window, overflow: "hidden" }}>
        <div style={{ height: LABEL_H, display: "flex", alignItems: "center", padding: "0 30px", fontSize: TYPE.label, color: color.dim, borderBottom: `1px solid ${color.line}` }}>screenshot.png</div>
      </div>
      <div style={{ position: "absolute", left: SHOT.x, top: SHOT.y, width: SHOT.w, height: SHOT.h, overflow: "hidden", borderRadius: 12 }}>
        <div style={{ position: "absolute", left: page.x - SHOT.x, top: page.y - SHOT.y, width: 300 + fix[1] * 160, overflow: "hidden", whiteSpace: "nowrap", fontSize: 56, fontWeight: 700, lineHeight: 1.2 }}>Welcome back</div>
        <div style={{ position: "absolute", left: page.x - SHOT.x, top: page.y - SHOT.y + 106, fontSize: 30, color: mix("#2c2c33", color.dim, fix[2]) }}>Sign in to see your projects.</div>
        {["Email", "Password"].map((field, i) => (
          <div key={field} style={{ position: "absolute", left: page.x - SHOT.x, top: page.y - SHOT.y + 196 + i * 96, width: 600, height: 70, border: `2px solid ${color.line}`, borderRadius: 8, display: "flex", alignItems: "center", padding: "0 22px", fontSize: 28, color: color.faint }}>
            {field}
          </div>
        ))}
        <div style={{ position: "absolute", left: buttonX - SHOT.x, top: page.y - SHOT.y + 420, width: 252, height: 84, borderRadius: 8, background: ink, color: color.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 600 }}>Sign in</div>
      </div>
      {rings.map((ring, i) => {
        const ringInk = mix(color.bad, color.good, fix[i]);
        return (
          <React.Fragment key={i}>
            <div style={{ position: "absolute", left: ring.x, top: ring.y, width: ring.w, height: ring.h, border: `3px solid ${ringInk}`, borderRadius: ring.h / 2, opacity: ease(t, markAt(i), FADE) }} />
            <div style={{ position: "absolute", left: ring.x + ring.w - 22, top: ring.y - 22, width: 44, height: 44, borderRadius: 22, background: ringInk, color: color.bg, fontSize: 26, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", opacity: ease(t, markAt(i), FADE) }}>
              {i + 1}
            </div>
          </React.Fragment>
        );
      })}

      <div style={{ position: "absolute", left: NOTES.x, width: NOTES.w, top: SHOT.y, display: "flex", gap: 12 }}>
        {rounds.map((name, i) => {
          const on = clamp(1 - Math.abs(i - round));
          return (
            <div key={name} style={{ flex: 1, height: 64, borderRadius: 8, border: `2px solid ${mix(color.line, ink, on)}`, background: on > 0.5 ? color.raised : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: TYPE.label, color: mix(color.dim, color.text, on) }}>
              {name}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: NOTES.x, top: SHOT.y + 110, fontSize: TYPE.label, color: color.dim }}>What the reviewer marked</div>
      {flaws.map((flaw, i) => {
        const flawInk = mix(color.bad, color.good, fix[i]);
        return (
          <div key={flaw} style={{ position: "absolute", left: NOTES.x, width: NOTES.w, top: SHOT.y + 170 + i * 100, height: 80, borderBottom: `1px solid ${color.line}`, display: "flex", alignItems: "center", gap: 22, fontSize: TYPE.body, opacity: ease(t, markAt(i), FADE) }}>
            <span style={{ width: 40, height: 40, borderRadius: 20, background: flawInk, color: color.bg, fontSize: 24, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
            <span style={{ color: mix(color.text, color.dim, fix[i]), textDecoration: fix[i] > 0.5 ? "line-through" : undefined }}>{flaw}</span>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: NOTES.x, top: SHOT.y + 520, fontSize: TYPE.body, fontWeight: 600, color: color.good, opacity: ease(t, cleanAt, sec(0.5)) }}>✓ {clean}</div>
    </Field>
  );
};
