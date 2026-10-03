import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, typed } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Bubble, Chip } from "../ui";

const HOMES = [
  { name: "claude-settings", what: "Where the setup itself is changed and checked", has: ["/setup-audit", "/usage-report", "/chat-review"] },
  { name: "ask-anything", what: "General questions", has: ["/court", "picture skill", "reads web pages and videos"] },
  { name: "internet-search", what: "Finding things online", has: ["finder skill", "its own link gate", "page tools"] },
  { name: "quick-tasks", what: "One-off file jobs", has: ["a dated folder per job", "works on copies", "picture skill"] },
] as const;

const REQUEST = "find a standing desk under $300";
const TYPE_AT = 80;
const SEND_AT = 124;
const ROUTED_AT = 150;

export const Projects: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const sent = frame >= SEND_AT;

  return (
    <Scene
      tag="four starter projects"
      caption="The installer creates four projects, each with its own rules and tools. A request that doesn't belong to the open project is sent to the one it does."
      durationInFrames={durationInFrames}
      stageStyle={{ flexDirection: "column", gap: 30, alignItems: "stretch", justifyContent: "center" }}
    >
      <div style={{ display: "flex", gap: 24 }}>
        {HOMES.map((home, i) => {
          const target = home.name === "internet-search" && frame >= ROUTED_AT;
          return (
            <Appear key={home.name} at={8 + i * 10} style={{ flex: 1, display: "flex" }}>
              <div
                style={{
                  flex: 1,
                  background: color.panel,
                  border: `1.5px solid ${target ? color.sky : color.line}`,
                  borderRadius: 16,
                  padding: "20px 22px",
                  boxShadow: target ? `0 0 50px ${color.sky}55` : "0 30px 80px rgba(0, 0, 0, 0.45)",
                }}
              >
                <div style={{ fontFamily: mono, fontSize: 27, fontWeight: 600, color: color.sky }}>{home.name}</div>
                <div style={{ fontSize: 25, lineHeight: 1.3, margin: "10px 0 16px", minHeight: 66 }}>{home.what}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                  {home.has.map((item) => (
                    <Chip key={item} color={color.dim} style={{ fontSize: 20 }}>
                      {item}
                    </Chip>
                  ))}
                </div>
              </div>
            </Appear>
          );
        })}
      </div>

      <Appear at={TYPE_AT - 12}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            background: color.panel,
            border: `1.5px solid ${color.line}`,
            borderRadius: 16,
            padding: "18px 24px",
            minHeight: 118,
            boxSizing: "border-box",
          }}
        >
          <span style={{ fontSize: 24, color: color.dim, whiteSpace: "nowrap" }}>
            Open project: <span style={{ fontFamily: mono, color: color.text }}>shop-backend</span>
          </span>
          {sent ? (
            <Bubble who="you">{REQUEST}</Bubble>
          ) : (
            <div
              style={{
                flex: 1,
                fontFamily: mono,
                fontSize: 26,
                border: `1.5px solid ${color.sky}`,
                borderRadius: 12,
                padding: "14px 18px",
                background: color.raised,
              }}
            >
              {typed(REQUEST, frame, TYPE_AT, 0.8)}
              <span style={{ color: color.sky, opacity: frame % 20 < 10 ? 1 : 0 }}>|</span>
            </div>
          )}
          {sent ? (
            <Appear at={ROUTED_AT - 8} from="left">
              <Bubble who="agent">
                That belongs in <span style={{ fontFamily: mono, color: color.sky }}>internet-search</span>. Opening it.
              </Bubble>
            </Appear>
          ) : null}
        </div>
      </Appear>
    </Scene>
  );
};
