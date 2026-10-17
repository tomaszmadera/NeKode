import { execFile } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { execFileRunner, GIT_MAX_BUFFER_BYTES, GIT_TIMEOUT_MS, GitService } from './git-service'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

describe('WSL Git status', () => {
  it('runs Linux git through exact distribution/cwd argv with a valid host cwd', async () => {
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const done = args[args.length - 1] as (error: null, stdout: string, stderr: string) => void
      done(null, '# branch.head main\n', '')
      return {} as ReturnType<typeof execFile>
    })
    expect(
      await new GitService().getStatus('\\\\wsl$\\Ubuntu\\home\\user\\My $ Project'),
    ).toMatchObject({ branch: 'main', dirty: false })
    expect(execFile).toHaveBeenCalledWith(
      'wsl.exe',
      [
        '--distribution',
        'Ubuntu',
        '--cd',
        '/home/user/My $ Project',
        '--exec',
        'git',
        'status',
        '--porcelain=v2',
        '--branch',
      ],
      expect.objectContaining({
        cwd: process.cwd(),
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER_BYTES,
      }),
      expect.any(Function),
    )
  })

  it('runs GitService.sync through wsl.exe for WSL project paths', async () => {
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const done = args[args.length - 1] as (error: null, stdout: string, stderr: string) => void
      done(null, '', '')
      return {} as ReturnType<typeof execFile>
    })
    const service = new GitService()
    await service.sync('\\\\wsl$\\Ubuntu\\home\\user\\My $ Project')
    expect(execFile).toHaveBeenCalledWith(
      'wsl.exe',
      ['--distribution', 'Ubuntu', '--cd', '/home/user/My $ Project', '--exec', 'git', 'pull'],
      expect.objectContaining({
        cwd: process.cwd(),
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER_BYTES,
      }),
      expect.any(Function),
    )
  })
})

describe('execFileRunner diagnostics and configuration', () => {
  it('passes explicit 16 MB maxBuffer and 15s timeout', async () => {
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const done = args[args.length - 1] as (error: null, stdout: string, stderr: string) => void
      done(null, 'ok', '')
      return {} as ReturnType<typeof execFile>
    })
    const result = await execFileRunner(['status'], 'D:/repo')
    expect(result).toEqual({ stdout: 'ok', stderr: '', exitCode: 0 })
    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['status'],
      expect.objectContaining({
        cwd: 'D:/repo',
        timeout: 15000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      }),
      expect.any(Function),
    )
  })

  it('logs runner failure once when error occurs with exit code != 128', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const done = args[args.length - 1] as (error: Error, stdout: string, stderr: string) => void
      const error = new Error('stdout maxBuffer length exceeded')
      ;(error as { code?: string }).code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      done(error, '', '')
      return {} as ReturnType<typeof execFile>
    })
    const result = await execFileRunner(['status'], 'D:/repo')
    expect(result.exitCode).toBe(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[git] runner failed for "D:/repo" (status):'),
      expect.stringContaining('maxBuffer'),
    )
    warnSpy.mockRestore()
  })

  it('does not log warning when non-zero exit is code 128 (not a repository)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const done = args[args.length - 1] as (error: Error, stdout: string, stderr: string) => void
      const error = new Error('fatal: not a git repository')
      ;(error as { code?: number }).code = 128
      done(error, '', 'fatal: not a git repository')
      return {} as ReturnType<typeof execFile>
    })
    const result = await execFileRunner(['status'], 'D:/repo')
    expect(result.exitCode).toBe(128)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
