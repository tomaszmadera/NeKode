import type React from 'react'
import { TEST_ID } from '../../lib/test-ids'

// Shared error notice banner (spec Errors: failures surface as a localized
// error state, no silent fallback). Rendered at the top of the left panel in
// both navigation modes (Projects/Chats and Project Files).
export function NoticeBanner({ notice }: { notice: string | null }): React.JSX.Element | null {
  if (notice === null) {
    return null
  }
  return (
    <p
      className="mx-2 rounded border border-red-900 bg-red-950/40 px-2 py-1.5 text-xs leading-relaxed text-red-300"
      data-testid={TEST_ID.actionNotice}
      role="alert"
    >
      {notice}
    </p>
  )
}
