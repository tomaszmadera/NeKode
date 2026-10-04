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
}: ResizeHandleProps): React.JSX.Element {
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (onResizeNudge === undefined) {
      return
    }
    const decrease = axis === 'x' ? 'ArrowLeft' : 'ArrowDown'
    const increase = axis === 'x' ? 'ArrowRight' : 'ArrowUp'
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
          ? // Width handles sit on the region's right edge (user request
            // 2026-10-04): a vertical strip reads as a width change; the
            // former in-flow bottom bar read as a height change. The host
            // region is the positioning context (`relative`).
            'absolute inset-y-0 right-0 w-1 cursor-col-resize touch-none bg-edge hover:bg-highlight'
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
