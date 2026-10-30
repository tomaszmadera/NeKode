import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { AppError } from '@shared/ipc-error'
import { describe, expect, it, vi } from 'vitest'
import { type AppUpdateIo, AppUpdateService } from './app-update-service'
import { type DetachedChild, startDetached } from './start-detached'

const TAG = '0.16.0'
const INSTALLER = `NeKode-Setup-${TAG}.exe`
const API = 'https://api.github.com/repos/tomaszmadera/NeKode/releases/latest'
const SUMS_URL = `https://github.com/tomaszmadera/NeKode/releases/download/${TAG}/SHA256SUMS.txt`
const FILE_URL = `https://github.com/tomaszmadera/NeKode/releases/download/${TAG}/${INSTALLER}`

function response(
  body: string | Uint8Array,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  // Copy into a fresh ArrayBuffer. A Uint8Array<ArrayBufferLike> is not a fetch body.
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body)
  return new Response(bytes, { status, headers })
}

function installerBytes(): Uint8Array {
  return new TextEncoder().encode('installer-bytes')
}

function sumsFor(bytes: Uint8Array, name = INSTALLER): string {
  const hash = createHash('sha256').update(bytes).digest('hex')
  return `${hash}  ${name}\n`
}

function harness(overrides: Partial<AppUpdateIo> = {}): {
  io: AppUpdateIo
  files: Map<string, Uint8Array>
  spawned: Array<{ file: string; args: readonly string[] }>
  quit: ReturnType<typeof vi.fn>
  quitListeners: Array<() => void>
} {
  const files = new Map<string, Uint8Array>()
  const spawned: Array<{ file: string; args: readonly string[] }> = []
  const quit = vi.fn()
  const quitListeners: Array<() => void> = []
  const bytes = installerBytes()
  const io: AppUpdateIo = {
    fetch: vi.fn(async (url: string) => {
      if (url === API)
        return response(JSON.stringify({ tag_name: TAG, draft: false, prerelease: false }))
      if (url === SUMS_URL) return response(sumsFor(bytes))
      if (url === FILE_URL) return response(bytes)
      return response('missing', 404)
    }),
    writeFile: async (path, data) => {
      files.set(path, data)
    },
    hashFile: async (path) => {
      const data = files.get(path)
      if (data === undefined) throw new Error(`missing ${path}`)
      return createHash('sha256').update(data).digest('hex')
    },
    removeFile: async (path) => {
      files.delete(path)
    },
    spawn: async (file, args) => {
      spawned.push({ file, args })
    },
    quit,
    tempDir: 'C:/temp',
    subscribeQuit: (listener) => {
      quitListeners.push(listener)
      return () => {
        const index = quitListeners.indexOf(listener)
        if (index >= 0) quitListeners.splice(index, 1)
      }
    },
    packaged: true,
    platform: 'win32',
    version: '0.15.0',
    ...overrides,
  }
  return { io, files, spawned, quit, quitListeners }
}

describe('app update service', () => {
  it('reads the latest numbered release and builds the GitHub download urls', async () => {
    const { io } = harness()
    const service = new AppUpdateService(io)
    await expect(service.latest()).resolves.toEqual({
      canInstall: true,
      version: TAG,
      error: null,
    })
    await service.download()
    expect(io.fetch).toHaveBeenCalledWith(API, expect.objectContaining({ redirect: 'manual' }))
    expect(io.fetch).toHaveBeenCalledWith(SUMS_URL, expect.objectContaining({ redirect: 'manual' }))
    expect(io.fetch).toHaveBeenCalledWith(FILE_URL, expect.objectContaining({ redirect: 'manual' }))
    const headerCall = vi.mocked(io.fetch).mock.calls[0]?.[1]
    expect(new Headers(headerCall?.headers).get('User-Agent')).toBe('NeKode/0.15.0')
  })

  it('starts the checked installer with no arguments and then quits', async () => {
    const { io, spawned, quit } = harness()
    const service = new AppUpdateService(io)
    await service.download()
    await service.launch()
    expect(spawned).toEqual([{ file: join('C:/temp', 'nekode-update', TAG, INSTALLER), args: [] }])
    expect(quit).toHaveBeenCalledOnce()
  })

  it('deletes a mismatched installer and does not start it', async () => {
    const bytes = installerBytes()
    const { io, files, spawned, quit } = harness({
      fetch: vi.fn(async (url: string) => {
        if (url === API)
          return response(JSON.stringify({ tag_name: TAG, draft: false, prerelease: false }))
        if (url === SUMS_URL) return response(`${'ab'.repeat(32)}  ${INSTALLER}\n`)
        if (url === FILE_URL) return response(bytes)
        return response('missing', 404)
      }),
    })
    const service = new AppUpdateService(io)
    await expect(service.download()).rejects.toThrow('The installer checksum does not match.')
    expect(files.size).toBe(0)
    expect(spawned).toEqual([])
    expect(quit).not.toHaveBeenCalled()
    await expect(service.launch()).rejects.toThrow('Download the installer before starting it.')
  })

  it('refuses a draft, a pre-release, and a suffixed tag', async () => {
    for (const body of [
      { tag_name: TAG, draft: true, prerelease: false },
      { tag_name: TAG, draft: false, prerelease: true },
      { tag_name: '0.16.0-rc.1', draft: false, prerelease: false },
    ]) {
      const { io } = harness({
        fetch: vi.fn(async () => response(JSON.stringify(body))),
      })
      const service = new AppUpdateService(io)
      const latest = await service.latest()
      expect(latest.canInstall).toBe(true)
      expect(latest.version).toBeNull()
      expect(latest.error).toBeTruthy()
    }
  })

  it('follows a release-asset redirect and rejects any other host', async () => {
    const bytes = installerBytes()
    const asset = 'https://release-assets.githubusercontent.com/nekode/setup.exe'
    const { io } = harness({
      fetch: vi.fn(async (url: string) => {
        if (url === API)
          return response(JSON.stringify({ tag_name: TAG, draft: false, prerelease: false }))
        if (url === SUMS_URL) return response(sumsFor(bytes))
        if (url === FILE_URL) return response('', 302, { location: asset })
        if (url === asset) return response(bytes)
        return response('missing', 404)
      }),
    })
    const service = new AppUpdateService(io)
    await service.download()
    expect(io.fetch).toHaveBeenCalledWith(asset, expect.anything())

    const blocked = harness({
      fetch: vi.fn(async (url: string) => {
        if (url === API)
          return response(JSON.stringify({ tag_name: TAG, draft: false, prerelease: false }))
        if (url === SUMS_URL)
          return response('', 302, { location: 'https://evil.example/sums.txt' })
        return response('missing', 404)
      }),
    })
    await expect(new AppUpdateService(blocked.io).download()).rejects.toThrow('unexpected address')
    expect(blocked.spawned).toEqual([])
  })

  it('does not download or spawn when the build is unpackaged or not Windows', async () => {
    for (const limits of [
      { packaged: false, platform: 'win32' },
      { packaged: true, platform: 'linux' },
    ]) {
      const { io, spawned } = harness(limits)
      const service = new AppUpdateService(io)
      await expect(service.latest()).resolves.toEqual({
        canInstall: false,
        version: null,
        error: null,
      })
      await expect(service.download()).rejects.toBeInstanceOf(AppError)
      expect(io.fetch).not.toHaveBeenCalled()
      expect(spawned).toEqual([])
    }
  })

  it('stops a download when the app is closing and does not start the installer', async () => {
    let rejectFetch: (error: Error) => void = () => undefined
    const { io, quitListeners, spawned } = harness({
      fetch: vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectFetch = reject
          }),
      ),
    })
    const service = new AppUpdateService(io)
    const pending = service.download()
    for (const listener of quitListeners) listener()
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    rejectFetch(abort)
    await expect(pending).rejects.toThrow('NeKode is closing')
    expect(spawned).toEqual([])
  })

  it('rejects a second download while one is in progress and does not quit when spawn fails', async () => {
    let releaseFetch: (response: Response) => void = () => undefined
    const { io, quit } = harness({
      fetch: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            releaseFetch = resolve
          }),
      ),
    })
    const service = new AppUpdateService(io)
    const first = service.download()
    await expect(service.download()).rejects.toThrow('already in progress')
    releaseFetch(response('nope', 500))
    await expect(first).rejects.toThrow('Could not read the latest release.')

    const ready = harness({
      spawn: async () => {
        throw new Error('spawn failed')
      },
    })
    const launching = new AppUpdateService(ready.io)
    await launching.download()
    await expect(launching.launch()).rejects.toThrow('Could not start the installer.')
    expect(ready.quit).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })

  it('refuses a release that is not newer and does not start or quit', async () => {
    for (const version of ['0.16.0', '0.17.0']) {
      const { io, spawned, quit } = harness({ version })
      const service = new AppUpdateService(io)
      await expect(service.download()).rejects.toThrow('No newer release is published.')
      await expect(service.launch()).rejects.toThrow('Download the installer before starting it.')
      expect(spawned).toEqual([])
      expect(quit).not.toHaveBeenCalled()
    }
  })

  it('bounds a stalled latest release response body', async () => {
    vi.useFakeTimers()
    try {
      const { io } = harness({
        fetch: vi.fn(async () => new Response(new ReadableStream({ start() {} }))),
      })
      const pending = new AppUpdateService(io).latest()
      await vi.advanceTimersByTimeAsync(30_000)
      await expect(pending).resolves.toEqual({
        canInstall: true,
        version: null,
        error: 'Could not read the latest release.',
      })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a stalled redirect request and permits a retry', async () => {
    vi.useFakeTimers()
    try {
      const normal = harness()
      const asset = 'https://release-assets.githubusercontent.com/nekode/sums.txt'
      let stalled = true
      const { io, spawned } = harness({
        fetch: vi.fn((url, init) => {
          if (stalled && url === SUMS_URL)
            return Promise.resolve(response('', 302, { location: asset }))
          if (stalled && url === asset) return new Promise<Response>(() => {})
          return normal.io.fetch(url, init)
        }),
      })
      const service = new AppUpdateService(io)
      const pending = service.download()
      const failure = expect(pending).rejects.toThrow('Could not download the installer.')
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      await failure
      await expect(service.launch()).rejects.toThrow('Download the installer before starting it.')
      expect(spawned).toEqual([])
      stalled = false
      await service.download()
      await service.launch()
      expect(spawned).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a stalled installer body and permits a retry', async () => {
    vi.useFakeTimers()
    try {
      const normal = harness()
      let stalled = true
      const { io, spawned } = harness({
        fetch: vi.fn((url, init) => {
          if (stalled && url === FILE_URL) {
            return Promise.resolve(new Response(new ReadableStream({ start() {} })))
          }
          return normal.io.fetch(url, init)
        }),
      })
      const service = new AppUpdateService(io)
      const pending = service.download()
      const failure = expect(pending).rejects.toThrow('Could not download the installer.')
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      await failure
      await expect(service.launch()).rejects.toThrow('Download the installer before starting it.')
      expect(spawned).toEqual([])
      stalled = false
      await service.download()
      await service.launch()
      expect(spawned).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('compares checksum hex case for a newer release', async () => {
    const bytes = installerBytes()
    const hash = createHash('sha256').update(bytes).digest('hex').toUpperCase()
    const { io, spawned } = harness({
      version: '0.14.0',
      fetch: vi.fn(async (url: string) => {
        if (url === API) {
          return response(JSON.stringify({ tag_name: '0.15.0', draft: false, prerelease: false }))
        }
        if (url.endsWith('SHA256SUMS.txt')) return response(`${hash} *NeKode-Setup-0.15.0.exe\n`)
        return response(bytes)
      }),
    })
    const service = new AppUpdateService(io)
    await service.download()
    await service.launch()
    expect(spawned).toHaveLength(1)
    expect(spawned[0]?.file).toContain('NeKode-Setup-0.15.0.exe')
  })
})

describe('startDetached', () => {
  it('starts the file with the given arguments, detaches, and unrefs after spawn', async () => {
    const child = new EventEmitter() as EventEmitter & DetachedChild
    child.unref = vi.fn()
    const spawnFn = vi.fn(() => child)
    const pending = startDetached(spawnFn, 'C:/temp/NeKode-Setup-0.16.0.exe', [])
    child.emit('spawn')
    await pending
    expect(spawnFn).toHaveBeenCalledWith('C:/temp/NeKode-Setup-0.16.0.exe', [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    expect(child.unref).toHaveBeenCalledOnce()
  })
})
