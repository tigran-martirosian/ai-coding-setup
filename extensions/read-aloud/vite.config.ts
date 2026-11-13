import { defineConfig, mergeConfig } from 'vite';
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';
import { extensionConfig } from '../shared/vite-base.ts';

// Only this UI build uses the language; the backend build (vite.backend.config.ts) has no translated text.
export default defineConfig(extensionConfig(mergeConfig, createExtensionConfig({ entry: './src/index.tsx' })));
