import type React from 'react'
import { TEST_ID } from '../../lib/test-ids'

// Default/empty center surface (UX-UI §6): shown when no chat is selected.

export function WelcomeSurface(): React.JSX.Element {
  return (
    <section
      className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
      data-testid={TEST_ID.welcomeSurface}
    >
      <h1 className="text-lg font-medium text-neutral-100">Welcome to NeKode</h1>
      <p className="text-sm leading-relaxed text-neutral-400">
        Add a local project to start working. Chats you create will run in dedicated terminals
        attached to the project directory.
      </p>
    </section>
  )
}
