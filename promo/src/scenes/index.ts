import React from "react";
import { SceneProps } from "../Scene";
import { Agents } from "./Agents";
import { Btw } from "./Btw";
import { Commands } from "./Commands";
import { Dashboard } from "./Dashboard";
import { Handoff } from "./Handoff";
import { Phone } from "./Phone";
import { Picture } from "./Picture";
import { Projects } from "./Projects";
import { Rules } from "./Rules";
import { Themes } from "./Themes";
import { Update } from "./Update";
import { Usage } from "./Usage";
import { Voice } from "./Voice";

export type SceneEntry = { id: string; component: React.FC<SceneProps>; durationInFrames: number };

/** The scenes behind the short clips in docs/features.md. The tour film itself is in ../film. */
export const SCENES: SceneEntry[] = [
  { id: "Btw", component: Btw, durationInFrames: 180 },
  { id: "Handoff", component: Handoff, durationInFrames: 230 },
  { id: "Phone", component: Phone, durationInFrames: 270 },
  { id: "Usage", component: Usage, durationInFrames: 200 },
  { id: "Dashboard", component: Dashboard, durationInFrames: 220 },
  { id: "Projects", component: Projects, durationInFrames: 220 },
  { id: "Picture", component: Picture, durationInFrames: 180 },
  { id: "Rules", component: Rules, durationInFrames: 200 },
  { id: "Commands", component: Commands, durationInFrames: 220 },
  { id: "Agents", component: Agents, durationInFrames: 200 },
  { id: "Themes", component: Themes, durationInFrames: 300 },
  { id: "Voice", component: Voice, durationInFrames: 180 },
  { id: "Update", component: Update, durationInFrames: 210 },
];

/** The clips, a few scenes each. */
const CLIP_SCENES: Record<string, string[]> = {
  sessions: ["Btw", "Handoff"],
  usage: ["Usage", "Dashboard"],
  projects: ["Projects", "Picture", "Rules"],
  commands: ["Commands", "Agents"],
  themes: ["Themes"],
  voice: ["Voice"],
  update: ["Update"],
};

export const CLIPS = Object.entries(CLIP_SCENES).map(([id, sceneIds]) => ({ id, sceneIds }));

export const ALL_SCENE_IDS = SCENES.map((scene) => scene.id);

export const scenesById = (ids: string[]): SceneEntry[] => ids.map((id) => SCENES.find((scene) => scene.id === id)!);

export const totalFrames = (ids: string[]): number =>
  scenesById(ids).reduce((sum, scene) => sum + scene.durationInFrames, 0);
