import type React from 'react'

interface ResizeHandleProps {
  axis: 'x' | 'y'
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void
  /** Keyboard resize (role=separator arrow keys), px per press. */
  onResizeNudge?: (delta: number) => void
  /** Current region size for aria-valuenow (a11y separator semantics). */
  size?: number
  minSize?: number
  maxSize?: number
  testId: string
  /** `end` is the region's right edge. `start` is its left edge (right panel). */
  placement?: 'start' | 'end'
}

const KEYBOARD_STEP = 16

export function ResizeHandle({
  axis,
  onResizeStart,
  onResizeNudge,
  size,
  minSize,
  maxSize,
  testId,
  placement = 'end',
}: ResizeHandleProps): React.JSX.Element {
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (onResizeNudge === undefined) {
      return
    }
    const decrease = axis === 'y' ? 'ArrowDown' : placement === 'start' ? 'ArrowRight' : 'ArrowLeft'
    const increase = axis === 'y' ? 'ArrowUp' : placement === 'start' ? 'ArrowLeft' : 'ArrowRight'
    if (event.key !== decrease && event.key !== increase) {
      return
    }
    event.preventDefault()
    const step = event.shiftKey ? KEYBOARD_STEP * 3 : KEYBOARD_STEP
    onResizeNudge(event.key === increase ? step : -step)
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: an interactive drag handle is a separator, not a thematic break (<hr> cannot host pointer/keyboard resize)
    <div
      className={
        axis === 'x'
          ? // Width handles sit on one vertical edge (user request
            // 2026-10-04, 2026-10-18): a transparent strip with 1px border at
            // rest avoids a heavy divider bar while keeping an easy drag target.
            `absolute inset-y-0 w-1 cursor-col-resize touch-none bg-transparent hover:bg-highlight active:bg-highlight focus-visible:bg-highlight focus-visible:outline-none transition-colors duration-fast ${placement === 'start' ? 'left-0' : 'right-0'}`
          : 'h-1 w-full cursor-row-resize touch-none bg-edge hover:bg-highlight'
      }
      onPointerDown={onResizeStart}
      onKeyDown={handleKeyDown}
      data-testid={testId}
      role="separator"
      tabIndex={0}
      aria-label="Resize region"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={size}
      aria-valuemin={minSize}
      aria-valuemax={maxSize}
    />
  )
}
