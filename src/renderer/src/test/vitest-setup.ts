// Global test setup. The split-write prompt submit gap (lib/pty-submit.ts)
// is 0 under tests so PTY write assertions stay synchronous; the app runs
// with the real 150 ms gap. Guarded: the node project has no window.
if (typeof window !== 'undefined') {
  window.NEKODE_PROMPT_SUBMIT_GAP_MS = 0
}

export {}
