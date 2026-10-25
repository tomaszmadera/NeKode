import { describe, expect, it } from 'vitest'
import { isNewerRelease } from './app-version'

describe('isNewerRelease', () => {
  it('accepts only a higher numeric version', () => {
    expect(isNewerRelease('0.20.1', '0.20.0')).toBe(true)
    expect(isNewerRelease('0.21.0', '0.20.9')).toBe(true)
    expect(isNewerRelease('1.0.0', '0.20.0')).toBe(true)
    expect(isNewerRelease('0.10.0', '0.9.0')).toBe(true)
    expect(isNewerRelease('v0.21.0', '0.20.0')).toBe(true)
  })

  it('rejects the same version, an older release, and a non-numeric value', () => {
    expect(isNewerRelease('0.20.0', '0.20.0')).toBe(false)
    expect(isNewerRelease('0.20.0', 'v0.20.0')).toBe(false)
    expect(isNewerRelease('0.19.0', '0.20.0')).toBe(false)
    expect(isNewerRelease('0.0.0', '0.0.0-test')).toBe(false)
    expect(isNewerRelease('0.0.0-test', '0.0.0-test')).toBe(false)
    expect(isNewerRelease('0.16.0', '0.0.0-test')).toBe(true)
    expect(isNewerRelease('latest', '0.20.0')).toBe(false)
    expect(isNewerRelease('0.20.0', '')).toBe(false)
  })
})
