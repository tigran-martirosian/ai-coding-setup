import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color } from "../theme";
import { Bar, Columns } from "../ui";

// Made-up figures. The layout follows the real pop-up and dashboard.
const PLANS = [
  { name: "Claude", used: 62, tint: color.red, note: "Runs out Thu 4:10 PM" },
  { name: "Codex", used: 18, tint: color.green, note: "Lasts until the reset" },
  { name: "Gemini", used: 9, tint: color.green, note: "Lasts until the reset" },
] as const;

const FORECAST = [
  { day: "Tue", value: 74, label: "74%", tint: color.amber },
  { day: "Wed", value: 91, label: "91%", tint: color.amber },
  { day: "Thu", value: 100, label: "out", tint: color.red },
] as const;

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

  return (
    <Scene
      tag="extension · usage-plan"
      caption="The usage pop-up shows how much of the week is used and when it runs out. The dashboard puts Claude, Codex and Gemini side by side."
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
          <div style={{ ...panel, display: "flex", flexDirection: "column", gap: 24, height: "100%", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 32, fontWeight: 700 }}>This week</span>
              <span style={{ fontSize: 23, color: color.dim }}>as of Mon 9:30 AM</span>
            </div>
            <div style={{ display: "flex", gap: 20 }}>
              {PLANS.map((plan, i) => {
                const grow = appear(frame, 84 + i * 10, 40);
                return (
                  <div
                    key={plan.name}
                    style={{
                      flex: 1,
                      border: `1px solid ${color.line}`,
                      borderRadius: 14,
                      padding: 22,
                      background: color.raised,
                    }}
                  >
                    <div style={{ fontSize: 28, fontWeight: 600 }}>{plan.name}</div>
                    <div style={{ fontSize: 68, fontWeight: 700, color: plan.tint, lineHeight: 1.2 }}>
                      {Math.round(plan.used * grow)}%
                    </div>
                    <Bar value={plan.used * grow} color={plan.tint} />
                    <div style={{ fontSize: 23, color: plan.tint === color.red ? color.red : color.dim, marginTop: 12 }}>
                      {plan.note}
                    </div>
                  </div>
                );
              })}
            </div>
            <div>
              <div style={{ fontSize: 23, color: color.dim, marginBottom: 6 }}>Claude at this pace, by the end of</div>
              {FORECAST.map((row, i) => (
                <div
                  key={row.day}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 24,
                    fontSize: 27,
                    padding: "10px 0",
                    borderTop: i === 0 ? "none" : `1px solid ${color.line}`,
                  }}
                >
                  <span style={{ width: 80 }}>{row.day}</span>
                  <div style={{ flex: 1 }}>
                    <Bar value={row.value * appear(frame, 120 + i * 10, 36)} color={row.tint} height={8} />
                  </div>
                  <span
                    style={{
                      width: 80,
                      textAlign: "right",
                      fontWeight: 700,
                      color: row.tint === color.red ? color.red : color.text,
                    }}
                  >
                    {row.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Appear>
      </Columns>
    </Scene>
  );
};
