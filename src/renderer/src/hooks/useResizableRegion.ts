import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface ResizableRegion {
  size: number
  startResize: (event: ReactPointerEvent<HTMLElement>) => void
}

const MAX_LEFT_WIDTH = 480
const MAX_BOTTOM_HEIGHT = 560

// Stage 1: sizes live in memory only. Stage 2 persists them via
// window.app.state.set once the state service is real (`options.id`
// is the future persistence key).
export function useResizableRegion(options: {
  id: 'left' | 'bottom'
  axis: 'x' | 'y'
  initialSize: number
  minSize: number
}): ResizableRegion {
  const { axis, minSize } = options
  const [size, setSize] = useState(options.initialSize)
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
        const maxSize = axis === 'x' ? MAX_LEFT_WIDTH : MAX_BOTTOM_HEIGHT
        setSize(Math.min(maxSize, Math.max(minSize, Math.round(delta))))
      }

      function endDrag(): void {
        handle.removeEventListener('pointermove', onPointerMove)
        handle.removeEventListener('pointerup', endDrag)
        handle.removeEventListener('pointercancel', endDrag)
        handle.removeEventListener('lostpointercapture', endDrag)
        endActiveDragRef.current = null
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
    [axis, minSize],
  )

  // Unmount during an active drag must not leave listeners behind that
  // would call setSize on a dead component.
  useEffect(() => {
    return () => {
      endActiveDragRef.current?.()
    }
  }, [])

  return { size, startResize }
}
