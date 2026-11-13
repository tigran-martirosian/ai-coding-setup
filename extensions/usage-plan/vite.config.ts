import { defineConfig, mergeConfig } from "vite";
import { createExtensionConfig } from "@nimbalyst/extension-sdk/vite";
import { extensionConfig } from "../shared/vite-base.ts";

export default defineConfig(
  extensionConfig(
    mergeConfig,
    createExtensionConfig({ entry: "./src/index.tsx" }),
  ),
);
