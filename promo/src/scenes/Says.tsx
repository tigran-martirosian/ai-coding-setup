import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color } from "../theme";
import { BlockNote, Bubble, Chip, Columns, ToolRow, Window } from "../ui";

const LINK_BLOCKED_AT = 44;
const PAGE_OPENED_AT = 84;
const REASON_BLOCKED_AT = 110;
const LOOKED_UP_AT = 150;

const link: React.CSSProperties = { color: color.sky, textDecoration: "underline" };

export const Says: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const lookedUp = frame >= LOOKED_UP_AT + 20;

  return (
    <Scene
      tag="hooks · link-gate, question-other"
      caption="Two hooks compare what the agent says with the log of what it did. A link it never opened, or a “Checked” with nothing looked up, is sent back."
      durationInFrames={durationInFrames}
    >
      <Columns>
        <Window title="A reply with a link" style={{ flex: 1 }}>
          <Appear at={8} style={{ display: "flex", flexDirection: "column" }}>
            <Bubble who="agent" struck={frame >= LINK_BLOCKED_AT}>
              The limit is 500 requests a minute: <span style={link}>docs.example.com/limits</span>
            </Bubble>
          </Appear>
          <Appear at={LINK_BLOCKED_AT}>
            <BlockNote hook="link-gate">This link was never opened in this session.</BlockNote>
          </Appear>
          <Appear at={PAGE_OPENED_AT - 18}>
            <ToolRow tool="WebFetch" text="docs.example.com/limits" status={frame >= PAGE_OPENED_AT ? "ok" : "running"} />
          </Appear>
          <Appear at={PAGE_OPENED_AT + 6} style={{ display: "flex", flexDirection: "column" }}>
            <Bubble who="agent">
              The page says 300 requests a minute: <span style={link}>docs.example.com/limits</span>
            </Bubble>
          </Appear>
        </Window>

        <Window title="A question with a recommendation" style={{ flex: 1 }}>
          <Appear at={70}>
            <div
              style={{
                border: `1.5px solid ${lookedUp ? color.green : frame >= REASON_BLOCKED_AT ? color.red : color.line}`,
                borderRadius: 12,
                padding: "14px 18px",
                background: color.raised,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 29, fontWeight: 600 }}>
                Keep the orders in Postgres <Chip>RECOMMENDED</Chip>
              </div>
              <div style={{ fontSize: 26, color: color.dim, marginTop: 8 }}>
                {lookedUp ? "Checked: package.json already uses pg 8." : "Checked: the docs."}
              </div>
            </div>
          </Appear>
          <Appear at={REASON_BLOCKED_AT}>
            <BlockNote hook="question-other">Nothing in the log was looked up. Look it up, or say “Judgment”.</BlockNote>
          </Appear>
          <Appear at={LOOKED_UP_AT}>
            <ToolRow tool="Read" text="package.json" status={lookedUp ? "ok" : "running"} />
          </Appear>
        </Window>
      </Columns>
    </Scene>
  );
};
