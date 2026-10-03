import type React from 'react'
import { TEST_ID } from '../../lib/test-ids'
import { IllustratedSurface } from './IllustratedSurface'

// Default/empty center surface (UX-UI §6): shown when no chat is selected and
// the workspace is in its neutral state (no project yet, chat list still
// loading). Full-bleed illustration backdrop (IllustratedSurface); heading,
// description and the primary action are real DOM content anchored just below
// the wave crest. `onAddProject` is the host's existing add-project flow —
// the button never duplicates it.

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
    <IllustratedSurface testId={TEST_ID.welcomeSurface}>
      <div className="flex w-full max-w-[560px] flex-col items-center px-2 pb-6 text-center">
        <h1 className="text-[clamp(20px,3.2cqh,26px)] font-medium text-ink">
          Welcome to <span className="text-project-title">{projectName ?? 'NeKode'}</span>
        </h1>
        <p className="mt-[clamp(10px,1.8cqh,16px)] max-w-[460px] text-sm leading-relaxed text-ink-secondary">
          {hasProject
            ? "Start a new chat to work in this project's directory."
            : 'Add a local project to start working. Chats you create will run in dedicated terminals attached to the project directory.'}
        </p>
        <button
          type="button"
          className="mt-[clamp(14px,2.6cqh,24px)] h-control rounded-md bg-info px-4 text-sm font-medium text-app hover:bg-info/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          data-testid={hasProject ? TEST_ID.startNewChatButton : TEST_ID.welcomeAddProjectButton}
          onClick={hasProject ? onNewChat : onAddProject}
        >
          {hasProject ? 'New chat' : '+ Add project'}
        </button>
      </div>
    </IllustratedSurface>
  )
}
