import { act, cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppApi } from '../../../shared/ipc-contract'
import { App, TEST_ID } from '../App'
import { BOTTOM_REGION_SIZE, useResizableRegion } from './useResizableRegion'

// jsdom (v30) ships a PointerEvent constructor but no
// Element.setPointerCapture; the hook guards the latter, the tests
// exercise the former.

function createAppApiStub(): AppApi {
  return {
    projects: {
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    tasks: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(undefined),
    },
    state: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    terminals: {
      create: vi.fn().mockResolvedValue('term-1'),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn().mockReturnValue(() => undefined),
      onExit: vi.fn().mockReturnValue(() => undefined),
    },
    git: {
      getStatus: vi.fn().mockResolvedValue({ branch: 'main', dirty: false }),
    },
  }
}

function firePointer(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  coordinates: { clientX?: number; clientY?: number } = {},
): void {
  act(() => {
    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        button: 0,
        pointerId: 1,
        ...coordinates,
      }),
    )
  })
}

describe('useResizableRegion (via App shell)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })

  afterEach(() => {
    cleanup()
  })

  function getHandle(testId: string): HTMLElement {
    const handle = screen.getByTestId(testId)
    expect(handle).toBeTruthy()
    return handle
  }

  it('resizes the left region by dragging (pointerdown → move → up)', () => {
    render(<App app={app} />)
    const leftNav = screen.getByTestId(TEST_ID.leftNav)
    expect((leftNav as HTMLElement).style.width).toBe('280px')

    const handle = getHandle(TEST_ID.leftResizeHandle)
    firePointer(handle, 'pointerdown', { clientX: 280 })
    firePointer(handle, 'pointermove', { clientX: 350 })
    firePointer(handle, 'pointerup', { clientX: 350 })

    expect((leftNav as HTMLElement).style.width).toBe('350px')
  })

  it('resizes the bottom region against window.innerHeight and clamps to min', () => {
    const { getByTestId } = render(<YAxisHarness />)
    const region = getByTestId('harness-bottom-region') as HTMLElement
    const handle = getByTestId('harness-handle')

    expect(region.style.height).toBe('220px')

    firePointer(handle, 'pointerdown', { clientY: 600 })
    firePointer(handle, 'pointermove', { clientY: 528 }) // 768 - 528 = 240
    expect(region.style.height).toBe('240px')

    firePointer(handle, 'pointermove', { clientY: 700 }) // 768 - 700 = 68 < 160
    expect(region.style.height).toBe('160px')

    firePointer(handle, 'pointerup', { clientY: 700 })
    expect(region.style.height).toBe('160px')
  })

  it('ignores pointermove before pointerdown', () => {
    render(<App app={app} />)
    const leftNav = screen.getByTestId(TEST_ID.leftNav)
    firePointer(getHandle(TEST_ID.leftResizeHandle), 'pointermove', { clientX: 400 })
    expect((leftNav as HTMLElement).style.width).toBe('280px')
  })

  it('ends the drag on pointercancel (subsequent moves do not resize)', () => {
    render(<App app={app} />)
    const leftNav = screen.getByTestId(TEST_ID.leftNav)
    const handle = getHandle(TEST_ID.leftResizeHandle)
    firePointer(handle, 'pointerdown', { clientX: 280 })
    firePointer(handle, 'pointermove', { clientX: 320 })
    expect((leftNav as HTMLElement).style.width).toBe('320px')

    firePointer(handle, 'pointercancel', { clientX: 320 })
    firePointer(handle, 'pointermove', { clientX: 450 })
    firePointer(handle, 'pointermove', { clientX: 460 })
    expect((leftNav as HTMLElement).style.width).toBe('320px')
  })

  it('ends the drag on lostpointercapture', () => {
    render(<App app={app} />)
    const leftNav = screen.getByTestId(TEST_ID.leftNav)
    const handle = getHandle(TEST_ID.leftResizeHandle)
    firePointer(handle, 'pointerdown', { clientX: 280 })
    firePointer(handle, 'pointermove', { clientX: 330 })
    expect((leftNav as HTMLElement).style.width).toBe('330px')
    act(() => {
      handle.dispatchEvent(new Event('lostpointercapture'))
    })
    firePointer(handle, 'pointermove', { clientX: 470 })
    expect((leftNav as HTMLElement).style.width).toBe('330px')
  })

  it('stops dragging after pointerup (no resize on later moves)', () => {
    render(<App app={app} />)
    const leftNav = screen.getByTestId(TEST_ID.leftNav)
    const handle = getHandle(TEST_ID.leftResizeHandle)
    firePointer(handle, 'pointerdown', { clientX: 280 })
    firePointer(handle, 'pointermove', { clientX: 300 })
    firePointer(handle, 'pointerup', { clientX: 300 })
    expect((leftNav as HTMLElement).style.width).toBe('300px')

    firePointer(handle, 'pointermove', { clientX: 420 })
    expect((leftNav as HTMLElement).style.width).toBe('300px')
  })

  it('cleans up an active drag on unmount (moves after unmount are inert)', () => {
    const { unmount } = render(<App app={app} />)
    const handle = getHandle(TEST_ID.leftResizeHandle)
    firePointer(handle, 'pointerdown', { clientX: 280 })
    firePointer(handle, 'pointermove', { clientX: 310 })
    unmount()

    // Dispatching on a detached node must not throw or re-enter React.
    expect(() => {
      handle.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
        }),
      )
    }).not.toThrow()
  })
})

// App hides the bottom region in Stage 2, so the y-axis behaviour
// (clientY measured against window.innerHeight) is exercised through a
// minimal harness with the same controlled wiring App uses.
function YAxisHarness(): React.JSX.Element {
  const [size, setSize] = useState(BOTTOM_REGION_SIZE.default)
  const bottomRegion = useResizableRegion({
    axis: 'y',
    minSize: BOTTOM_REGION_SIZE.min,
    maxSize: BOTTOM_REGION_SIZE.max,
    size,
    onSizeChange: setSize,
    onResizeEnd: () => undefined,
  })

  return (
    <div data-testid="harness-bottom-region" style={{ height: size }}>
      <div data-testid="harness-handle" onPointerDown={bottomRegion.startResize} />
    </div>
  )
}
