import React from "react";
import { Series } from "remotion";
import { scenesById } from "./scenes";

/**
 * Plays the named scenes one after another: all of them for the full video, a few for a clip.
 * The prop is a list of names because Remotion passes props as JSON, which can't carry components.
 */
export const Promo: React.FC<{ sceneIds: string[] }> = ({ sceneIds }) => (
  <Series>
    {scenesById(sceneIds).map((scene) => (
      <Series.Sequence key={scene.id} name={scene.id} durationInFrames={scene.durationInFrames}>
        <scene.component durationInFrames={scene.durationInFrames} />
      </Series.Sequence>
    ))}
  </Series>
);
