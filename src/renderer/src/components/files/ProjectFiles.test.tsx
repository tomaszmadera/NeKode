import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppApi, ChatInfo, FileEntry, ProjectInfo } from '../../../../shared/ipc-contract'
import { emptyGitWorktree } from '../../../../shared/ipc-contract'
import { App } from '../../App'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { resetMockFitAddons } from '../../test/fit-addon-mock'
import { resetMockTerminals } from '../../test/xterm-mock'

// Project Files view tests (spec Required tests — renderer): the "Files"
// action enters the mode and the row click does not; the context menu holds
// Remove Project and the row has no remove button; tree expand/collapse/
// select with lazy caching; clicking a file opens its tab (label = file name,
// tooltip = relative path); too-large/binary fallbacks with "Open externally"
// per tab; back-affordance round-trips keep the tab strip and the terminal
// session; per-project tree state retention across mode round-trips.
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
    actions: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      execute: vi.fn(),
      status: vi.fn(),
    },
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
      shellName: vi.fn().mockResolvedValue('PowerShell'),
      terminate: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn().mockReturnValue(() => undefined),
      onExit: vi.fn().mockReturnValue(() => undefined),
    },
    git: {
      getStatus: vi
        .fn()
        .mockResolvedValue({ branch: 'main', dirty: false, worktree: emptyGitWorktree() }),
    },
    files: {
      list: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue({ kind: 'text', content: '', language: null }),
      openExternal: vi.fn().mockResolvedValue(undefined),
      openRoot: vi.fn().mockResolvedValue(undefined),
    },
    handoffs: {
      list: vi.fn().mockResolvedValue([]),
    },
    dialogs: {
      pickDirectory: vi.fn().mockResolvedValue(null),
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

/** Main-surface pane of one open file tab (hidden view when inactive). */
function pane(relativePath: string): HTMLElement {
  return screen.getByTestId(testIdFor.filePreviewPane(relativePath))
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
    expect(screen.queryAllByTestId(/^tab-file-/)).toEqual([])

    // The Files action enters the mode (Behaviour 1 / AC1). The back
    // affordance is icon-only; its accessible name carries the meaning.
    await enterFilesMode()
    expect(getByTestIdString(TEST_ID.filesBackButton).getAttribute('aria-label')).toBe(
      'Back to Projects',
    )
    expect(getByTestIdString(TEST_ID.filesProjectName).textContent).toBe('Demo')
    // The center keeps the tab strip (tab model): no "Files" view label and no
    // preview empty state — clicking a file opens its tab.
    const strip = getByTestIdString(TEST_ID.tabStrip)
    expect(strip).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.tabTerminal)).toBeTruthy()
    expect(screen.queryByText('Select a file to preview')).toBeNull()
    expect(screen.queryAllByTestId(/^tab-file-/)).toEqual([])
    // The project context lives in the status bar (Behaviour 4).
    expect(getByTestIdString(TEST_ID.statusProjectName).textContent).toBe('Demo')
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

    // Selecting a file opens its tab (AC4) instead of an empty-state swap.
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src/app.ts')))
    await screen.findByTestId(testIdFor.tabFile('src/app.ts'))
  })

  it('previews a text file read-only in its tab, with mapped language and path tooltip', async () => {
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

    // Tab label = file name; tooltip = the path relative to the project root.
    const tab = screen.getByTestId(testIdFor.tabFile('README.md'))
    expect(within(tab).getByText('README.md')).toBeTruthy()
    expect(tab.getAttribute('title')).toBe('README.md')
    const monaco = await within(pane('README.md')).findByTestId(TEST_ID.filePreviewMonaco)
    expect(monaco.getAttribute('data-language')).toBe('typescript')
    expect(monaco.textContent).toBe('const x: number = 1')
    expect(app.files.read).toHaveBeenCalledWith('p1', 'README.md')

    // Nested paths tooltip as segments (spec Behaviour 7).
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))
    const nestedTab = screen.getByTestId(testIdFor.tabFile('src/app.ts'))
    expect(nestedTab.getAttribute('title')).toBe('src / app.ts')
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
    const monaco = await within(pane('README.md')).findByTestId(TEST_ID.filePreviewMonaco)
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

    const tooLarge = await within(pane('README.md')).findByTestId(TEST_ID.filePreviewTooLarge)
    expect(tooLarge.textContent).toContain('This file is too large for preview.')
    fireEvent.click(within(pane('README.md')).getByTestId(TEST_ID.filePreviewOpenExternal))
    await waitFor(() => expect(app.files.openExternal).toHaveBeenCalledWith('p1', 'README.md'))

    vi.mocked(app.files.read).mockResolvedValue({ kind: 'binary' })
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))
    // Fallbacks are per tab: the too-large state stays in its own tab.
    const binary = await within(pane('src/app.ts')).findByTestId(TEST_ID.filePreviewBinary)
    expect(binary.textContent).toContain('Binary file')
    expect(within(pane('src/app.ts')).getByTestId(TEST_ID.filePreviewOpenExternal)).toBeTruthy()
    expect(within(pane('README.md')).getByTestId(TEST_ID.filePreviewTooLarge)).toBeTruthy()
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
    fireEvent.click(await within(pane('README.md')).findByTestId(TEST_ID.filePreviewOpenExternal))

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
    // The rest of the app keeps working; the back affordance exits the mode.
    expect(getByTestIdString(TEST_ID.appShell)).toBeTruthy()
    fireEvent.click(getByTestIdString(TEST_ID.filesBackButton))
    await screen.findByTestId(TEST_ID.projectList)
    expect(screen.queryByTestId(TEST_ID.fileTreeError)).toBeNull()
  })

  it('shows a preview error for a file that vanished; other tabs keep working', async () => {
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
    const error = await within(pane('README.md')).findByTestId(TEST_ID.filePreviewError)
    expect(error.textContent).toContain('File not found.')

    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))
    expect(await within(pane('src/app.ts')).findByTestId(TEST_ID.filePreviewMonaco)).toBeTruthy()
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

  it('the back affordance keeps the tab strip and the active tab; the session survives (AC6)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
    const workspace = getByTestIdString(TEST_ID.chatWorkspace)

    await enterFilesMode()
    // The center keeps the tab strip and the active tab (Behaviour 12): the
    // chat workspace stays mounted and visible, the PTY session and its
    // scrollback survive the round-trip (AC6).
    expect(screen.getByTestId(TEST_ID.chatWorkspace)).toBe(workspace)
    expect(getByTestIdString(TEST_ID.chatSurfaceHost).style.display).toBe('flex')
    expect(screen.getByTestId(TEST_ID.tabTerminal).getAttribute('data-selected')).toBe('true')
    expect(app.terminals.create).toHaveBeenCalledTimes(1)

    fireEvent.click(getByTestIdString(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    expect(screen.getByTestId(TEST_ID.chatWorkspace)).toBe(workspace)
    expect(getByTestIdString(TEST_ID.chatSurfaceHost).style.display).toBe('flex')
    // Typing resumes in the same session: no re-spawn happened.
    expect(app.terminals.create).toHaveBeenCalledTimes(1)
  })

  it('the back affordance keeps the Welcome surface when no chat was active', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    render(<App app={app} />)
    await screen.findByTestId(TEST_ID.welcomeSurface)
    await enterFilesMode()
    // Project Files mode never swaps the center surface (tab model): the
    // welcome surface stays on screen while the mode is open.
    expect(screen.getByTestId(TEST_ID.welcomeSurface)).toBeTruthy()
    expect(getByTestIdString(TEST_ID.chatSurfaceHost).style.display).toBe('flex')

    fireEvent.click(getByTestIdString(TEST_ID.filesBackButton))
    expect(getByTestIdString(TEST_ID.chatSurfaceHost).style.display).toBe('flex')
    await screen.findByTestId(TEST_ID.welcomeSurface)
  })

  it('retains expansion state and the open tab per project across round-trips (AC9)', async () => {
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
    await within(pane('src/app.ts')).findByTestId(TEST_ID.filePreviewMonaco)
    expect(app.files.list).toHaveBeenCalledTimes(2)

    // Leave and re-enter: expansion and the open tab with its preview are
    // restored without re-listing (Behaviour 14).
    fireEvent.click(getByTestIdString(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    fireEvent.click(await screen.findByTestId(testIdFor.projectFiles('p1')))
    await screen.findByTestId(testIdFor.fileEntry('src/app.ts'))
    expect(screen.getByTestId(testIdFor.tabFile('src/app.ts')).getAttribute('data-selected')).toBe(
      'true',
    )
    await waitFor(() => expect(pane('src/app.ts').style.display).toBe('flex'))
    expect(app.files.list).toHaveBeenCalledTimes(2)

    // Another project shows its own tree and its own tab set (Behaviour 15).
    fireEvent.click(getByTestIdString(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    fireEvent.click(await screen.findByTestId(testIdFor.projectFiles('p2')))
    await screen.findByTestId(testIdFor.fileEntry('docs'))
    expect(screen.queryByTestId(testIdFor.fileEntry('src'))).toBeNull()
    expect(screen.queryByTestId(testIdFor.tabFile('src/app.ts'))).toBeNull()
    expect(screen.queryAllByTestId(/^tab-file-/)).toEqual([])
  })
})
