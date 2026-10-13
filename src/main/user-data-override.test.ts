import { isAbsolute, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyUserDataOverride, resolveUserDataPath } from './user-data-override'

describe('user-data-override', () => {
  it('returns null and does not call setPath when rawPath is undefined', () => {
    const setPath = vi.fn()
    const result = applyUserDataOverride(undefined, setPath)
    expect(result).toBeNull()
    expect(setPath).not.toHaveBeenCalled()
  })

  it('returns null and does not call setPath when rawPath is empty or whitespace only', () => {
    const setPath = vi.fn()
    expect(applyUserDataOverride('', setPath)).toBeNull()
    expect(applyUserDataOverride('   ', setPath)).toBeNull()
    expect(setPath).not.toHaveBeenCalled()
  })

  it('resolves relative path to absolute path and prevents Electron Path must be absolute error', () => {
    const electronSetPathMock = vi.fn((_name: string, targetPath: string) => {
      if (!isAbsolute(targetPath)) {
        throw new Error('Path must be absolute')
      }
    })

    const relativePath = './temp-user-data'
    const result = applyUserDataOverride(relativePath, electronSetPathMock)

    expect(result).toBe(resolve(relativePath))
    expect(typeof result).toBe('string')
    expect(isAbsolute(result ?? '')).toBe(true)
    expect(electronSetPathMock).toHaveBeenCalledWith('userData', resolve(relativePath))
  })

  it('handles paths with surrounding quotes and whitespace', () => {
    const electronSetPathMock = vi.fn((_name: string, targetPath: string) => {
      if (!isAbsolute(targetPath)) {
        throw new Error('Path must be absolute')
      }
    })

    const quotedRelative = '  "./temp-user-data"  '
    const result = applyUserDataOverride(quotedRelative, electronSetPathMock)

    expect(result).toBe(resolve('./temp-user-data'))
    expect(electronSetPathMock).toHaveBeenCalledWith('userData', resolve('./temp-user-data'))
  })

  it('directly resolves paths with resolveUserDataPath helper', () => {
    expect(resolveUserDataPath(undefined)).toBeNull()
    expect(resolveUserDataPath('   ')).toBeNull()
    expect(resolveUserDataPath('  "some-dir"  ')).toBe(resolve('some-dir'))
  })
})
