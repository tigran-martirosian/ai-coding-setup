import React from "react";
import { Appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color } from "../theme";

export const Intro: React.FC<SceneProps> = ({ durationInFrames }) => (
  <Scene durationInFrames={durationInFrames} stageStyle={{ flexDirection: "column", gap: 36, textAlign: "center" }}>
    <Appear at={6}>
      <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -1.5 }}>A setup for Claude Code, Codex and Gemini</div>
    </Appear>
    <Appear at={22}>
      <div style={{ fontSize: 44, color: color.dim }}>Rules, hooks and skills. A hook checks each step the agent takes.</div>
    </Appear>
  </Scene>
);
