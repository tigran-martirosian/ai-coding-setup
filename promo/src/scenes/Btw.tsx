import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { Appear, typed } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Bubble, Columns, Step, Window } from "../ui";

const NOTE = "/btw also keep the old column names";
const TYPE_AT = 18;
const SEND_AT = 60;
const FLY_AT = 66;
const NOTE_READ_AT = 100;

// The panels have a fixed height, so the note's path can be given in pixels of the stage:
// from the sent message to the place where the busy session shows the note.
const PANEL_HEIGHT = 470;
const FROM = { left: 1330, top: 230 };
const TO = { left: 60, top: 374 };
const NEXT_DONE_AT = 150;

export const Btw: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const sent = frame >= SEND_AT;
  // The note leaves the message in the second chat and lands where the busy session shows it.
  const flight = interpolate(frame, [FLY_AT, NOTE_READ_AT], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const flightOpacity = interpolate(frame, [FLY_AT, FLY_AT + 5, NOTE_READ_AT - 4, NOTE_READ_AT + 2], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Scene
      tag="/btw"
      caption="/btw sends a note to a session that is busy. It reads the note before its next step and carries on."
      durationInFrames={durationInFrames}
    >
      <Columns height={PANEL_HEIGHT}>
        <Window title="Import orders" chip="RUNNING" style={{ flex: 1.1 }}>
          <Step status="ok">Read the table schema</Step>
          <Step status="ok">Write the importer</Step>
          <Step status={frame >= NOTE_READ_AT - 6 ? "ok" : "running"}>Rename the columns</Step>
          <Appear at={NOTE_READ_AT}>
            <div
              style={{
                border: `1.5px solid ${color.sky}`,
                background: `${color.sky}1a`,
                borderRadius: 12,
                padding: "12px 18px",
                fontSize: 27,
                lineHeight: 1.35,
              }}
            >
              <span style={{ color: color.sky, fontWeight: 600 }}>Note read before the next step: </span>
              also keep the old column names
            </div>
          </Appear>
          <Appear at={NOTE_READ_AT + 22}>
            <Step status={frame >= NEXT_DONE_AT ? "ok" : "running"}>Keep the old names as aliases</Step>
          </Appear>
          <Appear at={NEXT_DONE_AT}>
            <Step status="running">Run the tests</Step>
          </Appear>
        </Window>

        <Window title="Second chat, same folder" style={{ flex: 1 }}>
          {sent ? (
            <Appear at={SEND_AT} style={{ display: "flex", flexDirection: "column" }}>
              <Bubble who="you">
                <span style={{ fontFamily: mono, fontSize: 27 }}>{NOTE}</span>
              </Bubble>
            </Appear>
          ) : null}
          <Appear at={SEND_AT + 34} style={{ display: "flex", flexDirection: "column" }}>
            <Bubble who="agent">Note sent to "Import orders".</Bubble>
          </Appear>
          {sent ? null : (
            <div
              style={{
                fontFamily: mono,
                fontSize: 27,
                border: `1.5px solid ${color.sky}`,
                borderRadius: 12,
                padding: "16px 18px",
                background: color.raised,
                whiteSpace: "nowrap",
              }}
            >
              {typed(NOTE, frame, TYPE_AT, 1)}
              <span style={{ color: color.sky, opacity: frame % 20 < 10 ? 1 : 0 }}>|</span>
            </div>
          )}
        </Window>
      </Columns>

      <div
        style={{
          position: "absolute",
          left: interpolate(flight, [0, 1], [FROM.left, TO.left]),
          // A shallow arc, so the note doesn't cut straight through the text.
          top: interpolate(flight, [0, 1], [FROM.top, TO.top]) - 50 * Math.sin(Math.PI * flight),
          opacity: flightOpacity,
          zIndex: 3,
          fontFamily: mono,
          fontSize: 24,
          fontWeight: 600,
          color: color.panel,
          background: color.sky,
          borderRadius: 999,
          padding: "8px 20px",
          boxShadow: `0 0 40px ${color.sky}88`,
        }}
      >
        note
      </div>
    </Scene>
  );
};
