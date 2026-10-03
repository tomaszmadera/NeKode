import type React from 'react'
import welcomeBackground from '../../assets/welcome-bkg.png'

// Shared full-bleed artwork backdrop for the center-surface empty states
// (welcome and "No chats in this project"): the supplied illustration fills
// the workspace to every edge (cover-sized, no letterbox, no edge fades) and
// `children` anchor just below the wave crest, so the cat's mouth stays
// around screen center at every workspace size. The geometry lives in the
// .artwork-* rules in index.css (cover math + container units — no fixed
// pixel offsets). The decorative layer is aria-hidden and pointer-events-none,
// clipped by the surface; it never intercepts input or reaches the sidebar,
// tab strip or status bar.

export function IllustratedSurface({
  children,
  testId,
}: {
  children: React.ReactNode
  testId: string
}): React.JSX.Element {
  return (
    <section className="artwork-root bg-app" data-testid={testId}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 select-none bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${welcomeBackground})` }}
      />
      <div className="artwork-content">{children}</div>
    </section>
  )
}
