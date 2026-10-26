import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// electron-vite v5: dependency externalization for main/preload is on by
// default (build.externalizeDeps); the externalizeDepsPlugin import is gone.

const appVersion: string = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version

// Path aliases; keep in sync with tsconfig.node.json, tsconfig.web.json, and
// vitest.config.ts. The renderer gets no @main alias and main/preload get no
// @renderer alias, so cross-process imports fail to resolve.
const sharedAlias = { '@shared': resolve('src/shared') }
const nodeAlias = { ...sharedAlias, '@main': resolve('src/main') }

export default defineConfig({
  main: {
    resolve: { alias: nodeAlias },
  },
  preload: {
    resolve: { alias: nodeAlias },
  },
  renderer: {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
