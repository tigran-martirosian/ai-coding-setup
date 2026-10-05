import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, typed } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Bubble, Step, Window } from "../ui";

// The line of hooks/update-check.mjs and the steps of skills/update-setup/update.mjs.
const NOTICE = "Setup update ready: version 1.0.1. Type /update-setup to install it.";
const COMMAND = "/update-setup";
const STEPS = [
  "Newer version: 1.0.1 (installed: 1.0.0)",
  "Downloaded the release from GitHub",
  "Replaced the setup's files, each old one kept as a dated copy",
  "Your own skills, hooks, settings and notes: not touched",
] as const;

const NOTICE_AT = 10;
const COMMAND_AT = 44;
const FIRST_STEP_AT = 76;
const PER_STEP = 24;

export const Update: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();

  return (
    <Scene
      tag="update-check · /update-setup"
      caption="Once a day the setup checks for a newer version and says so in one line. One command installs it and keeps what you added."
      durationInFrames={durationInFrames}
    >
      <Window title="Chat" chip="version 1.0.0" chipColor={color.dim} style={{ width: 1320 }}>
        <Appear at={NOTICE_AT}>
          <div
            style={{
              background: `${color.amber}1c`,
              border: `1px solid ${color.amber}88`,
              borderRadius: 12,
              padding: "12px 18px",
              fontSize: 27,
              whiteSpace: "nowrap",
            }}
          >
            {NOTICE}
          </div>
        </Appear>
        <Appear at={COMMAND_AT} style={{ alignSelf: "flex-end" }}>
          <Bubble who="you">
            <span style={{ fontFamily: mono, whiteSpace: "nowrap" }}>{typed(COMMAND, frame, COMMAND_AT + 6, 0.8) || " "}</span>
          </Bubble>
        </Appear>
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
