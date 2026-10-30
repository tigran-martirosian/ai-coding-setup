import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Rail } from "./kit";
import { Part, timeline } from "./script";
import { Chapter, ShotView } from "./Shots";

/** Plays the named shots one after another: all of them for the film, with chapter cards, or a few for a clip. */
export const Film: React.FC<{ shots?: string[] }> = ({ shots }) => (
  <AbsoluteFill>
    {timeline(shots).map((item) => (
      <Sequence key={item.id} name={item.id} from={item.from} durationInFrames={item.frames} layout="none">
        {item.shot ? <ShotView shot={item.shot} /> : <Chapter part={item.part as Part} />}
      </Sequence>
    ))}
    {shots ? null : <Rail />}
  </AbsoluteFill>
);
