import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppApi, ChatInfo, FileEntry, ProjectInfo } from '../../../../shared/ipc-contract'
import { App } from '../../App'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { resetMockFitAddons } from '../../test/fit-addon-mock'
import { resetMockTerminals } from '../../test/xterm-mock'

// Project Files view tests (spec Required tests — renderer): the "Files"
// action enters the mode and the row click does not; the context menu holds
// Remove Project and the row has no remove button; tree expand/collapse/
// select with lazy caching; empty state → preview; too-large/binary
// fallbacks with "Open externally"; `← Projects` restores the previous
// center surface; per-project state retention across mode round-trips.
//
// xterm.js is mocked at the module boundary (jsdom has no canvas) and the
// Monaco preview wrapper is mocked so the tests assert the data handed to
// the read-only editor (content, language), not monaco internals.

vi.mock('@xterm/xterm', () => import('../../test/xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('../../test/fit-addon-mock'))
vi.mock('./MonacoPreview', () => ({
  MonacoPreview: ({ content, language }: { content: string; language: string | null }) => (
    <pre data-testid="file-preview-monaco" data-language={language ?? 'plaintext'}>
      {content}
    </pre>
  ),
}))

function createAppApiStub(): AppApi {
  return {
    projects: {
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue(null),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    chats: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 't9', projectId: 'p1', name: 'PowerShell' }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    state: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    terminals: {
      create: vi.fn().mockResolvedValue('term-1'),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn().mockReturnValue(() => undefined),
      onExit: vi.fn().mockReturnValue(() => undefined),
    },
    git: {
      getStatus: vi.fn().mockResolvedValue({ branch: 'main', dirty: false }),
    },
    files: {
      list: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue({ kind: 'text', content: '', language: null }),
      openExternal: vi.fn().mockResolvedValue(undefined),
    },
  }
}

const projectA: ProjectInfo = {
  id: 'p1',
  name: 'Demo',
  path: 'D:/code/demo',
  runtimeLabel: 'Node 24',
}
const projectB: ProjectInfo = {
  id: 'p2',
  name: 'Other',
  path: 'D:/code/other',
  runtimeLabel: null,
}
const chatOne: ChatInfo = { id: 't1', projectId: 'p1', name: 'First chat' }

const rootEntries: FileEntry[] = [
  { name: 'src', relativePath: 'src', kind: 'directory' },
  { name: 'README.md', relativePath: 'README.md', kind: 'file' },
]
const srcEntries: FileEntry[] = [
  { name: 'nested', relativePath: 'src/nested', kind: 'directory' },
  { name: 'app.ts', relativePath: 'src/app.ts', kind: 'file' },
]
const otherRootEntries: FileEntry[] = [{ name: 'docs', relativePath: 'docs', kind: 'directory' }]

/** One level per call, per project (the real service contract). */
function mockListings(app: AppApi): void {
  vi.mocked(app.files.list).mockImplementation(async (projectId, relativePath) => {
    if (projectId === 'p2') {
      return relativePath === null ? otherRootEntries : []
    }
    if (relativePath === null) {
      return rootEntries
    }
    return relativePath === 'src' ? srcEntries : []
  })
}

function getByTestIdString(testId: string): HTMLElement {
  const element = screen.getByTestId(testId)
  expect(element).toBeTruthy()
  return element
}

async function enterFilesMode(): Promise<void> {
  fireEvent.click(await screen.findByTestId(testIdFor.projectFiles('p1')))
  await screen.findByTestId(TEST_ID.fileTree)
}

describe('project files — entry points (spec Behaviour 1–3)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('the Files action enters Project Files mode; a project row click never does', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)

    render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectRow('p1'))
    const filesButton = getByTestIdString(testIdFor.projectFiles('p1'))
    expect(filesButton.getAttribute('title')).toBe('Show project files')

    // Row click keeps its meaning: select + expand the chat list (Behaviour 2).
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(testIdFor.chatRow('t1'))
    expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.filesViewLabel)).toBeNull()

    // The Files action enters the mode (Behaviour 1 / AC1).
    await enterFilesMode()
    expect(getByTestIdString(TEST_ID.filesBackButton).textContent).toContain('← Projects')
    expect(getByTestIdString(TEST_ID.filesProjectName).textContent).toBe('Demo')
    expect(getByTestIdString(TEST_ID.filesViewLabel).textContent).toBe('Files')
    expect(getByTestIdString(TEST_ID.filePreviewEmpty).textContent).toContain(
      'Select a file to preview',
    )
    // The project context header is unchanged (Behaviour 4).
    expect(getByTestIdString(TEST_ID.headerProjectName).textContent).toBe('Demo')
    expect(app.files.list).toHaveBeenCalledWith('p1', null)
  })

  it('the project row has no remove button; the context menu holds Remove Project', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.projects.remove).mockResolvedValue(undefined)

    render(<App app={app} />)
    const row = await screen.findByTestId(testIdFor.projectRow('p1'))
    // No visible row button performs removal (Behaviour 3 / AC2).
    expect(screen.queryByTestId(testIdFor.removeProject('p1'))).toBeNull()
    expect(screen.queryByText('Remove')).toBeNull()

    fireEvent.contextMenu(row)
    const item = await screen.findByTestId(testIdFor.removeProject('p1'))
    expect(item.textContent).toBe('Remove Project')
    expect(screen.getByTestId(TEST_ID.projectContextMenu)).toBeTruthy()

    // The menu runs the existing removal flow unchanged.
    fireEvent.click(item)
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.projectContextMenu)).toBeNull())
  })

  it('the ContextMenu key and Shift+F10 open the menu; Escape closes it', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])

    render(<App app={app} />)
    const row = await screen.findByTestId(testIdFor.projectRow('p1'))

    fireEvent.keyDown(row, { key: 'ContextMenu' })
    await screen.findByTestId(TEST_ID.projectContextMenu)
    expect(screen.getByTestId(testIdFor.removeProject('p1'))).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId(TEST_ID.projectContextMenu)).toBeNull()

    fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
    await screen.findByTestId(TEST_ID.projectContextMenu)
  })
})

describe('project files — tree and preview (spec Behaviour 5–10)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('lists directories first, expands lazily (one read per expansion) and selects files', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)

    render(<App app={app} />)
    await enterFilesMode()
    const tree = getByTestIdString(TEST_ID.fileTree)
    await screen.findByTestId(testIdFor.fileEntry('README.md'))
    // Directories sort before files (the listing is pre-sorted in main).
    const text = tree.textContent ?? ''
    expect(text.indexOf('src')).toBeLessThan(text.indexOf('README.md'))
    expect(app.files.list).toHaveBeenCalledTimes(1)

    // Expanding loads exactly one directory level…
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src')))
    await screen.findByTestId(testIdFor.fileEntry('src/app.ts'))
    expect(app.files.list).toHaveBeenCalledWith('p1', 'src')
    expect(app.files.list).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId(testIdFor.fileEntry('src')).getAttribute('aria-expanded')).toBe(
      'true',
    )

    // …collapse keeps the children, and re-expanding does not re-read.
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src')))
    expect(screen.queryByTestId(testIdFor.fileEntry('src/app.ts'))).toBeNull()
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src')))
    await screen.findByTestId(testIdFor.fileEntry('src/app.ts'))
    expect(app.files.list).toHaveBeenCalledTimes(2)

    // Selecting a file leaves the empty state for the preview (AC4).
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src/app.ts')))
    expect(screen.queryByTestId(TEST_ID.filePreviewEmpty)).toBeNull()
  })

  it('previews a text file read-only with breadcrumb and mapped language', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    vi.mocked(app.files.read).mockResolvedValue({
      kind: 'text',
      content: 'const x: number = 1',
      language: 'typescript',
    })

    render(<App app={app} />)
    await enterFilesMode()
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))

    expect((await screen.findByTestId(TEST_ID.filePreviewBreadcrumb)).textContent).toBe('README.md')
    const monaco = await screen.findByTestId(TEST_ID.filePreviewMonaco)
    expect(monaco.getAttribute('data-language')).toBe('typescript')
    expect(monaco.textContent).toBe('const x: number = 1')
    expect(app.files.read).toHaveBeenCalledWith('p1', 'README.md')

    // Nested paths breadcrumb as segments (spec Behaviour 7).
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))
    expect((await screen.findByTestId(TEST_ID.filePreviewBreadcrumb)).textContent).toBe(
      'src / app.ts',
    )
  })

  it('falls back to plain text when the extension has no language mapping', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    vi.mocked(app.files.read).mockResolvedValue({
      kind: 'text',
      content: 'notes',
      language: null,
    })

    render(<App app={app} />)
    await enterFilesMode()
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    const monaco = await screen.findByTestId(TEST_ID.filePreviewMonaco)
    expect(monaco.getAttribute('data-language')).toBe('plaintext')
  })

  it('shows the too-large and binary fallbacks with Open externally', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    vi.mocked(app.files.read).mockResolvedValueOnce({
      kind: 'too-large',
      size: 2 * 1024 * 1024 + 1,
    })

    render(<App app={app} />)
    await enterFilesMode()
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))

    const tooLarge = await screen.findByTestId(TEST_ID.filePreviewTooLarge)
    expect(tooLarge.textContent).toContain('This file is too large for preview.')
    fireEvent.click(getByTestIdString(TEST_ID.filePreviewOpenExternal))
    await waitFor(() => expect(app.files.openExternal).toHaveBeenCalledWith('p1', 'README.md'))

    vi.mocked(app.files.read).mockResolvedValue({ kind: 'binary' })
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))
    const binary = await screen.findByTestId(TEST_ID.filePreviewBinary)
    expect(binary.textContent).toContain('Binary file')
    expect(screen.getByTestId(TEST_ID.filePreviewOpenExternal)).toBeTruthy()
  })

  it('surfaces a failed Open externally as a notice (spec Errors)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    vi.mocked(app.files.read).mockResolvedValue({ kind: 'binary' })
    vi.mocked(app.files.openExternal).mockRejectedValue({
      nekodeAppError: true,
      code: 'unknown',
      message: 'Failed to open the file externally.',
    })

    render(<App app={app} />)
    await enterFilesMode()
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(await screen.findByTestId(TEST_ID.filePreviewOpenExternal))

    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('Failed to open the file externally.')
  })

  it('shows the inline tree error when the project directory is unavailable (AC8)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.files.list).mockRejectedValue({
      nekodeAppError: true,
      code: 'not_found',
      message: 'File not found.',
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectFiles('p1')))
    const error = await screen.findByTestId(TEST_ID.fileTreeError)
    expect(error.textContent).toContain('File not found.')
    // The rest of the app keeps working; `← Projects` exits the mode.
    expect(getByTestIdString(TEST_ID.appShell)).toBeTruthy()
    fireEvent.click(getByTestIdString(TEST_ID.filesBackButton))
    await screen.findByTestId(TEST_ID.projectList)
    expect(screen.queryByTestId(TEST_ID.fileTreeError)).toBeNull()
  })

  it('shows a preview error for a file that vanished; selecting another file works', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    vi.mocked(app.files.read)
      .mockRejectedValueOnce({
        nekodeAppError: true,
        code: 'not_found',
        message: 'File not found.',
      })
      .mockResolvedValue({ kind: 'text', content: 'still here', language: null })

    render(<App app={app} />)
    await enterFilesMode()
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    const error = await screen.findByTestId(TEST_ID.filePreviewError)
    expect(error.textContent).toContain('File not found.')

    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))
    expect(await screen.findByTestId(TEST_ID.filePreviewMonaco)).toBeTruthy()
  })
})

describe('project files — mode round-trips (spec Behaviour 12, 14–15)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('`← Projects` restores the previous center surface and keeps sessions mounted', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
    const workspace = getByTestIdString(TEST_ID.chatWorkspace)

    await enterFilesMode()
    // The chat workspace stays mounted and hidden — the PTY session and its
    // scrollback survive the round-trip (Behaviour 12 / AC6).
    expect(screen.getByTestId(TEST_ID.chatWorkspace)).toBe(workspace)
    expect(getByTestIdString(TEST_ID.chatSurfaceHost).style.display).toBe('none')
    expect(app.terminals.create).toHaveBeenCalledTimes(1)

    fireEvent.click(getByTestIdString(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    expect(getByTestIdString(TEST_ID.chatSurfaceHost).style.display).toBe('flex')
    expect(getByTestIdString(TEST_ID.chatWorkspace).textContent).toContain('First chat')
    // Typing resumes in the same session: no re-spawn happened.
    expect(app.terminals.create).toHaveBeenCalledTimes(1)
  })

  it('`← Projects` restores the Welcome surface when no chat was active', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)

    render(<App app={app} />)
    await screen.findByTestId(TEST_ID.welcomeSurface)
    await enterFilesMode()
    // The welcome surface stays mounted but hidden while the mode is open.
    expect(getByTestIdString(TEST_ID.chatSurfaceHost).style.display).toBe('none')

    fireEvent.click(getByTestIdString(TEST_ID.filesBackButton))
    expect(getByTestIdString(TEST_ID.chatSurfaceHost).style.display).toBe('flex')
    await screen.findByTestId(TEST_ID.welcomeSurface)
  })

  it('retains expansion state and the selected file per project across round-trips (AC9)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    mockListings(app)
    vi.mocked(app.files.read).mockResolvedValue({
      kind: 'text',
      content: 'const x = 1',
      language: 'typescript',
    })

    render(<App app={app} />)
    await enterFilesMode()
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))
    await screen.findByTestId(TEST_ID.filePreviewBreadcrumb)
    expect(app.files.list).toHaveBeenCalledTimes(2)

    // Leave and re-enter: expansion and the selected preview are restored
    // without re-listing (Behaviour 14).
    fireEvent.click(getByTestIdString(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    fireEvent.click(await screen.findByTestId(testIdFor.projectFiles('p1')))
    await screen.findByTestId(testIdFor.fileEntry('src/app.ts'))
    expect((await screen.findByTestId(TEST_ID.filePreviewBreadcrumb)).textContent).toBe(
      'src / app.ts',
    )
    expect(app.files.list).toHaveBeenCalledTimes(2)

    // Another project shows its own tree with its own state (Behaviour 15).
    fireEvent.click(getByTestIdString(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    fireEvent.click(await screen.findByTestId(testIdFor.projectFiles('p2')))
    await screen.findByTestId(testIdFor.fileEntry('docs'))
    expect(screen.queryByTestId(testIdFor.fileEntry('src'))).toBeNull()
    expect(screen.queryByTestId(TEST_ID.filePreviewBreadcrumb)).toBeNull()
  })
})
