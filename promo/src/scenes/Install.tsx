import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, typed } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Step, Window } from "../ui";

// The command and the steps, as in docs/full-install.md.
const COMMAND = 'claude "Read docs/full-install.md and carry out every step in it."';
const STEPS = [
  "Programs that are missing: Nimbalyst, Node.js, Git, uv, Handy",
  "The rules, hooks, skills and four project folders",
  "Plugins, and the Codex and Gemini sign-ins",
  "The editor extensions and a few settings",
  "A test of every part",
] as const;

const TYPE_AT = 10;
const FIRST_STEP_AT = 72;
const PER_STEP = 22;

export const Install: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();

  return (
    <Scene
      tag="install · docs/full-install.md"
      caption="One command in Claude Code sets up a new computer: the programs, the files and the settings."
      durationInFrames={durationInFrames}
    >
      <Window title="Terminal" style={{ width: 1320 }}>
        <div style={{ fontFamily: mono, fontSize: 27, color: color.text, whiteSpace: "nowrap" }}>
          <span style={{ color: color.faint }}>$ </span>
          {typed(COMMAND, frame, TYPE_AT, 1.4)}
        </div>
        {STEPS.map((step, i) => {
          const at = FIRST_STEP_AT + i * PER_STEP;
          return (
            <Appear key={step} at={at}>
              <Step status={frame >= at + PER_STEP ? "ok" : "running"}>{step}</Step>
            </Appear>
          );
        })}
      </Window>
    </Scene>
  );
};
