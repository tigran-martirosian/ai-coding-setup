import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Appear, appear, typed } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Bubble, Columns, Step, Window } from "../ui";

const NOTE = "/btw also keep the old column names";
const TYPE_AT = 18;
const SEND_AT = 60;
const NOTE_READ_AT = 100;
const NEXT_DONE_AT = 150;

export const Btw: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const sent = frame >= SEND_AT;
  // The note travels from the second chat to the busy session.
  const flight = appear(frame, SEND_AT + 4, 30);
  const flightOpacity = interpolate(frame, [SEND_AT + 4, SEND_AT + 10, SEND_AT + 30, SEND_AT + 36], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Scene
      tag="/btw"
      caption="/btw sends a note to a session that is busy. It reads the note before its next step and carries on."
      durationInFrames={durationInFrames}
    >
      <Columns>
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
          top: 190,
          left: interpolate(flight, [0, 1], [1180, 560]),
          opacity: flightOpacity,
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
