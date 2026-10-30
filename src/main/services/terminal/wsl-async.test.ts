import { execFile } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runWslAsync } from './wsl-async'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

beforeEach(() => vi.mocked(execFile).mockReset())

describe('asynchronous WSL probe', () => {
  it('returns immediately and resolves only when the child completes', async () => {
    let complete: (error: Error | null, stdout: string) => void = () => {}
    vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
      complete = callback as typeof complete
      return {} as ReturnType<typeof execFile>
    }) as typeof execFile)
    const result = runWslAsync('Ubuntu', ['pwd'])
    expect(execFile).toHaveBeenCalledWith(
      'wsl.exe',
      ['--distribution', 'Ubuntu', '--exec', 'pwd'],
      expect.objectContaining({ timeout: 5000, windowsHide: true, encoding: 'utf8' }),
      expect.any(Function),
    )
    complete(null, '/home/user')
    await expect(result).resolves.toBe('/home/user')
  })

  it('maps a timed-out child to the existing unavailable error', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
        setTimeout(() => (callback as (error: Error) => void)(new Error('killed')), 5000)
        return {} as ReturnType<typeof execFile>
      }) as typeof execFile)
      const result = runWslAsync('Ubuntu', ['pwd'])
      const assertion = expect(result).rejects.toThrow(
        'The WSL distribution or executable is unavailable.',
      )
      await vi.advanceTimersByTimeAsync(5000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
