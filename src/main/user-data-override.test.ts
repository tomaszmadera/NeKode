import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUserDataOverride, resolveUserDataPath } from './user-data-override'

const scratch: string[] = []

afterEach(() => {
  for (const path of scratch.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

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
    const resolved = resolve(relativePath)
    scratch.push(resolved)
    const result = applyUserDataOverride(relativePath, electronSetPathMock)

    expect(result).toBe(resolved)
    expect(typeof result).toBe('string')
    expect(isAbsolute(result ?? '')).toBe(true)
    expect(electronSetPathMock).toHaveBeenCalledWith('userData', resolved)
  })

  it('handles paths with surrounding quotes and whitespace', () => {
    const electronSetPathMock = vi.fn((_name: string, targetPath: string) => {
      if (!isAbsolute(targetPath)) {
        throw new Error('Path must be absolute')
      }
    })

    const quotedRelative = '  "./temp-user-data"  '
    const resolved = resolve('./temp-user-data')
    scratch.push(resolved)
    const result = applyUserDataOverride(quotedRelative, electronSetPathMock)

    expect(result).toBe(resolved)
    expect(electronSetPathMock).toHaveBeenCalledWith('userData', resolved)
  })

  it('directly resolves paths with resolveUserDataPath helper', () => {
    expect(resolveUserDataPath(undefined)).toBeNull()
    expect(resolveUserDataPath('   ')).toBeNull()
    expect(resolveUserDataPath('  "some-dir"  ')).toBe(resolve('some-dir'))
  })

  it('creates a missing directory before setPath', () => {
    const parent = mkdtempSync(join(tmpdir(), 'nekode-user-data-'))
    scratch.push(parent)
    const target = join(parent, 'nested', 'profile')
    const setPath = vi.fn(() => {
      expect(existsSync(target)).toBe(true)
    })

    const result = applyUserDataOverride(target, setPath)

    expect(result).toBe(resolve(target))
    expect(setPath).toHaveBeenCalledOnce()
    expect(setPath).toHaveBeenCalledWith('userData', resolve(target))
  })

  it('does not call setPath when directory creation throws', () => {
    const parent = mkdtempSync(join(tmpdir(), 'nekode-user-data-'))
    scratch.push(parent)
    const blockingFile = join(parent, 'not-a-directory')
    writeFileSync(blockingFile, 'x')
    const setPath = vi.fn()

    expect(() => applyUserDataOverride(join(blockingFile, 'profile'), setPath)).toThrow(
      expect.objectContaining({ code: 'ENOTDIR' }),
    )
    expect(setPath).not.toHaveBeenCalled()
  })

  it('keeps an existing directory and still selects that profile', () => {
    const parent = mkdtempSync(join(tmpdir(), 'nekode-user-data-'))
    scratch.push(parent)
    const target = join(parent, 'profile')
    mkdirSync(target)
    const setPath = vi.fn()

    const result = applyUserDataOverride(target, setPath)

    expect(result).toBe(resolve(target))
    expect(existsSync(target)).toBe(true)
    expect(setPath).toHaveBeenCalledOnce()
    expect(setPath).toHaveBeenCalledWith('userData', resolve(target))
  })
})
