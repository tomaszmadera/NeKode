import { useCallback, useRef, useState } from 'react'

// Shared mutation-in-flight guard (settings panels). Every guarded handler
// runs its mutation through `run`: a second activation while one is in flight
// does nothing, `busy` is true for the duration (it drives the guarded
// buttons' `disabled`), and the guard releases when the mutation resolves or
// rejects (unlock on error). The in-flight ref is the authority, not the
// `busy` state, so a rapid second activation in the same frame is still
// blocked.

export interface MutationGuard {
  /** True while a mutation is in flight; drives `disabled` on the guarded controls. */
  busy: boolean
  /** Whether a mutation is in flight (for precondition checks before `run`). */
  inFlight: () => boolean
  /**
   * Runs `task` under the guard. A `run` while one is in flight returns
   * without calling `task`. The guard releases when `task` resolves or
   * rejects. With `isCurrent` given, the release is skipped while it returns
   * false: a stale run that was superseded (e.g. by a project switch) must
   * not unlock the run that replaced it (latched-release contract: a skipped
   * release keeps the guard locked until `reset()`).
   */
  run: (task: () => Promise<void>, isCurrent?: () => boolean) => Promise<void>
  /** Releases the guard unconditionally (panel reset, e.g. on project switch). */
  reset: () => void
}

export function useMutationGuard(): MutationGuard {
  const inFlightRef = useRef(false)
  const [busy, setBusy] = useState(false)

  // Stable identities (no render-scope values are captured): `reset` may sit
  // in an effect dependency list without re-running the effect per render.
  const inFlight = useCallback((): boolean => inFlightRef.current, [])

  const run = useCallback(
    async (task: () => Promise<void>, isCurrent?: () => boolean): Promise<void> => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      setBusy(true)
      try {
        await task()
      } finally {
        if (isCurrent === undefined || isCurrent()) {
          inFlightRef.current = false
          setBusy(false)
        }
      }
    },
    [],
  )

  const reset = useCallback((): void => {
    inFlightRef.current = false
    setBusy(false)
  }, [])

  return { busy, inFlight, run, reset }
}
