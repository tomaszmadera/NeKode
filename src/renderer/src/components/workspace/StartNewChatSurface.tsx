import type React from 'react'
import { TEST_ID } from '../../lib/test-ids'

// Empty state for a project without any chats (spec Behaviour 11): after the
// last chat closes on terminal exit, the center surface offers a "Start new
// chat" affordance that creates a chat immediately (spec Behaviour 3 — the
// name is the shell's display label, no naming form).

export function StartNewChatSurface({
  onStartNewChat,
}: {
  onStartNewChat: () => void
}): React.JSX.Element {
  return (
    <section
      className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
      data-testid={TEST_ID.startNewChatState}
    >
      <h1 className="text-lg font-medium text-ink">No chats in this project</h1>
      <p className="text-sm leading-relaxed text-ink-secondary">
        The previous chats were closed with their terminals. Start a new chat to open a fresh
        terminal session.
      </p>
      <button
        type="button"
        className="h-control rounded-md bg-button px-4 text-xs text-ink hover:bg-button-hover"
        data-testid={TEST_ID.startNewChatButton}
        onClick={onStartNewChat}
      >
        Start new chat
      </button>
    </section>
  )
}
