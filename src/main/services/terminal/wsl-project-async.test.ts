import { execFile } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  listWslDirectoriesAsync,
  listWslDistributionsAsync,
  validatedWslProjectPathAsync,
} from './wsl'

vi.mock('node:child_process', () => ({ execFile: vi.fn(), execFileSync: vi.fn() }))

describe('asynchronous WSL project discovery', () => {
  it('decodes asynchronously listed UTF-16 distributions', async () => {
    vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
      queueMicrotask(() =>
        (callback as (error: null, stdout: Buffer) => void)(
          null,
          Buffer.from('\uFEFFUbuntu\r\nDebian\r\n', 'utf16le'),
        ),
      )
      return {} as ReturnType<typeof execFile>
    }) as typeof execFile)
    await expect(listWslDistributionsAsync()).resolves.toEqual(['Ubuntu', 'Debian'])
    expect(execFile).toHaveBeenCalledWith(
      'wsl.exe',
      ['--list', '--quiet'],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    )
  })
  it('checks distribution and directory before returning a registration path', async () => {
    vi.mocked(execFile).mockImplementation(((_file, args, _options, callback) => {
      const output = (args as string[]).includes('--list')
        ? Buffer.from('Ubuntu\r\n', 'utf16le')
        : ''
      queueMicrotask(() =>
        (callback as (error: null, stdout: Buffer | string) => void)(null, output),
      )
      return {} as ReturnType<typeof execFile>
    }) as typeof execFile)
    await expect(validatedWslProjectPathAsync('Ubuntu', '/home/user')).resolves.toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\user',
    )
  })
  it('does not block while checking and listing the parent directory', async () => {
    const callbacks: Array<(error: Error | null, stdout: string) => void> = []
    vi.mocked(execFile).mockImplementation(((_file, _args, _options, callback) => {
      callbacks.push(callback as (error: Error | null, stdout: string) => void)
      return {} as ReturnType<typeof execFile>
    }) as typeof execFile)
    const result = listWslDirectoriesAsync('Ubuntu', '/home/us')
    expect(callbacks).toHaveLength(1)
    callbacks[0](null, '')
    await Promise.resolve()
    expect(callbacks).toHaveLength(2)
    callbacks[1](null, '/home/user\0/home/other\0')
    await expect(result).resolves.toEqual(['/home/user'])
  })
})
