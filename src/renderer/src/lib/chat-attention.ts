// Per-chat, in-memory attention state (chat attention badge spec Data/API):
// chat id → { message } with the OSC 9 tooltip text kept for the badge.
// Pure functions over a plain record — no persistence, no app_state, no
// database (AC8): the state lives for one renderer run and disappears with it.

/** Truncation ceiling for the OSC 9 tooltip text (spec Behaviour 3). */
const MAX_TOOLTIP_LENGTH = 120

export interface ChatAttention {
  /** OSC 9 message text kept for the tooltip; null = badge without one. */
  message: string | null
}

/** Marks a chat as needing attention; a newer OSC 9 message replaces the tooltip text. */
export function markAttention(
  attention: Record<string, ChatAttention>,
  chatId: string,
  message: string | null = null,
): Record<string, ChatAttention> {
  return { ...attention, [chatId]: { message: truncateMessage(message) } }
}

/** Clears one chat's attention; the badge stays clear until a new signal. */
export function clearAttention(
  attention: Record<string, ChatAttention>,
  chatId: string,
): Record<string, ChatAttention> {
  if (attention[chatId] === undefined) {
    return attention
  }
  const next = { ...attention }
  delete next[chatId]
  return next
}

/** Drops every chat id that no longer exists (chat closed → state removed, Behaviour 7). */
export function pruneAttention(
  attention: Record<string, ChatAttention>,
  chatExists: (chatId: string) => boolean,
): Record<string, ChatAttention> {
  let pruned = false
  const next: Record<string, ChatAttention> = {}
  for (const [chatId, value] of Object.entries(attention)) {
    if (chatExists(chatId)) {
      next[chatId] = value
    } else {
      pruned = true
    }
  }
  return pruned ? next : attention
}

/** OSC 9 tooltip text is kept for the badge only up to 120 characters (Behaviour 3). */
function truncateMessage(message: string | null): string | null {
  if (message === null || message.length <= MAX_TOOLTIP_LENGTH) {
    return message
  }
  return message.slice(0, MAX_TOOLTIP_LENGTH)
}
