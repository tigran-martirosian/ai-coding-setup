import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, appear, typed } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Bubble, ToolRow, Window } from "../ui";

const COMMAND = "rm -rf dist .cache && npm run build";
const EXPLAIN_LABEL = "# WHAT THIS DOES:";
const EXPLAIN = " deletes the dist and .cache folders, then builds the project again. Nothing is sent out.";
const ALLOW_AT = 138;

export const Permission: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const explain = appear(frame, 82, 18);
  const allowed = frame >= ALLOW_AT;
  const press = appear(frame, ALLOW_AT, 10);

  return (
    <Scene
      tag="hook · command-explain"
      caption="Every command in a permission popup ends with a line in plain words: what it does and what it changes."
      durationInFrames={durationInFrames}
    >
      <Window title="Chat" style={{ width: 640 }}>
        <Appear at={8} style={{ display: "flex", flexDirection: "column" }}>
          <Bubble who="you">Clear the build cache and rebuild.</Bubble>
        </Appear>
        <Appear at={24} style={{ display: "flex", flexDirection: "column" }}>
          <Bubble who="agent">Clearing the cache, then building.</Bubble>
        </Appear>
        <Appear at={38}>
          <ToolRow tool="Bash" text={allowed ? "allowed" : "asks permission"} status={allowed ? "ok" : "running"} />
        </Appear>
      </Window>

      <Appear at={44} from="right" style={{ flex: 1 }}>
        <Window title="Allow this command?" chip="PERMISSION" active>
          <div
            style={{
              fontFamily: mono,
              fontSize: 29,
              lineHeight: 1.5,
              background: color.raised,
              border: `1px solid ${color.line}`,
              borderRadius: 12,
              padding: 24,
              minHeight: 250,
            }}
          >
            <div>{typed(COMMAND, frame, 54, 1.6) || " "}</div>
            <div
              style={{
                marginTop: 24,
                opacity: explain,
                background: `${color.green}${explain > 0.5 ? "1f" : "00"}`,
                borderLeft: `5px solid ${color.green}`,
                borderRadius: 6,
                padding: "10px 16px",
              }}
            >
              <span style={{ color: color.green, fontWeight: 600 }}>{EXPLAIN_LABEL}</span>
              {EXPLAIN}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 16 }}>
            <Button label="Deny" />
            <Button label={allowed ? "Allowed" : "Allow"} primary scale={1 + 0.06 * Math.sin(press * Math.PI)} />
          </div>
        </Window>
      </Appear>
    </Scene>
  );
};

const Button: React.FC<{ label: string; primary?: boolean; scale?: number }> = ({ label, primary, scale = 1 }) => (
  <div
    style={{
      fontSize: 27,
      fontWeight: 600,
      padding: "12px 34px",
      borderRadius: 10,
      background: primary ? color.sky : color.line,
      color: primary ? color.panel : color.text,
      scale: String(scale),
    }}
  >
    {label}
  </div>
);
