import React from "react";
import { AbsoluteFill } from "remotion";
import { Camera, clamp, Field, Head, LogField, Marquee, pop, Rise, snap, Stamp, Typed, useTick, Window } from "./kit";
import { color, FLOOR, MARGIN, mono, TIGHT } from "./look";
import { CATCH, LOG_LABEL, Shot } from "./script";
import { need } from "./need";

/** The moment the reply is sent back is the film's loudest. */
const { caught: CAUGHT_AT, fixed: FIXED_AT, passed: PASSED_AT } = CATCH.at;

const LogLine: React.FC<{ at: number; what: string; state: string; ink?: string }> = ({ at, what, state, ink = color.white }) => {
  const t = useTick();
  if (t < at) return null;
  const land = pop(t, at);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 20, padding: "20px 0", borderBottom: `2px solid ${color.line}`, fontSize: 52, fontWeight: 500, color: ink, transform: `translateX(${(1 - land) * 90}px)`, opacity: clamp(land * 2) }}>
      <span>{what}</span>
      <span style={{ fontFamily: mono, fontSize: 42 }}>{state}</span>
    </div>
  );
};

/** The film's one story, played as it would happen: a reply, the log, the send-back, the fix. */
export const Catch: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const caught = t >= CAUGHT_AT && t < FIXED_AT;
  const fixed = t >= FIXED_AT;
  const [before, wrong, after] = CATCH.claim;
  const typed = Math.round(clamp((t - 6) * 2.6, 0, before.length + wrong.length + after.length));
  const shownBefore = before.slice(0, typed);
  const shownWrong = wrong.slice(0, Math.max(0, typed - before.length));
  const shownAfter = after.slice(0, Math.max(0, typed - before.length - wrong.length));
  const scan = clamp((t - 30) / 18);
  const stampOut = snap(t, FIXED_AT - 4);
  return (
    <Field bg={caught ? color.red : color.ink}>
      <LogField tint={caught ? "#ff6a43" : "#26262b"} speed={caught ? 22 : 9} />
      <Camera jolts={[{ at: CAUGHT_AT, size: 34 }, { at: PASSED_AT, size: 10 }]}>
        <Head title={shot.title} sub={shot.sub} size={84} style={{ top: 44 }} subStyle={{ fontSize: 36, marginTop: 8, color: caught ? color.white : "#b7b7bd" }} />
        <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: 214, bottom: 1080 - FLOOR + 6, display: "flex", gap: 16 }}>
          <Window label="The reply" style={{ flex: 1.45, transform: `translateY(${(1 - pop(t, 1)) * 800}px)` }} bodyStyle={{ fontSize: 100, fontWeight: 700, lineHeight: 1.06, letterSpacing: "-0.03em" }}>
            {shownBefore}
            {fixed ? (
              <>
                <span style={{ textDecoration: "line-through", textDecorationThickness: 8, color: color.red }}>{shownWrong}</span>{" "}
                <span style={{ color: color.lime, display: "inline-block", transform: `scale(${1 + (1 - pop(t, FIXED_AT)) * 0.9})` }}>{CATCH.fixed}</span>
              </>
            ) : (
              <span style={{ color: t > 44 ? color.red : color.white }}>{shownWrong}</span>
            )}
            {shownAfter}
            {t > 28 ? (
              <div style={{ marginTop: 26, fontFamily: mono, fontSize: 40, fontWeight: 400, letterSpacing: 0, color: color.dim, transform: `translateY(${(1 - pop(t, 28)) * 40}px)` }}>{CATCH.address}</div>
            ) : null}
            {fixed ? <div style={{ marginTop: 18, fontSize: 64, fontWeight: 700, letterSpacing: "-0.02em", color: color.lime }}>{CATCH.corrected}</div> : null}
          </Window>
          <Window label={LOG_LABEL} style={{ flex: 1, transform: `translateY(${(1 - pop(t, 3)) * 800}px)` }}>
            <LogLine at={10} what={CATCH.log[0]} state="done" />
            <LogLine at={20} what={CATCH.log[1]} state="done" />
            <LogLine at={42} what={CATCH.missing} state="no" ink={color.red} />
            <LogLine at={FIXED_AT + 2} what={CATCH.found} state="done" ink={color.lime} />
            {scan > 0 && scan < 1 ? <div style={{ position: "absolute", left: 0, right: 0, top: 10 + scan * 330, height: 6, background: color.white }} /> : null}
          </Window>
        </div>
        <div style={{ position: "absolute", left: MARGIN + 28, top: 926, fontFamily: mono, fontSize: 34, color: caught ? color.white : "#9a9aa2" }}>{CATCH.source}</div>
        {t >= CAUGHT_AT ? (
          <AbsoluteFill
            style={{
              alignItems: "center",
              justifyContent: "center",
              transform: `translate(${stampOut * 520}px, ${stampOut * -300}px) scale(${1 - stampOut * 0.78})`,
              opacity: t < FIXED_AT + 26 ? 1 : 0,
            }}
          >
            <div style={{ background: color.white, padding: "26px 56px 34px", borderRadius: 20, textAlign: "center", transform: `rotate(-4deg)` }}>
              <Stamp at={CAUGHT_AT} text={CATCH.verdict} ink={color.red} size={190} tilt={0} style={{ textTransform: "uppercase" }} />
              <div style={{ marginTop: 20, fontSize: 64, fontWeight: 700, color: color.ink, letterSpacing: "-0.02em", opacity: 1 - stampOut * 3 }}>
                <Rise text={CATCH.reason} at={CAUGHT_AT + 6} gap={0.8} />
              </div>
            </div>
          </AbsoluteFill>
        ) : null}
        {t >= PASSED_AT ? (
          <div style={{ position: "absolute", right: MARGIN + 60, top: 730 }}>
            <Stamp at={PASSED_AT} text={CATCH.passed} ink={color.lime} size={130} />
          </div>
        ) : null}
      </Camera>
    </Field>
  );
};

/** Each catch comes in hard from the right, pushes the ones before it up, and takes its stamp. */
export const SentBack: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { rows } = need(shot.body, "rows");
  const landAt = (i: number) => 6 + i * 13;
  const pitch = 200;
  const pushed = rows.reduce((sum, _, i) => sum + (i ? pop(t, landAt(i)) : 0), 0);
  return (
    <Field bg={color.red}>
      <Marquee text="SENT BACK" top={40} size={330} speed={-24} tint="#ff6a43" />
      <Marquee text="SENT BACK" top={380} size={330} speed={20} start={-2600} tint="#ff6a43" />
      <Marquee text="SENT BACK" top={720} size={330} speed={-16} tint="#ff6a43" />
      <Camera>
        <Head title={shot.title} size={84} style={{ top: 44 }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: 182, bottom: 1080 - FLOOR, overflow: "hidden" }}>
          {rows.map((row, i) => {
            const land = pop(t, landAt(i));
            const y = 606 + (i - pushed) * pitch;
            return (
              <div
                key={row.text}
                style={{
                  position: "absolute",
                  left: MARGIN,
                  right: MARGIN,
                  top: y,
                  height: pitch - 14,
                  background: color.ink,
                  borderRadius: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 44px",
                  fontSize: 88,
                  fontWeight: 700,
                  letterSpacing: TIGHT,
                  whiteSpace: "nowrap",
                  transform: `translateX(${(1 - land) * 1900}px)`,
                }}
              >
                <span>{row.text}</span>
                <Stamp at={landAt(i) + 6} text={row.note ?? ""} ink={color.lime} size={50} />
              </div>
            );
          })}
        </div>
      </Camera>
    </Field>
  );
};

const Card: React.FC<{ at: number; title: string; children: React.ReactNode }> = ({ at, title, children }) => {
  const t = useTick();
  return (
    <div style={{ background: color.ink, color: color.white, borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column", transform: `scale(${0.7 + pop(t, at) * 0.3})`, opacity: clamp((t - at) / 2) }}>
      <div style={{ fontSize: 58, fontWeight: 700, letterSpacing: "-0.025em", padding: "20px 30px 12px", lineHeight: 1.05 }}>{title}</div>
      <div style={{ flex: 1, padding: "8px 30px 22px", fontSize: 36, position: "relative", overflow: "hidden" }}>{children}</div>
    </div>
  );
};

/** Four small working screens, all running at once. */
export const Habits: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { rows } = need(shot.body, "rows");
  const decisions = ["Keep the old API for a month", "Postgres, not a new service", "Ship behind a flag"];
  return (
    <Field bg={color.red}>
      <Camera>
        <Head title={shot.title} size={84} style={{ top: 34 }} />
        <div style={{ position: "absolute", left: MARGIN, right: MARGIN, top: 142, bottom: 1080 - FLOOR + 8, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 14 }}>
          <Card at={2} title={rows[0].text}>
            <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: "-0.03em", color: color.lime }}>
              <Typed text="Yes, the fix works." at={8} speed={1.6} />
            </div>
            {["I changed one check in limits.ts.", "All 12 login tests pass."].map((line, i) => (
              <div key={line} style={{ fontSize: 42, fontWeight: 500, color: "#c9c9cf", marginTop: 8, transform: `translateX(${(1 - pop(t, 24 + i * 5)) * 80}px)`, opacity: t > 24 + i * 5 ? 1 : 0 }}>
                {line}
              </div>
            ))}
          </Card>
          <Card at={3} title={rows[1].text}>
            <div style={{ fontFamily: mono, fontSize: 34, lineHeight: 1.5 }}>
              <div>
                <span style={{ color: color.dim }}>$ </span>
                <Typed text="npm test -- login" at={8} speed={2} />
              </div>
              <div style={{ color: color.lime }}>
                <Typed text="# WHAT THIS DOES: runs the login tests" at={16} speed={2.6} />
              </div>
              <div>
                <Typed text="12 tests passed" at={32} speed={2.2} />
              </div>
            </div>
          </Card>
          <Card at={4} title={rows[2].text}>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              {["Keep it", "Roll it back"].map((label) => (
                <span key={label} style={{ background: color.raised, borderRadius: 8, padding: "8px 22px", fontSize: 42 }}>
                  {label}
                </span>
              ))}
            </div>
            <div style={{ border: `3px solid ${color.lime}`, borderRadius: 8, padding: "8px 18px", fontSize: 48, minHeight: 84 }}>
              <Typed text="Neither, do it this way" at={16} speed={1.5} cursor />
            </div>
          </Card>
          <Card at={5} title={rows[3].text}>
            <div style={{ fontFamily: mono, fontSize: 28, color: color.dim, marginBottom: 6 }}>DECISIONS.md</div>
            {decisions.map((line, i) =>
              t > 10 + i * 11 ? (
                <div key={line} style={{ fontSize: 46, fontWeight: 500, lineHeight: 1.2, transform: `translateX(${(1 - pop(t, 10 + i * 11)) * 80}px)` }}>
                  {line}
                </div>
              ) : null,
            )}
          </Card>
        </div>
      </Camera>
    </Field>
  );
};
