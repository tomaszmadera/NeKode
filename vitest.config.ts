import { defineConfig } from 'vitest/config'

// Vitest 5: environmentMatchGlobs was removed in Vitest 4; per-environment
// routing uses test.projects instead (node for main/preload/shared, jsdom for
// renderer components).
export default defineConfig({
  test: {
    // Renderer tests assert PTY writes synchronously, so the split-write
    // submit gap (lib/pty-submit.ts) must be 0 under jsdom; production never
    // sets this override (env.d.ts Window declaration).
    setupFiles: ['./src/renderer/src/test/vitest-setup.ts'],
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/preload/**/*.test.ts', 'src/shared/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
