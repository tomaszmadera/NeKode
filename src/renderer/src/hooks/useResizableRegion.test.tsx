import { act, cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { BOTTOM_REGION_SIZE, LEFT_REGION_SIZE, useResizableRegion } from './useResizableRegion'

// The hook is exercised through minimal harness components with the same
// controlled wiring App uses (x axis: the left region, y axis: the bottom
// region). App's own binding of the left region to the hook is covered in
// App.test.tsx ('resizes the left region by dragging through the App shell').

// jsdom (v30) ships a PointerEvent constructor but no
// Element.setPointerCapture; the hook guards the latter, the tests
// exercise the former.

const LEFT_REGION = 'harness-left-region'
const LEFT_HANDLE = 'harness-left-handle'

function firePointer(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  coordinates: { clientX?: number; clientY?: number } = {},
  pointerOptions: { isPrimary?: boolean; button?: number } = {},
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
        ...pointerOptions,
      }),
    )
  })
}

describe('useResizableRegion', () => {
  afterEach(() => {
    cleanup()
  })

  function getHandle(testId: string): HTMLElement {
    const handle = screen.getByTestId(testId)
    expect(handle).toBeTruthy()
    return handle
  }

  it('resizes the left region by dragging (pointerdown → move → up)', () => {
    render(<XAxisHarness />)
    const leftNav = screen.getByTestId(LEFT_REGION)
    expect((leftNav as HTMLElement).style.width).toBe('280px')

    const handle = getHandle(LEFT_HANDLE)
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

    // First move is a real change (768 - 528 = 240 > initial 220): the size
    // must move, proving the move path is not a no-op at the initial size.
    firePointer(handle, 'pointerdown', { clientY: 600 })
    firePointer(handle, 'pointermove', { clientY: 528 })
    expect(region.style.height).toBe('240px')

    firePointer(handle, 'pointermove', { clientY: 700 }) // 768 - 700 = 68 < 160
    expect(region.style.height).toBe('160px')

    firePointer(handle, 'pointerup', { clientY: 700 })
    expect(region.style.height).toBe('160px')
  })

  it('persists (onResizeEnd) only on drag end with an actual size change', () => {
    const resizeEnds: number[] = []
    const { getByTestId } = render(<YAxisHarness onResizeEnd={(size) => resizeEnds.push(size)} />)
    const handle = getByTestId('harness-handle')

    firePointer(handle, 'pointerdown', { clientY: 600 })
    firePointer(handle, 'pointermove', { clientY: 528 })
    firePointer(handle, 'pointermove', { clientY: 520 })
    expect(resizeEnds).toEqual([]) // not during the drag

    firePointer(handle, 'pointerup', { clientY: 520 })
    expect(resizeEnds).toEqual([248]) // 768 - 520, once, on change

    // Zero-move click: no persistence at all.
    firePointer(handle, 'pointerdown', { clientY: 600 })
    firePointer(handle, 'pointerup', { clientY: 600 })
    expect(resizeEnds).toEqual([248])
  })

  it('ignores non-primary and non-left-button pointerdown (multi-touch/button guard)', () => {
    render(<XAxisHarness />)
    const leftNav = screen.getByTestId(LEFT_REGION)
    const handle = getHandle(LEFT_HANDLE)

    firePointer(handle, 'pointerdown', { clientX: 280 }, { isPrimary: false })
    firePointer(handle, 'pointermove', { clientX: 400 })
    expect((leftNav as HTMLElement).style.width).toBe('280px')

    firePointer(handle, 'pointerdown', { clientX: 280 }, { button: 2 })
    firePointer(handle, 'pointermove', { clientX: 400 })
    expect((leftNav as HTMLElement).style.width).toBe('280px')
  })

  it('a second (multi-touch) pointerdown ends the first drag instead of stacking', () => {
    render(<XAxisHarness />)
    const leftNav = screen.getByTestId(LEFT_REGION)
    const handle = getHandle(LEFT_HANDLE)

    firePointer(handle, 'pointerdown', { clientX: 280 })
    firePointer(handle, 'pointermove', { clientX: 320 })
    expect((leftNav as HTMLElement).style.width).toBe('320px')

    // Non-primary pointerdown force-ends the active drag (no stacked drags).
    firePointer(handle, 'pointerdown', { clientX: 280 }, { isPrimary: false })
    firePointer(handle, 'pointermove', { clientX: 450 })
    expect((leftNav as HTMLElement).style.width).toBe('320px')
  })

  it('ignores pointermove before pointerdown', () => {
    render(<XAxisHarness />)
    const leftNav = screen.getByTestId(LEFT_REGION)
    firePointer(getHandle(LEFT_HANDLE), 'pointermove', { clientX: 400 })
    expect((leftNav as HTMLElement).style.width).toBe('280px')
  })

  it('ends the drag on pointercancel (subsequent moves do not resize)', () => {
    render(<XAxisHarness />)
    const leftNav = screen.getByTestId(LEFT_REGION)
    const handle = getHandle(LEFT_HANDLE)
    firePointer(handle, 'pointerdown', { clientX: 280 })
    firePointer(handle, 'pointermove', { clientX: 320 })
    expect((leftNav as HTMLElement).style.width).toBe('320px')

    firePointer(handle, 'pointercancel', { clientX: 320 })
    firePointer(handle, 'pointermove', { clientX: 450 })
    firePointer(handle, 'pointermove', { clientX: 460 })
    expect((leftNav as HTMLElement).style.width).toBe('320px')
  })

  it('ends the drag on lostpointercapture', () => {
    render(<XAxisHarness />)
    const leftNav = screen.getByTestId(LEFT_REGION)
    const handle = getHandle(LEFT_HANDLE)
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
    render(<XAxisHarness />)
    const leftNav = screen.getByTestId(LEFT_REGION)
    const handle = getHandle(LEFT_HANDLE)
    firePointer(handle, 'pointerdown', { clientX: 280 })
    firePointer(handle, 'pointermove', { clientX: 300 })
    firePointer(handle, 'pointerup', { clientX: 300 })
    expect((leftNav as HTMLElement).style.width).toBe('300px')

    firePointer(handle, 'pointermove', { clientX: 420 })
    expect((leftNav as HTMLElement).style.width).toBe('300px')
  })
})

// The x-axis behaviour (clientX against the drag start) drives the left
// region, starting at its default width (280px).
function XAxisHarness(): React.JSX.Element {
  const [size, setSize] = useState(LEFT_REGION_SIZE.default)
  const leftRegion = useResizableRegion({
    axis: 'x',
    minSize: LEFT_REGION_SIZE.min,
    maxSize: LEFT_REGION_SIZE.max,
    size,
    onSizeChange: setSize,
    onResizeEnd: () => undefined,
  })

  return (
    <div data-testid={LEFT_REGION} style={{ width: size }}>
      <div data-testid={LEFT_HANDLE} onPointerDown={leftRegion.startResize} />
    </div>
  )
}

// The y-axis behaviour (clientY measured against window.innerHeight) drives
// the bottom region.
function YAxisHarness({
  onResizeEnd = () => undefined,
}: {
  onResizeEnd?: (size: number) => void
}): React.JSX.Element {
  const [size, setSize] = useState(BOTTOM_REGION_SIZE.default)
  const bottomRegion = useResizableRegion({
    axis: 'y',
    minSize: BOTTOM_REGION_SIZE.min,
    maxSize: BOTTOM_REGION_SIZE.max,
    size,
    onSizeChange: setSize,
    onResizeEnd,
  })

  return (
    <div data-testid="harness-bottom-region" style={{ height: size }}>
      <div data-testid="harness-handle" onPointerDown={bottomRegion.startResize} />
    </div>
  )
}
