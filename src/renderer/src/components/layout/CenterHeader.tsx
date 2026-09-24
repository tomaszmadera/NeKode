import type React from 'react'
import { TEST_ID } from '../../App'

export function CenterHeader(): React.JSX.Element {
  return (
    <div
      className="flex h-12 shrink-0 items-center border-b border-neutral-800 px-4"
      data-testid={TEST_ID.centerHeader}
    >
      <span className="text-sm font-medium text-neutral-200">NeKode</span>
      <span className="ml-3 truncate text-xs text-neutral-500">
        Select a project to see its context
      </span>
    </div>
  )
}
