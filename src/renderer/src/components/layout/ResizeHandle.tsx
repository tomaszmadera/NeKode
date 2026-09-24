import type React from 'react'

interface ResizeHandleProps {
  axis: 'x' | 'y'
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void
  testId: string
}

export function ResizeHandle({
  axis,
  onResizeStart,
  testId,
}: ResizeHandleProps): React.JSX.Element {
  return (
    <div
      className={
        axis === 'x'
          ? 'h-1 w-full cursor-col-resize touch-none bg-neutral-800/60 hover:bg-neutral-700'
          : 'h-1 w-full cursor-row-resize touch-none bg-neutral-800/60 hover:bg-neutral-700'
      }
      onPointerDown={onResizeStart}
      data-testid={testId}
      role="separator"
      tabIndex={0}
      aria-label="Resize region"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
    />
  )
}
