import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, appear, typed } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Chip } from "../ui";

const BLIND_AT = 84;
const REVIEW_AT = 104;
const VERDICT_AT = 142;
const READERS_AT = 186;
const VERDICT = "Split by month. Answers B and C agree, and A leaves out the cost of the extra indexes.";

const SEATS = [
  { model: "Claude", letter: "A", tint: "#f59e0b", lines: [92, 78, 55] },
  { model: "GPT", letter: "B", tint: color.green, lines: [84, 95, 40] },
  { model: "Gemini", letter: "C", tint: color.sky, lines: [96, 70, 62] },
] as const;

const card: React.CSSProperties = {
  background: color.panel,
  border: `1.5px solid ${color.line}`,
  borderRadius: 16,
  padding: 24,
};

export const Court: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const blind = appear(frame, BLIND_AT, 12);

  return (
    <Scene
      tag="/court"
      caption="The court: three models answer one question alone, two review the answers without knowing who wrote which, and a chair writes the verdict."
      durationInFrames={durationInFrames}
      stageStyle={{ flexDirection: "column", gap: 20 }}
    >
      <Appear at={6}>
        <div style={{ ...card, padding: "14px 32px", fontSize: 32, fontWeight: 600, borderColor: color.faint }}>
          Should the orders table be split by month?
        </div>
      </Appear>

      <div style={{ display: "flex", gap: 28, width: "100%" }}>
        {SEATS.map((seat, i) => (
          <Appear key={seat.model} at={20 + i * 10} style={{ flex: 1 }}>
            <div style={card}>
              <div style={{ position: "relative", height: 40, marginBottom: 18 }}>
                <span style={{ position: "absolute", opacity: 1 - blind }}>
                  <Chip color={seat.tint} style={{ fontSize: 24 }}>
                    {seat.model}
                  </Chip>
                </span>
                <span style={{ position: "absolute", opacity: blind }}>
                  <Chip color={color.dim} style={{ fontSize: 24 }}>
                    Answer {seat.letter}
                  </Chip>
                </span>
              </div>
              {seat.lines.map((width, line) => (
                <div
                  key={line}
                  style={{
                    height: 14,
                    borderRadius: 7,
                    background: color.line,
                    marginTop: 14,
                    width: `${width * appear(frame, 30 + i * 10 + line * 8, 22)}%`,
                  }}
                />
              ))}
            </div>
          </Appear>
        ))}
      </div>

      <Appear at={REVIEW_AT}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 27, color: color.dim }}>
          <Chip color={color.green} style={{ fontSize: 24 }}>
            GPT reviews A, B, C
          </Chip>
          <Chip color={color.sky} style={{ fontSize: 24 }}>
            Gemini reviews A, B, C
          </Chip>
          <span>The names are hidden from the reviewers.</span>
        </div>
      </Appear>

      <Appear at={VERDICT_AT} style={{ width: "100%" }}>
        <div style={{ ...card, borderColor: color.sky, minHeight: 150 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
            <Chip style={{ fontSize: 24 }}>Chair's verdict</Chip>
            <span style={{ fontSize: 25, color: color.dim }}>You read it and decide.</span>
          </div>
          <div style={{ fontSize: 31, lineHeight: 1.35 }}>{typed(VERDICT, frame, VERDICT_AT + 8, 2.2)}</div>
        </div>
      </Appear>

      <Appear at={READERS_AT}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 27, color: color.dim }}>
          <Chip color={color.violet} style={{ fontSize: 24, fontFamily: mono }}>
            /court readers resume.md
          </Chip>
          <span>For a piece instead of a question: readers with different jobs say how it lands.</span>
        </div>
      </Appear>
    </Scene>
  );
};
