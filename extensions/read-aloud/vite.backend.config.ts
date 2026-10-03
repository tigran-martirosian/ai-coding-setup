import { defineConfig } from 'vite';

// Backend module: ESM for Node (Electron utility-process). Node built-ins stay external.
export default defineConfig({
  build: {
    ssr: 'src/backend.ts',
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node20',
    sourcemap: true,
    rollupOptions: {
      output: { format: 'es', entryFileNames: 'backend.js' },
    },
  },
});
