import { PREVIEW_CHANNEL } from '@shared/contracts/preview-contract'
import type { AppApi } from '@shared/ipc-contract'
import { describe, expect, it } from 'vitest'
import { selectBridge } from './bridge-selection'
import { createPreviewApi } from './preview-api'

function createIpcMock() {
  const invocations: Array<{ channel: string; args: unknown[] }> = []
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    invocations,
    listeners,
    invoke: (channel: string, ...args: unknown[]) => {
      invocations.push({ channel, args })
      return Promise.resolve(null)
    },
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      const set = listeners.get(channel) ?? new Set()
      set.add(listener)
      listeners.set(channel, set)
    },
    off: (channel: string, listener: (...args: unknown[]) => void) => {
      listeners.get(channel)?.delete(listener)
    },
  }
}

describe('preload preview api (file-preview-window Data / API)', () => {
  it('exposes exactly target, read, openExternal and onChanged', () => {
    expect(Object.keys(createPreviewApi(createIpcMock())).sort()).toEqual([
      'onChanged',
      'openExternal',
      'read',
      'target',
    ])
  })

  it('invokes the preview channels without any path argument', async () => {
    const ipc = createIpcMock()
    const api = createPreviewApi(ipc)
    await api.target()
    await api.read()
    await api.openExternal()
    expect(ipc.invocations).toEqual([
      { channel: PREVIEW_CHANNEL.target, args: [] },
      { channel: PREVIEW_CHANNEL.read, args: [] },
      { channel: PREVIEW_CHANNEL.openExternal, args: [] },
    ])
  })

  it('subscribes to change notices and unsubscribes', () => {
    const ipc = createIpcMock()
    const api = createPreviewApi(ipc)
    let calls = 0
    const off = api.onChanged(() => {
      calls += 1
    })
    for (const listener of ipc.listeners.get(PREVIEW_CHANNEL.changed) ?? []) listener({})
    expect(calls).toBe(1)
    off()
    expect(ipc.listeners.get(PREVIEW_CHANNEL.changed)?.size).toBe(0)
  })

  it('rethrows a transported AppError as its typed payload', async () => {
    const ipc = createIpcMock()
    ipc.invoke = () =>
      Promise.reject(
        new Error(
          '__nekode_app_error__{"nekodeAppError":true,"code":"not_found","kind":"not_found","message":"File not found.","channel":"preview:read"}',
        ),
      )
    await expect(createPreviewApi(ipc).read()).rejects.toMatchObject({
      code: 'not_found',
      message: 'File not found.',
    })
  })
})

describe('preload bridge selection', () => {
  it('gives a preview window only window.preview and the main window only window.app', () => {
    const app = {} as AppApi
    const preview = createPreviewApi(createIpcMock())
    const factories = { app: () => app, preview: () => preview }
    expect(selectBridge(true, factories)).toEqual({ key: 'preview', api: preview })
    expect(selectBridge(false, factories)).toEqual({ key: 'app', api: app })
  })
})
