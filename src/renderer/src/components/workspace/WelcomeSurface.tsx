import type React from 'react'
import { TEST_ID } from '../../lib/test-ids'
import { IllustratedSurface } from './IllustratedSurface'

// The primary action reuses the host's project/chat creation flows.

export function WelcomeSurface({
  onAddProject,
  projectName,
  onNewChat,
}: {
  onAddProject: () => void
  projectName?: string
  onNewChat: () => void
}): React.JSX.Element {
  const hasProject = projectName !== undefined
  return (
    <IllustratedSurface
      testId={TEST_ID.welcomeSurface}
      actionTestId={hasProject ? TEST_ID.startNewChatButton : TEST_ID.welcomeAddProjectButton}
      actionLabel={hasProject ? 'New Chat' : 'Add project'}
      onPrimaryAction={hasProject ? onNewChat : onAddProject}
    />
  )
}
