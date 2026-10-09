import { execFileSync } from 'node:child_process'
import { AppError } from '../../../shared/ipc-error'
import { parseWslPath, wslProjectPath } from '../../../shared/wsl-path'
import type { ShellSpec } from './shell-service'

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

export function validatedWslProjectPath(distribution: string, linuxPath: string): string {
  let path: string
  try {
    path = wslProjectPath(distribution, linuxPath)
  } catch (error) {
    throw new AppError(
      'validation',
      error instanceof Error ? error.message : 'Invalid WSL project path.',
    )
  }
  if (!listWslDistributions().includes(distribution)) {
    throw new AppError('validation', 'The WSL distribution is not installed.')
  }
  runWsl(distribution, ['/usr/bin/test', '-d', linuxPath])
  return path
}

/** Bare names resolve through Linux PATH; Windows executables are rejected. */
export function prepareWslTerminal(
  path: string,
  shell?: ShellSpec,
): { file: string; args: string[]; cwd: string } | null {
  const location = parseWslPath(path)
  if (location === null) return null
  const args = ['--distribution', location.distribution, '--cd', location.linuxPath]
  if (shell !== undefined && !(shell.file === 'wsl.exe' && shell.args.length === 0)) {
    if (
      !shell.file ||
      shell.file.includes('\u0000') ||
      /[\\:]/.test(shell.file) ||
      /\.(exe|com|cmd|bat)$/i.test(shell.file) ||
      shell.file.startsWith('-')
    ) {
      throw new AppError(
        'validation',
        'A WSL project requires a Linux executable, not a Windows executable.',
      )
    }
    args.push('--exec', shell.file, ...shell.args)
  }
  return { file: 'wsl.exe', args, cwd: process.cwd() }
}
