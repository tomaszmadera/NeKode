import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DictationResult } from '../../../shared/dictation-contract'
import { DictationService } from './dictation-service'
import type { OpenWhisprClient, TranscriptionResponse } from './openwhispr-client'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(join(tmpdir(), 'nekode-dictation-test-')))
      throw new Error('Unexpected test cleanup target')
    rmSync(directory, { recursive: true, force: true })
  }
})
const recordings = (root: string) =>
  readdirSync(root).flatMap((owner) =>
    readdirSync(join(root, owner)).map((file) => join(root, owner, file)),
  )
const wav = () => {
  const buffer = new ArrayBuffer(16044)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  for (const [at, text] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ] as const)
    bytes.set(
      [...text].map((char) => char.charCodeAt(0)),
      at,
    )
  for (const [at, value] of [
    [4, 16036],
    [16, 16],
    [24, 16000],
    [28, 32000],
    [40, 16000],
  ])
    view.setUint32(at, value, true)
  for (const [at, value] of [
    [20, 1],
    [22, 1],
    [32, 2],
    [34, 16],
  ])
    view.setUint16(at, value, true)
  return buffer
}
function harness(
  transcribe: (
    path: string,
    settings: unknown,
    signal: AbortSignal,
  ) => Promise<TranscriptionResponse>,
) {
  const directory = mkdtempSync(join(tmpdir(), 'nekode-dictation-test-'))
  directories.push(directory)
  const client = {
    getSettings: () => ({
      enabled: true,
      language: 'default',
      model: 'default',
      timeoutSeconds: 5,
    }),
    status: () => ({ state: 'operational', staleModelSelection: false }),
    transcribe: vi.fn(transcribe),
  } as unknown as OpenWhisprClient
  const service = new DictationService(client, directory)
  const results: DictationResult[] = []
  service.onResult((result) => results.push(result))
  return { service, client, results, directory }
}

describe('dictation sessions', () => {
  it('starts when another service sweeps an exited owner between discovery and inspection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nekode-dictation-test-'))
    directories.push(directory)
    const owner = join(directory, '101-12345678-1234-1234-1234-123456789abc')
    mkdirSync(owner)
    writeFileSync(join(owner, '12345678-1234-1234-1234-123456789abc.wav'), Buffer.from(wav()))
    const client = {
      getSettings: () => ({ enabled: true }),
      status: () => ({ state: 'operational' }),
    } as OpenWhisprClient
    const concurrentSweep = vi.fn(() => {
      new DictationService(client, directory, () => true).shutdown()
      return true
    })
    expect(() => new DictationService(client, directory, concurrentSweep).shutdown()).not.toThrow()
    expect(concurrentSweep).toHaveBeenCalledOnce()
    expect(existsSync(owner)).toBe(false)
  })
  it('does not sweep a recording owned by another live service', async () => {
    let resolve!: (value: TranscriptionResponse) => void
    let recordedPath = ''
    const h = harness((path) => {
      recordedPath = path
      return new Promise((done) => {
        resolve = done
      })
    })
    const pending = h.service.audio(h.service.start('chat', null).sessionId as string, wav())
    expect(existsSync(recordedPath)).toBe(true)
    const other = new DictationService(h.client, h.directory)
    const preserved = existsSync(recordedPath)
    other.shutdown()
    resolve({ text: 'hello', warning: null, error: null })
    await pending
    expect(preserved).toBe(true)
  })
  it('gates disabled and unavailable sessions with normalized errors', () => {
    const h = harness(vi.fn())
    vi.spyOn(h.client, 'getSettings').mockReturnValue({
      enabled: false,
      language: 'default',
      model: 'default',
      timeoutSeconds: 5,
    })
    expect(h.service.start('chat', null)).toEqual({ sessionId: null, error: 'disabled' })
    vi.spyOn(h.client, 'getSettings').mockReturnValue({
      enabled: true,
      language: 'default',
      model: 'default',
      timeoutSeconds: 5,
    })
    vi.spyOn(h.client, 'status').mockReturnValue({
      state: 'model-available',
      models: [],
      checkedAt: null,
      error: null,
      staleModelSelection: false,
    })
    expect(h.service.start('chat', null)).toEqual({ sessionId: null, error: 'no-model' })
    expect(h.client.transcribe).not.toHaveBeenCalled()
  })
  it('warns once on the next transcription outcome, preserving it across a cancelled recording', async () => {
    const h = harness(async () => ({ text: 'hello', error: null, warning: 'provider warning' }))
    vi.spyOn(h.client, 'getSettings').mockReturnValue({
      enabled: true,
      language: 'default',
      model: { provider: 'removed', model: 'gone' },
      timeoutSeconds: 5,
    })
    vi.spyOn(h.client, 'status').mockReturnValue({
      state: 'operational',
      models: [],
      checkedAt: null,
      error: null,
      staleModelSelection: true,
    })
    h.service.cancel(h.service.start('chat', null).sessionId as string)
    await h.service.audio(h.service.start('chat', null).sessionId as string, wav())
    expect(h.results[1].warning).toContain('Using the OpenWhispr default')
    expect(h.results[1].warning).toContain('provider warning')
    await h.service.audio(h.service.start('chat', null).sessionId as string, wav())
    expect(h.results[2].warning).toBe('provider warning')
  })
  it('settles write failure without exposing a path or calling the bridge', async () => {
    const h = harness(vi.fn())
    rmSync(h.directory, { recursive: true })
    await h.service.audio(h.service.start('chat', null).sessionId as string, wav())
    expect(h.results[0]).toMatchObject({ error: 'recording-failure', outcome: 'failed' })
    expect(JSON.stringify(h.results)).not.toContain(h.directory)
    expect(h.client.transcribe).not.toHaveBeenCalled()
    directories.splice(directories.indexOf(h.directory), 1)
  })
  it('owns one take, forwards a warning once and cleans successful audio', async () => {
    const h = harness(async (path) => {
      expect(existsSync(path)).toBe(true)
      return { text: 'hello', warning: 'language hint', error: null }
    })
    const id = h.service.start('chat-a', null).sessionId as string
    expect(h.service.start('chat-b', null).sessionId).toBeNull()
    await h.service.audio(id, wav())
    await h.service.audio(id, wav())
    expect(h.results).toEqual([
      expect.objectContaining({
        sessionId: id,
        chatId: 'chat-a',
        outcome: 'success',
        text: 'hello',
        warning: 'language hint',
      }),
    ])
    expect(recordings(h.directory)).toEqual([])
  })
  it('discards cancelled recording without a bridge call', () => {
    const h = harness(vi.fn())
    h.service.cancel(h.service.start('chat-a', null).sessionId as string)
    expect(h.results[0].outcome).toBe('cancelled')
    expect(h.client.transcribe).not.toHaveBeenCalled()
  })
  it('aborts transcription, cleans immediately, and discards late results after a new take', async () => {
    let resolve!: (value: TranscriptionResponse) => void
    let signal!: AbortSignal
    const h = harness((_path, _settings, input) => {
      signal = input
      return new Promise((done) => {
        resolve = done
      })
    })
    const id = h.service.start('chat-a', null).sessionId as string
    const pending = h.service.audio(id, wav())
    h.service.cancel(id)
    expect(signal.aborted).toBe(true)
    expect(recordings(h.directory)).toEqual([])
    expect(h.service.start('chat-b', null).sessionId).not.toBeNull()
    resolve({ text: 'stale', warning: null, error: null })
    await pending
    expect(h.results).toHaveLength(1)
    h.service.shutdown()
  })
  it('deletes timed-out files and allows a single explicit retry from retained bytes', async () => {
    const h = harness(async () => ({ text: '', warning: null, error: 'timeout' }))
    const id = h.service.start('chat-a', null).sessionId as string
    await h.service.audio(id, wav())
    expect(h.results[0]).toMatchObject({ error: 'timeout', retryable: true })
    expect(recordings(h.directory)).toEqual([])
    const retry = h.service.start('chat-a', id).sessionId as string
    expect(retry).not.toBe(id)
    await vi.waitFor(() => expect(h.results).toHaveLength(2))
    expect(h.results[1]).toMatchObject({ sessionId: retry, retryable: false })
    expect(() => h.service.start('chat-a', retry)).toThrow('cannot be retried')
    expect(recordings(h.directory)).toEqual([])
  })
  it.each(['malformed-response', 'unreachable'] as const)(
    'cleans failed audio: %s',
    async (error) => {
      const h = harness(async () => ({ text: '', warning: null, error }))
      await h.service.audio(h.service.start('chat-a', null).sessionId as string, wav())
      expect(h.results[0]).toMatchObject({ outcome: 'failed', error, retryable: false })
      expect(recordings(h.directory)).toEqual([])
    },
  )
  it('sweeps only proven-exited owners and leaves live, unknown and legacy recordings intact', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nekode-dictation-test-'))
    directories.push(directory)
    const filename = '12345678-1234-1234-1234-123456789abc.wav'
    const owners = [101, 102, 103].map((pid) =>
      join(directory, `${pid}-12345678-1234-1234-1234-123456789abc`),
    )
    for (const owner of owners) {
      mkdirSync(owner)
      writeFileSync(join(owner, filename), Buffer.from(wav()))
    }
    writeFileSync(join(directory, filename), Buffer.from(wav()))
    const client = {
      getSettings: () => ({ enabled: true }),
      status: () => ({ state: 'operational' }),
    } as OpenWhisprClient
    const provenExited = vi.fn((pid: number) => pid === 101)
    const service = new DictationService(client, directory, provenExited)
    expect(existsSync(owners[0])).toBe(false)
    expect(existsSync(join(owners[1], filename))).toBe(true)
    expect(existsSync(join(owners[2], filename))).toBe(true)
    expect(existsSync(join(directory, filename))).toBe(true)
    expect(provenExited.mock.calls.map(([pid]) => pid)).toEqual([101, 102, 103])
    const result = vi.fn()
    service.onResult(result)
    service.start('chat', null)
    service.shutdown()
    expect(result).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'cancelled' }))
    expect(service.start('chat', null).sessionId).toBeNull()
  })
})
