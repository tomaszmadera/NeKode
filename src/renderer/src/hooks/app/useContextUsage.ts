import type { AppApi } from '@shared/ipc-contract'
import { useEffect, useState } from 'react'

/** How often the context readout refreshes while the app runs. */
export const CONTEXT_USAGE_POLL_MS = 5000

function sameUsage(previous: Record<string, number>, next: Record<string, number>): boolean {
  const keys = Object.keys(next)
  if (keys.length !== Object.keys(previous).length) return false
  return keys.every((key) => previous[key] === next[key])
}

/**
 * Context tokens per chat, polled from main (spec left-panel Behaviour: the
 * session tile's meter). A chat missing from the result has no readable
 * transcript, so its tile shows no number. A failed read keeps the previous
 * values instead of blanking every tile.
 */
export function useContextUsage(app: AppApi | undefined): Record<string, number> {
  const [usage, setUsage] = useState<Record<string, number>>({})
  useEffect(() => {
    if (app === undefined) return
    let alive = true
    const read = (): void => {
      app.chats
        .contextUsage()
        .then((next) => {
          if (!alive) return
          setUsage((previous) => (sameUsage(previous, next) ? previous : next))
        })
        .catch(() => undefined)
    }
    read()
    const timer = window.setInterval(read, CONTEXT_USAGE_POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [app])
  return usage
}
