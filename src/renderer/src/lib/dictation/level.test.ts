import { describe, expect, it } from 'vitest'
import { DICTATION_LEVEL_WINDOW_SECONDS, dictationLevelFromRms } from './level'

describe('dictation level mapping', () => {
  it('maps silence to an empty meter', () => {
    expect(dictationLevelFromRms(0)).toBe(0)
    expect(dictationLevelFromRms(-0.2)).toBe(0)
    expect(dictationLevelFromRms(Number.NaN)).toBe(0)
  })

  it('spans the meter from -60 dBFS to -10 dBFS', () => {
    expect(dictationLevelFromRms(10 ** (-60 / 20))).toBe(0)
    expect(dictationLevelFromRms(10 ** (-35 / 20))).toBeCloseTo(0.5, 6)
    expect(dictationLevelFromRms(10 ** (-10 / 20))).toBeCloseTo(1, 6)
  })

  it('keeps a quiet microphone near the floor and clamps loud input', () => {
    expect(dictationLevelFromRms(10 ** (-70 / 20))).toBe(0)
    expect(dictationLevelFromRms(10 ** (-20 / 20))).toBeCloseTo(0.8, 6)
    expect(dictationLevelFromRms(1.4)).toBe(1)
  })

  it('reports a level window short enough to look live', () => {
    expect(DICTATION_LEVEL_WINDOW_SECONDS).toBeGreaterThan(0)
    expect(DICTATION_LEVEL_WINDOW_SECONDS).toBeLessThanOrEqual(0.25)
  })
})
