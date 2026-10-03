import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, typed } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Columns, Window } from "../ui";

const PROMPT = "Add a test for empty files to the importer, then run the tests.";

const HOLD_AT = 24;
const RELEASE_AT = 104;
const TEXT_AT = RELEASE_AT + 8;

export const Voice: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const held = frame >= HOLD_AT && frame < RELEASE_AT;
  const text = typed(PROMPT, frame, TEXT_AT, 4);

  return (
    <Scene
      tag="voice typing · Handy"
      caption="I speak most prompts. Handy types what I say where the cursor is, with a speech model that runs on the computer."
      durationInFrames={durationInFrames}
    >
      <Columns>
        <Appear at={8} style={{ width: 600 }}>
          <Window title="Handy" chip="PARAKEET V3 · ON THIS COMPUTER" chipColor={color.violet} bodyStyle={{ alignItems: "center", gap: 26, padding: 30 }}>
            <div
              style={{
                fontFamily: mono,
                fontSize: 30,
                fontWeight: 600,
                padding: "16px 34px",
                borderRadius: 14,
                border: `2px solid ${held ? color.sky : color.line}`,
                background: held ? `${color.sky}1a` : color.raised,
                color: held ? color.sky : color.text,
                translate: held ? "0px 3px" : "0px 0px",
              }}
            >
              Right Alt
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, height: 60 }}>
              {Array.from({ length: 34 }, (_, i) => {
                const level = held ? 0.2 + 0.8 * Math.abs(Math.sin(frame * 0.4 + i * 1.3) * Math.sin(i * 0.7 + frame * 0.13)) : 0.1;
                return <span key={i} style={{ width: 7, height: 60 * level, borderRadius: 3, background: color.violet }} />;
              })}
            </div>
            <div style={{ fontSize: 24, color: color.dim }}>{held ? "Listening" : frame < HOLD_AT ? "Hold the key and talk" : "Released"}</div>
          </Window>
        </Appear>

        <Appear at={14} from="left" style={{ flex: 1 }}>
          <Window title="Chat" active={frame >= TEXT_AT}>
            <div
              style={{
                minHeight: 150,
                border: `1.5px solid ${color.line}`,
                background: color.raised,
                borderRadius: 12,
                padding: "18px 22px",
                fontSize: 30,
                lineHeight: 1.4,
              }}
            >
              {text ? text : <span style={{ color: color.faint }}>Type a message</span>}
              <span style={{ color: color.sky, opacity: Math.floor(frame / 12) % 2 ? 1 : 0.2 }}>|</span>
            </div>
          </Window>
        </Appear>
      </Columns>
    </Scene>
  );
};
