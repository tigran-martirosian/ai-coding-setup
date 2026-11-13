import { defineConfig, mergeConfig } from "vite";
import { createExtensionConfig } from "@nimbalyst/extension-sdk/vite";
import { extensionConfig } from "../shared/vite-base.ts";

// `vite build --mode share` writes dist-share: the same extension without the buttons that only work here.
export default defineConfig(({ mode }) =>
  extensionConfig(
    mergeConfig,
    createExtensionConfig({ entry: "./src/index.tsx" }),
    {
      define: { __SHARE__: JSON.stringify(mode === "share") },
      build: mode === "share" ? { outDir: "dist-share" } : {},
    },
  ),
);
