import type React from 'react'
import { cn } from '../../lib/cn'
import { TEST_ID } from '../../lib/test-ids'

export function TopBar(): React.JSX.Element {
  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center border-b border-neutral-800 bg-neutral-900 px-4',
      )}
      data-testid={TEST_ID.topBar}
    >
      <span className="text-xs font-medium tracking-wide text-neutral-400">NeKode</span>
      <span className="ml-auto text-xs text-neutral-500">Action Bar placeholder</span>
    </header>
  )
}
