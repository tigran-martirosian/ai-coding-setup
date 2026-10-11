import { defineConfig, mergeConfig } from 'vite';
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';

// The language of the texts is fixed at build time: the installer sets SETUP_LANGUAGE (unset = english).
const language = process.env.SETUP_LANGUAGE || 'english';
if (language !== 'english' && language !== 'russian') {
  throw new Error(`SETUP_LANGUAGE must be "english" or "russian", not "${language}".`);
}

// `vite build --mode share` writes dist-share: the same extension without the buttons that only work here.
export default defineConfig(({ mode }) =>
  mergeConfig(createExtensionConfig({ entry: './src/index.tsx' }), {
    define: { __SHARE__: JSON.stringify(mode === 'share'), __SETUP_LANGUAGE__: JSON.stringify(language) },
    build: mode === 'share' ? { outDir: 'dist-share' } : {},
  })
);
