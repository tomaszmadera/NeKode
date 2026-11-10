import { AppError } from '@shared/ipc-error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostPath, isWindowsHost } from '../../test-support/host-path'
import { customChoice, ShellService } from './shell-service'

// ShellService unit tests (spec project-shell-selection): everything
// OS-facing is injected (exists, isFile, WSL runner, env): no real probing
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

function makeService(
  fs: FsShape,
  wsl: string[] | (() => Promise<string[]>) = [],
  env: NodeJS.ProcessEnv = WIN_ENV,
  host: {
    platform?: NodeJS.Platform
    etcShells?: string
    executables?: string[]
    realpaths?: Record<string, string>
  } = {},
) {
  const existsCalls: string[] = []
  const service = new ShellService({
    exists: (path) => {
      existsCalls.push(path)
      return fs.exists.includes(path)
    },
    isFile: (path) => fs.files.includes(path),
    listWslDistributionsAsync: typeof wsl === 'function' ? wsl : async () => wsl,
    env,
    platform: host.platform,
    // Never read the test host's real /etc/shells.
    readEtcShells: () => host.etcShells ?? '',
    isExecutable: (path) => (host.executables ?? []).includes(path),
    realpath: (path) => host.realpaths?.[path] ?? path,
  })
  return { service, existsCalls }
}

describe('detect (async, the entry create-services calls)', () => {
  it.skipIf(!isWindowsHost)(
    'lists default first, then installed candidates in fixed order',
    async () => {
      const { service } = makeService({
        exists: [
          'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
          'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe',
          'C:\\Windows\\System32\\cmd.exe',
        ],
        files: [],
      })
      const { shells } = await service.detectAsync([])
      expect(shells.map((shell) => shell.id)).toEqual(['default', 'powershell', 'pwsh', 'cmd'])
      expect(shells[0]?.label).toBe('PowerShell')
    },
  )

  it.skipIf(!isWindowsHost)(
    'prefers PowerShell 7 under Program Files over the WindowsApps alias',
    async () => {
      const programFiles = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
      const { service } = makeService({
        exists: [programFiles, 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe'],
        files: [],
      })
      const { shells } = await service.detectAsync([])
      // One pwsh entry either way: the probe order decides the spawn path.
      expect(shells.filter((shell) => shell.id === 'pwsh')).toHaveLength(1)
      expect(service.resolve('pwsh').file).toBe(programFiles)
    },
  )

  it('adds one WSL entry per distribution with a display label', async () => {
    const { service } = makeService({ exists: [], files: [] }, ['Ubuntu-24.04'], WIN_ENV, {
      platform: 'win32',
    })
    const { shells } = await service.detectAsync([])
    expect(shells).toContainEqual({ id: 'wsl:Ubuntu-24.04', label: 'WSL: Ubuntu-24.04' })
  })

  it.skipIf(!isWindowsHost)(
    'keeps only default when nothing is installed and WSL fails to answer',
    async () => {
      const { service } = makeService({ exists: [], files: [] }, () =>
        Promise.reject(new Error('wsl unavailable')),
      )
      const { shells, prunedCustomPaths } = await service.detectAsync([])
      expect(shells).toEqual([{ id: 'default', label: 'PowerShell' }])
      expect(prunedCustomPaths).toEqual([])
    },
  )

  it('merges persisted custom paths and prunes dead ones', async () => {
    const { service } = makeService({
      exists: [],
      files: [hostPath('D:\\tools\\nu.exe')],
    })
    const { shells, prunedCustomPaths } = await service.detectAsync([
      hostPath('D:\\tools\\nu.exe'),
      hostPath('D:\\tools\\gone.exe'),
    ])
    expect(shells).toContainEqual({
      id: customChoice(hostPath('D:\\tools\\nu.exe')),
      label: 'nu.exe',
    })
    expect(prunedCustomPaths).toEqual([hostPath('D:\\tools\\gone.exe')])
  })

  it('coalesces concurrent runs through the pending slot', async () => {
    const { service } = makeService({ exists: [], files: [] })
    const first = service.detectAsync(['D:\\kept.exe'])
    const second = service.detectAsync(['D:\\kept.exe'])
    expect(await second).toBe(await first)
    service.endDetect()
    const third = service.detectAsync(['D:\\kept.exe'])
    expect(await third).not.toBe(await first)
  })
})

describe('list (cache read, never probes)', () => {
  it.skipIf(!isWindowsHost)('before any detection: default only, no exists calls', () => {
    const { service, existsCalls } = makeService({ exists: [], files: [] })
    expect(service.list()).toEqual([{ id: 'default', label: 'PowerShell' }])
    expect(existsCalls).toEqual([])
  })

  it.skipIf(!isWindowsHost)(
    'after detection: the cached list, unchanged by the environment',
    async () => {
      const fs: FsShape = { exists: ['C:\\Windows\\System32\\cmd.exe'], files: [] }
      const { service } = makeService(fs)
      await service.detectAsync([])
      fs.exists.length = 0 // even "uninstalling" must not change the cache
      expect(service.list().map((shell) => shell.id)).toEqual(['default', 'cmd'])
    },
  )

  it('includes custom entries added after detection', async () => {
    const { service } = makeService({ exists: [], files: [hostPath('D:\\tools\\nu.exe')] })
    await service.detectAsync([])
    service.addCustomPath(hostPath('D:\\tools\\nu.exe'))
    expect(service.list().map((shell) => shell.id)).toEqual([
      'default',
      customChoice(hostPath('D:\\tools\\nu.exe')),
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
    expect(() => service.addCustomPath(hostPath('D:\\tools\\nu.exe'))).toThrowError(
      /executable file/,
    )
  })

  it('adds a validated path as a custom entry labeled by base name', () => {
    const { service } = makeService({ exists: [], files: [hostPath('D:\\tools\\nu.exe')] })
    expect(service.addCustomPath(hostPath('D:\\tools\\nu.exe'))).toEqual({
      id: customChoice(hostPath('D:\\tools\\nu.exe')),
      label: 'nu.exe',
    })
    expect(service.customPaths()).toEqual([hostPath('D:\\tools\\nu.exe')])
  })
})

describe('resolve (fallback rules)', () => {
  it.skipIf(!isWindowsHost)(
    'resolves default, empty, and missing to the platform default spec',
    () => {
      const { service } = makeService({ exists: [], files: [] })
      expect(service.resolve(null)).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
      expect(service.resolve('')).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
      expect(service.resolve('default')).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
    },
  )

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

  it.skipIf(!isWindowsHost)('falls back to the default when the candidate binary is gone', () => {
    const { service } = makeService({ exists: [], files: [] })
    expect(service.resolve('cmd')).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
  })

  it('resolves a WSL choice to wsl.exe -d <distro> without probing', () => {
    const { service, existsCalls } = makeService({ exists: [], files: [] }, [], WIN_ENV, {
      platform: 'win32',
    })
    expect(service.resolve('wsl:Ubuntu-24.04')).toEqual({
      file: 'wsl.exe',
      args: ['-d', 'Ubuntu-24.04'],
    })
    expect(existsCalls).toEqual([])
  })

  it('falls back to the host default for a wsl: choice detection no longer lists', async () => {
    const { service } = makeService({ exists: [], files: [] }, ['Ubuntu-24.04'], WIN_ENV, {
      platform: 'win32',
    })
    // Before the first detection run nothing is known: the stored choice keeps spawning.
    expect(service.resolve('wsl:Removed')).toEqual({ file: 'wsl.exe', args: ['-d', 'Removed'] })
    expect(service.label('wsl:Removed')).toBe('WSL: Removed')
    expect(service.chatLabel('wsl:Removed')).toBe('WSL')
    expect(service.effectiveChoice('wsl:Removed')).toBe('wsl:Removed')
    await service.detectAsync([])
    expect(service.effectiveChoice('wsl:Removed')).toBe('default')
    // The stale id now resolves and reads as the host shell, like any other stale
    // choice. The host default itself differs per platform, so compare against it
    // instead of a literal (CI runs this file on Linux too).
    expect(service.resolve('wsl:Removed')).toEqual(service.resolve(null))
    expect(service.label('wsl:Removed')).toBe(service.label(null))
    expect(service.chatLabel('wsl:Removed')).toBe(service.chatLabel(null))
    // A distribution detection lists still runs in WSL.
    expect(service.resolve('wsl:Ubuntu-24.04')).toEqual({
      file: 'wsl.exe',
      args: ['-d', 'Ubuntu-24.04'],
    })
    expect(service.label('wsl:Ubuntu-24.04')).toBe('WSL: Ubuntu-24.04')
  })

  it.skipIf(!isWindowsHost)(
    'falls back to the default for an unknown id and a dead custom path',
    () => {
      const { service } = makeService({ exists: [], files: [] })
      expect(service.resolve('wsl:')).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
      expect(service.resolve(customChoice('D:\\gone.exe'))).toEqual({
        file: 'powershell.exe',
        args: ['-NoLogo'],
      })
      expect(service.resolve('nonsense')).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
    },
  )

  it('resolves a live custom path to the executable', () => {
    const { service } = makeService({ exists: [], files: ['D:\\tools\\nu.exe'] })
    expect(service.resolve(customChoice('D:\\tools\\nu.exe'))).toEqual({
      file: 'D:\\tools\\nu.exe',
      args: [],
    })
  })
})

describe('label (same fallback rules as resolve)', () => {
  it.skipIf(!isWindowsHost)(
    'labels the default and unknown choices with the platform default name',
    () => {
      const { service } = makeService({ exists: [], files: [] })
      expect(service.label(null)).toBe('PowerShell')
      expect(service.label('default')).toBe('PowerShell')
      expect(service.label('nonsense')).toBe('PowerShell')
    },
  )

  it.skipIf(!isWindowsHost)('labels detected and custom choices', async () => {
    const { service } = makeService(
      {
        exists: ['C:\\Windows\\System32\\cmd.exe'],
        files: ['D:\\tools\\nu.exe'],
      },
      ['Ubuntu-24.04'],
    )
    await service.detectAsync([])
    expect(service.label('cmd')).toBe('cmd')
    expect(service.label('wsl:Ubuntu-24.04')).toBe('WSL: Ubuntu-24.04')
    expect(service.label(customChoice('D:\\tools\\nu.exe'))).toBe('nu.exe')
  })

  it.skipIf(!isWindowsHost)('falls back to the default label when the choice died', () => {
    const { service } = makeService({ exists: [], files: [] })
    expect(service.label('cmd')).toBe('PowerShell')
    expect(service.label(customChoice('D:\\gone.exe'))).toBe('PowerShell')
  })
})

describe('chatLabel (compact chat prefix)', () => {
  const INSTALLED = [
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Windows\\System32\\cmd.exe',
    'C:\\Program Files\\Git\\bin\\bash.exe',
  ]

  it('maps each installed candidate to its compact code', () => {
    const { service } = makeService({ exists: INSTALLED, files: [] })
    expect(service.chatLabel('powershell')).toBe('PS5')
    expect(service.chatLabel('pwsh')).toBe('PS7')
    expect(service.chatLabel('cmd')).toBe('cmd')
    expect(service.chatLabel('gitbash')).toBe('bash')
  })

  it.skipIf(!isWindowsHost)(
    'collapses every WSL choice to one code without the distribution',
    () => {
      const { service } = makeService({ exists: [], files: [] })
      expect(service.chatLabel('wsl:Ubuntu-24.04')).toBe('WSL')
      expect(service.chatLabel('wsl:Debian-12')).toBe('WSL')
      expect(service.chatLabel('wsl:')).toBe('PS5')
    },
  )

  it.skipIf(!isWindowsHost)(
    'keeps the default, unknown and custom codes aligned with label()',
    () => {
      const { service } = makeService({ exists: [], files: ['D:\\tools\\nu.exe'] })
      expect(service.chatLabel(null)).toBe('PS5')
      expect(service.chatLabel('default')).toBe('PS5')
      expect(service.chatLabel('nonsense')).toBe('PS5')
      expect(service.chatLabel(customChoice('D:\\tools\\nu.exe'))).toBe('nu.exe')
    },
  )

  it.skipIf(!isWindowsHost)('falls back to the default code when the chosen binary died', () => {
    const { service } = makeService({ exists: [], files: [] })
    expect(service.chatLabel('cmd')).toBe('PS5')
    expect(service.chatLabel(customChoice('D:\\gone.exe'))).toBe('PS5')
  })

  it('uses WSL for a WSL project and the base name for its custom Linux shell', () => {
    const service = new ShellService({ runWsl: vi.fn(() => 'usable') })
    const project = '\\\\wsl$\\Ubuntu\\home\\u'
    expect(service.chatLabel('default', project)).toBe('WSL')
    expect(service.chatLabel('wsl:Debian-12', project)).toBe('WSL')
    expect(service.chatLabel(customChoice('/bin/fish'), project)).toBe('fish')
  })
})

describe('project-scoped WSL shells', () => {
  const project = '\\\\wsl$\\Ubuntu\\home\\u'
  it('probes only the project distribution and never host candidates, custom files or distributions', async () => {
    const exists = vi.fn()
    const isFile = vi.fn()
    const listWslDistributionsAsync = vi.fn(async () => [])
    const runWslAsync = vi.fn(async (_distribution: string, args: string[]) =>
      args[0] === '/bin/cat' ? '# shells\n/bin/bash\n/bin/zsh\n' : 'usable',
    )
    const service = new ShellService({ exists, isFile, listWslDistributionsAsync, runWslAsync })
    const { shells } = await service.detectAsync(['/bin/fish'], project)
    expect(shells.map((entry) => entry.id)).toEqual([
      'default',
      'custom:/bin/bash',
      'custom:/bin/zsh',
      'custom:/bin/fish',
    ])
    expect(exists).not.toHaveBeenCalled()
    expect(isFile).not.toHaveBeenCalled()
    expect(listWslDistributionsAsync).not.toHaveBeenCalled()
    expect(runWslAsync.mock.calls.every(([distribution]) => distribution === 'Ubuntu')).toBe(true)
    expect(service.resolve('powershell', project)).toEqual({ file: 'wsl.exe', args: [] })
    expect(exists).not.toHaveBeenCalled()
  })
  it('validates Linux custom shells in WSL and fails explicitly after removal', () => {
    const runWsl = vi.fn(() => 'usable')
    const service = new ShellService({ runWsl })
    expect(service.addCustomPath('/bin/fish', project)).toEqual({
      id: 'custom:/bin/fish',
      label: 'fish',
    })
    expect(() => service.addCustomPath('C:\\shell.exe', project)).toThrow(/Linux/)
    runWsl.mockImplementation(() => {
      throw new Error('removed')
    })
    expect(() => service.resolve('custom:/bin/fish', project)).toThrow()
  })
})

// Non-Windows hosts (Linux): the platform default is the user's $SHELL with a
// /bin/bash fallback, labelled by its base name. Windows candidates are never
// probed. Detection of further host shells (e.g. from /etc/shells) does not
// exist yet; these tests cover today's behaviour only.
describe.skipIf(isWindowsHost)('non-Windows host defaults ($SHELL)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('detects only the $SHELL default and never probes Windows candidates', async () => {
    vi.stubEnv('SHELL', '/usr/bin/zsh')
    const { service, existsCalls } = makeService({ exists: [], files: [] })
    const { shells, prunedCustomPaths } = await service.detectAsync([])
    expect(shells).toEqual([{ id: 'default', label: 'zsh' }])
    expect(prunedCustomPaths).toEqual([])
    expect(existsCalls).toEqual([])
    expect(service.list()).toEqual([{ id: 'default', label: 'zsh' }])
  })

  it('resolves default, empty, unknown and dead choices to $SHELL', () => {
    vi.stubEnv('SHELL', '/usr/bin/zsh')
    const { service } = makeService({ exists: [], files: [] })
    const zsh = { file: '/usr/bin/zsh', args: [] }
    for (const choice of [null, '', 'default', 'cmd', 'wsl:', 'nonsense']) {
      expect(service.resolve(choice)).toEqual(zsh)
    }
    expect(service.resolve(customChoice('/opt/gone/fish'))).toEqual(zsh)
  })

  it('falls back to /bin/bash when $SHELL is unset', () => {
    vi.stubEnv('SHELL', undefined)
    const { service } = makeService({ exists: [], files: [] })
    expect(service.resolve(null)).toEqual({ file: '/bin/bash', args: [] })
    expect(service.label(null)).toBe('bash')
    expect(service.chatLabel(null)).toBe('bash')
  })

  it('labels the default and fallbacks with the $SHELL base name', () => {
    vi.stubEnv('SHELL', '/usr/bin/zsh')
    const { service } = makeService({ exists: [], files: [] })
    for (const choice of [null, 'default', 'nonsense', 'cmd']) {
      expect(service.label(choice)).toBe('zsh')
      expect(service.chatLabel(choice)).toBe('zsh')
    }
  })

  it('resolves and labels a live POSIX custom shell', () => {
    vi.stubEnv('SHELL', '/bin/bash')
    const { service } = makeService({ exists: [], files: ['/usr/bin/fish'] })
    expect(service.addCustomPath('/usr/bin/fish')).toEqual({
      id: customChoice('/usr/bin/fish'),
      label: 'fish',
    })
    expect(service.resolve(customChoice('/usr/bin/fish'))).toEqual({
      file: '/usr/bin/fish',
      args: [],
    })
    expect(service.label(customChoice('/usr/bin/fish'))).toBe('fish')
    expect(service.chatLabel(customChoice('/usr/bin/fish'))).toBe('fish')
  })

  it('never lists or resolves WSL on Linux, even when wsl.exe interop answers (inside WSL)', async () => {
    vi.stubEnv('SHELL', '/bin/bash')
    const listWsl = vi.fn(async () => ['Ubuntu-24.04'])
    const service = new ShellService({
      platform: 'linux',
      listWslDistributionsAsync: listWsl,
      readEtcShells: () => '',
      isFile: () => false,
    })
    expect((await service.detectAsync([])).shells.map((shell) => shell.id)).toEqual(['default'])
    expect(listWsl).not.toHaveBeenCalled()
    expect(service.resolve('wsl:Ubuntu-24.04')).toEqual({ file: '/bin/bash', args: [] })
    expect(service.label('wsl:Ubuntu-24.04')).toBe('bash')
    expect(service.chatLabel('wsl:Ubuntu-24.04')).toBe('bash')
  })

  it('offers installed shells from /etc/shells: executables only, aliases and $SHELL de-duplicated', async () => {
    vi.stubEnv('SHELL', '/bin/bash')
    const etcShells = [
      '# /etc/shells: valid login shells',
      '/bin/sh',
      '/usr/bin/sh',
      '/bin/bash',
      '/usr/bin/bash',
      '/usr/bin/zsh',
      '/usr/local/bin/fish',
      '/usr/bin/missing',
      '',
    ].join('\n')
    const { service } = makeService({ exists: [], files: ['/usr/bin/zsh'] }, [], WIN_ENV, {
      platform: 'linux',
      etcShells,
      executables: ['/bin/sh', '/usr/bin/sh', '/bin/bash', '/usr/bin/bash', '/usr/bin/zsh'],
      realpaths: {
        '/bin/sh': '/usr/bin/dash',
        '/usr/bin/sh': '/usr/bin/dash',
        '/bin/bash': '/usr/bin/bash',
      },
    })
    const { shells, prunedCustomPaths } = await service.detectAsync([])
    expect(shells).toEqual([
      { id: 'default', label: 'bash' },
      { id: customChoice('/bin/sh'), label: 'sh' },
      { id: customChoice('/usr/bin/zsh'), label: 'zsh' },
    ])
    expect(prunedCustomPaths).toEqual([])
    // Detected entries resolve and label like custom paths (no new id scheme).
    expect(service.resolve(customChoice('/usr/bin/zsh'))).toEqual({
      file: '/usr/bin/zsh',
      args: [],
    })
    expect(service.chatLabel(customChoice('/usr/bin/zsh'))).toBe('zsh')
  })

  it('leaves terminal multiplexers (tmux, screen) out of the /etc/shells list', async () => {
    vi.stubEnv('SHELL', '/bin/bash')
    const { service } = makeService({ exists: [], files: [] }, [], WIN_ENV, {
      platform: 'linux',
      etcShells: '/bin/bash\n/usr/bin/tmux\n/usr/bin/screen\n/bin/zsh\n',
      executables: ['/bin/bash', '/usr/bin/tmux', '/usr/bin/screen', '/bin/zsh'],
    })
    expect((await service.detectAsync([])).shells).toEqual([
      { id: 'default', label: 'bash' },
      { id: customChoice('/bin/zsh'), label: 'zsh' },
    ])
  })

  it('does not duplicate a persisted custom path that /etc/shells also lists', async () => {
    vi.stubEnv('SHELL', '/bin/bash')
    const { service } = makeService({ exists: [], files: ['/usr/bin/zsh'] }, [], WIN_ENV, {
      platform: 'linux',
      etcShells: '/usr/bin/zsh\n',
      executables: ['/usr/bin/zsh'],
    })
    const ids = (await service.detectAsync(['/usr/bin/zsh'])).shells.map((shell) => shell.id)
    expect(ids).toEqual(['default', customChoice('/usr/bin/zsh')])
  })
})

// SSH projects (spec ssh-projects Behaviour 9): one Default entry meaning the
// remote login shell, no host or WSL probe, and no custom remote shell path.
describe('SSH project shell', () => {
  const SSH = 'ssh://tomek@minipc/srv/app'

  it('answers one Default entry and never probes host or WSL shells', () => {
    const { service, existsCalls } = makeService({
      exists: ['C:\\Windows\\System32\\cmd.exe'],
      files: ['D:/sh.exe'],
    })
    expect(service.list(SSH)).toEqual([{ id: 'default', label: 'Default (remote login shell)' }])
    expect(service.label('default', SSH)).toBe('Default (remote login shell)')
    // A historic host choice is not represented for an SSH project.
    expect(service.label('custom:D:/sh.exe', SSH)).toBe('Default (remote login shell)')
    // AC7: the chat label identifies the session as SSH, not the remote shell.
    expect(service.chatLabel('powershell', SSH)).toBe('SSH')
    // No local spawn spec exists for an SSH project: the terminal runtime
    // spawns the ssh client instead (prepareSshTerminal).
    expect(() => service.resolve('powershell', SSH)).toThrow(
      'This action is not available for SSH projects.',
    )
    expect(() => service.resolve('powershell', SSH)).toThrow(AppError)
    expect(existsCalls).toEqual([])
  })

  it('reports unsupported detection and custom shells without a WSL probe', async () => {
    const runWsl = vi.fn(() => '')
    const runWslAsync = vi.fn(async () => '')
    const service = new ShellService({
      runWsl,
      runWslAsync,
      listWslDistributionsAsync: vi.fn(async () => ['Ubuntu']),
      exists: () => false,
      isFile: () => false,
    })
    await expect(service.detectAsync([], SSH)).rejects.toMatchObject({ code: 'unsupported' })
    await expect(service.addCustomPathAsync('/bin/fish', SSH)).rejects.toMatchObject({
      code: 'unsupported',
    })
    expect(() => service.addCustomPath('/bin/fish', SSH)).toThrow(
      'This action is not available for SSH projects.',
    )
    expect(runWsl).not.toHaveBeenCalled()
    expect(runWslAsync).not.toHaveBeenCalled()
  })
})
