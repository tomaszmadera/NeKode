/// <reference types="vite/client" />

import type { AppApi, PreviewApi } from '@shared/ipc-contract'

declare global {
  /** package.json version, injected at build time (electron.vite and vitest configs). */
  const __APP_VERSION__: string

  interface Window {
    app: AppApi
    /** Present only in file preview windows (src/preload/index.ts bridge selection). */
    preview?: PreviewApi
    /**
     * Test-only override of the prompt-line submit gap (lib/pty-submit.ts).
     * 0 keeps the CR write synchronous so jsdom tests can assert PTY writes
     * without fake timers; production never sets it.
     */
    NEKODE_PROMPT_SUBMIT_GAP_MS?: number
  }
}
