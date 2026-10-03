import React from "react";
import { SceneProps } from "../Scene";
import { Btw } from "./Btw";
import { Commands } from "./Commands";
import { Court } from "./Court";
import { Dashboard } from "./Dashboard";
import { EndCard } from "./EndCard";
import { Gates } from "./Gates";
import { Handoff } from "./Handoff";
import { Install } from "./Install";
import { Intro } from "./Intro";
import { Lead } from "./Lead";
import { Permission } from "./Permission";
import { Picture } from "./Picture";
import { Projects } from "./Projects";
import { Rules } from "./Rules";
import { RunYourself } from "./RunYourself";
import { Says } from "./Says";
import { Usage } from "./Usage";
import { Voice } from "./Voice";

export type SceneEntry = { id: string; component: React.FC<SceneProps>; durationInFrames: number };

/** The full video, in order. Change a length here and the totals follow. */
export const SCENES: SceneEntry[] = [
  { id: "Intro", component: Intro, durationInFrames: 90 },
  { id: "Permission", component: Permission, durationInFrames: 180 },
  { id: "RunYourself", component: RunYourself, durationInFrames: 180 },
  { id: "Says", component: Says, durationInFrames: 230 },
  { id: "Gates", component: Gates, durationInFrames: 200 },
  { id: "Court", component: Court, durationInFrames: 210 },
  { id: "Lead", component: Lead, durationInFrames: 230 },
  { id: "Btw", component: Btw, durationInFrames: 180 },
  { id: "Handoff", component: Handoff, durationInFrames: 230 },
  { id: "Usage", component: Usage, durationInFrames: 200 },
  { id: "Dashboard", component: Dashboard, durationInFrames: 220 },
  { id: "Projects", component: Projects, durationInFrames: 220 },
  { id: "Picture", component: Picture, durationInFrames: 180 },
  { id: "Rules", component: Rules, durationInFrames: 200 },
  { id: "Commands", component: Commands, durationInFrames: 220 },
  { id: "Voice", component: Voice, durationInFrames: 180 },
  { id: "Install", component: Install, durationInFrames: 210 },
  { id: "EndCard", component: EndCard, durationInFrames: 110 },
];

/** The short clips the README shows next to each section: the same scenes, a few at a time. */
const CLIP_SCENES: Record<string, string[]> = {
  checks: ["Permission", "RunYourself", "Says"],
  models: ["Gates", "Court", "Lead"],
  sessions: ["Btw", "Handoff"],
  usage: ["Usage", "Dashboard"],
  projects: ["Projects", "Picture", "Rules"],
  commands: ["Commands"],
  voice: ["Voice"],
};

export const CLIPS = Object.entries(CLIP_SCENES).map(([id, sceneIds]) => ({ id, sceneIds }));

export const ALL_SCENE_IDS = SCENES.map((scene) => scene.id);

export const scenesById = (ids: string[]): SceneEntry[] => ids.map((id) => SCENES.find((scene) => scene.id === id)!);

export const totalFrames = (ids: string[]): number =>
  scenesById(ids).reduce((sum, scene) => sum + scene.durationInFrames, 0);
