import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Appear, appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color } from "../theme";
import { Chip, Step, Window } from "../ui";

// An invented subject: a wall shelf. The skill collects facts and one whole-object photo first.
const FACTS = [
  "The board is 80 cm wide",
  "Two brackets, one at each end",
  "Brackets are screwed to the wall",
] as const;

const CHECKS = [
  { at: 66, text: "Flat front view" },
  { at: 92, text: "80 cm board, real proportions" },
  { at: 118, text: "Brackets hold the board, screwed to the wall" },
] as const;
const PASSED_AT = 132;

const Shelf: React.FC<{ labels?: boolean }> = ({ labels }) => (
  <svg viewBox="0 0 520 300" width="100%" style={{ display: "block", background: "#e2e8f0", borderRadius: 10 }}>
    <rect x={30} y={30} width={460} height={14} fill="#94a3b8" />
    <rect x={30} y={44} width={460} height={196} fill="#f1f5f9" />
    <rect x={60} y={120} width={400} height={18} rx={3} fill="#92704a" />
    {[100, 420].map((x) => (
      <g key={x}>
        <rect x={x - 6} y={138} width={12} height={62} fill="#475569" />
        <line x1={x} y1={200} x2={x + (x < 260 ? 36 : -36)} y2={138} stroke="#475569" strokeWidth={8} />
        <circle cx={x} cy={152} r={4} fill="#e2e8f0" />
        <circle cx={x} cy={186} r={4} fill="#e2e8f0" />
      </g>
    ))}
    {labels && (
      <g fill="#0f172a" fontSize={20} fontWeight={600} textAnchor="middle">
        <line x1={60} y1={98} x2={460} y2={98} stroke="#0f172a" strokeWidth={2} />
        <line x1={60} y1={90} x2={60} y2={106} stroke="#0f172a" strokeWidth={2} />
        <line x1={460} y1={90} x2={460} y2={106} stroke="#0f172a" strokeWidth={2} />
        <rect x={215} y={84} width={90} height={28} fill="#f1f5f9" />
        <text x={260} y={106}>80 cm</text>
      </g>
    )}
  </svg>
);

export const Picture: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const shown = appear(frame, PASSED_AT, 18);

  return (
    <Scene
      tag="skill · picture"
      caption="The picture skill generates an image from collected facts and a reference photo. You see it only after it passes a checklist."
      durationInFrames={durationInFrames}
      stageStyle={{ gap: 32 }}
    >
      <Appear at={8} from="left">
        <Window title="Facts and reference photo" style={{ width: 520 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Shelf />
            {FACTS.map((fact) => (
              <div key={fact} style={{ fontSize: 24, color: color.text }}>
                {fact}
                <span style={{ color: color.dim }}> · source</span>
              </div>
            ))}
          </div>
        </Window>
      </Appear>

      <Appear at={46} style={{ flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22, padding: "0 8px" }}>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Checklist</div>
          {CHECKS.map((check) => (
            <Step key={check.text} status={frame >= check.at ? "ok" : "running"}>
              {check.text}
            </Step>
          ))}
        </div>
      </Appear>

      <Appear at={46} from="right">
        <Window
          title="Generated picture"
          chip={frame >= PASSED_AT ? "PASSED" : "HELD"}
          chipColor={frame >= PASSED_AT ? color.green : color.amber}
          active={frame >= PASSED_AT}
          style={{ width: 580 }}
        >
          <div style={{ position: "relative" }}>
            <div
              style={{ filter: `blur(${interpolate(shown, [0, 1], [22, 0])}px)`, opacity: interpolate(shown, [0, 1], [0.3, 1]) }}
            >
              <Shelf labels />
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 1 - shown,
              }}
            >
              <Chip color={color.amber} style={{ fontSize: 26, padding: "8px 22px" }}>
                Not shown yet
              </Chip>
            </div>
          </div>
        </Window>
      </Appear>
    </Scene>
  );
};
