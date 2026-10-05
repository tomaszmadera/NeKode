import type React from 'react'
import welcomeBackground from '../../assets/welcome-bkg.svg'

// Shared artwork and content from tmp/nekode-welcome-v2.zip. Positioning follows
// the cover-scaled ledge in the actual workspace, rather than the OS window.

export function IllustratedSurface({
  onPrimaryAction,
  actionLabel,
  actionTestId,
  testId,
}: {
  onPrimaryAction: () => void
  actionLabel: string
  actionTestId: string
  testId: string
}): React.JSX.Element {
  return (
    <section className="artwork-root" data-testid={testId}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 select-none bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${welcomeBackground})` }}
      />
      <div className="artwork-content">
        <div className="artwork-welcome">
          <h1>Welcome to NeKode</h1>
          <button type="button" data-testid={actionTestId} onClick={onPrimaryAction}>
            <span aria-hidden="true">+</span>
            {actionLabel}
          </button>
        </div>
      </div>
    </section>
  )
}
