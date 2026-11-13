import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Rail } from "./kit";
import { color } from "./look";
import { timeline } from "./script";
import { ShotView } from "./Shots";

/** Plays the named shots one after another on the one background: all of them for the film, or a few for a clip. */
export const Film: React.FC<{ shots?: string[] }> = ({ shots }) => (
  <AbsoluteFill style={{ background: color.bg }}>
    {timeline(shots).map((item) => (
      <Sequence
        key={item.id}
        name={item.id}
        from={item.from}
        durationInFrames={item.frames}
        layout="none"
      >
        <ShotView shot={item.shot} />
      </Sequence>
    ))}
    {shots ? null : <Rail />}
  </AbsoluteFill>
);
