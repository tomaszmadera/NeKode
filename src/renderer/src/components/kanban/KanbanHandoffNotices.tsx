import type { AppApi, HandoffRejection, WorkItem } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TEST_ID } from '../../lib/test-ids'

// Handoff availability for the board (spec Resume availability): Resume is
// hidden until a batch check succeeds and the item has a readable accepted
// candidate. The check runs beside the board load and never delays rendering
// the board.

export type HandoffPhase = 'loading' | 'not-configured' | 'error' | 'ready'

export interface HandoffAvailability {
  phase: HandoffPhase
  error: string | null
  warnings: HandoffRejection[]
  /** Resume is shown only for an item the batch check proved available. */
  itemResumable: (item: WorkItem) => boolean
  /** Runs one batch check for these items. */
  load: (items: Array<{ itemId: string; ref: string }>) => Promise<void>
  /** Drops the shown result and any in-flight check (a project change). */
  reset: () => void
}

/**
 * One batch handoff check for the loaded items: one directory read, then the
 * same snapshot matched against every item. Identical concurrent triggers are
 * coalesced; a different item set is its own generation, so an older result
 * never marks a new item available (spec Resume availability items 6-9).
 */
export function useHandoffAvailability(app: AppApi, projectId: string): HandoffAvailability {
  const [phase, setPhase] = useState<HandoffPhase>('loading')
  const [availableIds, setAvailableIds] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<HandoffRejection[]>([])
  const pending = useRef<string | null>(null)
  const generation = useRef(0)

  const reset = useCallback((): void => {
    // A project change (or a direct projectId switch in a test) is a new scan
    // generation: a late response for the previous project never restores Resume.
    generation.current += 1
    pending.current = null
    setPhase('loading')
    setAvailableIds(new Set())
    setError(null)
    setWarnings([])
  }, [])

  // A disposed session ignores late responses (including StrictMode replay).
  useEffect(() => {
    return () => {
      generation.current += 1
      pending.current = null
    }
  }, [])

  const load = useCallback(
    async (items: Array<{ itemId: string; ref: string }>): Promise<void> => {
      const signature = items.map((entry) => `${entry.itemId}:${entry.ref}`).join('|')
      // The same load firing twice for an unchanged item set is one request.
      if (pending.current === signature) {
        return
      }
      const requestGeneration = ++generation.current
      pending.current = signature
      setPhase('loading')
      setAvailableIds(new Set())
      setError(null)
      setWarnings([])
      try {
        const result = await app.kanban.handoffAvailability({ projectId, items })
        if (requestGeneration !== generation.current) return
        if (result.state === 'not-configured') {
          setPhase('not-configured')
          return
        }
        if (result.state === 'error') {
          setPhase('error')
          setError(result.message)
          return
        }
        setAvailableIds(
          new Set(result.items.filter((entry) => entry.available).map((entry) => entry.itemId)),
        )
        setWarnings(result.rejections)
        setPhase('ready')
      } catch (cause) {
        if (requestGeneration !== generation.current) return
        setPhase('error')
        setError(parseAppErrorPayload(cause)?.message ?? 'Failed to read the handoff directory.')
      } finally {
        if (requestGeneration === generation.current) {
          pending.current = null
        }
      }
    },
    [app, projectId],
  )

  // The backend status and the mere presence of files never decide (spec
  // Resume availability item 2).
  const itemResumable = (item: WorkItem): boolean => phase === 'ready' && availableIds.has(item.id)

  return { phase, error, warnings, itemResumable, load, reset }
}

/**
 * Inline handoff-directory notices beneath the board header (spec Resume
 * availability items 3-4): an unconfigured directory offers Configure handoffs, a read
 * failure is its own state with Retry, and rejected files are named warnings.
 * A read failure never removes the loaded board; the notices render above it.
 */
export function HandoffNotices({
  phase,
  error,
  warnings,
  onConfigureHandoffs,
  onRetry,
}: {
  phase: 'not-configured' | 'error' | 'ready'
  error: string | null
  warnings: HandoffRejection[]
  onConfigureHandoffs?: () => void
  onRetry: () => void
}): React.JSX.Element | null {
  if (phase === 'not-configured') {
    return (
      <div className="mb-3 text-[12.6px]" data-testid={TEST_ID.kanbanHandoffNotConfigured}>
        <p className="text-ink-secondary">Handoff directory is not configured.</p>
        <button
          type="button"
          className="mt-2 h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover"
          data-testid={TEST_ID.kanbanHandoffConfigure}
          onClick={onConfigureHandoffs}
        >
          Configure handoffs
        </button>
      </div>
    )
  }
  if (phase === 'error') {
    return (
      <div className="mb-3 text-[12.6px]" data-testid={TEST_ID.kanbanHandoffError}>
        <p className="text-error">{error ?? 'Failed to read the handoff directory.'}</p>
        <button
          type="button"
          className="mt-2 h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover"
          data-testid={TEST_ID.kanbanHandoffRetry}
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    )
  }
  if (warnings.length > 0) {
    return (
      <ul
        className="mb-3 list-none space-y-1 text-[12.6px] text-warning"
        data-testid={TEST_ID.kanbanHandoffWarnings}
      >
        {warnings.map((warning) => (
          <li key={warning.name}>
            {warning.name}: {warning.reason}
          </li>
        ))}
      </ul>
    )
  }
  return null
}
