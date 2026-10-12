import { describe, expect, it } from 'vitest'
import { clampMenuPosition } from './menu-position'

describe('clampMenuPosition', () => {
  it('preserves pointer coordinates inside the safe viewport region', () => {
    const pos = clampMenuPosition(100, 150, {
      viewportWidth: 1000,
      viewportHeight: 800,
      menuWidth: 200,
      menuHeight: 150,
      padding: 8,
    })
    expect(pos).toEqual({ left: 100, top: 150 })
  })

  it('clamps coordinates near or beyond the right edge', () => {
    const pos = clampMenuPosition(950, 100, {
      viewportWidth: 1000,
      viewportHeight: 800,
      menuWidth: 200,
      menuHeight: 150,
      padding: 8,
    })
    // 1000 - 200 - 8 = 792
    expect(pos).toEqual({ left: 792, top: 100 })

    const beyond = clampMenuPosition(1200, 100, {
      viewportWidth: 1000,
      viewportHeight: 800,
      menuWidth: 200,
      menuHeight: 150,
      padding: 8,
    })
    expect(beyond).toEqual({ left: 792, top: 100 })
  })

  it('clamps coordinates near or beyond the bottom edge', () => {
    const pos = clampMenuPosition(100, 750, {
      viewportWidth: 1000,
      viewportHeight: 800,
      menuWidth: 200,
      menuHeight: 150,
      padding: 8,
    })
    // 800 - 150 - 8 = 642
    expect(pos).toEqual({ left: 100, top: 642 })

    const beyond = clampMenuPosition(100, 950, {
      viewportWidth: 1000,
      viewportHeight: 800,
      menuWidth: 200,
      menuHeight: 150,
      padding: 8,
    })
    expect(beyond).toEqual({ left: 100, top: 642 })
  })

  it('clamps coordinates near or beyond the left and top edges', () => {
    const pos = clampMenuPosition(-20, -50, {
      viewportWidth: 1000,
      viewportHeight: 800,
      menuWidth: 200,
      menuHeight: 150,
      padding: 8,
    })
    expect(pos).toEqual({ left: 8, top: 8 })
  })

  it('handles small viewports gracefully without negative positions', () => {
    const pos = clampMenuPosition(50, 50, {
      viewportWidth: 150,
      viewportHeight: 100,
      menuWidth: 200,
      menuHeight: 150,
      padding: 8,
    })
    expect(pos).toEqual({ left: 8, top: 8 })
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
