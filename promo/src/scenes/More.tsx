import React from "react";
import { Appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Window } from "../ui";

const ITEMS = [
  { name: "/plan-first", text: "Shows the plan for a big request in a form and starts after your yes." },
  { name: "/full-review", text: "Measures a week of work and ends in a short list of options to tick." },
  { name: "planner", text: "An agent. The strongest model writes the plan and changes nothing; cheaper helpers build." },
  { name: "/shared-usage", text: "On a shared subscription, the usage pop-up shows each person's share of the limits." },
  { name: "Russian", text: "The setup comes in Russian as well as English." },
] as const;

export const More: React.FC<SceneProps> = ({ durationInFrames }) => (
  <Scene tag="also new" caption="Also new in the setup." durationInFrames={durationInFrames}>
    <Window title="Also new" style={{ width: 1500 }} bodyStyle={{ gap: 16 }}>
      {ITEMS.map((item, i) => (
        <Appear key={item.name} at={12 + i * 14}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 24, fontSize: 30 }}>
            <span style={{ fontFamily: mono, fontWeight: 600, color: color.sky, width: 270, flexShrink: 0 }}>{item.name}</span>
            <span>{item.text}</span>
          </div>
        </Appear>
      ))}
    </Window>
  </Scene>
);
