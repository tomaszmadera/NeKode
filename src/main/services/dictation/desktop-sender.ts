import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '../../../shared/ipc-error'

export function desktopHelperPath(
  packaged: boolean,
  appPath: string,
  resourcesPath: string,
): string {
  return packaged
    ? join(resourcesPath, 'dictation', 'desktop-shortcut.ps1')
    : join(appPath, 'resources', 'dictation', 'desktop-shortcut.ps1')
}

const uncertain =
  'Shortcut outcome is uncertain. Inspect and stop OpenWhispr, and release Ctrl and Super if needed before trying again.'
const policyBlocked =
  "Windows PowerShell policy blocked the desktop dictation helper. Ask your administrator whether NeKode's bundled helper is permitted."
const errors: Record<string, string> = {
  FOREGROUND: 'Select the owning NeKode window and its prompt before using Dictation.',
  MODIFIERS: 'Release Ctrl, Super, Shift and Alt before using Dictation.',
  SEND_UNCERTAIN: uncertain,
  RELEASE_UNCERTAIN: uncertain,
}

/** The deadline bounds the caller, never terminates a sender after GO.
 * Serialization remains latched until process close, including after timeout.
 * Before GO, no input is permitted and terminating startup is safe. */
export class DesktopShortcutSender {
  private active = false
  constructor(
    private readonly helper: string,
    private readonly options: {
      platform?: NodeJS.Platform
      exists?: (path: string) => boolean
      launch?: (exe: string, args: string[]) => ChildProcessWithoutNullStreams
      systemRoot?: string
      startupMs?: number
      dispatchMs?: number
    } = {},
  ) {}

  send(handle: string): Promise<void> {
    if ((this.options.platform ?? process.platform) !== 'win32')
      return Promise.reject(new AppError('validation', 'Desktop dictation requires Windows.'))
    if (!/^[1-9]\d*$/.test(handle))
      return Promise.reject(new AppError('validation', 'The owning NeKode window is unavailable.'))
    if (!(this.options.exists ?? existsSync)(this.helper))
      return Promise.reject(
        new AppError(
          'not_found',
          'The desktop dictation helper is unavailable. Repair your NeKode installation.',
        ),
      )
    if (this.active)
      return Promise.reject(
        new AppError(
          'conflict',
          `The previous shortcut helper is still completing cleanup. ${uncertain}`,
        ),
      )
    this.active = true
    return new Promise<void>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams
      try {
        const systemRoot = this.options.systemRoot ?? process.env.SystemRoot
        if (!systemRoot) throw new Error('Windows system directory unavailable')
        const exe = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        // Applies only to this fixed helper process. Enforced Group Policy still takes precedence.
        const args = [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          this.helper,
          '-ExpectedWindow',
          handle,
        ]
        child = this.options.launch
          ? this.options.launch(exe, args)
          : spawn(exe, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch {
        this.active = false
        reject(
          new AppError(
            'not_found',
            'The Windows shortcut helper could not start. Repair your NeKode installation.',
          ),
        )
        return
      }
      let go = false
      let settled = false
      let activeReleased = false
      const releaseActive = () => {
        if (activeReleased) return
        activeReleased = true
        this.active = false
      }
      let buffer = ''
      let startupStderr = ''
      let outputBytes = 0
      let outcome: string | null = null
      const initializationFailure = () =>
        startupStderr.includes('PSSecurityException') ||
        (/CategoryInfo\s*:\s*SecurityError:/.test(startupStderr) &&
          /FullyQualifiedErrorId\s*:\s*UnauthorizedAccess\b/.test(startupStderr))
          ? policyBlocked
          : 'The shortcut helper could not initialize. Repair your NeKode installation.'
      const finish = (message?: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (message) reject(new AppError('unknown', message))
        else resolve()
      }
      const abort = (message: string) => {
        if (settled) return
        finish(message)
        if (!go) child.kill()
      }
      let timer = setTimeout(
        () =>
          abort(
            'The Windows shortcut helper did not become ready. Repair your NeKode installation.',
          ),
        this.options.startupMs ?? 10000,
      )
      child.stdout.on('data', (data: Buffer) => {
        if (settled) return
        outputBytes += data.length
        if (outputBytes > 4096) {
          abort(
            go
              ? uncertain
              : 'The shortcut helper returned an invalid response. Repair your NeKode installation.',
          )
          return
        }
        buffer += data.toString('utf8')
        let end = buffer.indexOf('\n')
        while (end !== -1 && !settled) {
          const line = buffer.slice(0, end).trim()
          buffer = buffer.slice(end + 1)
          if (line === 'READY' && !go && outcome === null) {
            go = true
            clearTimeout(timer)
            timer = setTimeout(() => finish(uncertain), this.options.dispatchMs ?? 5000)
            child.stdin.end('GO\n')
          } else if (go && outcome === null && (line === 'OK' || Object.hasOwn(errors, line))) {
            outcome = line
          } else {
            abort(
              go
                ? uncertain
                : 'The shortcut helper returned an invalid response. Repair your NeKode installation.',
            )
          }
          end = buffer.indexOf('\n')
        }
      })
      // Retain only bounded startup diagnostics; never disclose raw native paths/errors.
      child.stderr.on('data', (data: Buffer) => {
        if (settled) return
        if (!go) startupStderr = (startupStderr + data.toString('utf8')).slice(0, 4096)
        outputBytes += data.length
        if (outputBytes > 4096) abort(go ? uncertain : initializationFailure())
      })
      child.stdin.on('error', () =>
        abort(go ? uncertain : 'The shortcut helper could not initialize.'),
      )
      child.on('error', () => {
        if (!go) releaseActive()
        abort(
          go
            ? uncertain
            : 'The Windows shortcut helper could not start. Repair your NeKode installation.',
        )
      })
      child.once('close', (code) => {
        releaseActive()
        if (code === 0 && outcome === 'OK') finish()
        else
          finish(
            outcome && Object.hasOwn(errors, outcome)
              ? errors[outcome]
              : go
                ? uncertain
                : initializationFailure(),
          )
      })
    })
  }
}
