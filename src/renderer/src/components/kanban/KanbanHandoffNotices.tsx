import type { AppApi, HandoffRejection, WorkItem } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TEST_ID } from '../../lib/test-ids'

// Resume availability for the board (spec Task and file Resume sources, NEKODE-142):
// Resume is hidden until a discovery succeeds and the item has a matching
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
 * Case-insensitive match on the full ref: exact equality or ref followed by a hyphen.
 * (e.g. "NEKODE-2" matches "nekode-2" or "nekode-2-slug", but not "nekode-20" or "old-nekode-2").
 */
export function matchesTaskRef(ref: string, candidateId: string): boolean {
  const r = ref.trim().toLowerCase()
  const c = candidateId.trim().toLowerCase()
  return c === r || c.startsWith(`${r}-`)
}

/**
 * One batch check for the loaded items: discovers the project's reusable template
 * candidates, then matches against every loaded item ref. Identical concurrent triggers
 * are coalesced; a different item set is its own generation.
 */
export function useHandoffAvailability(app: AppApi, projectId: string): HandoffAvailability {
  const [phase, setPhase] = useState<HandoffPhase>('loading')
  const [availableIds, setAvailableIds] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<HandoffRejection[]>([])
  const pending = useRef<string | null>(null)
  const generation = useRef(0)

  const reset = useCallback((): void => {
    generation.current += 1
    pending.current = null
    setPhase('loading')
    setAvailableIds(new Set())
    setError(null)
    setWarnings([])
  }, [])

  useEffect(() => {
    const unsub = app.resumeSources?.onChanged?.(() => {
      reset()
    })
    return () => {
      generation.current += 1
      pending.current = null
      unsub?.()
    }
  }, [app, reset])

  const load = useCallback(
    async (items: Array<{ itemId: string; ref: string }>): Promise<void> => {
      const signature = items.map((entry) => `${entry.itemId}:${entry.ref}`).join('|')
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
        const binding = await app.resumeSources.binding(projectId)
        if (requestGeneration !== generation.current) return
        if (!binding.templateId) {
          setPhase('not-configured')
          return
        }
        const requestId = `kanban-avail-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const discovery = await app.resumeSources.discover(projectId, requestId)
        if (requestGeneration !== generation.current) return
        const matched = new Set<string>()
        for (const item of items) {
          if (discovery.candidates.some((candidate) => matchesTaskRef(item.ref, candidate.id))) {
            matched.add(item.itemId)
          }
        }
        setAvailableIds(matched)
        setWarnings(
          discovery.rejections.map((r) => ({ name: r.path, path: r.path, reason: r.reason })),
        )
        setPhase('ready')
      } catch (cause) {
        if (requestGeneration !== generation.current) return
        setPhase('error')
        const message =
          (cause instanceof Error && cause.message ? cause.message : null) ??
          parseAppErrorPayload(cause)?.message ??
          'Failed to discover Resume sources.'
        setError(message)
      } finally {
        if (requestGeneration === generation.current) {
          pending.current = null
        }
      }
    },
    [app, projectId],
  )

  const itemResumable = (item: WorkItem): boolean => phase === 'ready' && availableIds.has(item.id)

  return { phase, error, warnings, itemResumable, load, reset }
}

/**
 * Inline Resume source notices beneath the board header: an unconfigured template
 * offers Configure Resume, a read failure is its own state with Retry, and rejected
 * items are named warnings.
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
        <p className="text-ink-secondary">No Resume template is configured for this project.</p>
        <button
          type="button"
          className="mt-2 h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover"
          data-testid={TEST_ID.kanbanHandoffConfigure}
          onClick={onConfigureHandoffs}
        >
          Configure Resume
        </button>
      </div>
    )
  }
  if (phase === 'error') {
    return (
      <div className="mb-3 text-[12.6px]" data-testid={TEST_ID.kanbanHandoffError}>
        <p className="text-error">{error ?? 'Failed to discover Resume sources.'}</p>
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
