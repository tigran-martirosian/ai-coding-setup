import React from "react";
import { Composition, Folder } from "remotion";
import { Promo } from "./Promo";
import { SCENES, TOTAL_FRAMES } from "./scenes";
import { FPS, HEIGHT, WIDTH } from "./theme";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Promo" component={Promo} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={TOTAL_FRAMES} />
    <Folder name="Scenes">
      {SCENES.map((scene) => (
        <Composition
          key={scene.id}
          id={scene.id}
          component={scene.component}
          defaultProps={{ durationInFrames: scene.durationInFrames }}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={scene.durationInFrames}
        />
      ))}
    </Folder>
  </>
);
