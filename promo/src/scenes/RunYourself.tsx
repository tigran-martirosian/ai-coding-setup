import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { mono } from "../theme";
import { BlockNote, Bubble, ToolRow, Window } from "../ui";

const SENT_BACK_AT = 52;
const TESTS_DONE_AT = 128;

export const RunYourself: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const done = frame >= TESTS_DONE_AT;

  return (
    <Scene
      tag="hook · run-yourself"
      caption="A reply that tells you to run a command the agent could run is sent back. The agent runs it."
      durationInFrames={durationInFrames}
    >
      <Window title="Chat" style={{ width: 1280 }}>
        <Appear at={8} style={{ display: "flex", flexDirection: "column" }}>
          <Bubble who="agent" struck={frame >= SENT_BACK_AT}>
            The fix is in. Now run <span style={{ fontFamily: mono }}>npm test</span> yourself to check it.
          </Bubble>
        </Appear>
        <Appear at={SENT_BACK_AT}>
          <BlockNote hook="run-yourself">Reply sent back: run the command, then report what it printed.</BlockNote>
        </Appear>
        <Appear at={90}>
          <ToolRow tool="Bash" text={done ? "npm test   38 passed, 0 failed" : "npm test"} status={done ? "ok" : "running"} />
        </Appear>
        <Appear at={TESTS_DONE_AT + 10} style={{ display: "flex", flexDirection: "column" }}>
          <Bubble who="agent">The fix is in. I ran the tests: 38 passed.</Bubble>
        </Appear>
      </Window>
    </Scene>
  );
};
