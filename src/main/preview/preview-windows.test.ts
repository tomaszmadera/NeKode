import { PREVIEW_CHANNEL } from '@shared/contracts/preview-contract'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerPreviewIpcHandlers } from './preview-ipc'
import {
  type BoundPreview,
  type PreviewWindowHandle,
  PreviewWindows,
  type PreviewWindowsDeps,
} from './preview-windows'

interface FakeWindow extends PreviewWindowHandle {
  sent: string[]
  focused: number
  closed: boolean
}

function createHarness(fingerprints: Array<string | null | Error> = ['1:1']) {
  const windows: FakeWindow[] = []
  let tick: (() => void) | null = null
  let nextId = 10
  const queue = [...fingerprints]
  const fingerprint = vi.fn(async () => {
    const value = queue.length > 1 ? queue.shift() : queue[0]
    if (value instanceof Error) throw value
    return value ?? null
  })
  const deps: PreviewWindowsDeps = {
    resolveTarget: vi.fn(
      async (projectId: string, relativePath: string): Promise<BoundPreview> => ({
        projectId,
        projectName: 'Proj',
        relativePath,
        fileName: relativePath.split('/').pop() ?? relativePath,
      }),
    ),
    createWindow: vi.fn(() => {
      const listeners: Array<() => void> = []
      const window: FakeWindow = {
        webContentsId: nextId++,
        sent: [],
        focused: 0,
        closed: false,
        focus() {
          window.focused += 1
        },
        close() {
          if (window.closed) return
          window.closed = true
          for (const listener of listeners) listener()
        },
        send(channel) {
          window.sent.push(channel)
        },
        onClosed(listener) {
          listeners.push(listener)
        },
      }
      windows.push(window)
      return window
    }),
    fingerprint,
    setInterval: vi.fn((callback: () => void) => {
      tick = callback
      return 'timer'
    }),
    clearInterval: vi.fn(),
  }
  const registry = new PreviewWindows(deps)
  async function poll(): Promise<void> {
    tick?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { registry, deps, windows, poll, fingerprint }
}

describe('PreviewWindows registry (file-preview-window Behaviour 2-4, 11)', () => {
  it('creates one window per file and focuses it on a second open', async () => {
    const { registry, windows } = createHarness()
    await registry.open('p1', 'docs/spec.md')
    await registry.open('p1', 'docs/spec.md')
    expect(windows).toHaveLength(1)
    expect(windows[0].focused).toBe(1)
    expect(registry.targetFor(windows[0].webContentsId)).toEqual({
      projectId: 'p1',
      projectName: 'Proj',
      relativePath: 'docs/spec.md',
      fileName: 'spec.md',
    })
  })

  it('creates a single window for two concurrent opens of the same file', async () => {
    const { registry, windows } = createHarness()
    await Promise.all([registry.open('p1', 'a.md'), registry.open('p1', 'a.md')])
    expect(windows).toHaveLength(1)
  })

  it('keys windows by project id and path', async () => {
    const { registry, windows } = createHarness()
    await registry.open('p1', 'a.md')
    await registry.open('p1', 'b.md')
    await registry.open('p2', 'a.md')
    expect(windows).toHaveLength(3)
    expect(registry.size).toBe(3)
  })

  it('opens no window when the target is rejected', async () => {
    const { registry, deps, windows } = createHarness()
    vi.mocked(deps.resolveTarget).mockRejectedValueOnce(new Error('not found'))
    await expect(registry.open('p1', 'missing.md')).rejects.toThrow('not found')
    expect(windows).toHaveLength(0)
    expect(registry.size).toBe(0)
  })

  it('drops a closed window, stops its poller, and reopens a fresh one later', async () => {
    const { registry, deps, windows } = createHarness()
    await registry.open('p1', 'a.md')
    windows[0].close()
    expect(deps.clearInterval).toHaveBeenCalledWith('timer')
    expect(registry.targetFor(windows[0].webContentsId)).toBeNull()
    await registry.open('p1', 'a.md')
    expect(windows).toHaveLength(2)
  })

  it('closes every preview window on closeAll', async () => {
    const { registry, windows } = createHarness()
    await registry.open('p1', 'a.md')
    await registry.open('p1', 'b.md')
    registry.closeAll()
    expect(windows.every((window) => window.closed)).toBe(true)
    expect(registry.size).toBe(0)
  })

  it('creates no window for an open still in flight when closeAll runs, and opens later ones', async () => {
    const { registry, deps, windows } = createHarness()
    let release!: () => void
    vi.mocked(deps.resolveTarget).mockImplementationOnce(
      (projectId, relativePath) =>
        new Promise((resolve) => {
          release = () => {
            resolve({ projectId, projectName: 'Proj', relativePath, fileName: relativePath })
          }
        }),
    )
    const opening = registry.open('p1', 'slow.md')
    registry.closeAll()
    release()
    await opening
    expect(windows).toHaveLength(0)
    expect(registry.size).toBe(0)
    expect(deps.setInterval).not.toHaveBeenCalled()
    await registry.open('p1', 'slow.md')
    expect(windows).toHaveLength(1)
  })
})

describe('PreviewWindows change poller (Behaviour 9-10)', () => {
  it('notifies on a changed fingerprint only', async () => {
    const { registry, windows, poll } = createHarness(['1:1', '1:1', '2:5'])
    await registry.open('p1', 'a.md')
    await poll()
    expect(windows[0].sent).toEqual([])
    await poll()
    expect(windows[0].sent).toEqual([PREVIEW_CHANNEL.changed])
    await poll()
    expect(windows[0].sent).toEqual([PREVIEW_CHANNEL.changed])
  })

  it('notifies once when the file disappears and again when it returns', async () => {
    const { registry, windows, poll } = createHarness(['1:1', null, null, '1:1'])
    await registry.open('p1', 'a.md')
    await poll()
    await poll()
    expect(windows[0].sent).toHaveLength(1)
    await poll()
    expect(windows[0].sent).toHaveLength(2)
  })

  it('logs an unexpected check failure once per streak and keeps polling', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { registry, windows, poll } = createHarness([
      '1:1',
      new Error('boom'),
      new Error('boom'),
      '3:3',
    ])
    await registry.open('p1', 'a.md')
    await poll()
    await poll()
    expect(error).toHaveBeenCalledTimes(1)
    await poll()
    expect(windows[0].sent).toEqual([PREVIEW_CHANNEL.changed])
    error.mockRestore()
  })

  it('does not notify a window that closed during a check', async () => {
    const { registry, windows, poll, fingerprint } = createHarness(['1:1', '2:2'])
    await registry.open('p1', 'a.md')
    fingerprint.mockImplementationOnce(async () => {
      windows[0].close()
      return '2:2'
    })
    await poll()
    expect(windows[0].sent).toEqual([])
  })
})

describe('preview IPC (Authorization)', () => {
  type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

  function setup() {
    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    } as unknown as IpcMain
    const bound: BoundPreview = {
      projectId: 'p1',
      projectName: 'Proj',
      relativePath: 'docs/spec.md',
      fileName: 'spec.md',
    }
    const deps = {
      targetFor: vi.fn((id: number) => (id === 7 ? bound : null)),
      read: vi.fn(async () => ({ kind: 'binary' as const })),
      openExternal: vi.fn(async () => undefined),
    }
    registerPreviewIpcHandlers(ipcMain, deps)
    function invoke(channel: string, senderId: number, mainFrame = true, ...args: unknown[]) {
      const frame = {}
      const event = {
        senderFrame: frame,
        sender: { id: senderId, mainFrame: mainFrame ? frame : {} },
      } as unknown as IpcMainInvokeEvent
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`no handler for ${channel}`)
      return handler(event, ...args)
    }
    return { deps, invoke, handlers }
  }

  it('registers exactly the three preview invoke channels', () => {
    const { handlers } = setup()
    expect([...handlers.keys()].sort()).toEqual(
      [PREVIEW_CHANNEL.openExternal, PREVIEW_CHANNEL.read, PREVIEW_CHANNEL.target].sort(),
    )
  })

  it('serves only the bound file and ignores renderer payloads', async () => {
    const { deps, invoke } = setup()
    await expect(invoke(PREVIEW_CHANNEL.target, 7)).resolves.toEqual({
      projectName: 'Proj',
      relativePath: 'docs/spec.md',
      fileName: 'spec.md',
    })
    await invoke(PREVIEW_CHANNEL.read, 7, true, 'p2', '../secret')
    expect(deps.read).toHaveBeenCalledExactlyOnceWith('p1', 'docs/spec.md')
    await invoke(PREVIEW_CHANNEL.openExternal, 7)
    expect(deps.openExternal).toHaveBeenCalledExactlyOnceWith('p1', 'docs/spec.md')
  })

  it('rejects unregistered senders (such as the main window) and subframes', async () => {
    const { deps, invoke } = setup()
    await expect(invoke(PREVIEW_CHANNEL.read, 1)).rejects.toThrow('Rejected untrusted IPC sender.')
    await expect(invoke(PREVIEW_CHANNEL.read, 7, false)).rejects.toThrow(
      'Rejected untrusted IPC sender.',
    )
    expect(deps.read).not.toHaveBeenCalled()
  })
})
