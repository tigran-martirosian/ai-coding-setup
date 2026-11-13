import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color } from "../theme";
import { Bar, Columns } from "../ui";

// Made-up figures. The layout follows the real pop-up and the "Plan ahead" part of the dashboard.
const AHEAD = [
  { day: "Tue", pace: 67, paceLabel: "67%", budget: "65%", tint: color.green },
  { day: "Wed", pace: 87, paceLabel: "87%", budget: "77%", tint: color.amber },
  { day: "Thu", pace: 100, paceLabel: "out", budget: "89%", tint: color.red },
] as const;

const THIS_COMPUTER = 94;

const panel: React.CSSProperties = {
  background: color.panel,
  border: `1.5px solid ${color.line}`,
  borderRadius: 16,
  padding: 28,
  boxShadow: "0 30px 80px rgba(0, 0, 0, 0.45)",
};

const Limit: React.FC<{ title: string; window: string; used: number; tint: string; resets: string; grow: number }> = ({
  title,
  window,
  used,
  tint,
  resets,
  grow,
}) => (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 30, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 23, color: color.dim }}>{window}</div>
      </div>
      <div style={{ textAlign: "right", color: tint }}>
        <div style={{ fontSize: 50, fontWeight: 700, lineHeight: 1 }}>{Math.round(used * grow)}%</div>
        <div style={{ fontSize: 21 }}>used</div>
      </div>
    </div>
    <Bar value={used * grow} color={tint} />
    <div style={{ fontSize: 23, color: color.dim, marginTop: 10 }}>{resets}</div>
  </div>
);

export const Usage: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const split = THIS_COMPUTER * appear(frame, 150, 36);

  return (
    <Scene
      tag="extension · usage-plan"
      caption="Not only how much is used: when the week runs out at this pace, the daily budget that would make it last, and how much of it was this computer."
      durationInFrames={durationInFrames}
    >
      <Columns>
        <Appear at={8} from="left" style={{ width: 500 }}>
          <div style={{ ...panel, display: "flex", flexDirection: "column", gap: 28, height: "100%", boxSizing: "border-box" }}>
            <div style={{ fontSize: 32, fontWeight: 700 }}>Usage Plan</div>
            <Limit
              title="Weekly"
              window="7-day window"
              used={62}
              tint={color.red}
              resets="Resets in 3d 4h"
              grow={appear(frame, 18, 40)}
            />
            <Limit
              title="Session"
              window="5-hour window"
              used={21}
              tint={color.green}
              resets="Resets in 2h 40m"
              grow={appear(frame, 28, 40)}
            />
            <Appear at={60}>
              <div
                style={{ border: `1px solid ${color.line}`, borderRadius: 14, padding: "18px 22px", background: color.raised }}
              >
                <div style={{ fontSize: 30, fontWeight: 700 }}>Runs out Thu 4:10 PM</div>
                <div style={{ fontSize: 23, color: color.dim, marginTop: 4 }}>1d 6h before the reset</div>
              </div>
            </Appear>
          </div>
        </Appear>

        <Appear at={70} from="right" style={{ flex: 1 }}>
          <div style={{ ...panel, display: "flex", flexDirection: "column", gap: 18, height: "100%", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 32, fontWeight: 700 }}>Plan ahead</span>
              <span style={{ fontSize: 23, color: color.dim }}>as of Tue 6:10 PM</span>
            </div>
            <div>
              <div style={{ display: "flex", gap: 24, fontSize: 22, color: color.dim, paddingBottom: 4 }}>
                <span style={{ flex: 1 }}>By the end of</span>
                <span style={{ width: 150, textAlign: "right" }}>At this pace</span>
                <span style={{ width: 130, textAlign: "right" }}>On budget</span>
              </div>
              {AHEAD.map((row, i) => (
                <div
                  key={row.day}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 24,
                    fontSize: 27,
                    padding: "9px 0",
                    borderTop: `1px solid ${color.line}`,
                  }}
                >
                  <span style={{ width: 70 }}>{row.day}</span>
                  <div style={{ flex: 1 }}>
                    <Bar value={row.pace * appear(frame, 84 + i * 10, 36)} color={row.tint} height={8} />
                  </div>
                  <span style={{ width: 150, textAlign: "right", fontWeight: 700, color: row.tint === color.red ? color.red : color.text }}>
                    {row.paceLabel}
                  </span>
                  <span style={{ width: 130, textAlign: "right", color: color.dim }}>{row.budget}</span>
                </div>
              ))}
            </div>
            <Appear at={120}>
              <div style={{ fontSize: 26 }}>
                <span style={{ color: color.dim }}>Budget </span>
                <b>12% a day</b> to last; now averaging <b style={{ color: color.red }}>20%</b>.
              </div>
            </Appear>
            <Appear at={144}>
              <div style={{ borderTop: `1px solid ${color.line}`, paddingTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, marginBottom: 10 }}>
                  <span>
                    <span style={{ color: color.dim }}>Who used the plan · </span>This computer <b>{Math.round(split)}%</b>
                  </span>
                  <span>
                    Other use <b>{Math.round(100 - split)}%</b>
                  </span>
                </div>
                <div style={{ display: "flex", height: 10, borderRadius: 10, overflow: "hidden", background: color.faint }}>
                  <div style={{ width: `${split}%`, background: color.sky }} />
                </div>
              </div>
            </Appear>
          </div>
        </Appear>
      </Columns>
    </Scene>
  );
};
