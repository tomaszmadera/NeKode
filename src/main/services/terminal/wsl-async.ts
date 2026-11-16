import { execFile } from 'node:child_process'
import { AppError } from '@shared/ipc-error'

/**
 * Bound for one WSL probe. The first probe of a Windows session can have to
 * boot the whole WSL2 VM, which routinely takes longer than an already-running
 * distribution; a five-second bound failed the first WSL launch after a boot
 * before the distribution answered. The probe stays asynchronous; only the
 * finite deadline is large enough to cover a cold start.
 */
export const WSL_PROBE_TIMEOUT_MS = 30_000

/** Run a WSL probe without blocking the main process. */
export function runWslAsync(distribution: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'wsl.exe',
      ['--distribution', distribution, '--exec', ...args],
      { timeout: WSL_PROBE_TIMEOUT_MS, encoding: 'utf8', windowsHide: true },
      (error, stdout) => {
        if (error)
          reject(new AppError('unknown', 'The WSL distribution or executable is unavailable.'))
        else resolve(stdout)
      },
    )
  })
}
