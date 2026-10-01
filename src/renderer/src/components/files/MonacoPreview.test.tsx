import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import {
  MockSelection,
  mockEditors,
  mockModels,
  mockOptions,
  resetMockMonaco,
} from '../../test/monaco-mock'
import { MonacoPreview } from './MonacoPreview'

// Read-only preview context menu tests: the host opens the app menu (Copy /
// Select All) on right-click instead of Monaco's built-in one, Copy writes
// the selected range to the renderer clipboard and Select All selects the
// full model range, Escape and a second right-click close the menu, and the
// unmount disposes the editor and the model. Monaco is mocked at the module
// boundary (./monaco-setup), the same convention as the xterm mocks.

vi.mock('./monaco-setup', () => import('../../test/monaco-mock'))

function stubClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  return { writeText }
}

describe('MonacoPreview context menu', () => {
  let clipboard: { writeText: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    resetMockMonaco()
    clipboard = stubClipboard()
  })

  afterEach(() => {
    cleanup()
  })

  async function renderPreview(): Promise<HTMLElement> {
    render(<MonacoPreview content="const x: number = 1" language="typescript" />)
    const host = await screen.findByTestId(TEST_ID.filePreviewMonaco)
    await waitFor(() => expect(mockEditors).toHaveLength(1))
    return host
  }

  it('mounts the editor with the built-in context menu disabled', async () => {
    await renderPreview()
    const options = mockOptions[0] as { contextmenu: boolean }
    expect(options.contextmenu).toBe(false)
  })

  it('right-click opens the menu; Copy is disabled without a selection', async () => {
    const host = await renderPreview()

    fireEvent.contextMenu(host)
    expect(screen.getByTestId(TEST_ID.editorContextMenu)).toBeTruthy()
    const copy = screen.getByTestId(TEST_ID.editorContextCopy)
    expect(copy.getAttribute('disabled')).not.toBeNull()
  })

  it('Copy writes the selected range to the clipboard and closes the menu', async () => {
    const host = await renderPreview()
    mockEditors[0].selection = new MockSelection(1, 7, 1, 8)

    fireEvent.contextMenu(host)
    fireEvent.click(screen.getByTestId(TEST_ID.editorContextCopy))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('x'))
    expect(screen.queryByTestId(TEST_ID.editorContextMenu)).toBeNull()
  })

  it('Select All selects the full model range and closes the menu', async () => {
    const host = await renderPreview()

    fireEvent.contextMenu(host)
    fireEvent.click(screen.getByTestId(TEST_ID.editorContextSelectAll))
    await waitFor(() =>
      expect(mockEditors[0].getSelection()).toEqual(new MockSelection(1, 1, 1, 20)),
    )
    expect(screen.queryByTestId(TEST_ID.editorContextMenu)).toBeNull()
  })

  it('Escape closes the menu', async () => {
    const host = await renderPreview()

    fireEvent.contextMenu(host)
    expect(screen.getByTestId(TEST_ID.editorContextMenu)).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId(TEST_ID.editorContextMenu)).toBeNull()
  })

  it('a second right-click closes the menu', async () => {
    const host = await renderPreview()

    fireEvent.contextMenu(host)
    expect(screen.getByTestId(TEST_ID.editorContextMenu)).toBeTruthy()
    // The overlay now covers the viewport, so the second gesture lands there.
    fireEvent.contextMenu(screen.getByRole('menu', { name: 'File preview' }))
    expect(screen.queryByTestId(TEST_ID.editorContextMenu)).toBeNull()
  })

  it('unmount disposes the editor and the model', async () => {
    await renderPreview()
    const editor = mockEditors[0]
    const model = mockModels[0]

    cleanup()
    expect(editor.disposed).toBe(true)
    expect(model.disposed).toBe(true)
  })
})
