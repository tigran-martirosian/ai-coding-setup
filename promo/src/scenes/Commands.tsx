import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Columns, Step, Window } from "../ui";

// The buttons and their notes, as in extensions/commands/src/commands.ts.
const COMMANDS = [
  { label: "Board cleanup", note: "Move finished sessions to Complete" },
  { label: "Next move", note: "The most useful thing to do next here" },
  { label: "Project scan", note: "Check this project's Claude setup" },
  { label: "Setup audit", note: "Full check of the global setup" },
  { label: "Usage report", note: "Where the tokens went, and the forecast" },
  { label: "New project", note: "Set this folder up for Claude" },
] as const;

const SENTENCES = ["The importer is done.", "Empty files are skipped now.", "All the tests pass."] as const;

const PRESS_AT = 56;
const SPEAK_AT = 96;
const PER_SENTENCE = 34;

export const Commands: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const pressed = frame >= PRESS_AT;
  const speaking = Math.floor((frame - SPEAK_AT) / PER_SENTENCE);

  return (
    <Scene
      tag="extensions · commands, read-aloud"
      caption="One side-bar button starts the commands I use most, each in a new session. Read Aloud speaks replies with a voice model on the computer."
      durationInFrames={durationInFrames}
    >
      <Columns>
        <Window title="Commands" style={{ width: 600 }} bodyStyle={{ gap: 10, padding: 18 }}>
          {COMMANDS.map((command, i) => {
            const active = command.label === "Setup audit" && pressed;
            return (
              <Appear key={command.label} at={8 + i * 5}>
                <div
                  style={{
                    border: `1.5px solid ${active ? color.sky : color.line}`,
                    background: active ? `${color.sky}1a` : color.raised,
                    borderRadius: 12,
                    padding: "9px 16px",
                  }}
                >
                  <div style={{ fontSize: 26, fontWeight: 600 }}>{command.label}</div>
                  <div style={{ fontSize: 21, color: active ? color.sky : color.dim }}>
                    {active ? "Started: see the sessions list" : command.note}
                  </div>
                </div>
              </Appear>
            );
          })}
        </Window>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 24 }}>
          <Appear at={PRESS_AT + 8} from="left">
            <Window title="Setup audit" chip="NEW SESSION">
              <Step status={frame >= PRESS_AT + 34 ? "ok" : "running"}>Run every hook and both workers</Step>
              <Appear at={PRESS_AT + 34}>
                <Step status={frame >= PRESS_AT + 60 ? "ok" : "running"}>Count where the tokens went</Step>
              </Appear>
              <Appear at={PRESS_AT + 60}>
                <Step status={frame >= PRESS_AT + 86 ? "ok" : "running"}>Compare with the last audit, save the report</Step>
              </Appear>
            </Window>
          </Appear>

          <Appear at={SPEAK_AT - 10} from="left">
            <Window title="Read Aloud" chip="KOKORO · ON THIS COMPUTER" chipColor={color.violet}>
              <div style={{ fontSize: 28, lineHeight: 1.45 }}>
                {SENTENCES.map((sentence, i) => (
                  <span key={sentence} style={{ color: i === speaking ? color.sky : i < speaking ? color.dim : color.text }}>
                    {sentence}{" "}
                  </span>
                ))}
                <span style={{ fontFamily: mono, fontSize: 22, color: color.faint, textDecoration: "line-through", whiteSpace: "nowrap" }}>
                  npm test -- importer
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, height: 44 }}>
                {Array.from({ length: 46 }, (_, i) => {
                  const on = frame >= SPEAK_AT && speaking < SENTENCES.length;
                  const level = on ? 0.25 + 0.75 * Math.abs(Math.sin(frame * 0.35 + i * 1.7) * Math.sin(i * 0.6 + frame * 0.11)) : 0.12;
                  return <span key={i} style={{ width: 6, height: 44 * level, borderRadius: 3, background: color.violet }} />;
                })}
                <span style={{ marginLeft: 18, fontSize: 22, color: color.dim, whiteSpace: "nowrap" }}>code is skipped · 1.2×</span>
              </div>
            </Window>
          </Appear>
        </div>
      </Columns>
    </Scene>
  );
};
