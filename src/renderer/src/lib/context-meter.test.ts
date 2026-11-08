import { describe, expect, it } from 'vitest'
import { contextLevel, describeContextTokens, formatContextTokens } from './context-meter'

// Session context meter (spec left-panel Behaviour): the number is what the
// agent reports, and the two thresholds are absolute (160k warning, 180k
// critical). Boundaries are inclusive, so 160000 is already a warning.
describe('context meter', () => {
  it('raises the level exactly at the absolute thresholds', () => {
    expect(contextLevel(0)).toBe('normal')
    expect(contextLevel(159_999)).toBe('normal')
    expect(contextLevel(160_000)).toBe('warning')
    expect(contextLevel(179_999)).toBe('warning')
    expect(contextLevel(180_000)).toBe('critical')
    expect(contextLevel(1_000_000)).toBe('critical')
  })

  it('formats a tile-sized count without a denominator', () => {
    expect(formatContextTokens(999)).toBe('999')
    expect(formatContextTokens(1000)).toBe('1k')
    expect(formatContextTokens(12_450)).toBe('12.5k')
    expect(formatContextTokens(64_611)).toBe('64.6k')
    expect(formatContextTokens(160_000)).toBe('160k')
    expect(formatContextTokens(170_500)).toBe('170k')
    expect(formatContextTokens(184_900)).toBe('184k')
  })

  it('keeps the full count for the tooltip and accessible name', () => {
    expect(describeContextTokens(64_611)).toBe('64,611 tokens')
  })
})
