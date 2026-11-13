import React from "react";
import { Composition, Folder } from "remotion";
import { Promo } from "./Promo";
import { ALL_SCENE_IDS, CLIPS, SCENES, totalFrames } from "./scenes";
import { FPS, HEIGHT, WIDTH } from "./theme";

const size = { width: WIDTH, height: HEIGHT, fps: FPS };

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Promo"
      component={Promo}
      defaultProps={{ sceneIds: ALL_SCENE_IDS }}
      durationInFrames={totalFrames(ALL_SCENE_IDS)}
      {...size}
    />
    <Folder name="Clips">
      {CLIPS.map((clip) => (
        <Composition
          key={clip.id}
          id={`clip-${clip.id}`}
          component={Promo}
          defaultProps={{ sceneIds: clip.sceneIds }}
          durationInFrames={totalFrames(clip.sceneIds)}
          {...size}
        />
      ))}
    </Folder>
    <Folder name="Scenes">
      {SCENES.map((scene) => (
        <Composition
          key={scene.id}
          id={scene.id}
          component={scene.component}
          defaultProps={{ durationInFrames: scene.durationInFrames }}
          durationInFrames={scene.durationInFrames}
          {...size}
        />
      ))}
    </Folder>
  </>
);
