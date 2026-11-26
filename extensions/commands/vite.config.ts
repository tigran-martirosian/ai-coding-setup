import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExtensionConfig } from "@nimbalyst/extension-sdk/vite";
import { defineConfig, mergeConfig } from "vite";
import { extensionConfig } from "../shared/vite-base.mts";

// The skills installed here: own.ts buttons show only when their skill is (own.ts is in the public repo too).
const skillsDir = path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
  "skills",
);
const skills = fs.existsSync(skillsDir)
  ? fs
      .readdirSync(skillsDir)
      .filter((n) => fs.existsSync(path.join(skillsDir, n, "SKILL.md")))
  : [];

// `vite build --mode share` writes dist-share: the same extension without the buttons that only work here.
export default defineConfig(({ mode }) =>
  extensionConfig(
    mergeConfig,
    createExtensionConfig({ entry: "./src/index.tsx" }),
    {
      define: {
        __SHARE__: JSON.stringify(mode === "share"),
        __SKILLS__: JSON.stringify(skills),
      },
      build: mode === "share" ? { outDir: "dist-share" } : {},
    },
  ),
);
