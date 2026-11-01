import type { FilePreview } from '@shared/contracts/files-contract'
import type { PreviewApi } from '@shared/contracts/preview-contract'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../lib/test-ids'
import { THEME_STORAGE_KEY } from '../lib/theme'
import { PreviewApp } from './PreviewApp'

vi.mock('../components/files/MonacoPreview', () => ({
  MonacoPreview: ({ content }: { content: string }) => (
    <pre data-testid="file-preview-monaco">{content}</pre>
  ),
}))

// Preview window root (docs/features/file-preview-window Behaviour 6-10):
// the strip, the classified preview from window.preview, refresh on change
// notices with stale-read protection, not-found recovery, theme follow, and
// the Markdown Code | Preview switch (Behaviour 14).

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const NOT_FOUND = {
  nekodeAppError: true,
  code: 'not_found',
  kind: 'not_found',
  message: 'File not found.',
}

type Read = () => Promise<FilePreview>

function createPreviewStub(reads: Read[], relativePath = 'docs/spec.md') {
  const listeners = new Set<() => void>()
  const queue = [...reads]
  const api: PreviewApi = {
    target: vi.fn(async () => ({
      projectName: 'Demo',
      relativePath,
      fileName: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    })),
    read: vi.fn(() => {
      const next = queue.shift()
      return next ? next() : Promise.reject(new Error('no read queued'))
    }),
    openExternal: vi.fn(async () => undefined),
    onChanged: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }),
  }
  function change(): void {
    act(() => {
      for (const listener of listeners) listener()
    })
  }
  return { api, change, listeners }
}

const text =
  (content: string): Read =>
  () =>
    Promise.resolve({ kind: 'text', content, language: 'markdown' })

describe('PreviewApp', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })
  afterEach(() => {
    cleanup()
  })

  it('shows the file identity in the strip and renders Markdown', async () => {
    const { api } = createPreviewStub([text('# Hello preview')])
    render(<PreviewApp preview={api} />)
    const strip = await screen.findByTestId(TEST_ID.previewTitleBar)
    await waitFor(() => expect(strip.textContent).toContain('spec.md'))
    expect(strip.textContent).toContain('Demo / docs/spec.md')
    expect(strip.className).toContain('drag-region')
    expect((await screen.findByTestId(TEST_ID.fileMarkdownRender)).textContent).toContain(
      'Hello preview',
    )
  })

  it('shows Code | Preview in the strip for Markdown, defaulting to Preview', async () => {
    const { api } = createPreviewStub([text('# Hello preview')])
    render(<PreviewApp preview={api} />)
    const strip = await screen.findByTestId(TEST_ID.previewTitleBar)
    const code = await within(strip).findByTestId(TEST_ID.fileMarkdownCode)
    const previewButton = within(strip).getByTestId(TEST_ID.fileMarkdownPreview)
    expect(previewButton.getAttribute('aria-pressed')).toBe('true')
    expect(code.getAttribute('aria-pressed')).toBe('false')
    expect(code.closest('fieldset')?.classList.contains('no-drag')).toBe(true)
  })

  it('has no view switch and no other control for a non-Markdown file', async () => {
    const { api } = createPreviewStub(
      [() => Promise.resolve({ kind: 'text', content: 'const a = 1', language: 'typescript' })],
      'src/app.ts',
    )
    render(<PreviewApp preview={api} />)
    await screen.findByTestId(TEST_ID.filePreviewMonaco)
    expect(screen.getByTestId(TEST_ID.previewTitleBar).textContent).toContain('app.ts')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('switches Markdown between Monaco and rendered, and keeps the choice across a refresh', async () => {
    const { api, change } = createPreviewStub([text('# First'), text('# Second')])
    render(<PreviewApp preview={api} />)
    await screen.findByTestId(TEST_ID.fileMarkdownRender)
    fireEvent.click(screen.getByTestId(TEST_ID.fileMarkdownCode))
    expect((await screen.findByTestId(TEST_ID.filePreviewMonaco)).textContent).toBe('# First')
    expect(screen.queryByTestId(TEST_ID.fileMarkdownRender)).toBeNull()
    change()
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.filePreviewMonaco).textContent).toBe('# Second'),
    )
    expect(screen.getByTestId(TEST_ID.fileMarkdownCode).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId(TEST_ID.fileMarkdownPreview))
    expect((await screen.findByTestId(TEST_ID.fileMarkdownRender)).textContent).toContain('Second')
  })

  it('reads again on a change notice and keeps the old content until it settles', async () => {
    const second = deferred<FilePreview>()
    const { api, change } = createPreviewStub([text('first'), () => second.promise])
    render(<PreviewApp preview={api} />)
    await screen.findByText('first')
    change()
    expect(api.read).toHaveBeenCalledTimes(2)
    expect(screen.getByText('first')).toBeTruthy()
    second.resolve({ kind: 'text', content: 'second', language: 'markdown' })
    expect(await screen.findByText('second')).toBeTruthy()
  })

  it('never lets an older read replace a newer one', async () => {
    const slow = deferred<FilePreview>()
    const { api, change } = createPreviewStub([text('first'), () => slow.promise, text('newest')])
    render(<PreviewApp preview={api} />)
    await screen.findByText('first')
    change()
    change()
    expect(await screen.findByText('newest')).toBeTruthy()
    slow.resolve({ kind: 'text', content: 'stale', language: 'markdown' })
    await Promise.resolve()
    expect(screen.queryByText('stale')).toBeNull()
    expect(screen.getByText('newest')).toBeTruthy()
  })

  it('shows the not-found state and recovers when the file returns', async () => {
    const { api, change } = createPreviewStub([
      text('before'),
      () => Promise.reject(NOT_FOUND),
      text('after'),
    ])
    render(<PreviewApp preview={api} />)
    await screen.findByText('before')
    change()
    expect((await screen.findByTestId(TEST_ID.filePreviewError)).textContent).toBe(
      'File not found.',
    )
    change()
    expect(await screen.findByText('after')).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.filePreviewError)).toBeNull()
  })

  it('opens a binary file externally through the bound file and shows a failure notice', async () => {
    const { api } = createPreviewStub([() => Promise.resolve({ kind: 'binary' })])
    vi.mocked(api.openExternal).mockRejectedValueOnce({ ...NOT_FOUND, message: 'No app.' })
    render(<PreviewApp preview={api} />)
    fireEvent.click(await screen.findByTestId(TEST_ID.filePreviewOpenExternal))
    expect(api.openExternal).toHaveBeenCalledTimes(1)
    expect((await screen.findByTestId(TEST_ID.previewNotice)).textContent).toBe('No app.')
  })

  it('applies the stored theme and follows a theme change from the main window', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'nekode-flat')
    const { api } = createPreviewStub([text('x')])
    render(<PreviewApp preview={api} />)
    expect(document.documentElement.dataset.theme).toBe('nekode-flat')
    localStorage.setItem(THEME_STORAGE_KEY, 'nekode-float')
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }))
    })
    expect(document.documentElement.dataset.theme).toBe('nekode-float')
  })

  it('unsubscribes from change notices on unmount', async () => {
    const { api, listeners } = createPreviewStub([text('x')])
    const { unmount } = render(<PreviewApp preview={api} />)
    await screen.findByText('x')
    unmount()
    expect(listeners.size).toBe(0)
  })
})
