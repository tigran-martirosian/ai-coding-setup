import React from "react";
import { AbsoluteFill } from "remotion";
import { Camera, clamp, Field, Head, LOG_LINES, pop, snap, SOFT_EDGES, Stamp, Typed, useTick, Window } from "./kit";
import { color, MARGIN, mono, partColor, TIGHT } from "./look";
import { Shot } from "./script";
import { need } from "./need";

const violet = partColor["Big jobs"];

/** Lines of a session's log running inside a window. */
const Running: React.FC<{ seed: number; speed?: number; stopAt?: number; size?: number }> = ({ seed, speed = 7, stopAt = Infinity, size = 28 }) => {
  const t = useTick();
  const pitch = size * 1.45;
  const moved = Math.min(t, stopAt) * speed + seed * 91;
  const first = Math.floor(moved / pitch);
  return (
    <div style={{ position: "absolute", inset: "0 18px", fontFamily: mono, fontSize: size, lineHeight: `${pitch}px`, color: color.dim, overflow: "hidden", whiteSpace: "nowrap", ...SOFT_EDGES }}>
      <div style={{ transform: `translateY(${-(moved % pitch)}px)` }}>
        {Array.from({ length: 14 }, (_, r) => (
          <div key={r}>{LOG_LINES[(first + r + seed * 7) % LOG_LINES.length]}</div>
        ))}
      </div>
    </div>
  );
};

/** Dots running along a line from one place to another. */
const Dots: React.FC<{ from: [number, number]; to: [number, number]; ink: string; at?: number; stopAt?: number }> = ({ from, to, ink, at = 0, stopAt = Infinity }) => {
  const t = useTick();
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => {
        const go = t - at - i * 5;
        if (go < 0 || t > stopAt) return null;
        const x = (go % 26) / 26;
        const mid = (from[0] + to[0]) / 2;
        const px = x < 0.5 ? from[0] + (mid - from[0]) * x * 2 : mid + (to[0] - mid) * (x - 0.5) * 2;
        const py = x < 0.5 ? from[1] : x < 0.5 ? from[1] : to[1];
        const bend = x < 0.42 ? from[1] : x > 0.58 ? to[1] : from[1] + ((x - 0.42) / 0.16) * (to[1] - from[1]);
        return <div key={i} style={{ position: "absolute", left: px - 9, top: (py && bend) - 9, width: 18, height: 18, borderRadius: 9, background: ink }} />;
      })}
    </>
  );
};

/** One job goes in, three sessions work side by side, and a fourth checks what they made. */
export const Lead: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { flow } = need(shot.body, "flow");
  const [[lead], sessions, [review]] = flow;
  const doneAt = [62, 80, 70];
  const allDone = 84;
  const ys = [318, 560, 802];
  return (
    <Field bg={violet.bg}>
      <Camera>
        <Head title={shot.title} sub={shot.sub} size={84} style={{ top: 34 }} subStyle={{ fontSize: 40 }} />
        <AbsoluteFill>
          {sessions.map((_, i) => (
            <Dots key={i} from={[350, 560]} to={[520, ys[i]]} ink={color.white} at={2} stopAt={doneAt[i]} />
          ))}
          {sessions.map((_, i) => (
            <Dots key={i} from={[1270, ys[i]]} to={[1420, 560]} ink={color.lime} at={doneAt[i]} stopAt={110} />
          ))}
        </AbsoluteFill>
        <div style={{ position: "absolute", left: MARGIN, top: 460, width: 280, height: 200, borderRadius: 16, background: color.white, color: color.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontWeight: 600, fontSize: 64, transform: `scale(${pop(t, 0)})` }}>{lead}</div>
        {sessions.map((name, i) => {
          const fill = clamp((t - 4) / (doneAt[i] - 4));
          return (
            <div key={name} style={{ position: "absolute", left: 520, top: ys[i] - 112, width: 750, height: 224, transform: `translateX(${(1 - pop(t, 2 + i * 2)) * 1400}px)` }}>
              <Window style={{ height: "100%" }} bodyStyle={{ padding: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 20px 6px", fontSize: 46, fontWeight: 700, letterSpacing: "-0.02em", position: "relative", zIndex: 1, background: color.window }}>
                  <span>{name}</span>
                  <span style={{ fontFamily: mono, fontSize: 36, fontWeight: 400, color: t >= doneAt[i] ? color.lime : color.dim, fontVariantNumeric: "tabular-nums" }}>{t >= doneAt[i] ? "done" : `${Math.round(fill * 100)}%`}</span>
                </div>
                <div style={{ position: "relative", height: 96 }}>
                  <Running seed={i + 1} stopAt={doneAt[i]} speed={8 + i * 2} />
                </div>
                <div style={{ position: "absolute", left: 0, bottom: 0, height: 12, width: `${fill * 100}%`, background: t >= doneAt[i] ? color.lime : color.violet }} />
              </Window>
            </div>
          );
        })}
        <div style={{ position: "absolute", left: 1420, top: 420, width: 428, height: 280, borderRadius: 16, background: t >= allDone ? color.lime : color.white, color: color.ink, padding: "24px 30px", fontSize: 72, fontWeight: 700, letterSpacing: TIGHT, lineHeight: 1, transform: `scale(${pop(t, 6)})` }}>
          {review}
          {t >= allDone ? (
            <div style={{ marginTop: 34 }}>
              <Stamp at={allDone} text="Reviewed" ink={color.ink} size={48} />
            </div>
          ) : null}
        </div>
      </Camera>
    </Field>
  );
};

const ANSWERS = [
  ["Use a queue here.", "It handles the spikes.", "Retries stay simple.", "Cost: one more service."],
  ["Keep it in the database.", "Fewer moving parts.", "Fine under this load.", "Revisit at ten times."],
  ["A queue, but a small one.", "Start with one worker.", "Watch the wait time.", "Move later if needed."],
];

/** Three answers written side by side, each one out of sight of the others, then pulled into one verdict. */
export const Court: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { flow } = need(shot.body, "flow");
  const [, models, [verdict]] = flow;
  const closeAt = 62;
  const close = snap(t, closeAt);
  const w = 576;
  return (
    <Field bg={violet.bg}>
      <Camera jolts={[{ at: closeAt + 7, size: 14 }]}>
        <Head title={shot.title} sub={shot.sub} size={84} style={{ top: 34 }} subStyle={{ fontSize: 40 }} />
        {models.map((name, i) => {
          const x = MARGIN + i * (w + 24);
          const toCentre = (1920 - w) / 2 - x;
          return (
            <div key={name} style={{ position: "absolute", left: x, top: 214, width: w, height: 770, transform: `translate(${close * toCentre}px, ${(1 - pop(t, 2 + i * 2)) * 900}px) scaleY(${1 - close * 0.4})`, transformOrigin: "50% 100%", opacity: 1 - clamp((t - closeAt - 3) / 4) }}>
              <Window label={name} style={{ height: "100%" }} bodyStyle={{ fontSize: 58, fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em" }}>
                {ANSWERS[i].map((line, l) =>
                  t > 6 + l * 12 + i * 2 ? (
                    <div key={line} style={{ marginBottom: 14 }}>
                      <Typed text={line} at={6 + l * 12 + i * 2} speed={2.6} />
                    </div>
                  ) : null,
                )}
              </Window>
            </div>
          );
        })}
        {t >= closeAt + 5 ? (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: 170 }}>
            <div style={{ background: color.lime, color: color.ink, borderRadius: 20, padding: "40px 90px", fontSize: 170, fontWeight: 700, letterSpacing: TIGHT, lineHeight: 1, whiteSpace: "nowrap", transform: `scale(${1 + (1 - pop(t, closeAt + 5)) * 0.8})` }}>{verdict}</div>
          </AbsoluteFill>
        ) : null}
      </Camera>
    </Field>
  );
};

const FLAWS: { x: number; y: number; round: number; text: string }[] = [
  { x: 40, y: 54, round: 1, text: "Wrong total" },
  { x: 420, y: 150, round: 1, text: "Missing test" },
  { x: 150, y: 262, round: 1, text: "Unclear name" },
  { x: 500, y: 372, round: 1, text: "Edge case" },
  { x: 60, y: 468, round: 1, text: "Stale claim" },
  { x: 390, y: 60, round: 2, text: "Slow query" },
  { x: 240, y: 372, round: 2, text: "Vague heading" },
];

/** Reviewers go over the work; flaws pin on, get fixed and drop away; a later round finds fewer, then nothing serious. */
export const BlindReview: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { rounds, clean } = need(shot.body, "review");
  const starts = [4, 32, 60];
  const span = 24;
  const round = t < starts[1] ? 0 : t < starts[2] ? 1 : 2;
  const beam = (t - starts[round]) / span;
  const done = t >= starts[2] + span;
  return (
    <Field bg={violet.bg}>
      <Camera jolts={[{ at: starts[2] + span, size: 8 }]}>
        <Head title={shot.title} sub={shot.sub} size={84} style={{ top: 34 }} subStyle={{ fontSize: 40 }} />
        <div style={{ position: "absolute", left: MARGIN, top: 226, width: 940, height: 760, transform: `translateY(${(1 - pop(t, 0)) * 900}px)` }}>
          <Window label="The work" style={{ height: "100%" }} bodyStyle={{ padding: 28 }}>
            <div style={{ fontFamily: mono, fontSize: 34, lineHeight: "48px", color: color.dim, whiteSpace: "nowrap", overflow: "hidden" }}>
              {LOG_LINES.slice(0, 13).map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
            {beam < 1 ? <div style={{ position: "absolute", left: 0, right: 0, top: `${clamp(beam) * 100}%`, height: 8, background: color.lime }} /> : null}
            {FLAWS.map((flaw, i) => {
              const roundStart = starts[flaw.round - 1];
              const at = roundStart + 6 + (i % 5) * 3;
              const gone = starts[flaw.round] - 6;
              if (t < at || t > gone + 8) return null;
              const off = snap(t, gone);
              return (
                <div key={flaw.text} style={{ position: "absolute", left: flaw.x, top: flaw.y, background: color.red, color: color.white, fontFamily: mono, fontWeight: 600, fontSize: 36, padding: "6px 18px", borderRadius: 8, whiteSpace: "nowrap", transform: `scale(${pop(t, at) * (1 - off)}) rotate(${(i % 3) - 1.5}deg)` }}>
                  {flaw.text}
                </div>
              );
            })}
          </Window>
        </div>
        <div style={{ position: "absolute", left: 1040, right: MARGIN, top: 226 }}>
          {rounds.map((name, i) => {
            const on = round === i && !done;
            const land = pop(t, 2 + i);
            return (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "14px 26px", marginBottom: 12, borderRadius: 14, background: on ? color.white : color.ink, color: on ? color.ink : color.white, fontSize: 84, fontWeight: 700, letterSpacing: TIGHT, transform: `translateX(${(1 - land) * 900}px)` }}>
                {name}
                <span style={{ fontFamily: mono, fontSize: 34, fontWeight: 400, letterSpacing: 0 }}>{t >= starts[i] + span ? (i < 2 ? "fixed" : "clear") : ""}</span>
              </div>
            );
          })}
          {done ? (
            <div style={{ marginTop: 26, background: color.lime, color: color.ink, borderRadius: 14, padding: "20px 26px", fontSize: 84, fontWeight: 700, lineHeight: 1, letterSpacing: TIGHT, transform: `scale(${1 + (1 - pop(t, starts[2] + span)) * 0.5})` }}>{clean}</div>
          ) : null}
        </div>
      </Camera>
    </Field>
  );
};

/** The note is written in the old session, then flies across and the new session carries straight on. */
export const Handoff: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { rows } = need(shot.body, "note");
  const flyAt = 48;
  const fly = snap(t, flyAt) * 916;
  const wakeAt = flyAt + 10;
  return (
    <Field bg={violet.bg}>
      <Camera>
        <Head title={shot.title} sub={shot.sub} size={84} style={{ top: 34 }} subStyle={{ fontSize: 40 }} />
        <div style={{ position: "absolute", left: MARGIN, top: 226, width: 860, height: 760, transform: `translateX(${(1 - pop(t, 0)) * -1000}px)`, opacity: 1 - clamp((t - flyAt - 8) / 20) * 0.55 }}>
          <Window label="Session 1" style={{ height: "100%" }} bodyStyle={{ padding: 0 }}>
            <Running seed={3} speed={11} stopAt={flyAt} size={30} />
          </Window>
        </div>
        <div style={{ position: "absolute", right: MARGIN, top: 226, width: 860, height: 760, transform: `translateX(${(1 - pop(t, 2)) * 1000}px)` }}>
          <Window label="Session 2" style={{ height: "100%" }} bodyStyle={{ padding: 0 }}>
            {t >= wakeAt ? <Running seed={6} speed={11} size={30} /> : null}
          </Window>
        </div>
        <div style={{ position: "absolute", left: MARGIN + 60, top: 332, width: 740, background: color.lime, color: color.ink, borderRadius: 16, padding: "22px 34px 28px", transform: `translateX(${fly}px) rotate(${-2 + snap(t, flyAt) * 3}deg) scale(${pop(t, 6)})` }}>
          <div style={{ fontFamily: mono, fontSize: 32, marginBottom: 10 }}>HANDOFF.md</div>
          {rows.map((row, i) => (
            <div key={row.name} style={{ display: "flex", gap: 24, fontSize: 64, fontWeight: 700, letterSpacing: TIGHT, lineHeight: 1.26 }}>
              <span style={{ fontWeight: 500, width: 150 }}>{row.name}</span>
              <span style={{ whiteSpace: "nowrap" }}>
                <Typed text={row.text} at={10 + i * 9} speed={2.6} />
              </span>
            </div>
          ))}
        </div>
      </Camera>
    </Field>
  );
};

const STATUS = ["idle", "planning", "running", "checking", "done"];

/** Each card's route across the columns: which column it sits in, and the tick it moves on. */
const MOVES: { column: number; slot: number; hops: [number, number, number][] }[] = [
  { column: 2, slot: 0, hops: [[10, 3, 0], [54, 4, 0]] },
  { column: 1, slot: 0, hops: [[22, 2, 1], [66, 3, 1]] },
  { column: 0, slot: 0, hops: [[34, 1, 0], [76, 2, 0]] },
  { column: 3, slot: 0, hops: [[16, 4, 1]] },
  { column: 0, slot: 1, hops: [[44, 1, 1]] },
  { column: 3, slot: 2, hops: [[60, 4, 2]] },
  { column: 0, slot: 2, hops: [[70, 1, 2]] },
];

/** A session board, cards hopping across as the work goes. The whole board slides past slowly. */
export const Board: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { columns, cards } = need(shot.body, "board");
  const w = 346;
  const gap = 14;
  const slotY = 86;
  const pitch = 188;
  const place = (column: number, slot: number) => [column * (w + gap) + 16, slotY + slot * pitch] as const;
  return (
    <Field bg={violet.bg}>
      <Camera>
        <Head title={shot.title} sub={shot.sub} size={84} style={{ top: 34 }} subStyle={{ fontSize: 40 }} />
        <div style={{ position: "absolute", left: MARGIN - 8, top: 214, width: 1792, height: 780, background: color.ink, borderRadius: 18, transform: `translateY(${(1 - pop(t, 0)) * 900}px)` }}>
          {columns.map((name, i) => (
            <div key={name} style={{ position: "absolute", left: i * (w + gap) + 8, top: 8, bottom: 8, width: w + 8, background: color.window, borderRadius: 12, padding: "16px 20px", fontFamily: mono, fontSize: 28, color: color.dim, textTransform: "uppercase" }}>
              {name}
            </div>
          ))}
          {cards.map((name, i) => {
            const route = MOVES[i];
            let [x, y] = place(route.column, route.slot);
            let lift = 0;
            for (const [at, column, slot] of route.hops) {
              const go = pop(t, at);
              const [nx, ny] = place(column, slot);
              x += (nx - x) * go;
              y += (ny - y) * go;
              lift = Math.max(lift, go > 0.02 && go < 0.98 ? 1 : 0);
            }
            const moved = route.hops.filter(([at]) => t >= at).length;
            return (
              <div key={name} style={{ position: "absolute", left: x, top: y, width: w - 8, height: pitch - 16, background: color.raised, color: color.white, borderRadius: 12, padding: "16px 20px", fontSize: 44, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.05, transform: `rotate(${lift * 2}deg) scale(${1 + lift * 0.05})`, zIndex: lift ? 2 : 1, borderLeft: `10px solid ${[color.yellow, color.lime, color.violet, color.red][moved % 4]}` }}>
                {name}
                <div style={{ fontFamily: mono, fontSize: 26, fontWeight: 400, letterSpacing: 0, color: color.dim, marginTop: 10 }}>{STATUS[moved ? route.hops[moved - 1][1] : route.column]}</div>
              </div>
            );
          })}
        </div>
      </Camera>
    </Field>
  );
};
