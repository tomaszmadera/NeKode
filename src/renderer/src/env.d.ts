/// <reference types="vite/client" />

import type { AppApi } from '../../shared/ipc-contract'

declare global {
  interface Window {
    app: AppApi
    /**
     * Test-only override of the prompt-line submit gap (lib/pty-submit.ts).
     * 0 keeps the CR write synchronous so jsdom tests can assert PTY writes
     * without fake timers; production never sets it.
     */
    NEKODE_PROMPT_SUBMIT_GAP_MS?: number
  }
}
