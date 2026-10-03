import React from "react";
import { SceneProps } from "../Scene";
import { Btw } from "./Btw";
import { Court } from "./Court";
import { EndCard } from "./EndCard";
import { Gates } from "./Gates";
import { Handoff } from "./Handoff";
import { Intro } from "./Intro";
import { Permission } from "./Permission";
import { Picture } from "./Picture";
import { RunYourself } from "./RunYourself";
import { Usage } from "./Usage";

export type SceneEntry = { id: string; component: React.FC<SceneProps>; durationInFrames: number };

/** The video, in order. Change a length here and the total follows. */
export const SCENES: SceneEntry[] = [
  { id: "Intro", component: Intro, durationInFrames: 90 },
  { id: "Permission", component: Permission, durationInFrames: 180 },
  { id: "RunYourself", component: RunYourself, durationInFrames: 180 },
  { id: "Gates", component: Gates, durationInFrames: 200 },
  { id: "Btw", component: Btw, durationInFrames: 180 },
  { id: "Court", component: Court, durationInFrames: 210 },
  { id: "Usage", component: Usage, durationInFrames: 200 },
  { id: "Picture", component: Picture, durationInFrames: 180 },
  { id: "Handoff", component: Handoff, durationInFrames: 210 },
  { id: "EndCard", component: EndCard, durationInFrames: 110 },
];

export const TOTAL_FRAMES = SCENES.reduce((sum, scene) => sum + scene.durationInFrames, 0);
