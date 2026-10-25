import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppUpdateLatest } from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'
import {
  checksumFor,
  installerName,
  isAllowedReleaseUrl,
  parseLatestTag,
  releaseApiUrl,
  releaseDownloadUrl,
} from './release-url'
import { type DetachedChild, startDetached } from './start-detached'

export interface AppUpdateIo {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  writeFile: (path: string, data: Uint8Array) => Promise<void>
  hashFile: (path: string) => Promise<string>
  removeFile: (path: string) => Promise<void>
  spawn: (file: string, args: readonly string[]) => Promise<void>
  quit: () => void
  tempDir: string
  subscribeQuit: (listener: () => void) => () => void
  packaged: boolean
  platform: string
  version: string
}

export function createAppUpdateIo(options: {
  packaged: boolean
  platform: string
  version: string
  tempDir: string
  quit: () => void
  subscribeQuit: (listener: () => void) => () => void
}): AppUpdateIo {
  return {
    fetch: (url, init) => fetch(url, init),
    writeFile: async (path, data) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
    },
    hashFile: async (path) =>
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    removeFile: (path) => rm(path, { force: true }),
    spawn: (file, args) =>
      startDetached(
        (command, commandArgs, spawnOptions) =>
          spawn(command, [...commandArgs], spawnOptions) as unknown as DetachedChild,
        file,
        args,
      ),
    quit: options.quit,
    tempDir: options.tempDir,
    subscribeQuit: options.subscribeQuit,
    packaged: options.packaged,
    platform: options.platform,
    version: options.version,
  }
}

export class AppUpdateService {
  private busy = false
  private quitting = false
  private verifiedPath: string | null = null

  constructor(private readonly io: AppUpdateIo) {
    io.subscribeQuit(() => {
      this.quitting = true
    })
  }

  private canInstall(): boolean {
    return this.io.packaged && this.io.platform === 'win32'
  }

  async latest(): Promise<AppUpdateLatest> {
    if (!this.canInstall()) return { canInstall: false, version: null, error: null }
    try {
      const version = await this.readTag(new AbortController().signal)
      return { canInstall: true, version, error: null }
    } catch (error) {
      return {
        canInstall: true,
        version: null,
        error: error instanceof AppError ? error.message : 'Could not read the latest release.',
      }
    }
  }

  async download(): Promise<void> {
    if (!this.canInstall()) {
      throw new AppError(
        'validation',
        'Update from this screen is only for an installed Windows build.',
      )
    }
    if (this.busy) throw new AppError('conflict', 'An update is already in progress.')
    if (this.quitting)
      throw new AppError('conflict', 'The download stopped because NeKode is closing.')
    this.busy = true
    this.verifiedPath = null
    const controller = new AbortController()
    const stop = this.io.subscribeQuit(() => controller.abort())
    let written: string | null = null
    try {
      const tag = await this.readTag(controller.signal)
      const name = installerName(tag)
      const sums = await this.downloadText(
        releaseDownloadUrl(tag, 'SHA256SUMS.txt'),
        controller.signal,
      )
      const expected = checksumFor(sums, name)
      const fileUrl = releaseDownloadUrl(tag, name)
      const bytes = await this.downloadBytes(fileUrl, controller.signal)
      const path = join(this.io.tempDir, 'nekode-update', tag, name)
      await this.io.writeFile(path, bytes)
      written = path
      const actual = (await this.io.hashFile(path)).toLowerCase()
      if (actual !== expected) {
        await this.io.removeFile(path)
        written = null
        throw new AppError('validation', 'The installer checksum does not match.')
      }
      this.verifiedPath = path
    } catch (error) {
      if (written !== null) await this.io.removeFile(written)
      this.verifiedPath = null
      if (error instanceof AppError) throw error
      if (controller.signal.aborted || this.quitting) {
        throw new AppError('conflict', 'The download stopped because NeKode is closing.')
      }
      throw new AppError('network', 'Could not download the installer.')
    } finally {
      stop()
      this.busy = false
    }
  }

  async launch(): Promise<void> {
    if (!this.canInstall()) {
      throw new AppError(
        'validation',
        'Update from this screen is only for an installed Windows build.',
      )
    }
    const path = this.verifiedPath
    if (path === null) {
      throw new AppError('validation', 'Download the installer before starting it.')
    }
    if (this.quitting) {
      throw new AppError('conflict', 'The download stopped because NeKode is closing.')
    }
    try {
      await this.io.spawn(path, [])
    } catch {
      throw new AppError('io', 'Could not start the installer.')
    }
    this.verifiedPath = null
    this.io.quit()
  }

  private async readTag(signal: AbortSignal): Promise<string> {
    const response = await this.request(releaseApiUrl(), 'api', signal)
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new AppError('validation', 'The latest release is not a numbered version.')
    }
    return parseLatestTag(body)
  }

  private async downloadText(url: string, signal: AbortSignal): Promise<string> {
    const response = await this.request(url, 'download', signal)
    return response.text()
  }

  private async downloadBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
    const response = await this.request(url, 'download', signal)
    return new Uint8Array(await response.arrayBuffer())
  }

  private async request(
    url: string,
    kind: 'api' | 'download',
    signal: AbortSignal,
  ): Promise<Response> {
    let current = url
    for (let hop = 0; hop < 5; hop++) {
      const parsed = new URL(current)
      if (!isAllowedReleaseUrl(parsed, kind)) {
        throw new AppError('validation', 'The download redirected to an unexpected address.')
      }
      const response = await this.io.fetch(current, {
        redirect: 'manual',
        signal,
        headers: {
          'User-Agent': `NeKode/${this.io.version}`,
          Accept: kind === 'api' ? 'application/vnd.github+json' : 'application/octet-stream',
        },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (location === null || location.length === 0) {
          throw new AppError('network', 'Could not download the installer.')
        }
        current = new URL(location, current).toString()
        continue
      }
      if (!response.ok) {
        throw new AppError(
          'network',
          kind === 'api'
            ? 'Could not read the latest release.'
            : 'Could not download the installer.',
        )
      }
      return response
    }
    throw new AppError('network', 'Could not download the installer.')
  }
}
