import os from "node:os";
import path from "node:path";
import { createExtensionConfig } from "@nimbalyst/extension-sdk/vite";
import { defineConfig, mergeConfig } from "vite";
import { extensionConfig } from "../shared/vite-base.mts";

export default defineConfig(
  extensionConfig(
    mergeConfig,
    createExtensionConfig({ entry: "./src/index.tsx" }),
    {
      // The folder the map check runs in (src/store.ts trusted): never the open project
      define: {
        __CLAUDE_DIR__: JSON.stringify(path.join(os.homedir(), ".claude")),
      },
    },
  ),
);
