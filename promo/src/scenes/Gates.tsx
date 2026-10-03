import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { BlockNote, Columns, ToolRow, Window } from "../ui";

const READ_BLOCKED_AT = 32;
const SEARCH_BLOCKED_AT = 84;
const CODEX_DONE_AT = 150;

export const Gates: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const codexDone = frame >= CODEX_DONE_AT;

  return (
    <Scene
      tag="hooks · big-read-gate, worker-nudge"
      caption="A whole-file read of a big file is blocked and becomes a read of the part needed. A search subagent is blocked and the search goes to Codex or Gemini."
      durationInFrames={durationInFrames}
    >
      <Columns>
        <Window title="Reading a big file" style={{ flex: 1 }}>
          <Appear at={8}>
            <ToolRow tool="Read" text="server.log   all 4,812 lines" status={frame >= READ_BLOCKED_AT ? "blocked" : "running"} />
          </Appear>
          <Appear at={READ_BLOCKED_AT}>
            <BlockNote hook="big-read-gate">Blocked: read only the part you need.</BlockNote>
          </Appear>
          <Appear at={58}>
            <ToolRow tool="Grep" text={'"timeout"   found at line 2,164'} status="ok" />
          </Appear>
          <Appear at={78}>
            <ToolRow tool="Read" text="server.log   lines 2,140 to 2,200" status="ok" />
          </Appear>
        </Window>

        <Window title="Searching the code" style={{ flex: 1 }}>
          <Appear at={60}>
            <ToolRow
              tool="Agent"
              text="search: where is the retry logic?"
              status={frame >= SEARCH_BLOCKED_AT ? "blocked" : "running"}
            />
          </Appear>
          <Appear at={SEARCH_BLOCKED_AT}>
            <BlockNote hook="worker-nudge">Blocked: searching goes to Codex or Gemini.</BlockNote>
          </Appear>
          <Appear at={112}>
            <ToolRow tool="Bash" text={'codex exec "where is the retry logic?"'} status={codexDone ? "ok" : "running"} />
          </Appear>
          <Appear at={CODEX_DONE_AT}>
            <ToolRow tool="Codex" text="src/net/retry.ts, line 41   in 8 s" status="ok" />
          </Appear>
        </Window>
      </Columns>
    </Scene>
  );
};
