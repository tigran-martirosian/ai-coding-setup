import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, typed } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Columns, Window } from "../ui";

// Headings of real rules in rules/CLAUDE.md, each with what it comes to.
const RULES = [
  { name: "Lead with the answer.", gist: "The result first, details after." },
  { name: "Do the work yourself, fully.", gist: "Run it, open it, check it." },
  { name: "Don't assume.", gist: "One question with options when the choice matters." },
  { name: "Fix at the root.", gist: "A repeated mistake changes the rule that caused it." },
] as const;

const FILES = [
  { name: "CLAUDE.md", what: "the rules of this project" },
  { name: "HANDOFF.md", what: "where the work stands, what is next" },
  { name: "DECISIONS.md", what: "what you decided, with dates" },
] as const;

const DECISION = "Orders stay in Postgres (your pick).";
const CONFIRM_AT = 96;
const WRITE_AT = 116;

export const Rules: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();

  return (
    <Scene
      tag="rules · /new-project"
      caption="The rules are plain files. Every project gets a CLAUDE.md, a HANDOFF.md and a DECISIONS.md, and a decision you confirm is written down at once."
      durationInFrames={durationInFrames}
    >
      <Columns>
        <Window title="~/.claude/CLAUDE.md" chip="EVERY SESSION" style={{ flex: 1 }}>
          {RULES.map((rule, i) => (
            <Appear key={rule.name} at={10 + i * 14}>
              <div style={{ borderLeft: `4px solid ${color.sky}`, paddingLeft: 18 }}>
                <div style={{ fontSize: 29, fontWeight: 700 }}>{rule.name}</div>
                <div style={{ fontSize: 25, color: color.dim, marginTop: 2 }}>{rule.gist}</div>
              </div>
            </Appear>
          ))}
        </Window>

        <Window title="A project set up by /new-project" style={{ flex: 1 }}>
          {FILES.map((file, i) => (
            <Appear key={file.name} at={66 + i * 8}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 18,
                  background: color.raised,
                  border: `1px solid ${file.name === "DECISIONS.md" && frame >= WRITE_AT ? color.sky : color.line}`,
                  borderRadius: 12,
                  padding: "12px 18px",
                }}
              >
                <span style={{ fontFamily: mono, fontSize: 26, fontWeight: 600, width: 220 }}>{file.name}</span>
                <span style={{ fontSize: 24, color: color.dim }}>{file.what}</span>
              </div>
            </Appear>
          ))}
          <Appear at={CONFIRM_AT}>
            <div style={{ fontSize: 25, color: color.dim }}>
              You: <span style={{ color: color.text }}>“Yes, keep Postgres.”</span>
            </div>
          </Appear>
          <Appear at={WRITE_AT}>
            <div
              style={{
                fontFamily: mono,
                fontSize: 24,
                lineHeight: 1.4,
                border: `1.5px solid ${color.sky}`,
                background: `${color.sky}1a`,
                borderRadius: 12,
                padding: "12px 18px",
                minHeight: 34,
              }}
            >
              <span style={{ color: color.sky }}>+ </span>
              {typed(DECISION, frame, WRITE_AT + 6, 0.9)}
            </div>
          </Appear>
        </Window>
      </Columns>
    </Scene>
  );
};
