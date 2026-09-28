import type React from 'react'
import { TEST_ID } from '../../lib/test-ids'

// Default/empty center surface (UX-UI §6): shown when no chat is selected.
// h-full centers the section vertically inside its host (a plain block, not a
// flex container), per the user decision to center it in the middle column.

export function WelcomeSurface(): React.JSX.Element {
  return (
    <section
      className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center"
      data-testid={TEST_ID.welcomeSurface}
    >
      <h1 className="text-lg font-medium text-ink">Welcome to NeKode</h1>
      <p className="text-sm leading-relaxed text-ink-secondary">
        Add a local project to start working. Chats you create will run in dedicated terminals
        attached to the project directory.
      </p>
    </section>
  )
}
