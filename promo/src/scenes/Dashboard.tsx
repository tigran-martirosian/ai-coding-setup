import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color } from "../theme";
import { Bar } from "../ui";

// Made-up figures and project names. The sections are the ones on the real page.
const RANGES = ["Today", "7 days", "30 days", "All"] as const;

const PROJECTS = [
  { name: "shop-backend", tokens: "412M", chats: "61 chats", share: 100 },
  { name: "data-pipeline", tokens: "305M", chats: "38 chats", share: 74 },
  { name: "docs-site", tokens: "118M", chats: "22 chats", share: 29 },
  { name: "claude-settings", tokens: "64M", chats: "17 chats", share: 16 },
] as const;

const MODELS = [
  { name: "Opus", tokens: "702M", share: 100, part: "78%" },
  { name: "Sonnet", tokens: "171M", share: 24, part: "19%" },
  { name: "Haiku", tokens: "26M", share: 4, part: "3%" },
] as const;

// Tokens per day: the main chat, and the subagents on top of it.
const DAYS = [
  { day: "Mon", main: 38, sub: 4 },
  { day: "Tue", main: 61, sub: 9 },
  { day: "Wed", main: 84, sub: 6 },
  { day: "Thu", main: 52, sub: 22 },
  { day: "Fri", main: 73, sub: 5 },
  { day: "Sat", main: 24, sub: 2 },
  { day: "Sun", main: 45, sub: 7 },
] as const;

const CHATS = [
  { title: "Import orders from CSV", project: "shop-backend", tokens: "58.2M", main: 78, sub: 22 },
  { title: "Monthly report job", project: "data-pipeline", tokens: "41.7M", main: 62, sub: 8 },
  { title: "Rewrite the install guide", project: "docs-site", tokens: "19.4M", main: 31, sub: 2 },
] as const;

const CHART_HEIGHT = 150;

const panel: React.CSSProperties = {
  background: color.panel,
  border: `1.5px solid ${color.line}`,
  borderRadius: 16,
  padding: "18px 24px",
  boxShadow: "0 30px 80px rgba(0, 0, 0, 0.45)",
};
const heading: React.CSSProperties = { fontSize: 26, fontWeight: 700, marginBottom: 10 };
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 18, fontSize: 24, padding: "7px 0" };

const Legend: React.FC<{ tint: string; children: React.ReactNode }> = ({ tint, children }) => (
  <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 20, color: color.dim, fontWeight: 400 }}>
    <span style={{ width: 12, height: 12, borderRadius: 3, background: tint }} />
    {children}
  </span>
);

export const Dashboard: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const opened = frame >= 150;

  return (
    <Scene
      tag="type: usage"
      caption="Typing “usage” opens the dashboard: where the tokens went by project, model, day and chat, and what the same work would cost at API prices."
      durationInFrames={durationInFrames}
      stageStyle={{ flexDirection: "column", gap: 18, alignItems: "stretch", justifyContent: "center" }}
    >
      <Appear at={6}>
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <div style={{ display: "flex", border: `1.5px solid ${color.line}`, borderRadius: 10, overflow: "hidden" }}>
            {RANGES.map((range) => (
              <span
                key={range}
                style={{
                  fontSize: 23,
                  padding: "8px 20px",
                  background: range === "7 days" ? color.sky : color.panel,
                  color: range === "7 days" ? color.panel : color.text,
                  fontWeight: range === "7 days" ? 700 : 400,
                }}
              >
                {range}
              </span>
            ))}
          </div>
          <span style={{ fontSize: 28 }}>
            {Math.round(899 * appear(frame, 12, 40))}M tokens in 138 chats, about{" "}
            <b style={{ color: color.amber }}>${Math.round(486 * appear(frame, 12, 40))}</b> at API prices
          </span>
        </div>
      </Appear>

      <div style={{ display: "flex", gap: 18 }}>
        <Appear at={22} style={{ flex: 1.25 }}>
          <div style={panel}>
            <div style={heading}>Projects</div>
            {PROJECTS.map((project, i) => (
              <div key={project.name} style={{ ...row, borderTop: i ? `1px solid ${color.line}` : "none" }}>
                <span style={{ width: 230 }}>{project.name}</span>
                <div style={{ flex: 1 }}>
                  <Bar value={project.share * appear(frame, 30 + i * 6, 34)} color={color.sky} height={8} />
                </div>
                <b style={{ width: 80, textAlign: "right" }}>{project.tokens}</b>
                <span style={{ width: 110, color: color.dim, fontSize: 21 }}>{project.chats}</span>
              </div>
            ))}
          </div>
        </Appear>
        <Appear at={34} style={{ flex: 1, display: "flex" }}>
          <div style={{ ...panel, flex: 1 }}>
            <div style={heading}>Models</div>
            {MODELS.map((model, i) => (
              <div key={model.name} style={{ ...row, borderTop: i ? `1px solid ${color.line}` : "none" }}>
                <span style={{ width: 110 }}>{model.name}</span>
                <div style={{ flex: 1 }}>
                  <Bar value={model.share * appear(frame, 42 + i * 6, 34)} color={color.sky} height={8} />
                </div>
                <b style={{ width: 80, textAlign: "right" }}>{model.tokens}</b>
                <span style={{ width: 56, color: color.dim, fontSize: 21 }}>{model.part}</span>
              </div>
            ))}
          </div>
        </Appear>
      </div>

      <div style={{ display: "flex", gap: 18 }}>
        <Appear at={62} style={{ flex: 1, display: "flex" }}>
          <div style={{ ...panel, flex: 1 }}>
            <div style={{ ...heading, display: "flex", alignItems: "center", gap: 20 }}>
              <span style={{ flex: 1 }}>Tokens per day</span>
              <Legend tint={color.sky}>Main chat</Legend>
              <Legend tint={color.violet}>Subagents</Legend>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 22, height: CHART_HEIGHT, borderBottom: `1px solid ${color.line}` }}>
              {DAYS.map((day, i) => {
                const grow = appear(frame, 70 + i * 4, 30);
                return (
                  <div key={day.day} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                    <div style={{ height: (day.sub / 110) * CHART_HEIGHT * grow, background: color.violet, borderRadius: "4px 4px 0 0" }} />
                    <div style={{ height: (day.main / 110) * CHART_HEIGHT * grow, background: color.sky }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 22, marginTop: 6 }}>
              {DAYS.map((day) => (
                <span key={day.day} style={{ flex: 1, textAlign: "center", fontSize: 20, color: color.dim }}>
                  {day.day}
                </span>
              ))}
            </div>
          </div>
        </Appear>
        <Appear at={96} style={{ flex: 1.25 }}>
          <div style={panel}>
            <div style={heading}>Chats</div>
            {CHATS.map((chat, i) => (
              <React.Fragment key={chat.title}>
                <div style={{ ...row, borderTop: i ? `1px solid ${color.line}` : "none" }}>
                  <span style={{ color: color.dim, rotate: i === 0 && opened ? "90deg" : "0deg" }}>›</span>
                  <span style={{ flex: 1, whiteSpace: "nowrap" }}>{chat.title}</span>
                  <span style={{ width: 150, color: color.dim, fontSize: 21 }}>{chat.project}</span>
                  <b style={{ width: 86, textAlign: "right" }}>{chat.tokens}</b>
                  <div style={{ width: 150, display: "flex", height: 8 }}>
                    <div style={{ width: `${chat.main * appear(frame, 104, 30)}%`, background: color.sky, borderRadius: 4 }} />
                    <div style={{ width: `${chat.sub * appear(frame, 104, 30)}%`, background: color.violet, borderRadius: 4 }} />
                  </div>
                </div>
                {i === 0 && opened ? (
                  <Appear at={150}>
                    <div
                      style={{
                        fontSize: 22,
                        color: color.dim,
                        background: color.raised,
                        border: `1px solid ${color.line}`,
                        borderRadius: 10,
                        padding: "8px 14px",
                        margin: "2px 0 8px 28px",
                      }}
                    >
                      Opus · largest context 212k ·{" "}
                      <span style={{ color: color.text }}>6 Codex and Gemini runs started from this chat</span>
                    </div>
                  </Appear>
                ) : null}
              </React.Fragment>
            ))}
          </div>
        </Appear>
      </div>
    </Scene>
  );
};
