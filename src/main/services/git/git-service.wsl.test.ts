import { execFile } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { GitService } from './git-service'

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
      expect.objectContaining({ cwd: process.cwd(), windowsHide: true }),
      expect.any(Function),
    )
  })
})
