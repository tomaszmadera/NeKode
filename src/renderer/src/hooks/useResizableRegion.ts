import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'

// Drag mechanics for the resizable left/bottom regions. The hook is
// controlled: the caller owns the size so startup hydration and persistence
// (window.app.state) stay in one place (App).

export interface ResizableRegion {
  startResize: (event: ReactPointerEvent<HTMLElement>) => void
}

export interface RegionSizeLimits {
  default: number
  min: number
  max: number
}

export const LEFT_REGION_SIZE: RegionSizeLimits = { default: 280, min: 220, max: 480 }
export const BOTTOM_REGION_SIZE: RegionSizeLimits = { default: 220, min: 160, max: 560 }

/** Clamps a raw or persisted region size to the region's limits. */
export function clampRegionSize(value: number, limits: RegionSizeLimits): number {
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)))
}

export function useResizableRegion(options: {
  axis: 'x' | 'y'
  minSize: number
  maxSize: number
  /** Current region size in px; owned by the caller (hydrate/persist live there). */
  size: number
  /** Applied on every pointer move during an active drag. */
  onSizeChange: (size: number) => void
  /** Applied once when an active drag ends; the caller persists here. */
  onResizeEnd: (size: number) => void
}): ResizableRegion {
  const { axis, minSize, maxSize, size, onSizeChange, onResizeEnd } = options
  const endActiveDragRef = useRef<(() => void) | null>(null)

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      // A second pointerdown (multi-touch) must not stack two drags.
      endActiveDragRef.current?.()
      if (!event.isPrimary || event.button > 0) {
        return
      }
      // Prevents text selection and compatibility mouse-event synthesis
      // for the rest of the drag.
      event.preventDefault()

      const handle = event.currentTarget
      const pointerId = event.pointerId
      let currentSize = size

      // Pointer capture retargets every following pointer event to the
      // handle, so pointerup cannot be lost when the pointer leaves the
      // window (Alt+Tab, fast drags). jsdom has no setPointerCapture and
      // browsers may throw for an already-inactive pointer; the drag then
      // simply works while the pointer stays over the handle.
      try {
        handle.setPointerCapture(pointerId)
      } catch {
        // Capture is a robustness upgrade, not a requirement for the drag.
      }

      function onPointerMove(moveEvent: PointerEvent): void {
        const delta = axis === 'x' ? moveEvent.clientX : window.innerHeight - moveEvent.clientY
        const next = Math.min(maxSize, Math.max(minSize, Math.round(delta)))
        if (next !== currentSize) {
          currentSize = next
          onSizeChange(next)
        }
      }

      function endDrag(): void {
        handle.removeEventListener('pointermove', onPointerMove)
        handle.removeEventListener('pointerup', endDrag)
        handle.removeEventListener('pointercancel', endDrag)
        handle.removeEventListener('lostpointercapture', endDrag)
        endActiveDragRef.current = null
        onResizeEnd(currentSize)
      }

      // Listeners live on the handle element, not on window: with capture
      // the browser delivers move/up there anyway, and pointercancel /
      // lostpointercapture force-end the drag when the OS takes the
      // pointer away.
      handle.addEventListener('pointermove', onPointerMove)
      handle.addEventListener('pointerup', endDrag)
      handle.addEventListener('pointercancel', endDrag)
      handle.addEventListener('lostpointercapture', endDrag)
      endActiveDragRef.current = endDrag
    },
    [axis, minSize, maxSize, size, onSizeChange, onResizeEnd],
  )

  // Unmount during an active drag must not leave listeners behind that
  // would call onSizeChange on a dead component.
  useEffect(() => {
    return () => {
      endActiveDragRef.current?.()
    }
  }, [])

  return { startResize }
}
