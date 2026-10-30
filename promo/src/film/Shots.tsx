import React from "react";
import { AbsoluteFill } from "remotion";
import { BlindReview, Board, Court, Handoff, Lead } from "./BigJobs";
import { Catch, Habits, SentBack } from "./Checks";
import { End, Install, Proof } from "./Close";
import { Compact, Reads, Usage } from "./Cost";
import { clamp, Field, snap, useTick } from "./kit";
import { HEIGHT, MARGIN, mono, partColor, TIGHT, WIDTH } from "./look";
import { Compare, Contents, Title } from "./Open";
import { Part, PARTS, PUSH_TICKS, Shot, WIPE_TICKS } from "./script";
import { Audits, Editor, Everyday, Projects } from "./Tools";

const VIEWS: Record<string, React.FC<{ shot: Shot }>> = {
  title: Title,
  contents: Contents,
  compare: Compare,
  catch: Catch,
  sentback: SentBack,
  habits: Habits,
  compact: Compact,
  reads: Reads,
  usage: Usage,
  lead: Lead,
  court: Court,
  review: BlindReview,
  handoff: Handoff,
  board: Board,
  everyday: Everyday,
  audits: Audits,
  projects: Projects,
  editor: Editor,
  install: Install,
  proof: Proof,
  end: End,
};

/** Slides a shot in over the one before it. */
const Enter: React.FC<{ shot: Shot; children: React.ReactNode }> = ({ shot, children }) => {
  const t = useTick();
  const away = 1 - clamp(snap(t, 0) * 1.02);
  const moving = t < PUSH_TICKS * 2;
  const move = !moving ? "none" : shot.enter === "left" ? `translateX(${away * WIDTH}px)` : shot.enter === "up" ? `translateY(${away * HEIGHT}px)` : "none";
  return <AbsoluteFill style={{ transform: move }}>{children}</AbsoluteFill>;
};

export const ShotView: React.FC<{ shot: Shot }> = ({ shot }) => {
  const View = VIEWS[shot.id];
  if (!View) throw new Error(`No view for shot "${shot.id}".`);
  return (
    <Enter shot={shot}>
      <View shot={shot} />
    </Enter>
  );
};

const BARS = 7;

/** A comb of bars closing across the screen, staggered: the shape a chapter card wipes in through. */
const comb = (t: number, fromRight: boolean): string => {
  const edge = (x: number) => (fromRight ? 100 - x : x);
  const points: string[] = [`${edge(0)}% 0%`];
  for (let i = 0; i < BARS; i++) {
    const reach = 1 - Math.pow(1 - clamp((t - i * 0.7) / (WIPE_TICKS - BARS * 0.7)), 3);
    points.push(`${edge(reach * 100)}% ${(i / BARS) * 100}%`, `${edge(reach * 100)}% ${((i + 1) / BARS) * 100}%`);
  }
  points.push(`${edge(0)}% 100%`);
  return `polygon(${points.join(", ")})`;
};

/** The chapter number and name, full screen, as the film changes colour. */
export const Chapter: React.FC<{ part: Part }> = ({ part }) => {
  const t = useTick();
  const { bg, on } = partColor[part];
  const rise = snap(t, WIPE_TICKS - 2);
  const index = PARTS.indexOf(part);
  return (
    <AbsoluteFill style={{ clipPath: comb(t, index % 2 === 0) }}>
      <Field bg={bg} on={on}>
        <div style={{ position: "absolute", left: MARGIN, top: 40, fontFamily: mono, fontSize: 40 }}>{index + 1}/6</div>
        <AbsoluteFill style={{ justifyContent: "center", padding: `0 ${MARGIN}px`, overflow: "hidden" }}>
          <div style={{ fontSize: 340, fontWeight: 700, lineHeight: 1, letterSpacing: TIGHT, whiteSpace: "nowrap", transform: `translateX(${(1 - rise) * 500 - t * 3}px)`, visibility: t < WIPE_TICKS - 2 ? "hidden" : "visible" }}>{part}</div>
        </AbsoluteFill>
      </Field>
    </AbsoluteFill>
  );
};
