import type React from 'react'
import { RIGHT_REGION_SIZE } from '../../hooks/useResizableRegion'
import { cn } from '../../lib/cn'
import { TEST_ID } from '../../lib/test-ids'
import { ResizeHandle } from './ResizeHandle'

/** Right slot. The float theme uses the same detached frame as the left slot. */
export function RightPanel({
  width,
  floating = false,
  onResizeStart,
  onResizeNudge,
  children,
}: {
  width: number
  floating?: boolean
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void
  onResizeNudge: (delta: number) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <aside
      className={cn(
        'relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-panel',
        floating ? 'm-2 rounded-[10px] border border-edge' : 'rounded-none border-l border-edge',
      )}
      style={{ width }}
      data-testid={TEST_ID.rightRegion}
    >
      <div className="h-full min-h-0 flex-1">{children}</div>
      <ResizeHandle
        axis="x"
        placement="start"
        size={width}
        minSize={RIGHT_REGION_SIZE.min}
        maxSize={RIGHT_REGION_SIZE.max}
        onResizeStart={onResizeStart}
        onResizeNudge={onResizeNudge}
        testId={TEST_ID.rightResizeHandle}
      />
    </aside>
  )
}
