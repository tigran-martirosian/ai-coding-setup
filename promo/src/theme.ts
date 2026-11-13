import { loadFont as loadSans } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

export const sans = loadSans("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["400", "600"], subsets: ["latin"] }).fontFamily;

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// The dark palette of the editor the mock-ups redraw.
export const color = {
  bg: "#0b1220",
  bgGlow: "#15233f",
  panel: "#020617",
  panelHead: "#0f172a",
  raised: "#111a2e",
  line: "#1e293b",
  text: "#f8fafc",
  dim: "#94a3b8",
  faint: "#475569",
  sky: "#38bdf8",
  red: "#ef4444",
  green: "#10b981",
  amber: "#eab308",
  violet: "#a78bfa",
} as const;
