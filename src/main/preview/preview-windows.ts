import { PREVIEW_CHANNEL, type PreviewTarget } from '@shared/contracts/preview-contract'

// Main-owned registry of read-only file preview windows
// (docs/features/file-preview-window/spec.md). Electron-free: index.ts
// supplies the window factory, so the registry, its per-file key, and the
// change poller stay unit-testable.

/** The part of a BrowserWindow the registry drives. */
export interface PreviewWindowHandle {
  /** webContents id of the window; the preview IPC sender key. */
  readonly webContentsId: number
  /** Restores a minimized window and focuses it. */
  focus(): void
  close(): void
  send(channel: string): void
  /** Called once when the window is closed (by the user or by close()). */
  onClosed(listener: () => void): void
}

export interface BoundPreview extends PreviewTarget {
  projectId: string
}

export interface PreviewWindowsDeps {
  /** Validates the file and returns its display data (throws on a rejected path). */
  resolveTarget(projectId: string, relativePath: string): Promise<BoundPreview>
  createWindow(target: BoundPreview): PreviewWindowHandle
  /** Size/mtime fingerprint of the bound file; null when it is missing. */
  fingerprint(projectId: string, relativePath: string): Promise<string | null>
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
  /** Poll period; about one second (spec Behaviour 9). */
  intervalMs?: number
}

interface Entry {
  key: string
  target: BoundPreview
  window: PreviewWindowHandle
  timer: unknown
  last: string | null
  checking: boolean
  /** The previous check threw; a failure streak is logged once. */
  failing: boolean
}

const DEFAULT_INTERVAL_MS = 1000

function keyOf(projectId: string, relativePath: string): string {
  return `${projectId}\u0000${relativePath}`
}

export class PreviewWindows {
  readonly #deps: PreviewWindowsDeps
  readonly #byKey = new Map<string, Entry>()
  readonly #byWebContents = new Map<number, Entry>()
  /** Opens in flight per key, so a double click never creates two windows. */
  readonly #opening = new Map<string, Promise<void>>()
  /** Incremented by closeAll; an open started before it creates no window. */
  #generation = 0

  constructor(deps: PreviewWindowsDeps) {
    this.#deps = deps
  }

  /** Opens the window of one file, or focuses the one already open (Behaviour 2-4). */
  open(projectId: string, relativePath: string): Promise<void> {
    const key = keyOf(projectId, relativePath)
    const existing = this.#byKey.get(key)
    if (existing) {
      existing.window.focus()
      return Promise.resolve()
    }
    const pending = this.#opening.get(key)
    if (pending) {
      return pending
    }
    const opening = this.#create(key, projectId, relativePath).finally(() => {
      this.#opening.delete(key)
    })
    this.#opening.set(key, opening)
    return opening
  }

  /** The file bound to a preview window, or null for any other sender. */
  targetFor(webContentsId: number): BoundPreview | null {
    return this.#byWebContents.get(webContentsId)?.target ?? null
  }

  /** Closes every preview window (main window closed, Behaviour 11). */
  closeAll(): void {
    // Opens still awaiting their target or fingerprint belong to the closed
    // main window and must not create a window afterwards.
    this.#generation += 1
    for (const entry of [...this.#byKey.values()]) {
      entry.window.close()
    }
  }

  get size(): number {
    return this.#byKey.size
  }

  async #create(key: string, projectId: string, relativePath: string): Promise<void> {
    const generation = this.#generation
    const target = await this.#deps.resolveTarget(projectId, relativePath)
    const last = await this.#deps.fingerprint(projectId, relativePath)
    if (generation !== this.#generation) {
      return
    }
    const window = this.#deps.createWindow(target)
    const entry: Entry = {
      key,
      target,
      window,
      timer: null,
      last,
      checking: false,
      failing: false,
    }
    entry.timer = this.#deps.setInterval(() => {
      void this.#check(entry)
    }, this.#deps.intervalMs ?? DEFAULT_INTERVAL_MS)
    this.#byKey.set(key, entry)
    this.#byWebContents.set(window.webContentsId, entry)
    window.onClosed(() => {
      this.#deps.clearInterval(entry.timer)
      this.#byKey.delete(entry.key)
      this.#byWebContents.delete(window.webContentsId)
    })
  }

  async #check(entry: Entry): Promise<void> {
    if (entry.checking || this.#byKey.get(entry.key) !== entry) {
      return
    }
    entry.checking = true
    try {
      const next = await this.#deps.fingerprint(entry.target.projectId, entry.target.relativePath)
      entry.failing = false
      if (next !== entry.last && this.#byKey.get(entry.key) === entry) {
        entry.last = next
        entry.window.send(PREVIEW_CHANNEL.changed)
      }
    } catch (error) {
      // An unexpected failure (not "missing") is logged once per streak; the
      // next tick retries (spec Errors: no log on every poll).
      if (!entry.failing) {
        console.error('[preview] change check failed:', error)
      }
      entry.failing = true
    } finally {
      entry.checking = false
    }
  }
}
