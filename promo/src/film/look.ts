import { loadFont as loadSans } from "@remotion/google-fonts/BricolageGrotesque";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import type { Part } from "./script";

// The look of the tour film: one flat colour for each chapter, edge to edge, with very large type and dark windows
// on top. No gradients and no glow. Size and movement carry the emphasis.
export const sans = loadSans("normal", { weights: ["500", "700"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["400", "600"], subsets: ["latin"] }).fontFamily;

export const color = {
  ink: "#0e0e0e",
  window: "#141416",
  raised: "#202024",
  line: "#2e2e33",
  dim: "#8c8c94",
  white: "#ffffff",
  paper: "#f4f3ee",
  red: "#ff4a1c",
  blue: "#1a3cff",
  lime: "#c6f135",
  violet: "#7a3cff",
  yellow: "#ffc800",
} as const;

/** The colour of each chapter, the text colour that reads on it, and a slightly different shade for what moves behind. */
export const partColor: Record<Part, { bg: string; on: string; shade: string }> = {
  Overview: { bg: color.blue, on: color.white, shade: "#3a57ff" },
  Checks: { bg: color.red, on: color.white, shade: "#ff6a43" },
  Cost: { bg: color.lime, on: color.ink, shade: "#aed926" },
  "Big jobs": { bg: color.violet, on: color.white, shade: "#8f5aff" },
  Tools: { bg: color.yellow, on: color.ink, shade: "#e8b500" },
  Install: { bg: color.ink, on: color.white, shade: "#232326" },
};

/** Left and right margin of every shot, and the line nothing but the chapter bar goes below. */
export const MARGIN = 72;
export const FLOOR = 996;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** Headline tracking: tight, as large type needs. */
export const TIGHT = "-0.022em";
