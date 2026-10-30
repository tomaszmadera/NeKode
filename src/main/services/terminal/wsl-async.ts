import { execFile } from 'node:child_process'
import { AppError } from '@shared/ipc-error'

/** Run a WSL probe without blocking the main process. */
export function runWslAsync(distribution: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'wsl.exe',
      ['--distribution', distribution, '--exec', ...args],
      { timeout: 5000, encoding: 'utf8', windowsHide: true },
      (error, stdout) => {
        if (error)
          reject(new AppError('unknown', 'The WSL distribution or executable is unavailable.'))
        else resolve(stdout)
      },
    )
  })
}
