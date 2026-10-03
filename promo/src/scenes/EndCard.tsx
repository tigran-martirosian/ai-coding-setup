import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, typed } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";

export const EndCard: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();

  return (
    <Scene durationInFrames={durationInFrames} stageStyle={{ flexDirection: "column", gap: 34, textAlign: "center" }}>
      <Appear at={6}>
        <div style={{ fontSize: 132, fontWeight: 700, letterSpacing: -3 }}>ai-coding-setup</div>
      </Appear>
      <Appear at={18}>
        <div style={{ fontSize: 40, color: color.dim }}>
          Rules, hooks, skills, three editor extensions and four starter projects.
        </div>
      </Appear>
      <Appear at={34}>
        <div
          style={{
            fontFamily: mono,
            fontSize: 44,
            minWidth: 560,
            textAlign: "left",
            background: color.panel,
            border: `1.5px solid ${color.sky}`,
            borderRadius: 14,
            padding: "20px 34px",
            marginTop: 20,
          }}
        >
          <span style={{ color: color.faint }}>$ </span>
          {typed("node install.mjs", frame, 42, 0.9)}
        </div>
      </Appear>
      <Appear at={62}>
        <div style={{ fontSize: 46, fontWeight: 600 }}>One installer.</div>
      </Appear>
    </Scene>
  );
};
