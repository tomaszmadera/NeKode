import type {
  AppApi,
  ChatInfo,
  FileEntry,
  GitFileStatuses,
  ProjectInfo,
} from '@shared/ipc-contract'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { createAppApiStub } from '../../test/app-api-stub'
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
const otherRootEntries: FileEntry[] = [
  { name: 'docs', relativePath: 'docs', kind: 'directory' },
  { name: 'guide.md', relativePath: 'guide.md', kind: 'file' },
]

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

  it('the Files header shows a path under the home directory as ~, full path on hover', async () => {
    app = { ...app, platform: 'win32', homeDir: 'D:\\code' }
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)

    render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectRow('p1'))
    await enterFilesMode()
    const path = getByTestIdString(TEST_ID.filesProjectPath)
    expect(path.textContent).toBe('~/demo')
    expect(path.getAttribute('title')).toBe('D:/code/demo')
  })

  it('the Files action enters Project Files mode; a project row click never does', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)

    render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectRow('p1'))
    const filesButton = getByTestIdString(testIdFor.projectFiles('p1'))
    expect(filesButton.getAttribute('title')).toBe('File tree')
    expect(filesButton.getAttribute('aria-label')).toBe('Open file tree of Demo')

    // Row click keeps its meaning: select + expand the chat list (Behaviour 2).
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(testIdFor.chatRow('t1'))
    expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull()
    expect(screen.queryAllByTestId(/^tab-file-/)).toEqual([])

    // The Files action enters the mode (Behaviour 1 / AC1). The back
    // button names the destination visibly and remains keyboard-focusable.
    await enterFilesMode()
    const backButton = screen.getByRole('button', { name: 'Back to projects' })
    expect(backButton.textContent).toBe('Back to Projects')
    backButton.focus()
    expect(document.activeElement).toBe(backButton)
    expect(screen.getByTestId(TEST_ID.fileTree)).toBeTruthy()
    expect(getByTestIdString(TEST_ID.filesProjectName).textContent).toBe('DEMO')
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

    // Escape in the tree panel acts as back button
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    backButton.dispatchEvent(escapeEvent)
    expect(escapeEvent.defaultPrevented).toBe(false)
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
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

  it.each([
    [
      'previews a text file read-only in its tab, with mapped language and path tooltip',
      'const x: number = 1',
      'typescript',
      'typescript',
    ],
    [
      'falls back to plain text when the extension has no language mapping',
      'notes',
      null,
      'plaintext',
    ],
  ] as Array<[string, string, string | null, string]>)(
    '%s',
    async (_title, content, language, expectedLanguage) => {
      vi.mocked(app.projects.list).mockResolvedValue([projectA])
      mockListings(app)
      vi.mocked(app.files.read).mockResolvedValue({
        kind: 'text',
        content,
        language,
      })

      render(<App app={app} />)
      await enterFilesMode()
      fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))

      if (language !== null) {
        // Tab label = file name; tooltip = the path relative to the project root.
        const tab = screen.getByTestId(testIdFor.tabFile('README.md'))
        expect(within(tab).getByText('README.md')).toBeTruthy()
        expect(tab.getAttribute('title')).toBe('README.md')
      }
      // README.md opens rendered. Code still hands the mapped language to Monaco.
      fireEvent.click(screen.getByTestId(TEST_ID.fileMarkdownCode))
      const monaco = await within(pane('README.md')).findByTestId(TEST_ID.filePreviewMonaco)
      expect(monaco.getAttribute('data-language')).toBe(expectedLanguage)
      if (language !== null) {
        expect(monaco.textContent).toBe(content)
        expect(app.files.read).toHaveBeenCalledWith('p1', 'README.md')

        // Nested paths tooltip as segments (spec Behaviour 7).
        fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src')))
        fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))
        const nestedTab = screen.getByTestId(testIdFor.tabFile('src/app.ts'))
        expect(nestedTab.getAttribute('title')).toBe('src / app.ts')
      }
    },
  )

  it('switches a markdown file between code and rendered preview from the action row', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    vi.mocked(app.files.read).mockImplementation(async (_projectId, relativePath) => {
      if (relativePath === 'README.md') {
        return { kind: 'text', content: '# Title\n\nHello', language: 'markdown' }
      }
      return { kind: 'text', content: 'const x = 1', language: 'typescript' }
    })

    render(<App app={app} />)
    await enterFilesMode()
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    const rendered = await within(pane('README.md')).findByTestId(TEST_ID.fileMarkdownRender)
    expect(rendered.querySelector('h1')?.textContent).toBe('Title')
    expect(within(pane('README.md')).queryByTestId(TEST_ID.filePreviewMonaco)).toBeNull()
    expect(screen.getByTestId(TEST_ID.fileMarkdownPreview).getAttribute('aria-pressed')).toBe(
      'true',
    )

    fireEvent.click(screen.getByTestId(TEST_ID.fileMarkdownCode))
    await within(pane('README.md')).findByTestId(TEST_ID.filePreviewMonaco)
    expect(within(pane('README.md')).queryByTestId(TEST_ID.fileMarkdownRender)).toBeNull()
    expect(screen.getByTestId(TEST_ID.fileMarkdownCode).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))
    await within(pane('src/app.ts')).findByTestId(TEST_ID.filePreviewMonaco)
    expect(screen.queryByTestId(TEST_ID.fileMarkdownCode)).toBeNull()

    // The file tab's test id is the container; the select control is its inner button.
    const readmeTab = screen.getByTestId(testIdFor.tabFile('README.md'))
    fireEvent.click(within(readmeTab).getByRole('button', { name: 'README.md' }))
    expect(screen.getByTestId(TEST_ID.fileMarkdownCode).getAttribute('aria-pressed')).toBe('true')
    expect(within(pane('README.md')).getByTestId(TEST_ID.filePreviewMonaco)).toBeTruthy()
    expect(within(pane('README.md')).queryByTestId(TEST_ID.fileMarkdownRender)).toBeNull()

    fireEvent.click(screen.getByTestId(TEST_ID.fileMarkdownPreview))
    expect(within(pane('README.md')).getByTestId(TEST_ID.fileMarkdownRender)).toBeTruthy()
    expect(within(pane('README.md')).queryByTestId(TEST_ID.filePreviewMonaco)).toBeNull()
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
    // The error stays in its own tab (Behaviour 7): the other pane is
    // untouched and the failing tab still shows its error.
    expect(within(pane('src/app.ts')).queryByTestId(TEST_ID.filePreviewError)).toBeNull()
    expect(within(pane('README.md')).getByTestId(TEST_ID.filePreviewError)).toBeTruthy()
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

    // Another project shows its own tree in the sidebar while the center stays on p1 until a file is opened.
    fireEvent.click(getByTestIdString(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    fireEvent.click(await screen.findByTestId(testIdFor.projectFiles('p2')))
    await screen.findByTestId(testIdFor.fileEntry('docs'))
    expect(screen.queryByTestId(testIdFor.fileEntry('src'))).toBeNull()
    // Center surface still shows p1's open tab until a file from p2 is selected.
    expect(screen.getByTestId(testIdFor.tabFile('src/app.ts'))).toBeTruthy()

    // Selecting a file from p2 activates p2 and displays its tab set.
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('guide.md')))
    await screen.findByTestId(testIdFor.filePreviewPane('guide.md'))
    expect(screen.queryByTestId(testIdFor.tabFile('src/app.ts'))).toBeNull()
    expect(screen.getByTestId(testIdFor.tabFile('guide.md'))).toBeTruthy()
  })
})

describe('project files — refresh (spec Behaviour 25)', () => {
  let app: AppApi

  function hold<T>(): { promise: Promise<T>; release: (value: T) => void } {
    let release: (value: T) => void = () => undefined
    const promise = new Promise<T>((resolve) => {
      release = (value) => {
        resolve(value)
      }
    })
    return { promise, release }
  }

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  function refreshButton(): HTMLElement {
    return getByTestIdString(TEST_ID.filesRefreshButton)
  }

  function refreshIcon(): SVGElement {
    const icon = refreshButton().querySelector('svg')
    expect(icon).toBeTruthy()
    return icon as SVGElement
  }

  it('places Refresh above the tree and lists a file added since the last read', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    const added: FileEntry = { name: 'new-file.ts', relativePath: 'new-file.ts', kind: 'file' }
    let rootHold: ReturnType<typeof hold<FileEntry[]>> | null = null
    let statusHold: ReturnType<typeof hold<Record<string, 'untracked'>>> | null = null
    vi.mocked(app.files.list).mockImplementation((_projectId, relativePath) => {
      if (relativePath === null && rootHold !== null) {
        return rootHold.promise
      }
      return Promise.resolve(relativePath === null ? rootEntries : [])
    })
    vi.mocked(app.git.fileStatuses).mockImplementation(() => {
      if (statusHold !== null) {
        return statusHold.promise
      }
      return Promise.resolve({})
    })

    render(<App app={app} />)
    await enterFilesMode()
    const refresh = refreshButton()
    const tree = getByTestIdString(TEST_ID.fileTree)
    expect(refresh.getAttribute('aria-label')).toBe('Refresh')
    expect(refresh.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(screen.queryByTestId(testIdFor.fileEntry('new-file.ts'))).toBeNull()

    rootHold = hold<FileEntry[]>()
    statusHold = hold()
    fireEvent.click(refresh)
    await waitFor(() => expect(refreshIcon().classList.contains('animate-spin')).toBe(true))
    expect(refreshButton().getAttribute('aria-busy')).toBe('true')
    expect(refreshButton().getAttribute('aria-label')).toBe('Refreshing')
    expect(screen.getByTestId(testIdFor.fileEntry('README.md'))).toBeTruthy()

    rootHold.release([...rootEntries, added])
    statusHold.release({ 'new-file.ts': 'untracked' })
    await screen.findByTestId(testIdFor.fileEntry('new-file.ts'))
    await waitFor(() => expect(refreshIcon().classList.contains('animate-spin')).toBe(false))
    expect(refreshButton().getAttribute('aria-label')).toBe('Refresh')
    expect(refreshButton().getAttribute('aria-busy')).toBe('false')
    expect(app.files.list).toHaveBeenCalledTimes(2)
    expect(app.git.fileStatuses).toHaveBeenCalledTimes(2)
    expect(
      within(screen.getByTestId(testIdFor.fileEntry('new-file.ts'))).getByTestId(
        TEST_ID.fileTreeGitBadge,
      ).textContent,
    ).toBe('U')
  })

  it('re-reads an expanded directory and drops a collapsed listing', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    const extra: FileEntry = { name: 'extra.ts', relativePath: 'src/extra.ts', kind: 'file' }
    vi.mocked(app.files.list).mockImplementation(async (projectId, relativePath) => {
      if (projectId !== 'p1') {
        return []
      }
      if (relativePath === null) {
        return rootEntries
      }
      if (relativePath === 'src') {
        return vi.mocked(app.files.list).mock.calls.length > 2 ? [...srcEntries, extra] : srcEntries
      }
      return []
    })

    render(<App app={app} />)
    await enterFilesMode()
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src')))
    await screen.findByTestId(testIdFor.fileEntry('src/app.ts'))
    expect(app.files.list).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src')))
    expect(screen.queryByTestId(testIdFor.fileEntry('src/app.ts'))).toBeNull()
    fireEvent.click(refreshButton())
    await waitFor(() => expect(refreshButton().getAttribute('aria-label')).toBe('Refresh'))
    expect(app.files.list).toHaveBeenCalledTimes(3)
    expect(app.files.list).toHaveBeenLastCalledWith('p1', null)

    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src')))
    await screen.findByTestId(testIdFor.fileEntry('src/extra.ts'))
    expect(app.files.list).toHaveBeenLastCalledWith('p1', 'src')
    expect(app.files.list).toHaveBeenCalledTimes(4)
  })

  it('shows the inline tree error when the root refresh fails', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    render(<App app={app} />)
    await enterFilesMode()
    await screen.findByTestId(testIdFor.fileEntry('README.md'))

    vi.mocked(app.files.list).mockRejectedValue({
      nekodeAppError: true,
      code: 'not_found',
      message: 'File not found.',
    })
    fireEvent.click(refreshButton())
    const error = await screen.findByTestId(TEST_ID.fileTreeError)
    expect(error.textContent).toContain('File not found.')
    await waitFor(() => expect(refreshButton().getAttribute('aria-label')).toBe('Refresh'))
    expect(screen.queryByTestId(testIdFor.fileEntry('README.md'))).toBeNull()
  })

  it('keeps the rest of the tree when an expanded directory fails to refresh', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    render(<App app={app} />)
    await enterFilesMode()
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src')))
    await screen.findByTestId(testIdFor.fileEntry('src/app.ts'))

    vi.mocked(app.files.list).mockImplementation(async (_projectId, relativePath) => {
      if (relativePath === 'src') {
        return Promise.reject({
          nekodeAppError: true,
          code: 'not_found',
          message: 'Failed to refresh a folder.',
        })
      }
      return rootEntries
    })
    fireEvent.click(refreshButton())
    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('Failed to refresh a folder.')
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.fileEntry('src')).getAttribute('aria-expanded')).toBe(
        'false',
      ),
    )
    expect(screen.queryByTestId(testIdFor.fileEntry('src/app.ts'))).toBeNull()
    expect(screen.getByTestId(testIdFor.fileEntry('README.md'))).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.fileTreeError)).toBeNull()
    expect(refreshButton().getAttribute('aria-label')).toBe('Refresh')
  })
})

describe('project files: tree context menu (spec Behaviour 20-24, NEKODE-38)', () => {
  let app: AppApi
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })
  afterEach(() => {
    cleanup()
  })

  async function openFiles(): Promise<void> {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    render(<App app={app} />)
    await enterFilesMode()
    await screen.findByTestId(testIdFor.fileEntry('README.md'))
  }

  it('opens the four items on a file and a directory and does not toggle the directory', async () => {
    await openFiles()
    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('src')))
    const menu = await screen.findByTestId(TEST_ID.fileTreeContextMenu)
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Show in file explorer', 'Copy path', 'Copy relative path', 'Delete'])
    expect(screen.getByTestId(testIdFor.fileEntry('src')).getAttribute('aria-expanded')).toBe(
      'false',
    )
    expect(screen.queryByTestId(testIdFor.fileEntry('src/app.ts'))).toBeNull()
    expect(app.files.list).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId(TEST_ID.fileTreeContextMenu)).toBeNull()

    fireEvent.keyDown(screen.getByTestId(testIdFor.fileEntry('README.md')), { key: 'ContextMenu' })
    await screen.findByTestId(TEST_ID.fileTreeContextMenu)
    fireEvent.contextMenu(screen.getByTestId(TEST_ID.fileTreeContextMenu))
    expect(screen.queryByTestId(TEST_ID.fileTreeContextMenu)).toBeNull()

    fireEvent.keyDown(screen.getByTestId(testIdFor.fileEntry('README.md')), {
      key: 'F10',
      shiftKey: true,
    })
    await screen.findByTestId(TEST_ID.fileTreeContextMenu)
    // The menu role is the backdrop. A click there dismisses; a click on the
    // panel does not, because item clicks run their own action.
    fireEvent.click(screen.getByRole('menu', { name: 'README.md' }))
    expect(screen.queryByTestId(TEST_ID.fileTreeContextMenu)).toBeNull()

    fireEvent.contextMenu(screen.getByTestId(TEST_ID.filesProjectName))
    fireEvent.contextMenu(screen.getByTestId(TEST_ID.filesBackButton))
    expect(screen.queryByTestId(TEST_ID.fileTreeContextMenu)).toBeNull()
  })

  it('copies the relative path and the file-tab absolute path', async () => {
    await openFiles()
    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeCopyRelativePath))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('README.md'))

    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeCopyPath))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('D:/code/demo/README.md'))
  })

  it('copies a nested path and surfaces a clipboard failure', async () => {
    await openFiles()
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src')))
    await screen.findByTestId(testIdFor.fileEntry('src/app.ts'))
    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('src/app.ts')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeCopyPath))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('D:/code/demo/src/app.ts'))

    writeText.mockRejectedValueOnce(new Error('denied'))
    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('src/app.ts')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeCopyRelativePath))
    expect(await screen.findByTestId(TEST_ID.actionNotice)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.actionNotice).textContent).toContain(
      'Failed to copy the path.',
    )
  })

  it('reveals the entry and moves it to the Recycle Bin without a confirmation dialog', async () => {
    await openFiles()
    vi.mocked(app.files.showInFolder).mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'unknown',
      message: 'Failed to show the item in the file explorer.',
    })
    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeShowInFolder))
    expect((await screen.findByTestId(TEST_ID.actionNotice)).textContent).toContain(
      'Failed to show the item in the file explorer.',
    )
    expect(screen.getByTestId(testIdFor.fileEntry('README.md'))).toBeTruthy()

    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeShowInFolder))
    await waitFor(() => expect(app.files.showInFolder).toHaveBeenCalledTimes(2))
    expect(app.files.showInFolder).toHaveBeenCalledWith('p1', 'README.md')
    expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull()

    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('README.md')))
    await screen.findByTestId(testIdFor.tabFile('README.md'))
    vi.mocked(app.files.list).mockImplementation(async (_projectId, relativePath) => {
      if (relativePath === null) {
        return rootEntries.filter((entry) => entry.relativePath !== 'README.md')
      }
      return relativePath === 'src' ? srcEntries : []
    })
    vi.mocked(app.git.fileStatuses).mockResolvedValue({ src: 'added' })
    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeTrash))
    expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull()
    await waitFor(() => expect(app.files.trash).toHaveBeenCalledWith('p1', 'README.md'))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.fileEntry('README.md'))).toBeNull())
    expect(screen.queryByTestId(testIdFor.tabFile('README.md'))).toBeNull()
    expect(app.files.list).toHaveBeenCalledWith('p1', null)
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.fileEntry('src')).getAttribute('data-git-status')).toBe(
        'added',
      ),
    )
  })

  it('leaves the row in place when trash is rejected', async () => {
    await openFiles()
    vi.mocked(app.files.trash).mockRejectedValue({
      nekodeAppError: true,
      code: 'unknown',
      message: 'Failed to move the item to the Recycle Bin.',
    })
    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeTrash))
    expect(await screen.findByTestId(TEST_ID.actionNotice)).toBeTruthy()
    expect(screen.getByTestId(testIdFor.fileEntry('README.md'))).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull()
  })

  it('drops a directory, its expansion, and a nested file tab, and keeps decorations when status reread fails', async () => {
    vi.mocked(app.git.fileStatuses).mockResolvedValue({
      src: 'modified',
      'README.md': 'modified',
    })
    await openFiles()
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.fileEntry('src')).getAttribute('data-git-status')).toBe(
        'modified',
      ),
    )
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src')))
    await screen.findByTestId(testIdFor.fileEntry('src/app.ts'))
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src/app.ts')))
    await screen.findByTestId(testIdFor.tabFile('src/app.ts'))

    vi.mocked(app.files.list).mockImplementation(async () => [
      { name: 'README.md', relativePath: 'README.md', kind: 'file' },
    ])
    vi.mocked(app.git.fileStatuses).mockRejectedValue(new Error('git failed'))
    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeTrash))
    await waitFor(() => expect(app.files.trash).toHaveBeenCalledWith('p1', 'src'))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.fileEntry('src'))).toBeNull())
    expect(screen.queryByTestId(testIdFor.fileEntry('src/app.ts'))).toBeNull()
    expect(screen.queryByTestId(testIdFor.tabFile('src/app.ts'))).toBeNull()
    expect(
      screen.getByTestId(testIdFor.fileEntry('README.md')).getAttribute('data-git-status'),
    ).toBe('modified')
    expect(screen.queryByTestId(TEST_ID.fileTreeError)).toBeNull()
  })

  it('keeps the updated cache and shows a notice when the parent re-read fails', async () => {
    await openFiles()
    vi.mocked(app.files.list).mockRejectedValue(new Error('disk'))
    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeTrash))
    await waitFor(() => expect(app.files.trash).toHaveBeenCalledWith('p1', 'README.md'))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.fileEntry('README.md'))).toBeNull())
    expect(screen.getByTestId(testIdFor.fileEntry('src'))).toBeTruthy()
    expect((await screen.findByTestId(TEST_ID.actionNotice)).textContent).toContain(
      'Failed to load project files.',
    )
    expect(screen.queryByTestId(TEST_ID.fileTreeError)).toBeNull()
  })

  it('ignores a second trash of the same path while the first is still in flight', async () => {
    await openFiles()
    vi.mocked(app.files.list).mockImplementation(async (_projectId, relativePath) => {
      if (relativePath === null) {
        return rootEntries.filter((entry) => entry.relativePath !== 'README.md')
      }
      return relativePath === 'src' ? srcEntries : []
    })
    let releaseTrash: () => void = () => undefined
    vi.mocked(app.files.trash).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseTrash = () => resolve()
        }),
    )
    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeTrash))
    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeTrash))
    expect(app.files.trash).toHaveBeenCalledTimes(1)
    releaseTrash()
    await waitFor(() => expect(screen.queryByTestId(testIdFor.fileEntry('README.md'))).toBeNull())
    expect(screen.queryByTestId(TEST_ID.actionNotice)).toBeNull()
  })

  it('keeps a folder listing that was already in flight when another path is trashed', async () => {
    await openFiles()
    let releaseSrc: (entries: FileEntry[]) => void = () => undefined
    vi.mocked(app.files.list).mockImplementation((_projectId, relativePath) => {
      if (relativePath === 'src') {
        return new Promise((resolve) => {
          releaseSrc = resolve
        })
      }
      if (relativePath === null) {
        return Promise.resolve(rootEntries.filter((entry) => entry.relativePath !== 'README.md'))
      }
      return Promise.resolve([])
    })
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src')))
    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeTrash))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.fileEntry('README.md'))).toBeNull())
    releaseSrc(srcEntries)
    expect(await screen.findByTestId(testIdFor.fileEntry('src/app.ts'))).toBeTruthy()
    expect(screen.getByTestId(testIdFor.fileEntry('src')).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('keeps the post-trash tree when an earlier status read and listing resolve later', async () => {
    const releaseStatus: Array<(statuses: GitFileStatuses) => void> = []
    vi.mocked(app.git.fileStatuses).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseStatus.push(resolve)
        }),
    )
    await openFiles()

    let releaseRefresh: (entries: FileEntry[]) => void = () => undefined
    let listCalls = 0
    vi.mocked(app.files.list).mockImplementation(
      () =>
        new Promise((resolve) => {
          listCalls += 1
          if (listCalls === 1) {
            releaseRefresh = resolve
            return
          }
          resolve([{ name: 'src', relativePath: 'src', kind: 'directory' }])
        }),
    )
    fireEvent.click(screen.getByTestId(TEST_ID.filesRefreshButton))
    await waitFor(() => expect(releaseStatus).toHaveLength(2))

    fireEvent.contextMenu(screen.getByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(await screen.findByTestId(TEST_ID.fileTreeTrash))
    await waitFor(() => expect(releaseStatus).toHaveLength(3))
    const stale = { 'README.md': 'modified' as const, src: 'modified' as const }
    releaseStatus[2]?.({ src: 'added' })
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.fileEntry('src')).getAttribute('data-git-status')).toBe(
        'added',
      ),
    )
    expect(screen.queryByTestId(testIdFor.fileEntry('README.md'))).toBeNull()

    releaseStatus[1]?.(stale)
    releaseRefresh(rootEntries)
    releaseStatus[0]?.(stale)
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.filesRefreshButton).getAttribute('aria-label')).toBe(
        'Refresh',
      ),
    )
    expect(screen.queryByTestId(testIdFor.fileEntry('README.md'))).toBeNull()
    expect(screen.getByTestId(testIdFor.fileEntry('src')).getAttribute('data-git-status')).toBe(
      'added',
    )
  })
})

describe('project files: Git status decoration (spec Behaviour 16-19, NEKODE-31)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('decorates entries from the status map and aggregates it onto folders', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    vi.mocked(app.git.fileStatuses).mockResolvedValue({
      'src/app.ts': 'modified',
      'src/nested': 'untracked',
      'README.md': 'ignored',
    })

    render(<App app={app} />)
    await enterFilesMode()

    // One read per mode entry, against the project id (Behaviour 19).
    await waitFor(() => expect(app.git.fileStatuses).toHaveBeenCalledWith('p1'))

    // A collapsed folder already shows the strongest status below it
    // (Behaviour 17): modified wins over the untracked directory inside.
    const srcRow = screen.getByTestId(testIdFor.fileEntry('src'))
    expect(srcRow.getAttribute('data-git-status')).toBe('modified')
    expect(srcRow.getAttribute('aria-expanded')).toBe('false')
    const srcBadge = within(srcRow).getByTestId(TEST_ID.fileTreeGitBadge)
    expect(srcBadge.textContent).toBe('M')
    // The status word joins the accessible name: never color alone.
    // (The letter-to-color mapping is owned by git-decoration.test.ts.)
    expect(srcRow.textContent).toContain('modified')

    // Ignored entry: its own letter.
    const readmeRow = screen.getByTestId(testIdFor.fileEntry('README.md'))
    expect(readmeRow.getAttribute('data-git-status')).toBe('ignored')
    const readmeBadge = within(readmeRow).getByTestId(TEST_ID.fileTreeGitBadge)
    expect(readmeBadge.textContent).toBe('I')

    // Expanding reveals the changed file and the untracked directory.
    fireEvent.click(srcRow)
    const appRow = await screen.findByTestId(testIdFor.fileEntry('src/app.ts'))
    expect(appRow.getAttribute('data-git-status')).toBe('modified')
    expect(within(appRow).getByTestId(TEST_ID.fileTreeGitBadge).textContent).toBe('M')
    const nestedRow = screen.getByTestId(testIdFor.fileEntry('src/nested'))
    expect(nestedRow.getAttribute('data-git-status')).toBe('untracked')
    const nestedBadge = within(nestedRow).getByTestId(TEST_ID.fileTreeGitBadge)
    expect(nestedBadge.textContent).toBe('U')
  })

  it('shows the A and C badges for a staged addition and a conflicted file', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.files.list).mockImplementation(async (projectId, relativePath) => {
      if (projectId !== 'p1') {
        return []
      }
      if (relativePath === null) {
        return [
          { name: 'src', relativePath: 'src', kind: 'directory' },
          { name: 'conflict.txt', relativePath: 'conflict.txt', kind: 'file' },
        ]
      }
      return relativePath === 'src'
        ? [{ name: 'new.ts', relativePath: 'src/new.ts', kind: 'file' }]
        : []
    })
    vi.mocked(app.git.fileStatuses).mockResolvedValue({
      'src/new.ts': 'added',
      'conflict.txt': 'conflict',
    })

    render(<App app={app} />)
    await enterFilesMode()
    await waitFor(() => expect(app.git.fileStatuses).toHaveBeenCalledWith('p1'))

    // The collapsed folder aggregates the staged addition (Behaviour 17).
    const srcRow = screen.getByTestId(testIdFor.fileEntry('src'))
    expect(srcRow.getAttribute('data-git-status')).toBe('added')
    const srcBadge = within(srcRow).getByTestId(TEST_ID.fileTreeGitBadge)
    expect(srcBadge.textContent).toBe('A')

    const conflictRow = screen.getByTestId(testIdFor.fileEntry('conflict.txt'))
    expect(conflictRow.getAttribute('data-git-status')).toBe('conflicted')
    const conflictBadge = within(conflictRow).getByTestId(TEST_ID.fileTreeGitBadge)
    expect(conflictBadge.textContent).toBe('C')
    expect(conflictRow.textContent).toContain('conflicted')

    fireEvent.click(srcRow)
    const newRow = await screen.findByTestId(testIdFor.fileEntry('src/new.ts'))
    expect(newRow.getAttribute('data-git-status')).toBe('added')
    expect(within(newRow).getByTestId(TEST_ID.fileTreeGitBadge).textContent).toBe('A')
  })

  it.each([
    ['renders the undecorated tree and no error when the status read rejects', 'reject'],
    ['renders the plain tree with no badge when the read yields no statuses', 'empty'],
  ] as Array<[string, 'reject' | 'empty']>)('%s', async (_title, cause) => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    if (cause === 'reject') {
      vi.mocked(app.git.fileStatuses).mockRejectedValue(new Error('ipc-error: invalid argument'))
    } else {
      vi.mocked(app.git.fileStatuses).mockResolvedValue({})
    }

    render(<App app={app} />)
    await enterFilesMode()
    await waitFor(() => expect(app.git.fileStatuses).toHaveBeenCalledWith('p1'))

    // Behaviour 19 / Errors: a failed or empty read leaves every entry
    // undecorated with no badge.
    for (const path of ['src', 'README.md']) {
      const row = screen.getByTestId(testIdFor.fileEntry(path))
      expect(row.getAttribute('data-git-status')).toBeNull()
      expect(within(row).queryByTestId(TEST_ID.fileTreeGitBadge)).toBeNull()
    }
    if (cause === 'reject') {
      // A failed read never surfaces an error banner or notice.
      expect(screen.queryByTestId(TEST_ID.fileTreeError)).toBeNull()
      expect(screen.queryByTestId(TEST_ID.actionNotice)).toBeNull()
    } else {
      expect(
        within(screen.getByTestId(testIdFor.fileEntry('README.md'))).getByText('README.md')
          .className,
      ).not.toContain('text-')
    }
  })
})
