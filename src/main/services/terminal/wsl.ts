import { execFile, execFileSync } from 'node:child_process'
import { AppError } from '@shared/ipc-error'
import { parseWslPath, type WslLocation, wslProjectPath } from '@shared/wsl-path'
import type { ShellSpec } from './shell-service'
import { runWslAsync } from './wsl-async'

export type WslRun = (distribution: string, args: string[]) => string

export const runWsl: WslRun = (distribution, args) => {
  try {
    return execFileSync('wsl.exe', ['--distribution', distribution, '--exec', ...args], {
      timeout: 5000,
      encoding: 'utf8',
      windowsHide: true,
    })
  } catch {
    throw new AppError('unknown', 'The WSL distribution or executable is unavailable.')
  }
}

/**
 * WSL integration exists only when NeKode itself runs on Windows. On Linux,
 * including inside a WSL distribution where wsl.exe is reachable through
 * interop, WSL projects, discovery and shells stay hidden.
 */
export function wslSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
}

/** Rejects WSL project operations when NeKode does not run on Windows. */
export function requireWslSupport(platform: NodeJS.Platform = process.platform): void {
  if (!wslSupported(platform)) {
    throw new AppError('validation', 'WSL projects are available only when NeKode runs on Windows.')
  }
}

export function listWslDistributions(): string[] {
  try {
    return execFileSync('wsl.exe', ['--list', '--quiet'], { timeout: 5000, windowsHide: true })
      .toString('utf16le')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean)
  } catch {
    throw new AppError('unknown', 'Unable to list WSL distributions. Check that WSL is installed.')
  }
}

export function listWslDistributionsAsync(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'wsl.exe',
      ['--list', '--quiet'],
      { timeout: 5000, windowsHide: true, encoding: 'buffer' },
      (error, stdout) => {
        if (error) {
          reject(
            new AppError(
              'unknown',
              'Unable to list WSL distributions. Check that WSL is installed.',
            ),
          )
          return
        }
        resolve(
          stdout
            .toString('utf16le')
            .replace(/^\uFEFF/, '')
            .split(/\r?\n/)
            .map((name) => name.trim())
            .filter(Boolean),
        )
      },
    )
  })
}

/** Query paths may end in '/' and include the root, unlike registration paths. */
export function listWslDirectories(distribution: string, query: string): string[] {
  const location = validateDirectoryQuery(distribution, query)
  if (location === null) return []
  const { parent } = location
  runWsl(distribution, ['/usr/bin/test', '-d', parent])
  const output = runWsl(distribution, directoryFindArgs(parent))
  return filterDirectories(distribution, location, output)
}

export async function listWslDirectoriesAsync(
  distribution: string,
  query: string,
): Promise<string[]> {
  const location = validateDirectoryQuery(distribution, query)
  if (location === null) return []
  const { parent } = location
  await runWslAsync(distribution, ['/usr/bin/test', '-d', parent])
  const output = await runWslAsync(distribution, directoryFindArgs(parent))
  return filterDirectories(distribution, location, output)
}

function validateDirectoryQuery(distribution: string, query: string) {
  try {
    // Validate the distribution even for empty queries without invoking WSL.
    wslProjectPath(distribution, '/query')
    if ([...query].some((character) => character.charCodeAt(0) < 32)) {
      throw new Error('Directory queries must not contain control characters.')
    }
    if (!query.startsWith('/')) return null
    const candidate = query === '/' ? '/query' : query.endsWith('/') ? query.slice(0, -1) : query
    wslProjectPath(distribution, candidate)
  } catch (error) {
    throw new AppError('validation', error instanceof Error ? error.message : 'Invalid WSL query.')
  }
  const separator = query.lastIndexOf('/')
  const parent = query.slice(0, separator) || '/'
  const prefix = query.slice(separator + 1)
  const childPrefix = parent === '/' ? '/' : `${parent}/`
  return { parent, prefix, childPrefix }
}

function directoryFindArgs(parent: string): string[] {
  // find on a regular file can succeed with no output; prove the parent is a directory first.
  return ['find', '-H', parent, '-mindepth', '1', '-maxdepth', '1', '-type', 'd', '-print0']
}

function filterDirectories(
  distribution: string,
  { prefix, childPrefix }: { prefix: string; childPrefix: string },
  output: string,
): string[] {
  return output
    .split('\0')
    .filter((path) => {
      if (!path.startsWith(childPrefix)) return false
      const name = path.slice(childPrefix.length)
      if (!name || name.includes('/') || !name.startsWith(prefix)) return false
      try {
        wslProjectPath(distribution, path)
        return true
      } catch {
        // Linux permits names that the shared project path contract deliberately rejects.
        return false
      }
    })
    .sort()
    .slice(0, 100)
}

export function validatedWslProjectPath(distribution: string, linuxPath: string): string {
  const path = validateWslProjectPath(distribution, linuxPath)
  if (!listWslDistributions().includes(distribution)) {
    throw new AppError('validation', 'The WSL distribution is not installed.')
  }
  runWsl(distribution, ['/usr/bin/test', '-d', linuxPath])
  return path
}

export async function validatedWslProjectPathAsync(
  distribution: string,
  linuxPath: string,
): Promise<string> {
  const path = validateWslProjectPath(distribution, linuxPath)
  if (!(await listWslDistributionsAsync()).includes(distribution)) {
    throw new AppError('validation', 'The WSL distribution is not installed.')
  }
  await runWslAsync(distribution, ['/usr/bin/test', '-d', linuxPath])
  return path
}

function validateWslProjectPath(distribution: string, linuxPath: string): string {
  try {
    return wslProjectPath(distribution, linuxPath)
  } catch (error) {
    throw new AppError(
      'validation',
      error instanceof Error ? error.message : 'Invalid WSL project path.',
    )
  }
}

/** Check the project's Linux PATH before a launch is reported as delivered. */
export function validateWslExecutable(path: string | WslLocation, shell: ShellSpec): void {
  const location = typeof path === 'string' ? parseWslPath(path) : path
  if (location === null || (shell.file === 'wsl.exe' && shell.args.length === 0)) return
  assertLinuxExecutable(shell.file)
  let result: string
  try {
    result = runWsl(location.distribution, [
      'bash',
      '-lc',
      'cd -- "$1" && if executable=$(type -P -- "$2") && test -f "$executable" && test -x "$executable"; then printf usable; fi',
      'nekode-executable',
      location.linuxPath,
      shell.file,
    ])
  } catch {
    throw new AppError(
      'unknown',
      `Unable to check Linux executable "${shell.file}" in WSL distribution "${location.distribution}".`,
    )
  }
  if (result !== 'usable') {
    throw new AppError(
      'not_found',
      `Linux executable "${shell.file}" is unavailable or not executable in WSL distribution "${location.distribution}".`,
    )
  }
}

export async function validateWslExecutableAsync(
  path: string | WslLocation,
  shell: ShellSpec,
): Promise<void> {
  const location = typeof path === 'string' ? parseWslPath(path) : path
  if (location === null || (shell.file === 'wsl.exe' && shell.args.length === 0)) return
  assertLinuxExecutable(shell.file)
  let result: string
  try {
    result = await runWslAsync(location.distribution, [
      'bash',
      '-lc',
      'cd -- "$1" && if executable=$(type -P -- "$2") && test -f "$executable" && test -x "$executable"; then printf usable; fi',
      'nekode-executable',
      location.linuxPath,
      shell.file,
    ])
  } catch {
    throw new AppError(
      'unknown',
      `Unable to check Linux executable "${shell.file}" in WSL distribution "${location.distribution}".`,
    )
  }
  if (result !== 'usable')
    throw new AppError(
      'not_found',
      `Linux executable "${shell.file}" is unavailable or not executable in WSL distribution "${location.distribution}".`,
    )
}

function assertLinuxExecutable(file: string): void {
  if (
    !file ||
    file.includes('\u0000') ||
    /[\\:]/.test(file) ||
    /\.(exe|com|cmd|bat)$/i.test(file) ||
    file.startsWith('-')
  ) {
    throw new AppError(
      'validation',
      'A WSL project requires a Linux executable, not a Windows executable.',
    )
  }
}

/** Bare names resolve through the login-shell Linux PATH; Windows executables are rejected. */
export function prepareWslTerminal(
  path: string | WslLocation,
  shell?: ShellSpec,
): { file: string; args: string[]; cwd: string } | null {
  const location = typeof path === 'string' ? parseWslPath(path) : path
  if (location === null) return null
  return wslTerminalSpec(location, shell)
}

function wslTerminalSpec(location: WslLocation, shell?: ShellSpec) {
  const args = ['--distribution', location.distribution, '--cd', location.linuxPath]
  if (shell !== undefined && !(shell.file === 'wsl.exe' && shell.args.length === 0)) {
    assertLinuxExecutable(shell.file)
    // A bash login shell loads ~/.profile, so user-installed CLIs (~/.local/bin)
    // resolve. The command and its args stay separate argv: bash never parses them.
    args.push('--exec', 'bash', '-lc', 'exec "$@"', 'bash', shell.file, ...shell.args)
  }
  return { file: 'wsl.exe', args, cwd: process.cwd() }
}

/** Agent profiles use the project's WSL choice without changing its host filesystem path. */
export function prepareWslAgent(
  path: string,
  command: ShellSpec,
  shellChoice: string | null,
): ShellSpec {
  // UNC projects already route through TerminalService using their persisted distribution.
  if (parseWslPath(path) !== null || !shellChoice?.startsWith('wsl:')) return command
  const distribution = shellChoice.slice('wsl:'.length)
  if (!distribution) return command // Same unconfigured-choice rule as ShellService.resolve.
  assertLinuxExecutable(command.file)
  let location: WslLocation
  try {
    wslProjectPath(distribution, '/query')
    const linuxPath = runWsl(distribution, ['wslpath', '-a', '-u', path]).replace(/\r?\n$/, '')
    wslProjectPath(distribution, linuxPath)
    location = { distribution, linuxPath }
  } catch {
    throw new AppError(
      'unknown',
      `Unable to resolve the project directory in WSL distribution "${distribution}".`,
    )
  }
  validateWslExecutable(location, command)
  // An explicit location always produces a WSL launch; the host cwd stays the Windows folder.
  const prepared = wslTerminalSpec(location, command)
  return { file: prepared.file, args: prepared.args }
}

export async function prepareWslAgentAsync(
  path: string,
  command: ShellSpec,
  shellChoice: string | null,
): Promise<ShellSpec> {
  if (parseWslPath(path) !== null || !shellChoice?.startsWith('wsl:')) return command
  const distribution = shellChoice.slice('wsl:'.length)
  if (!distribution) return command
  assertLinuxExecutable(command.file)
  let location: WslLocation
  try {
    wslProjectPath(distribution, '/query')
    const linuxPath = (await runWslAsync(distribution, ['wslpath', '-a', '-u', path])).replace(
      /\r?\n$/,
      '',
    )
    wslProjectPath(distribution, linuxPath)
    location = { distribution, linuxPath }
  } catch {
    throw new AppError(
      'unknown',
      `Unable to resolve the project directory in WSL distribution "${distribution}".`,
    )
  }
  await validateWslExecutableAsync(location, command)
  const prepared = wslTerminalSpec(location, command)
  return { file: prepared.file, args: prepared.args }
}
