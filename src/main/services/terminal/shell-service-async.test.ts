import { describe, expect, it, vi } from 'vitest'
import { ShellService } from './shell-service'

describe('asynchronous WSL shell discovery', () => {
  it('shares a pending host distribution listing and degrades on failure', async () => {
    let fail: (error: Error) => void = () => {}
    const listWslDistributionsAsync = vi.fn(
      () =>
        new Promise<string[]>((_resolve, reject) => {
          fail = reject
        }),
    )
    const service = new ShellService({
      platform: 'win32',
      exists: () => false,
      isFile: () => false,
      listWslDistributionsAsync,
    })
    const first = service.detectAsync([])
    const second = service.detectAsync([])
    expect(listWslDistributionsAsync).toHaveBeenCalledOnce()
    fail(new Error('unavailable'))
    expect((await first).shells.map((shell) => shell.id)).toEqual(['default'])
    expect(await second).toEqual(await first)
    service.endDetect()
  })
  it('validates custom shell selection asynchronously', async () => {
    const runWslAsync = vi.fn(async () => 'usable')
    const service = new ShellService({ runWslAsync })
    const project = '\\\\wsl$\\Ubuntu\\home\\user'
    await expect(service.addCustomPathAsync('/bin/fish', project)).resolves.toMatchObject({
      id: 'custom:/bin/fish',
    })
    await expect(service.resolveAsync('custom:/bin/fish', project)).resolves.toEqual({
      file: '/bin/fish',
      args: [],
    })
    expect(runWslAsync).toHaveBeenCalledTimes(2)
  })
  it('waits for WSL shell probes without blocking the caller', async () => {
    let finish: (output: string) => void = () => {}
    const runWslAsync = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    )
    const service = new ShellService({ runWslAsync })
    const result = service.detectAsync([], '\\\\wsl$\\Ubuntu\\home\\user')
    expect(runWslAsync).toHaveBeenCalledOnce()
    finish('/bin/bash\n')
    await Promise.resolve()
    finish('usable')
    await expect(result).resolves.toMatchObject({
      shells: [{ id: 'default' }, { id: 'custom:/bin/bash' }],
    })
  })
})
