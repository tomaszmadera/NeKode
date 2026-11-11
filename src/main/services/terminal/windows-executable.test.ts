import { describe, expect, it, vi } from 'vitest'
import { resolveWindowsExecutable } from './windows-executable'

/** A probe that reports exactly these candidates as present files. */
function probeOf(paths: readonly string[]): (candidate: string) => boolean {
  return (candidate) => paths.includes(candidate)
}

const NPM = 'C:\\Users\\tomek\\AppData\\Roaming\\npm'

describe('resolveWindowsExecutable', () => {
  it('preserves an explicit extension without touching the disk', () => {
    const probe = vi.fn(() => false)
    for (const file of ['agent.exe', 'agent.com', 'agent.cmd', 'agent.bat', 'wsl.exe']) {
      expect(resolveWindowsExecutable(file, {}, probe)).toBe(file)
    }
    expect(probe).not.toHaveBeenCalled()
  })

  it('finds an npm command shim that has no native executable', () => {
    // The host shape that failed: `opencode` installed by npm as `opencode.cmd` only.
    expect(
      resolveWindowsExecutable(
        'opencode',
        { PATH: `C:\\Windows\\system32;${NPM}` },
        probeOf([`${NPM}\\opencode.cmd`]),
      ),
    ).toBe(`${NPM}\\opencode.cmd`)
  })

  it('prefers a native executable over a shim when both exist', () => {
    expect(
      resolveWindowsExecutable(
        'codex',
        { PATH: NPM },
        probeOf([`${NPM}\\codex.exe`, `${NPM}\\codex.cmd`]),
      ),
    ).toBe(`${NPM}\\codex.exe`)
  })

  it('searches PATH in order and ignores empty or quoted entries', () => {
    const env = { Path: ` ;; "${NPM}" ;C:\\Program Files\\nodejs` }
    expect(
      resolveWindowsExecutable(
        'gemini',
        env,
        probeOf([`${NPM}\\gemini.cmd`, 'C:\\Program Files\\nodejs\\gemini.cmd']),
      ),
    ).toBe(`${NPM}\\gemini.cmd`)
  })

  it('falls back to the native suffix when no candidate exists', () => {
    expect(resolveWindowsExecutable('hermes', { PATH: 'C:\\bin' }, () => false)).toBe('hermes.exe')
  })

  it('resolves a directory path without an extension in that directory', () => {
    expect(
      resolveWindowsExecutable(
        'C:\\Agent tools\\agent',
        {},
        probeOf(['C:\\Agent tools\\agent.exe']),
      ),
    ).toBe('C:\\Agent tools\\agent.exe')
    expect(resolveWindowsExecutable('C:\\Agent tools\\agent', { PATH: NPM }, () => false)).toBe(
      'C:\\Agent tools\\agent.exe',
    )
    expect(
      resolveWindowsExecutable('C:\\tools\\agent', {}, probeOf(['C:\\tools\\agent.bat'])),
    ).toBe('C:\\tools\\agent.bat')
  })
})
