import { describe, expect, it } from 'vitest'
import {
  ownsWheel,
  planWheelScroll,
  WHEEL_DELTA_LINES,
  WHEEL_DELTA_PAGES,
  WHEEL_DELTA_PIXELS,
} from './terminal-wheel'

// The wheel path itself (which xterm path applies the delta) is exercised in
// ChatTerminal.test.tsx; this file covers the arithmetic that decides how many
// buffer lines one wheel event moves.

describe('planWheelScroll', () => {
  const grid = { rows: 24, rowHeight: 20 }

  it('converts a pixel notch into whole rows plus a remainder', () => {
    expect(
      planWheelScroll({ ...grid, deltaY: 100, deltaMode: WHEEL_DELTA_PIXELS, pendingPixels: 0 }),
    ).toEqual({
      lines: 5,
      pendingPixels: 0,
    })
  })

  it('keeps the sub-row remainder for the next event', () => {
    const first = planWheelScroll({
      ...grid,
      deltaY: 30,
      deltaMode: WHEEL_DELTA_PIXELS,
      pendingPixels: 0,
    })
    expect(first).toEqual({ lines: 1, pendingPixels: 10 })
    const second = planWheelScroll({
      ...grid,
      deltaY: 30,
      deltaMode: WHEEL_DELTA_PIXELS,
      pendingPixels: first.pendingPixels,
    })
    expect(second).toEqual({ lines: 2, pendingPixels: 0 })
  })

  it('accumulates high-resolution deltas until a whole row is reached', () => {
    let pendingPixels = 0
    let lines = 0
    for (let i = 0; i < 8; i++) {
      const plan = planWheelScroll({
        ...grid,
        deltaY: 5,
        deltaMode: WHEEL_DELTA_PIXELS,
        pendingPixels,
      })
      pendingPixels = plan.pendingPixels
      lines += plan.lines
    }
    // 8 x 5 px = 40 px = exactly two rows at 20 px.
    expect(lines).toBe(2)
    expect(pendingPixels).toBe(0)
  })

  it('scrolls up for negative deltas', () => {
    expect(
      planWheelScroll({ ...grid, deltaY: -100, deltaMode: WHEEL_DELTA_PIXELS, pendingPixels: 0 }),
    ).toEqual({
      lines: -5,
      pendingPixels: 0,
    })
  })

  it('honours line and page delta modes', () => {
    expect(
      planWheelScroll({ ...grid, deltaY: 3, deltaMode: WHEEL_DELTA_LINES, pendingPixels: 0 }),
    ).toEqual({
      lines: 3,
      pendingPixels: 0,
    })
    expect(
      planWheelScroll({ ...grid, deltaY: 1, deltaMode: WHEEL_DELTA_PAGES, pendingPixels: 0 }),
    ).toEqual({
      lines: 24,
      pendingPixels: 0,
    })
  })

  it('moves nothing when the grid cannot be measured', () => {
    expect(
      planWheelScroll({
        rows: 0,
        rowHeight: 0,
        deltaY: 100,
        deltaMode: WHEEL_DELTA_PIXELS,
        pendingPixels: 7,
      }),
    ).toEqual({ lines: 0, pendingPixels: 7 })
  })
})

describe('ownsWheel', () => {
  const owned = {
    bufferType: 'normal' as const,
    mouseTrackingMode: 'none',
    shiftKey: false,
    rows: 24,
    rowHeight: 20,
  }

  it('takes the wheel for a normal buffer that leaves it to the terminal', () => {
    expect(ownsWheel(owned)).toBe(true)
  })

  it.each([
    ['an alternate-screen program owns its own view', { bufferType: 'alternate' as const }],
    ['a mouse-tracking program receives wheel reports', { mouseTrackingMode: 'vt200' }],
    ['shift+wheel stays xterm horizontal scroll', { shiftKey: true }],
    ['an unmeasured grid leaves xterm in charge', { rowHeight: 0 }],
  ])('leaves the wheel to xterm when %s', (_name, override) => {
    expect(ownsWheel({ ...owned, ...override })).toBe(false)
  })
})
