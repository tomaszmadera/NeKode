export interface ActivitySession {
  output: (data: string) => void
  dispose: () => void
}

const SILENCE_MS = 2500
const PUBLICATION_MS = 250

/** One scheduler per workspace. Output mutates timestamps without React updates. */
export function createChatActivity(publish: (active: ReadonlySet<string>) => void) {
  const sessions = new Map<string, { lastOutput: number | null }>()
  let active: ReadonlySet<string> = new Set()
  let timer: ReturnType<typeof setTimeout> | undefined

  function stop(): void {
    clearTimeout(timer)
    timer = undefined
  }

  function publishChanged(next: ReadonlySet<string>): void {
    if (next.size === active.size && [...next].every((id) => active.has(id))) return
    active = next
    publish(next)
  }

  function tick(): void {
    timer = undefined
    const now = Date.now()
    const next = new Set<string>()
    for (const [id, session] of sessions) {
      if (session.lastOutput !== null && now - session.lastOutput < SILENCE_MS) next.add(id)
    }
    publishChanged(next)
    if (next.size > 0) timer = setTimeout(tick, PUBLICATION_MS)
  }

  function remove(chatId: string): void {
    sessions.delete(chatId)
    if (active.has(chatId)) {
      const next = new Set(active)
      next.delete(chatId)
      publishChanged(next)
    }
    if (![...sessions.values()].some((session) => session.lastOutput !== null)) stop()
  }

  return {
    register(chatId: string): ActivitySession {
      remove(chatId)
      // Object identity belongs to this mount, even if chat id/generation is reused.
      const session = { lastOutput: null as number | null }
      sessions.set(chatId, session)
      return {
        output(data) {
          if (data.length === 0 || sessions.get(chatId) !== session) return
          session.lastOutput = Date.now()
          if (timer === undefined) timer = setTimeout(tick, PUBLICATION_MS)
        },
        dispose() {
          if (sessions.get(chatId) === session) remove(chatId)
        },
      }
    },
    remove,
    dispose() {
      stop()
      sessions.clear()
      publishChanged(new Set())
    },
  }
}
