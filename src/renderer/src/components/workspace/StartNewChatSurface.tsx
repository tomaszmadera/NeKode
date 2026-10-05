import type React from 'react'
import { TEST_ID } from '../../lib/test-ids'
import { IllustratedSurface } from './IllustratedSurface'

// A project without chats offers immediate chat creation (spec Behaviour 11).

export function StartNewChatSurface({
  onStartNewChat,
}: {
  onStartNewChat: () => void
}): React.JSX.Element {
  return (
    <IllustratedSurface
      testId={TEST_ID.startNewChatState}
      actionTestId={TEST_ID.startNewChatButton}
      actionLabel="New Chat"
      onPrimaryAction={onStartNewChat}
    />
  )
}
