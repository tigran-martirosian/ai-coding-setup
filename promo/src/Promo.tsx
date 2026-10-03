import React from "react";
import { Series } from "remotion";
import { SCENES } from "./scenes";

export const Promo: React.FC = () => (
  <Series>
    {SCENES.map((scene) => (
      <Series.Sequence key={scene.id} name={scene.id} durationInFrames={scene.durationInFrames}>
        <scene.component durationInFrames={scene.durationInFrames} />
      </Series.Sequence>
    ))}
  </Series>
);
