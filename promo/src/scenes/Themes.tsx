import React from "react";
import { interpolateColors, useCurrentFrame } from "remotion";
import { Appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";

// The colours of the themes, as in extensions/ink-themes/themes.mjs.
const THEMES = [
  { name: "Ink Aurora", bg: "#14121c", side: "#0f0d16", raised: "#1f1c2c", border: "#2a2639", text: "#ebe9f3", muted: "#c1bdd1", faint: "#958fa9", primary: "#7a6dc9", onPrimary: "#ffffff" },
  { name: "Ink Ivy", bg: "#171b19", side: "#111513", raised: "#222826", border: "#2e3632", text: "#e7ece8", muted: "#b9c4bd", faint: "#8d9a92", primary: "#3f8a5f", onPrimary: "#ffffff" },
  { name: "Ink Graphite", bg: "#2b2a29", side: "#191817", raised: "#383634", border: "#464340", text: "#f1ede7", muted: "#c4bdb3", faint: "#aca499", primary: "#b98452", onPrimary: "#1c140c" },
  { name: "Ink Bone", bg: "#f6f1e6", side: "#ebe4d4", raised: "#fdfaf3", border: "#d5cab5", text: "#2b2620", muted: "#584f44", faint: "#6f6558", primary: "#9a5a3c", onPrimary: "#ffffff" },
  { name: "Ink Tide", bg: "#111a20", side: "#0c1318", raised: "#1a272f", border: "#26363f", text: "#e6eef1", muted: "#b6c6cd", faint: "#8a9ca4", primary: "#26818e", onPrimary: "#ffffff" },
  { name: "Ink Ember", bg: "#1b1517", side: "#141011", raised: "#282023", border: "#382d31", text: "#f1e9ea", muted: "#cdbfc2", faint: "#a39397", primary: "#b0506a", onPrimary: "#ffffff" },
  { name: "Ink Frost", bg: "#f1f4f7", side: "#e3e8ee", raised: "#fbfcfd", border: "#c5cdd8", text: "#1c232c", muted: "#444f5d", faint: "#586473", primary: "#35609a", onPrimary: "#ffffff" },
  { name: "Ink Saffron", bg: "#1a1a17", side: "#121210", raised: "#262622", border: "#35352f", text: "#efede3", muted: "#c8c5b6", faint: "#9d9a8b", primary: "#d2a03c", onPrimary: "#1d1503" },
  { name: "Ink Cobalt", bg: "#12151f", side: "#0d0f17", raised: "#1c2130", border: "#2a3044", text: "#e8ebf5", muted: "#bcc3d8", faint: "#8e96b0", primary: "#3f6fd8", onPrimary: "#ffffff" },
  { name: "Ink Blossom", bg: "#f8f1f2", side: "#eee3e6", raised: "#fefbfb", border: "#dcc9ce", text: "#2a1f23", muted: "#56464c", faint: "#6a585e", primary: "#a8406a", onPrimary: "#ffffff" },
  { name: "Ink Slate", bg: "#22262b", side: "#16191d", raised: "#2e333a", border: "#3d434b", text: "#eef0f2", muted: "#c2c8cf", faint: "#a3aab3", primary: "#e0823c", onPrimary: "#1f1005" },
] as const;

type Key = Exclude<keyof (typeof THEMES)[number], "name">;

const FIRST_AT = 24;
const PER_THEME = 24;
const FADE = 8;
const SESSIONS = ["Fix the login page", "Weekly report", "Tidy the sessions board"] as const;

export const Themes: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const step = Math.min(THEMES.length - 1, Math.max(0, Math.floor((frame - FIRST_AT) / PER_THEME)));
  const next = Math.min(THEMES.length - 1, step + 1);
  const local = frame - FIRST_AT - step * PER_THEME;
  // Each colour holds, then moves to the next theme's in the last frames of its turn
  const c = (key: Key) => interpolateColors(local, [PER_THEME - FADE, PER_THEME], [THEMES[step][key], THEMES[next][key]]);
  const shown = local >= PER_THEME - FADE / 2 ? next : step;

  return (
    <Scene
      tag="extension · ink-themes"
      caption="Eleven colour themes for the editor that share one look, folded into one row of the Theme menu. A test checks that every text colour can be read."
      durationInFrames={durationInFrames}
      stageStyle={{ flexDirection: "column", gap: 30 }}
    >
      <Appear at={6}>
        <div
          style={{
            display: "flex",
            width: 1360,
            height: 500,
            borderRadius: 20,
            overflow: "hidden",
            border: `1.5px solid ${c("border")}`,
            background: c("bg"),
            color: c("text"),
            boxShadow: "0 30px 80px rgba(0, 0, 0, 0.45)",
          }}
        >
          <div style={{ width: 400, padding: 26, background: c("side"), borderRight: `1.5px solid ${c("border")}` }}>
            <div style={{ fontSize: 30, fontWeight: 700 }}>my-project</div>
            <div style={{ fontFamily: mono, fontSize: 19, color: c("faint"), marginTop: 4 }}>~/projects/my-project</div>
            <div
              style={{
                marginTop: 22,
                padding: "14px 20px",
                borderRadius: 14,
                fontSize: 26,
                fontWeight: 600,
                background: c("primary"),
                color: c("onPrimary"),
              }}
            >
              + New session
            </div>
            {SESSIONS.map((title, i) => (
              <div
                key={title}
                style={{
                  marginTop: i === 0 ? 22 : 8,
                  padding: "12px 16px",
                  borderRadius: 14,
                  fontSize: 25,
                  background: i === 0 ? c("raised") : "transparent",
                  color: i === 0 ? c("text") : c("muted"),
                }}
              >
                {title}
              </div>
            ))}
          </div>
          <div style={{ flex: 1, padding: 34, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ fontSize: 50, fontWeight: 700, letterSpacing: -1, marginTop: 70 }}>What are we working on?</div>
            <div style={{ fontSize: 27, color: c("muted"), marginTop: 12 }}>{THEMES[shown].name}</div>
            <div
              style={{
                marginTop: "auto",
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 14px 14px 26px",
                borderRadius: 20,
                fontSize: 27,
                background: c("raised"),
                border: `1.5px solid ${c("border")}`,
                color: c("faint"),
              }}
            >
              <span>Type your message…</span>
              <span style={{ padding: "10px 26px", borderRadius: 14, fontWeight: 600, background: c("primary"), color: c("onPrimary") }}>
                Send
              </span>
            </div>
          </div>
        </div>
      </Appear>

      <Appear at={14}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 14, width: 1500 }}>
          {THEMES.map((theme, i) => (
            <div
              key={theme.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 20px",
                borderRadius: 999,
                fontSize: 23,
                fontWeight: 600,
                background: color.panelHead,
                border: `1.5px solid ${i === shown ? color.sky : color.line}`,
                color: i === shown ? color.text : color.dim,
              }}
            >
              <span style={{ width: 20, height: 20, borderRadius: 10, background: theme.primary }} />
              {theme.name}
            </div>
          ))}
        </div>
      </Appear>
    </Scene>
  );
};
