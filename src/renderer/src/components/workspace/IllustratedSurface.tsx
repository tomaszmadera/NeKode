import type React from 'react'
import { Icon } from '../../lib/icons'
import { WelcomeIllustration } from './WelcomeIllustration'

// Shared artwork and content from design reference tmp/welcome-view/Main.dc.html.
// Bottom-anchored glowing cat vector silhouette, centered heading and primary action button.

export function IllustratedSurface({
  onPrimaryAction,
  actionLabel,
  actionTestId,
  testId,
  projectName,
}: {
  onPrimaryAction: () => void
  actionLabel: string
  actionTestId: string
  testId: string
  projectName?: string
}): React.JSX.Element {
  return (
    <section className="artwork-root" data-testid={testId}>
      <WelcomeIllustration />
      <div className="artwork-content">
        <div className="artwork-welcome">
          <h1>Welcome to NeKode</h1>
          {projectName ? (
            <p className="artwork-welcome-subtitle">
              Start an agent chat in <span className="artwork-project-badge">{projectName}</span>
            </p>
          ) : null}
          <button
            type="button"
            className="artwork-primary-btn"
            data-testid={actionTestId}
            aria-label={actionLabel}
            onClick={onPrimaryAction}
          >
            <Icon.plus size={16} aria-hidden />
            <span>{actionLabel}</span>
            {actionLabel === 'New Chat' ? <kbd className="artwork-kbd">Ctrl N</kbd> : null}
          </button>
        </div>
      </div>
    </section>
  )
}
