import React from "react";
import { Composition, Folder } from "remotion";
import { Promo } from "./Promo";
import { Film } from "./film/Film";
import { CHECKS_CLIP, clipFrames, FILM_FRAMES } from "./film";
import { FPS as FILM_FPS, frames, SCRIPT } from "./film/script";
import { ShotView } from "./film/Shots";
import { CLIPS, SCENES, totalFrames } from "./scenes";
import { FPS, HEIGHT, WIDTH } from "./theme";

const size = { width: WIDTH, height: HEIGHT, fps: FPS };
const filmSize = { ...size, fps: FILM_FPS };

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Promo" component={Film} durationInFrames={FILM_FRAMES} {...filmSize} />
    <Composition id="clip-checks" component={Film} defaultProps={{ shots: CHECKS_CLIP }} durationInFrames={clipFrames(CHECKS_CLIP)} {...filmSize} />
    <Folder name="Shots">
      {SCRIPT.map((shot) => (
        <Composition key={shot.id} id={shot.id} component={ShotView} defaultProps={{ shot }} durationInFrames={frames(shot)} {...filmSize} />
      ))}
    </Folder>
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
