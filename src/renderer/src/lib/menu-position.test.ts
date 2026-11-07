import { describe, expect, it } from 'vitest'
import { clampMenuPosition } from './menu-position'

describe('clampMenuPosition', () => {
  const viewport = {
    viewportWidth: 1000,
    viewportHeight: 800,
    menuWidth: 200,
    menuHeight: 150,
    padding: 8,
  }

  it.each([
    ['preserves pointer coordinates inside the safe region', 100, 150, viewport, 100, 150],
    ['clamps near the right edge to width - menu - padding', 950, 100, viewport, 792, 100],
    ['clamps beyond the right edge', 1200, 100, viewport, 792, 100],
    ['clamps near the bottom edge to height - menu - padding', 100, 750, viewport, 100, 642],
    ['clamps beyond the bottom edge', 100, 950, viewport, 100, 642],
    ['clamps the left and top edges to the padding', -20, -50, viewport, 8, 8],
    [
      'never goes negative when the menu is larger than the viewport',
      50,
      50,
      { ...viewport, viewportWidth: 150, viewportHeight: 100 },
      8,
      8,
    ],
  ])('%s', (_name, x, y, options, left, top) => {
    expect(clampMenuPosition(x, y, options)).toEqual({ left, top })
  })

  it('falls back to window dimensions when viewports are omitted', () => {
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
      const pos = clampMenuPosition(750, 550, {
        menuWidth: 200,
        menuHeight: 100,
        padding: 10,
      })
      // left: 800 - 200 - 10 = 590
      // top: 600 - 100 - 10 = 490
      expect(pos).toEqual({ left: 590, top: 490 })
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      })
    }
  })
})
