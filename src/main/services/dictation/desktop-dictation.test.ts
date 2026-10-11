import { describe, expect, it, vi } from 'vitest'
import { APP_STATE_KEY } from '../../../shared/ipc-contract'
import { DesktopDictation } from './desktop-dictation'

function harness(platform: NodeJS.Platform = 'win32') {
  const values = new Map<string, string>()
  const state = {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value)
    },
  }
  const send = vi.fn(async (_handle: string) => {})
  return { values, send, state, service: new DesktopDictation(state, send, platform) }
}

describe('desktop dictation setup and dispatch', () => {
  it('defaults off, preserves local setup, resets confirmation on enablement changes and round trips', async () => {
    const { values, send, state, service } = harness()
    values.set(APP_STATE_KEY.dictationEnabled, 'true')
    expect(service.get()).toEqual({
      supported: true,
      settings: { enabled: false, confirmed: false },
    })
    await expect(service.activate('123')).rejects.toThrow('confirm')
    expect(service.set({ enabled: true, confirmed: true }).settings.confirmed).toBe(false)
    service.set({ enabled: true, confirmed: true })
    expect(new DesktopDictation(state, send, 'win32').get().settings).toEqual({
      enabled: true,
      confirmed: true,
    })
    await service.activate('123')
    expect(send).toHaveBeenCalledExactlyOnceWith('123')
    service.set({ enabled: false, confirmed: false })
    expect(service.set({ enabled: true, confirmed: true }).settings.confirmed).toBe(false)
    expect(values.get(APP_STATE_KEY.dictationEnabled)).toBe('true')
    expect(send).toHaveBeenCalledOnce()
  })

  it('refuses unsupported, unconfirmed and malformed settings without sending', async () => {
    const { values, service, send } = harness('linux')
    service.set({ enabled: true, confirmed: false })
    service.set({ enabled: true, confirmed: true })
    await expect(service.activate('123')).rejects.toThrow('Windows')
    expect(() => service.set({ enabled: false, confirmed: true })).toThrow('invalid')
    values.set(APP_STATE_KEY.dictationDesktop, '{')
    expect(() => service.get()).toThrow('invalid')
    values.set(APP_STATE_KEY.dictationDesktop, '{"enabled":true,"confirmed":true,"command":"bad"}')
    expect(() => service.get()).toThrow('invalid')
    expect(send).not.toHaveBeenCalled()
  })

  it('ignores reentrant activation and settles after sender failure without retry', async () => {
    const { service, send } = harness()
    service.set({ enabled: true, confirmed: false })
    service.set({ enabled: true, confirmed: true })
    let rejectSend!: (error: Error) => void
    send.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSend = reject
        }),
    )
    const first = service.activate('123')
    await service.activate('456')
    expect(send).toHaveBeenCalledOnce()
    rejectSend(new Error('uncertain'))
    await expect(first).rejects.toThrow('uncertain')
    expect(send).toHaveBeenCalledOnce()
    await service.activate('123')
    expect(send).toHaveBeenCalledTimes(2)
  })
})
