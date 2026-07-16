import { defineConfig } from 'vitest/config';

// The sim (src/) is plain TypeScript with no DOM deps, so it is importable by both
// the Node trainer/headless scripts and the browser build. Vite serves the browser
// consumer (the Phase 1 renderer lives in web/ later); Vitest reuses this config.
export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  test: {
    // Vitest picks up *.test.ts across the repo; the sim tests are colocated in src/.
    root: '.',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
  },
});
