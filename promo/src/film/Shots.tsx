import React from "react";
import { BlindReview, Lead } from "./BigJobs";
import { Claim } from "./Checks";
import { Install } from "./Close";
import { Usage } from "./Cost";
import { Fade, Field } from "./kit";
import { Compare, Results, Title } from "./Open";
import { Shot } from "./script";
import { Also, Btw, SystemsMap } from "./Tools";

const VIEWS: Record<string, React.FC<{ shot: Shot }>> = {
  open: Title,
  verify: Claim,
  link: Claim,
  lead: Lead,
  blind: BlindReview,
  usage: Usage,
  map: SystemsMap,
  btw: Btw,
  compare: Compare,
  also: Also,
  results: Results,
  install: Install,
};

/** Fades a shot in from the film's background over 0.4 s. Shots cut to the background, never push or wipe. */
const Enter: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Field>
    <Fade style={{ position: "absolute", inset: 0 }}>{children}</Fade>
  </Field>
);

export const ShotView: React.FC<{ shot: Shot }> = ({ shot }) => {
  const View = VIEWS[shot.id];
  if (!View) throw new Error(`No view for shot "${shot.id}".`);
  return (
    <Enter>
      <View shot={shot} />
    </Enter>
  );
};
