import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { appear } from "./anim";
import { color, mono, sans } from "./theme";

export type SceneProps = { durationInFrames: number };

const FADE = 10;

/** The frame every scene sits in: the hook or command name on top, the mock-up in the middle, one caption below. */
export const Scene: React.FC<{
  tag?: string;
  caption?: React.ReactNode;
  durationInFrames: number;
  stageStyle?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ tag, caption, durationInFrames, stageStyle, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, FADE, durationInFrames - FADE, durationInFrames - 1], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1400px 800px at 50% 0%, ${color.bgGlow} 0%, ${color.bg} 65%)`,
        fontFamily: sans,
        color: color.text,
      }}
    >
      <AbsoluteFill style={{ opacity }}>
        {tag ? (
          <div
            style={{
              position: "absolute",
              top: 40,
              left: 80,
              fontFamily: mono,
              fontSize: 26,
              color: color.sky,
              border: `1px solid ${color.line}`,
              background: color.panelHead,
              borderRadius: 999,
              padding: "8px 22px",
            }}
          >
            {tag}
          </div>
        ) : null}
        <div
          style={{
            position: "absolute",
            top: 120,
            left: 80,
            right: 80,
            bottom: caption ? 260 : 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 40,
            ...stageStyle,
          }}
        >
          {children}
        </div>
        {caption ? (
          <div
            style={{
              position: "absolute",
              left: 160,
              right: 160,
              bottom: 0,
              height: 250,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              fontSize: 42,
              fontWeight: 500,
              lineHeight: 1.32,
              opacity: appear(frame, 6, 16),
            }}
          >
            {caption}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
