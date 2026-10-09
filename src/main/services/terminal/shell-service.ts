import { execFileSync } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { basename, isAbsolute, posix } from 'node:path'
import type { ShellChoice, ShellInfo } from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'
import { parseWslPath } from '../../../shared/wsl-path'
import { runWsl, type WslRun } from './wsl'

// ShellService (spec project-shell-selection): detection of installed shells,
// per-choice resolution to a spawnable spec, and display labels. Detection is
// explicit: the renderer triggers it on Shell-tab entry, so nothing probes
// the machine at startup or in the background. Local detection checks fixed
// candidate paths and enumerates WSL distributions. A WSL project probes only
// its distribution's Linux shells. Detection results live in a
// run-scoped cache; persisted custom paths re-validate on every detection
// run (dead ones pruned). Local resolve() never throws: an unresolvable choice
// (uninstalled shell, removed distribution, unknown id) falls back to the
// platform default so a terminal always opens.
//
// Existence uses accessSync(F_OK), not existsSync: MSIX app-execution aliases
// (e.g. the Store PowerShell 7 at %LOCALAPPDATA%\Microsoft\WindowsApps\
// pwsh.exe) are 0-byte reparse points that existsSync reports as missing and
// statSync/openSync reject with EACCES, while accessSync sees them and the
// executable runs (verified on this host: PowerShell 7.6.6 via the alias).

/** The executable + arguments a PTY spawns (TerminalService contract). */
export interface ShellSpec {
  file: string
  args: string[]
}

export interface DetectResult {
  shells: ShellInfo[]
  /** Custom paths that no longer exist; main prunes them from storage. */
  prunedCustomPaths: string[]
}

/** Fixed Windows candidates probed at known locations, in display order. */
interface Candidate {
  id: ShellChoice
  label: string
  /**
   * Compact code for the chat-name prefix (spec project-shell-selection
   * Behaviour 6): `[PS7] Codex` instead of `[PowerShell 7] Codex`. The verbose
   * `label` stays the settings and bottom-tab text.
   */
  shortLabel: string
  /** First existing path wins; empty list = not installed. */
  paths: (env: NodeJS.ProcessEnv) => string[]
  spec: (path: string) => ShellSpec
}

/** Chat-prefix code for every WSL choice; the distribution is omitted. */
const WSL_SHORT_LABEL = 'WSL'

const WINDOWS_CANDIDATES: readonly Candidate[] = [
  {
    id: 'powershell',
    label: 'PowerShell',
    shortLabel: 'PS5',
    paths: (env) => [
      `${env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    ],
    spec: (path) => ({ file: path, args: ['-NoLogo'] }),
  },
  {
    id: 'pwsh',
    label: 'PowerShell 7',
    shortLabel: 'PS7',
    paths: (env) => [
      `${env.ProgramFiles ?? 'C:\\Program Files'}\\PowerShell\\7\\pwsh.exe`,
      `${env.LOCALAPPDATA ?? ''}\\Microsoft\\WindowsApps\\pwsh.exe`,
    ],
    spec: (path) => ({ file: path, args: ['-NoLogo'] }),
  },
  {
    id: 'cmd',
    label: 'cmd',
    shortLabel: 'cmd',
    paths: (env) => [`${env.SystemRoot ?? 'C:\\Windows'}\\System32\\cmd.exe`],
    spec: (path) => ({ file: path, args: [] }),
  },
  {
    id: 'gitbash',
    label: 'Git Bash',
    shortLabel: 'bash',
    paths: (env) => [`${env.ProgramFiles ?? 'C:\\Program Files'}\\Git\\bin\\bash.exe`],
    spec: (path) => ({ file: path, args: ['-i', '-l'] }),
  },
]

export interface ShellServiceOptions {
  /**
   * Existence probe; injectable for tests. The real implementation is
   * accessSync(F_OK): see the module comment for the MSIX-alias rationale.
   */
  runWsl?: WslRun
  exists?: (path: string) => boolean
  /** File check for custom paths; injectable for tests. */
  isFile?: (path: string) => boolean
  /**
   * WSL distribution enumeration; the real implementation runs
   * `wsl.exe --list --quiet` (UTF-16LE) with a short timeout and returns []
   * on any failure. Injectable for tests.
   */
  listWslDistributions?: () => string[]
  /** Process environment (SystemRoot / ProgramFiles / LOCALAPPDATA). */
  env?: NodeJS.ProcessEnv
}

/** Decodes `wsl.exe --list --quiet` output: UTF-16LE, optional BOM, CRLF. */
export function decodeWslList(raw: Buffer): string[] {
  const text = raw.toString('utf16le').replace(/^\uFEFF/, '')
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function realWslDistributions(): string[] {
  try {
    return decodeWslList(execFileSync('wsl.exe', ['--list', '--quiet'], { timeout: 5000 }))
  } catch {
    // Missing wsl.exe, no distributions, or a failed call: WSL simply
    // contributes no entries and detection is not an error (spec Behaviour 2).
    return []
  }
}

function realIsFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Existence for candidate probing and custom-path spawn validation:
 * accessSync(F_OK) instead of existsSync so MSIX app-execution aliases (the
 * Store PowerShell 7) are detected and spawnable: see the module comment.
 */
function realExists(path: string): boolean {
  try {
    accessSync(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export class ShellService {
  readonly #exists: (path: string) => boolean
  readonly #isFile: (path: string) => boolean
  readonly #listWslDistributions: () => string[]
  readonly #env: NodeJS.ProcessEnv
  readonly #runWsl: WslRun
  readonly #wslLists = new Map<string, ShellInfo[]>()
  /** Run-scoped cache; null until the first detection of this app run. */
  #detected: ShellInfo[] | null = null
  /** Custom entries merged into the cache (validated at add/detect time). */
  #customEntries: ShellInfo[] = []
  /** A pending detection run; concurrent callers share it. */
  #pending: DetectResult | null = null

  constructor(options: ShellServiceOptions = {}) {
    this.#exists = options.exists ?? realExists
    this.#isFile = options.isFile ?? realIsFile
    this.#listWslDistributions = options.listWslDistributions ?? realWslDistributions
    this.#env = options.env ?? process.env
    this.#runWsl = options.runWsl ?? runWsl
  }

  /**
   * One detection run: fixed candidates + one WSL enumeration + re-validated
   * custom paths. `customPaths` is the persisted app-level list (shells.custom).
   */
  detect(customPaths: readonly string[], projectPath?: string): DetectResult {
    const location = projectPath === undefined ? null : parseWslPath(projectPath)
    if (location !== null) {
      const output = this.#runWsl(location.distribution, ['/bin/cat', '/etc/shells'])
      const paths = [
        ...new Set([
          ...output.split(/\r?\n/).filter((path) => path.startsWith('/')),
          ...customPaths,
        ]),
      ]
      const shells: ShellInfo[] = [
        { id: 'default', label: `Default (WSL: ${location.distribution})` },
      ]
      const prunedCustomPaths: string[] = []
      for (const path of paths) {
        try {
          this.#validateLinuxShell(path, location.distribution)
          shells.push({ id: customChoice(path), label: posix.basename(path) })
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== 'validation') throw error
          if (customPaths.includes(path)) prunedCustomPaths.push(path)
        }
      }
      this.#wslLists.set(projectPath as string, shells)
      return { shells, prunedCustomPaths }
    }
    if (this.#pending !== null) {
      return this.#pending
    }
    const shells: ShellInfo[] = [{ id: 'default', label: this.defaultLabel() }]
    if (process.platform === 'win32') {
      for (const candidate of WINDOWS_CANDIDATES) {
        const path = candidate.paths(this.#env).find((item) => this.#exists(item))
        if (path !== undefined) {
          shells.push({ id: candidate.id, label: candidate.label })
        }
      }
    }
    for (const distro of this.#listWslDistributions()) {
      shells.push({ id: `wsl:${distro}`, label: `WSL: ${distro}` })
    }
    const prunedCustomPaths: string[] = []
    const customEntries: ShellInfo[] = []
    for (const path of customPaths) {
      if (this.#isFile(path)) {
        customEntries.push({ id: customChoice(path), label: basename(path) })
      } else {
        prunedCustomPaths.push(path)
      }
    }
    this.#customEntries = customEntries
    this.#detected = [...shells, ...customEntries]
    this.#pending = { shells: this.#detected, prunedCustomPaths }
    return this.#pending
  }

  /** Clears the coalescing slot after the caller persisted pruned paths. */
  endDetect(): void {
    this.#pending = null
  }

  /**
   * Cached list for rendering: `default`, the last detection, and custom
   * entries. Never probes (spec Behaviour 3); null detected means the Shell
   * tab has not run detection yet in this app run.
   */
  list(projectPath?: string): ShellInfo[] {
    const location = projectPath === undefined ? null : parseWslPath(projectPath)
    if (location !== null)
      return (
        this.#wslLists.get(projectPath as string) ?? [
          { id: 'default', label: `Default (WSL: ${location.distribution})` },
        ]
      )
    const detected = this.#detected ?? [{ id: 'default' as const, label: this.defaultLabel() }]
    return [...detected, ...this.#customEntries.filter((entry) => !hasId(detected, entry.id))]
  }

  /**
   * Validates an absolute executable path and adds it to the cache as a
   * `custom:<path>` entry. Storage (shells.custom) is owned by the caller.
   */
  addCustomPath(path: string, projectPath?: string): ShellInfo {
    const location = projectPath === undefined ? null : parseWslPath(projectPath)
    if (location !== null) {
      this.#validateLinuxShell(path, location.distribution)
      const entry: ShellInfo = { id: customChoice(path), label: posix.basename(path) }
      this.#wslLists.set(projectPath as string, [
        ...this.list(projectPath).filter((shell) => shell.id !== entry.id),
        entry,
      ])
      return entry
    }
    const trimmed = path.trim()
    if (trimmed.length === 0 || !isAbsolute(trimmed)) {
      throw new AppError('validation', 'The shell path must be absolute.')
    }
    if (!this.#isFile(trimmed)) {
      throw new AppError('validation', 'The shell path does not point to an executable file.')
    }
    const entry: ShellInfo = { id: customChoice(trimmed), label: basename(trimmed) }
    this.#customEntries = [...this.#customEntries.filter((item) => item.id !== entry.id), entry]
    this.#detected = [
      ...(this.#detected ?? [{ id: 'default' as const, label: this.defaultLabel() }]),
    ]
    return entry
  }

  /** Read access for the caller persisting shells.custom. */
  customPaths(): string[] {
    return this.#customEntries.map((entry) => customPathOf(entry.id))
  }

  /**
   * Resolves a stored choice to a spawnable spec. Local choices fall back to
   * the platform default. WSL host choices use the distribution default;
   * unavailable Linux choices fail explicitly. `null`/empty/absent is default.
   */
  resolve(choice: string | null | undefined, projectPath?: string): ShellSpec {
    const location = projectPath === undefined ? null : parseWslPath(projectPath)
    if (location !== null) {
      // Historic host choices are visibly represented by the distribution default.
      if (!choice?.startsWith('custom:/')) return { file: 'wsl.exe', args: [] }
      const path = customPathOf(choice)
      this.#validateLinuxShell(path, location.distribution)
      return { file: path, args: [] }
    }
    if (choice === null || choice === undefined || choice.length === 0 || choice === 'default') {
      return this.defaultShellSpec()
    }
    if (choice.startsWith('custom:')) {
      const path = customPathOf(choice)
      return this.#isFile(path) ? { file: path, args: [] } : this.defaultShellSpec()
    }
    if (choice.startsWith('wsl:')) {
      const distro = choice.slice('wsl:'.length)
      if (distro.length === 0) {
        return this.defaultShellSpec()
      }
      return { file: 'wsl.exe', args: ['-d', distro] }
    }
    const candidate = WINDOWS_CANDIDATES.find((item) => item.id === choice)
    if (candidate === undefined) {
      return this.defaultShellSpec()
    }
    const path = candidate.paths(this.#env).find((item) => this.#exists(item))
    return path !== undefined ? candidate.spec(path) : this.defaultShellSpec()
  }

  /**
   * Display label of a stored choice; same fallback rule as resolve() so the
   * chat name and the spawned shell can never disagree.
   */
  label(choice: string | null | undefined, projectPath?: string): string {
    const location = projectPath === undefined ? null : parseWslPath(projectPath)
    if (location !== null)
      return choice?.startsWith('custom:/')
        ? posix.basename(customPathOf(choice))
        : `WSL: ${location.distribution}`
    if (choice === null || choice === undefined || choice.length === 0 || choice === 'default') {
      return this.defaultLabel()
    }
    if (choice.startsWith('custom:')) {
      const path = customPathOf(choice)
      return this.#isFile(path) ? basename(path) : this.defaultLabel()
    }
    if (choice.startsWith('wsl:')) {
      const distro = choice.slice('wsl:'.length)
      return distro.length > 0 ? `WSL: ${distro}` : this.defaultLabel()
    }
    const detected = this.#detected?.find((entry) => entry.id === choice)
    if (detected !== undefined) {
      return detected.label
    }
    const candidate = WINDOWS_CANDIDATES.find((item) => item.id === choice)
    if (candidate === undefined) {
      return this.defaultLabel()
    }
    const path = candidate.paths(this.#env).find((item) => this.#exists(item))
    return path !== undefined ? candidate.label : this.defaultLabel()
  }

  /**
   * Compact chat-name prefix code of a stored choice (spec project-shell-selection
   * Behaviour 6): `[PS5]`, `[PS7]`, `[cmd]`, `[bash]`, `[WSL]`, or the base
   * name of a custom executable. Same fallback rules as label() and resolve(),
   * so the prefix can never disagree with the spawned shell. The verbose
   * `label()` keeps serving the Shell settings list and the bottom-tab text.
   */
  chatLabel(choice: string | null | undefined, projectPath?: string): string {
    const location = projectPath === undefined ? null : parseWslPath(projectPath)
    if (location !== null)
      return choice?.startsWith('custom:/') ? posix.basename(customPathOf(choice)) : WSL_SHORT_LABEL
    if (choice === null || choice === undefined || choice.length === 0 || choice === 'default') {
      return this.defaultShortLabel()
    }
    if (choice.startsWith('custom:')) {
      const path = customPathOf(choice)
      return this.#isFile(path) ? basename(path) : this.defaultShortLabel()
    }
    if (choice.startsWith('wsl:')) {
      const distro = choice.slice('wsl:'.length)
      return distro.length > 0 ? WSL_SHORT_LABEL : this.defaultShortLabel()
    }
    const candidate = WINDOWS_CANDIDATES.find((item) => item.id === choice)
    if (candidate === undefined) {
      return this.defaultShortLabel()
    }
    const path = candidate.paths(this.#env).find((item) => this.#exists(item))
    return path !== undefined ? candidate.shortLabel : this.defaultShortLabel()
  }

  #validateLinuxShell(path: string, distribution: string): void {
    if (
      !path.startsWith('/') ||
      path.includes('\\') ||
      path.includes('\u0000') ||
      path.split('/').some((part) => part === '..' || part === '.')
    ) {
      throw new AppError('validation', 'Use an absolute Linux shell path.')
    }
    // Fixed source, positional path data. Never interpolate the executable.
    const result = this.#runWsl(distribution, [
      '/bin/sh',
      '-c',
      'if test -f "$1" && test -x "$1"; then printf usable; fi',
      'nekode-shell',
      path,
    ])
    if (result !== 'usable')
      throw new AppError('validation', 'The Linux shell is unavailable or not executable.')
  }

  defaultShellSpec(): ShellSpec {
    if (process.platform === 'win32') {
      return { file: 'powershell.exe', args: ['-NoLogo'] }
    }
    return { file: process.env.SHELL ?? '/bin/bash', args: [] }
  }

  defaultLabel(): string {
    if (process.platform === 'win32') {
      return 'PowerShell'
    }
    return basename(process.env.SHELL ?? '/bin/bash')
  }

  /** Chat-prefix code of the platform-default shell (label()'s short form). */
  defaultShortLabel(): string {
    if (process.platform === 'win32') {
      return 'PS5'
    }
    return basename(process.env.SHELL ?? '/bin/bash')
  }
}

/** Serialized choice id of a custom executable path. */
export function customChoice(path: string): `custom:${string}` {
  return `custom:${path}`
}

/** The absolute path inside a `custom:<path>` choice id. */
export function customPathOf(choice: string): string {
  return choice.slice('custom:'.length)
}

function hasId(shells: readonly ShellInfo[], id: ShellChoice): boolean {
  return shells.some((entry) => entry.id === id)
}
