import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import type { Part } from "./script";

// The look of the tour film: one near-black background from the first frame to the last, light type, all of it in
// JetBrains Mono, and each chapter's colour only as a small mark (a dot, a label, a thin line, a highlight). Red and
// green say wrong and right. Never a coloured field, no gradients, no glow.
export const mono = loadMono("normal", {
  weights: ["400", "600", "700"],
  subsets: ["latin"],
}).fontFamily;

export const color = {
  /** The one background of the whole film. */
  bg: "#111114",
  text: "#e8e8ec",
  /** Window headers: one step lighter than `dim`, so they read at 900 px wide. */
  soft: "#b0b0b8",
  dim: "#8c8c94",
  faint: "#4a4a52",
  line: "#2a2a30",
  window: "#17171b",
  raised: "#1e1e23",
  /** Something wrong: a claim with no step behind it, a flaw. */
  bad: "#ff6b5e",
  /** Something put right. */
  good: "#6fd88a",
} as const;

/** Each chapter's colour, light enough to read as a small mark on the background. */
export const accent: Record<Part, string> = {
  Overview: "#7d93ff",
  Checks: "#ff8a5c",
  Cost: "#c6f135",
  Ask: "#a988ff",
  Steer: "#ffc800",
  Install: "#5fd0bd",
};

/** Type sizes at 1920x1080. GitHub shows the film at 1600x900 and often smaller, so nothing goes below `label`.
 * A monospace letter is 0.6 of its size wide: a 60 px headline fits about 49 letters across. */
export const TYPE = {
  /** A shot's headline. */
  head: 60,
  /** The one line under a headline. */
  sub: 30,
  /** Words inside a diagram. */
  body: 34,
  /** Small labels and notes. */
  label: 26,
} as const;

/** Left and right margin of every shot, the top of the diagram under the headline, and the line nothing but the
 * chapter bar goes below. */
export const MARGIN = 72;
export const TOP = 250;
export const FLOOR = 996;
export const WIDTH = 1920;
export const HEIGHT = 1080;
