import type React from 'react'
import type { WorkspaceLayoutMode } from '../../hooks/app/useLayoutRegions'
import { cn } from '../../lib/cn'
import { TEST_ID } from '../../lib/test-ids'

const OPTIONS: Array<{ mode: WorkspaceLayoutMode; label: string; testId: string }> = [
  { mode: 'two', label: 'Two panels', testId: TEST_ID.layoutSwitchTwo },
  { mode: 'three', label: 'Three panels', testId: TEST_ID.layoutSwitchThree },
]

/** Two-option layout control in the existing title bar (workspace-layout spec Behaviour 1). */
export function LayoutSwitcher({
  mode,
  onChange,
}: {
  mode: WorkspaceLayoutMode
  onChange: (mode: WorkspaceLayoutMode) => void
}): React.JSX.Element {
  return (
    <fieldset
      className="no-drag ml-3 flex min-w-0 shrink-0 items-center gap-1 border-0 p-0"
      aria-label="Workspace layout"
    >
      {OPTIONS.map((option) => {
        const pressed = mode === option.mode
        return (
          <button
            key={option.mode}
            type="button"
            className={cn(
              'h-6 cursor-pointer rounded px-2 text-xs focus-visible:outline focus-visible:outline-info',
              pressed
                ? 'bg-highlight text-ink'
                : 'text-ink-muted hover:bg-highlight hover:text-ink',
            )}
            data-testid={option.testId}
            aria-pressed={pressed}
            onClick={() => onChange(option.mode)}
          >
            {option.label}
          </button>
        )
      })}
    </fieldset>
  )
}
