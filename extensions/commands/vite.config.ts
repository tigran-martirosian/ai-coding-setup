import { defineConfig, mergeConfig } from 'vite';
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';

// `vite build --mode share` writes dist-share: the same extension without the buttons that only work here.
export default defineConfig(({ mode }) =>
  mergeConfig(createExtensionConfig({ entry: './src/index.tsx' }), {
    define: { __SHARE__: JSON.stringify(mode === 'share') },
    build: mode === 'share' ? { outDir: 'dist-share' } : {},
  })
);
