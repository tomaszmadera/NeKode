import { describe, expect, it } from 'vitest'
import { customChoice, decodeWslList, ShellService } from './shell-service'

// ShellService unit tests (spec project-shell-selection): everything
// OS-facing is injected (exists, isFile, WSL runner, env) — no real probing
// and no processes in vitest. Covers detection composition/ordering, UTF-16LE
// WSL decoding, degradation when WSL is unavailable, custom-path
// add/validate/prune semantics, cache behavior (list never probes), and the
// fallback rules (unknown id / dead path -> platform default).

const WIN_ENV: NodeJS.ProcessEnv = {
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
}

interface FsShape {
  exists: string[]
  files: string[]
}

function makeService(fs: FsShape, wsl: string[] = [], env: NodeJS.ProcessEnv = WIN_ENV) {
  const existsCalls: string[] = []
  const service = new ShellService({
    exists: (path) => {
      existsCalls.push(path)
      return fs.exists.includes(path)
    },
    isFile: (path) => fs.files.includes(path),
    listWslDistributions: () => wsl,
    env,
  })
  return { service, existsCalls }
}

describe('decodeWslList', () => {
  it("decodes UTF-16LE output with BOM and CRLF (this machine's real shape)", () => {
    const raw = Buffer.from('\uFEFFUbuntu-24.04\r\nDebian-12\r\n', 'utf16le')
    expect(decodeWslList(raw)).toEqual(['Ubuntu-24.04', 'Debian-12'])
  })

  it('returns an empty list for blank output', () => {
    expect(decodeWslList(Buffer.from('\uFEFF\r\n', 'utf16le'))).toEqual([])
  })
})

describe('detect', () => {
  it('lists default first, then installed candidates in fixed order', () => {
    const { service } = makeService({
      exists: [
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe',
        'C:\\Windows\\System32\\cmd.exe',
      ],
      files: [],
    })
    const { shells } = service.detect([])
    expect(shells.map((shell) => shell.id)).toEqual(['default', 'powershell', 'pwsh', 'cmd'])
    expect(shells[0]?.label).toBe('PowerShell')
  })

  it('prefers PowerShell 7 under Program Files over the WindowsApps alias', () => {
    const { service } = makeService({
      exists: [
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe',
      ],
      files: [],
    })
    const { shells } = service.detect([])
    // One pwsh entry either way: the probe order only decides the spawn path.
    expect(shells.filter((shell) => shell.id === 'pwsh')).toHaveLength(1)
    expect(shells.map((shell) => shell.id)).toContain('pwsh')
  })

  it('adds one WSL entry per distribution with a display label', () => {
    const { service } = makeService({ exists: [], files: [] }, ['Ubuntu-24.04'])
    const { shells } = service.detect([])
    expect(shells).toContainEqual({ id: 'wsl:Ubuntu-24.04', label: 'WSL: Ubuntu-24.04' })
  })

  it('keeps only default when nothing is installed and WSL fails to answer', () => {
    const { service } = makeService({ exists: [], files: [] })
    const { shells, prunedCustomPaths } = service.detect([])
    expect(shells).toEqual([{ id: 'default', label: 'PowerShell' }])
    expect(prunedCustomPaths).toEqual([])
  })

  it('detects PowerShell 7 through the MSIX WindowsApps alias (access-based probe)', () => {
    // existsSync/statSync/openSync all reject the 0-byte reparse point with
    // EACCES; only accessSync(F_OK) sees it. The service must list pwsh when
    // its probe (the injected `exists`, standing in for accessSync) succeeds
    // even though a stricter file check would fail (regression: the Store
    // PowerShell 7 was invisible to the first existsSync-based detection).
    const alias = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe'
    const { service } = makeService({ exists: [alias], files: [] })
    const { shells } = service.detect([])
    expect(shells.map((shell) => shell.id)).toContain('pwsh')
  })

  it('merges persisted custom paths and prunes dead ones', () => {
    const { service } = makeService({
      exists: [],
      files: ['D:\\tools\\nu.exe'],
    })
    const { shells, prunedCustomPaths } = service.detect([
      'D:\\tools\\nu.exe',
      'D:\\tools\\gone.exe',
    ])
    expect(shells).toContainEqual({ id: customChoice('D:\\tools\\nu.exe'), label: 'nu.exe' })
    expect(prunedCustomPaths).toEqual(['D:\\tools\\gone.exe'])
  })

  it('coalesces concurrent runs through the pending slot', () => {
    const { service } = makeService({ exists: [], files: [] })
    const first = service.detect(['D:\\kept.exe'])
    const second = service.detect(['D:\\kept.exe'])
    expect(second).toBe(first)
    service.endDetect()
    const third = service.detect(['D:\\kept.exe'])
    expect(third).not.toBe(first)
  })
})

describe('list (cache read, never probes)', () => {
  it('before any detection: default only, no exists calls', () => {
    const { service, existsCalls } = makeService({ exists: [], files: [] })
    expect(service.list()).toEqual([{ id: 'default', label: 'PowerShell' }])
    expect(existsCalls).toEqual([])
  })

  it('after detection: the cached list, unchanged by the environment', () => {
    const fs: FsShape = { exists: ['C:\\Windows\\System32\\cmd.exe'], files: [] }
    const { service } = makeService(fs)
    service.detect([])
    fs.exists.length = 0 // even "uninstalling" must not change the cache
    expect(service.list().map((shell) => shell.id)).toEqual(['default', 'cmd'])
  })

  it('includes custom entries added after detection', () => {
    const { service } = makeService({ exists: [], files: ['D:\\tools\\nu.exe'] })
    service.detect([])
    service.addCustomPath('D:\\tools\\nu.exe')
    expect(service.list().map((shell) => shell.id)).toEqual([
      'default',
      customChoice('D:\\tools\\nu.exe'),
    ])
  })
})

describe('addCustomPath', () => {
  it('rejects relative paths', () => {
    const { service } = makeService({ exists: [], files: [] })
    expect(() => service.addCustomPath('tools/nu.exe')).toThrowError(/absolute/)
  })

  it('rejects paths that are not executable files', () => {
    const { service } = makeService({ exists: [], files: [] })
    expect(() => service.addCustomPath('D:\\tools\\nu.exe')).toThrowError(/executable file/)
  })

  it('adds a validated path as a custom entry labeled by base name', () => {
    const { service } = makeService({ exists: [], files: ['D:\\tools\\nu.exe'] })
    expect(service.addCustomPath('D:\\tools\\nu.exe')).toEqual({
      id: customChoice('D:\\tools\\nu.exe'),
      label: 'nu.exe',
    })
    expect(service.customPaths()).toEqual(['D:\\tools\\nu.exe'])
  })
})

describe('resolve (fallback rules)', () => {
  it('resolves default, empty, and missing to the platform default spec', () => {
    const { service } = makeService({ exists: [], files: [] })
    expect(service.resolve(null)).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
    expect(service.resolve('')).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
    expect(service.resolve('default')).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
  })

  it('resolves an installed candidate to its path and arguments', () => {
    const { service } = makeService({
      exists: ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
      files: [],
    })
    expect(service.resolve('powershell')).toEqual({
      file: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      args: ['-NoLogo'],
    })
  })

  it('falls back to the default when the candidate binary is gone', () => {
    const { service } = makeService({ exists: [], files: [] })
    expect(service.resolve('cmd')).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
  })

  it('resolves a WSL choice to wsl.exe -d <distro> without probing', () => {
    const { service, existsCalls } = makeService({ exists: [], files: [] })
    expect(service.resolve('wsl:Ubuntu-24.04')).toEqual({
      file: 'wsl.exe',
      args: ['-d', 'Ubuntu-24.04'],
    })
    expect(existsCalls).toEqual([])
  })

  it('falls back to the default for an unknown id and a dead custom path', () => {
    const { service } = makeService({ exists: [], files: [] })
    expect(service.resolve('wsl:')).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
    expect(service.resolve(customChoice('D:\\gone.exe'))).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo'],
    })
    expect(service.resolve('nonsense')).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
  })

  it('resolves a live custom path to the executable', () => {
    const { service } = makeService({ exists: [], files: ['D:\\tools\\nu.exe'] })
    expect(service.resolve(customChoice('D:\\tools\\nu.exe'))).toEqual({
      file: 'D:\\tools\\nu.exe',
      args: [],
    })
  })
})

describe('label (same fallback rules as resolve)', () => {
  it('labels the default and unknown choices with the platform default name', () => {
    const { service } = makeService({ exists: [], files: [] })
    expect(service.label(null)).toBe('PowerShell')
    expect(service.label('default')).toBe('PowerShell')
    expect(service.label('nonsense')).toBe('PowerShell')
  })

  it('labels detected and custom choices', () => {
    const { service } = makeService({
      exists: ['C:\\Windows\\System32\\cmd.exe'],
      files: ['D:\\tools\\nu.exe'],
    })
    service.detect([])
    expect(service.label('cmd')).toBe('cmd')
    expect(service.label('wsl:Ubuntu-24.04')).toBe('WSL: Ubuntu-24.04')
    expect(service.label(customChoice('D:\\tools\\nu.exe'))).toBe('nu.exe')
  })

  it('falls back to the default label when the choice died', () => {
    const { service } = makeService({ exists: [], files: [] })
    expect(service.label('cmd')).toBe('PowerShell')
    expect(service.label(customChoice('D:\\gone.exe'))).toBe('PowerShell')
  })
})
