import type React from 'react'
import { TEST_ID } from '../../lib/test-ids'
import { IllustratedSurface } from './IllustratedSurface'

// Empty state for a project without any chats (spec Behaviour 11): after the
// last chat closes on terminal exit, the center surface offers a "Start new
// chat" affordance that creates a chat immediately (spec Behaviour 3 — the
// name is the shell's display label, no naming form). Same full-bleed
// illustration backdrop as the welcome surface (IllustratedSurface).

export function StartNewChatSurface({
  onStartNewChat,
  projectName,
}: {
  onStartNewChat: () => void
  projectName?: string
}): React.JSX.Element {
  return (
    <IllustratedSurface testId={TEST_ID.startNewChatState}>
      <div className="flex w-full max-w-[560px] flex-col items-center px-2 pb-6 text-center">
        <h1 className="text-[clamp(20px,3.2cqh,26px)] font-medium text-ink">
          Welcome to <span className="text-project-title">{projectName ?? 'your project'}</span>
        </h1>
        <p className="mt-[clamp(10px,1.8cqh,16px)] max-w-[460px] text-sm leading-relaxed text-ink-secondary">
          Start a new chat to work in this project's directory.
        </p>
        <button
          type="button"
          className="mt-[clamp(14px,2.6cqh,24px)] h-control rounded-md bg-info px-4 text-sm font-medium text-app hover:bg-info/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          data-testid={TEST_ID.startNewChatButton}
          onClick={onStartNewChat}
        >
          New chat
        </button>
      </div>
    </IllustratedSurface>
  )
}
