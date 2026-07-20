import { defineConfig } from 'vitest/config';

// The engine (src/) is plain TypeScript with no DOM deps, importable by both the
// Node labeling/training scripts and the browser build. Vite serves web/.
export default defineConfig({
  root: 'web',
  // Relative base so the static build works under any path (e.g. GitHub Pages /repo/).
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  test: {
    root: '.',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
