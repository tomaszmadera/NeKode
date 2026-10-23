import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppApi, ChatInfo, FileEntry, ProjectInfo } from '../../../../shared/ipc-contract'
import { APP_STATE_KEY, projectKanbanAdapterKey } from '../../../../shared/ipc-contract'
import { App } from '../../App'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { createAppApiStub } from '../../test/app-api-stub'
import { resetMockFitAddons } from '../../test/fit-addon-mock'
import { resetMockTerminals } from '../../test/xterm-mock'

// Tab strip + file tabs + status-bar wiring (center-layout-tabs-actions spec
// Behaviour 1–8, AC1–AC4): tab order and switching, file tab open/focus/close
// with the previously-active fallback, per-project tab retention across
// project switches (per-session UI state), the `+ New chat` passthrough and
// terminal-session survival across tab switches (hidden views).
//
// xterm.js is mocked at the module boundary (jsdom has no canvas) and the
// Monaco preview wrapper is mocked so the tests assert the data handed to
// the read-only editor, not monaco internals.

vi.mock('@xterm/xterm', () => import('../../test/xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('../../test/fit-addon-mock'))
vi.mock('../files/MonacoPreview', () => ({
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
const _chatTwo: ChatInfo = { id: 't2', projectId: 'p1', name: 'Second chat' }
const chatOther: ChatInfo = { id: 't8', projectId: 'p2', name: 'Other chat' }

const rootEntries: FileEntry[] = [
  { name: 'src', relativePath: 'src', kind: 'directory' },
  { name: 'README.md', relativePath: 'README.md', kind: 'file' },
  { name: 'notes.txt', relativePath: 'notes.txt', kind: 'file' },
]
const srcEntries: FileEntry[] = [
  { name: 'nested', relativePath: 'src/nested', kind: 'directory' },
  { name: 'app.ts', relativePath: 'src/app.ts', kind: 'file' },
]
const otherRootEntries: FileEntry[] = [
  { name: 'docs', relativePath: 'docs', kind: 'directory' },
  { name: 'other.md', relativePath: 'other.md', kind: 'file' },
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

function tabIds(): string[] {
  return screen
    .queryAllByTestId(/^tab-file-/)
    .map((element) => element.getAttribute('data-testid') ?? '')
}

function isTabSelected(relativePath: string): boolean {
  return (
    screen.getByTestId(testIdFor.tabFile(relativePath)).getAttribute('data-selected') === 'true'
  )
}

function paneDisplay(relativePath: string): string {
  return screen.getByTestId(testIdFor.filePreviewPane(relativePath)).style.display
}

async function enterFilesMode(app: AppApi, projectId: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(testIdFor.projectFiles(projectId)))
  await screen.findByTestId(TEST_ID.fileTree)
  expect(app.files.list).toHaveBeenCalled()
}

describe('tab strip — order and labels (spec Behaviour 1–3, AC1)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('terminal-chat tab first (chat name), file tabs in open order, + New chat at the right end', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))

    const strip = screen.getByTestId(TEST_ID.tabStrip)
    const terminalTab = screen.getByTestId(TEST_ID.tabTerminal)
    expect(terminalTab.textContent).toBe('First chat')
    expect(terminalTab.getAttribute('data-selected')).toBe('true')
    // Unbound project: a plain project-name label leads the strip, then the first tab.
    const nameLabel = screen.getByTestId(TEST_ID.tabProjectName)
    expect(nameLabel.textContent).toBe('DEMO')
    expect(nameLabel.tagName).toBe('SPAN')
    expect(strip.firstElementChild).toBe(nameLabel)
    expect(nameLabel.nextElementSibling).toBe(terminalTab)

    await enterFilesMode(app, 'p1')
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('notes.txt')))
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))

    // File tabs follow the terminal-chat tab in open order (AC1).
    expect(tabIds()).toEqual(['tab-file-README.md', 'tab-file-notes.txt', 'tab-file-src/app.ts'])
    // Labels = file names; tooltips = the path relative to the project root.
    const appTab = screen.getByTestId(testIdFor.tabFile('src/app.ts'))
    expect(within(appTab).getByText('app.ts')).toBeTruthy()
    expect(appTab.getAttribute('title')).toBe('src / app.ts')
    // The terminal-chat tab is never closable; file tabs carry a close control.
    expect(within(terminalTab).queryByRole('button', { name: /Close/ })).toBeNull()
    expect(screen.getByTestId(testIdFor.tabFileClose('README.md'))).toBeTruthy()
    // Project Settings sits at the right end of the strip.
    expect(strip.lastElementChild?.getAttribute('data-testid')).toBe(TEST_ID.tabProjectSettings)
    // No breadcrumb and no "Files" view label are rendered (tab model).
    expect(screen.queryByText('Select a file to preview')).toBeNull()
    expect(screen.queryByTestId(TEST_ID.actionRowSlot)).toBeTruthy()
  })

  it('clicking a file opens its tab; clicking again focuses it without duplicates or reordering', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)

    render(<App app={app} />)
    await enterFilesMode(app, 'p1')
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('notes.txt')))
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))

    // Focus an earlier tab via its tree entry: one tab, order preserved.
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('README.md')))
    expect(tabIds()).toEqual(['tab-file-README.md', 'tab-file-notes.txt', 'tab-file-src/app.ts'])
    expect(isTabSelected('README.md')).toBe(true)
    expect(isTabSelected('src/app.ts')).toBe(false)
    // The focused tab drives the main surface (read-only preview).
    await waitFor(() => expect(paneDisplay('README.md')).toBe('flex'))
    expect(paneDisplay('src/app.ts')).toBe('none')
  })
})

describe('tab strip — closing (spec Behaviour 4, AC4)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('closing the active tab selects the previously active tab; the last close falls back to the terminal tab', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await enterFilesMode(app, 'p1')
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('notes.txt')))

    // Active = notes.txt, previously active = README.md.
    fireEvent.click(screen.getByTestId(testIdFor.tabFileClose('notes.txt')))
    expect(tabIds()).toEqual(['tab-file-README.md'])
    expect(isTabSelected('README.md')).toBe(true)

    // No file tab left: the terminal-chat tab is selected (fallback).
    fireEvent.click(screen.getByTestId(testIdFor.tabFileClose('README.md')))
    expect(tabIds()).toEqual([])
    expect(screen.getByTestId(TEST_ID.tabTerminal).getAttribute('data-selected')).toBe('true')
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('flex'),
    )
  })

  it('closing a non-active tab keeps the selection and never closes with confirmation', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)

    render(<App app={app} />)
    await enterFilesMode(app, 'p1')
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('notes.txt')))
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))

    // Active = src/app.ts; closing notes.txt (inactive) keeps it active and
    // keeps open order of the surviving tabs (no dialog, no prompt).
    fireEvent.click(screen.getByTestId(testIdFor.tabFileClose('notes.txt')))
    expect(tabIds()).toEqual(['tab-file-README.md', 'tab-file-src/app.ts'])
    expect(isTabSelected('src/app.ts')).toBe(true)
    await waitFor(() => expect(paneDisplay('src/app.ts')).toBe('flex'))
  })
})

describe('tab strip — file-tab context menu and middle click (spec Behaviour 20–21)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  /** jsdom has no clipboard: stub writeText and return the spy. */
  function stubClipboard(): { writeText: ReturnType<typeof vi.fn> } {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText: vi.fn(() => Promise.resolve('')) },
    })
    return { writeText }
  }

  /** Middle click = auxclick with button 1 (bubbles to React's root). */
  function middleClick(element: Element): void {
    fireEvent(element, new MouseEvent('auxclick', { button: 1, bubbles: true }))
  }

  async function openTwoTabs(): Promise<void> {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)
    render(<App app={app} />)
    await enterFilesMode(app, 'p1')
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('notes.txt')))
  }

  it('right click opens the context menu; Copy Relative Path copies and closes it', async () => {
    const clipboard = stubClipboard()
    await openTwoTabs()
    fireEvent.contextMenu(screen.getByTestId(testIdFor.tabFile('notes.txt')))
    expect(screen.getByTestId(TEST_ID.tabContextMenu)).toBeTruthy()
    // The right click never changes the selection (active stays notes.txt).
    expect(isTabSelected('notes.txt')).toBe(true)
    expect(isTabSelected('README.md')).toBe(false)
    fireEvent.click(screen.getByTestId(TEST_ID.tabContextCopyRelative))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('notes.txt'))
    expect(screen.queryByTestId(TEST_ID.tabContextMenu)).toBeNull()
    // The tab itself is untouched by the copy.
    expect(tabIds()).toEqual(['tab-file-README.md', 'tab-file-notes.txt'])
  })

  it('Copy Absolute Path copies the project root joined with the relative path', async () => {
    const clipboard = stubClipboard()
    await openTwoTabs()
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))
    fireEvent.contextMenu(screen.getByTestId(testIdFor.tabFile('src/app.ts')))
    fireEvent.click(await screen.findByTestId(TEST_ID.tabContextCopyAbsolute))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('D:/code/demo/src/app.ts'))
    expect(screen.queryByTestId(TEST_ID.tabContextMenu)).toBeNull()
  })

  it('Escape dismisses the menu without closing; the Close Tab item runs the close flow', async () => {
    await openTwoTabs()
    fireEvent.contextMenu(screen.getByTestId(testIdFor.tabFile('notes.txt')))
    await screen.findByTestId(TEST_ID.tabContextMenu)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId(TEST_ID.tabContextMenu)).toBeNull()
    expect(tabIds()).toEqual(['tab-file-README.md', 'tab-file-notes.txt'])
    // Reopen: Close Tab closes the active tab with the Behaviour 4 fallback.
    fireEvent.contextMenu(screen.getByTestId(testIdFor.tabFile('notes.txt')))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Close Tab' }))
    expect(tabIds()).toEqual(['tab-file-README.md'])
    expect(isTabSelected('README.md')).toBe(true)
  })

  it('clamps context menu coordinates when opened near viewport edges', async () => {
    await openTwoTabs()
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })

      fireEvent.contextMenu(screen.getByTestId(testIdFor.tabFile('notes.txt')), {
        clientX: 790,
        clientY: 590,
      })
      const menu = await screen.findByTestId(TEST_ID.tabContextMenu)
      // Clamped against 800 - 200 - 8 = 592, 600 - 120 - 8 = 472
      expect(Number.parseInt(menu.style.left, 10)).toBeLessThanOrEqual(592)
      expect(Number.parseInt(menu.style.top, 10)).toBeLessThanOrEqual(472)
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      })
    }
  })

  it('middle click closes the tab without changing the selection', async () => {
    await openTwoTabs()
    // Active = notes.txt; middle click closes the inactive README.md.
    middleClick(screen.getByTestId(testIdFor.tabFile('README.md')))
    expect(tabIds()).toEqual(['tab-file-notes.txt'])
    expect(isTabSelected('notes.txt')).toBe(true)
    // The last file tab: the close falls back to the terminal-chat tab.
    middleClick(screen.getByTestId(testIdFor.tabFile('notes.txt')))
    expect(tabIds()).toEqual([])
    expect(screen.getByTestId(TEST_ID.tabTerminal).getAttribute('data-selected')).toBe('true')
  })

  it('middle click on the close control never closes; left click still closes', async () => {
    await openTwoTabs()
    middleClick(screen.getByTestId(testIdFor.tabFileClose('notes.txt')))
    expect(tabIds()).toEqual(['tab-file-README.md', 'tab-file-notes.txt'])
    fireEvent.click(screen.getByTestId(testIdFor.tabFileClose('notes.txt')))
    expect(tabIds()).toEqual(['tab-file-README.md'])
  })
})

describe('tab strip — per-project retention (spec Behaviour 5, AC4)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('each project keeps its own tabs, order and active tab across project switches', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)
    vi.mocked(app.files.read).mockImplementation(async (projectId, relativePath) => ({
      kind: 'text' as const,
      content: `${projectId}:${relativePath}`,
      language: null,
    }))

    render(<App app={app} />)
    await enterFilesMode(app, 'p1')
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('src/app.ts')))
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('README.md')))
    await screen.findByTestId(testIdFor.filePreviewPane('README.md'))

    // A second project opens its own tab set (its own Files mode round-trip).
    fireEvent.click(screen.getByTestId(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    await enterFilesMode(app, 'p2')
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('other.md')))
    await screen.findByTestId(testIdFor.filePreviewPane('other.md'))
    expect(tabIds()).toEqual(['tab-file-other.md'])

    // Back to the first project: its own tabs, order and active tab return.
    fireEvent.click(screen.getByTestId(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    expect(tabIds()).toEqual(['tab-file-src/app.ts', 'tab-file-README.md'])
    expect(isTabSelected('README.md')).toBe(true)
    await waitFor(() => expect(paneDisplay('README.md')).toBe('flex'))
    expect(screen.getByTestId(testIdFor.filePreviewPane('README.md')).textContent).toBe(
      'p1:README.md',
    )
    // The other project's tab is not part of this strip.
    expect(screen.queryByTestId(testIdFor.tabFile('other.md'))).toBeNull()
  })

  it('tabs are per-session UI state: nothing is persisted to the app state store', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await enterFilesMode(app, 'p1')
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    await screen.findByTestId(testIdFor.filePreviewPane('README.md'))
    // Selection keys are persisted; open tabs never are (Non-goals) — neither
    // under a tabs-prefixed key nor smuggled as a call VALUE under an
    // unrelated key (that regression shape must not survive this fixture).
    await waitFor(() => expect(app.state.set).toHaveBeenCalled())
    const writes = vi
      .mocked(app.state.set)
      .mock.calls.map((call) => [String(call[0]), String(call[1])] as const)
    expect(writes.map(([key]) => key)).toContain(APP_STATE_KEY.selectedProjectId)
    for (const [key, value] of writes) {
      expect(key.startsWith('tabs')).toBe(false)
      expect(key).not.toContain('README.md')
      expect(value).not.toContain('README.md')
    }
  })
})

describe('tab strip — terminal tab, + New chat and session survival (spec Behaviour 2, 6, 8)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('Project Settings button in the tab strip opens the settings dialog', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))

    fireEvent.click(screen.getByTestId(TEST_ID.tabProjectSettings))
    expect(await screen.findByRole('dialog', { name: 'Project Settings' })).toBeTruthy()
  })

  it('terminal sessions survive file-tab round-trips (hidden views, no respawn)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
    const workspace = screen.getByTestId(TEST_ID.chatWorkspace)

    // A file tab hides the chat surface but keeps the session host mounted.
    await enterFilesMode(app, 'p1')
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('none'),
    )
    expect(screen.getByTestId(TEST_ID.chatWorkspace)).toBe(workspace)
    expect(app.terminals.create).toHaveBeenCalledTimes(1)

    // Back to the terminal-chat tab: same session, same scrollback (AC2).
    fireEvent.click(screen.getByTestId(TEST_ID.tabTerminal))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('flex'),
    )
    expect(screen.getByTestId(TEST_ID.chatWorkspace)).toBe(workspace)
    expect(app.terminals.create).toHaveBeenCalledTimes(1)
  })

  it('entering and leaving Project Files keeps the tab strip and the active tab unchanged (AC11)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))

    await enterFilesMode(app, 'p1')
    expect(screen.getByTestId(TEST_ID.tabStrip)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.tabTerminal).getAttribute('data-selected')).toBe('true')

    fireEvent.click(screen.getByTestId(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    expect(screen.getByTestId(TEST_ID.tabStrip)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.tabTerminal).getAttribute('data-selected')).toBe('true')
  })
})

describe('Files mode in left panel acts as an independent sidebar', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('Files mode of an unselected project row keeps the active project and chat in the center surface', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockImplementation(async (projectId) =>
      projectId === 'p1' ? [chatOne] : [],
    )
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('First chat')

    // Files action on the unselected project row:
    // the left panel shows p2's tree, while the center surface stays on p1's chat.
    await enterFilesMode(app, 'p2')

    // The center surface remains on p1's active chat with its live terminal.
    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('First chat')
    expect(screen.getByTestId(testIdFor.terminalView('t1')).style.display).toBe('block')
    expect(screen.queryByTestId(TEST_ID.startNewChatState)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
    // Status bar remains on p1.
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Demo')
    expect(screen.getByTestId(TEST_ID.statusProjectPath).textContent).toBe('D:/code/demo')

    // Leaving Files mode: file tree closes, p1 remains active as before.
    fireEvent.click(screen.getByTestId(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('First chat')
    expect(screen.getByTestId(testIdFor.terminalView('t1')).style.display).toBe('block')
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Demo')
    expect(app.terminals.create).toHaveBeenCalledTimes(1)
  })

  it('opening a file from the unselected project tree activates that project and shows its preview', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockImplementation(async (projectId) =>
      projectId === 'p1' ? [chatOne] : [],
    )
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await enterFilesMode(app, 'p2')

    // Center surface is still on p1.
    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('First chat')
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Demo')

    // Selecting a file from p2's tree activates p2 and opens its tab in the center.
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('other.md')))
    await screen.findByTestId(testIdFor.filePreviewPane('other.md'))
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Other')
  })

  it('the normal case is unchanged: Files mode of the selected project keeps its active chat', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
    await enterFilesMode(app, 'p1')

    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('First chat')
    expect(screen.getByTestId(TEST_ID.tabTerminal).getAttribute('data-selected')).toBe('true')
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.terminalView('t1')).style.display).toBe('block'),
    )
    expect(screen.queryByTestId(TEST_ID.startNewChatState)).toBeNull()
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Demo')
  })
})

describe('Kanban board vs the Files surfaces (spec kanban-adapter-interface Behaviour 14)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
    // The tab-strip project is bound to a Kanban adapter so its tab exists.
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === projectKanbanAdapterKey('p1') ? 'plane' : null,
    )
  })
  afterEach(() => {
    cleanup()
  })

  // Regression: the board is a tab in the strip, not a center-surface view
  // switch. Selecting a file or chat tab must return to that surface, and the
  // Kanban tab must show the board meanwhile.

  it.each([
    [
      'selecting a file tab while the board is up returns to its preview',
      async () => {
        vi.mocked(app.projects.list).mockResolvedValue([projectA])
        vi.mocked(app.chats.list).mockResolvedValue([chatOne])
        mockListings(app)

        render(<App app={app} />)
        fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
        fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
        await enterFilesMode(app, 'p1')
        fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
        fireEvent.click(screen.getByTestId(testIdFor.fileEntry('notes.txt')))
        await waitFor(() => expect(paneDisplay('notes.txt')).toBe('flex'))

        // Board up: the active file tab's preview is hidden. The Kanban tab sits
        // first, before the chat and file tabs.
        fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
        await screen.findByTestId(TEST_ID.kanbanBoard)
        expect(paneDisplay('notes.txt')).toBe('none')
        const strip = screen.getByTestId(TEST_ID.tabStrip)
        expect(strip.firstElementChild).toBe(screen.getByTestId(TEST_ID.kanbanTab))
        expect(screen.getByTestId(TEST_ID.kanbanTab).nextElementSibling).toBe(
          screen.getByTestId(TEST_ID.tabTerminal),
        )
        expect(screen.getByTestId(TEST_ID.tabTerminal).nextElementSibling).toBe(
          screen.getByTestId(testIdFor.tabFile('README.md')),
        )
      },
      async () => {
        // Clicking the file tab is a "show me this file" gesture: the preview
        // returns, never a hidden strip change. The file tab's testid is the
        // container; the select control is its inner button.
        const readmeTab = screen.getByTestId(testIdFor.tabFile('README.md'))
        fireEvent.click(within(readmeTab).getByRole('button', { name: 'README.md' }))
      },
      async () => {
        expect(isTabSelected('README.md')).toBe(true)
        await waitFor(() => expect(paneDisplay('README.md')).toBe('flex'))
      },
    ],
    [
      'the chat tab selected while the board is up returns to the terminal',
      async () => {
        vi.mocked(app.projects.list).mockResolvedValue([projectA])
        vi.mocked(app.chats.list).mockResolvedValue([chatOne])
        mockListings(app)

        render(<App app={app} />)
        fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
        fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
        await enterFilesMode(app, 'p1')
        await waitFor(() =>
          expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('flex'),
        )

        fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
        await screen.findByTestId(TEST_ID.kanbanBoard)
        expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('none')
      },
      async () => {
        fireEvent.click(screen.getByTestId(TEST_ID.tabTerminal))
      },
      async () => {
        await waitFor(() =>
          expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('flex'),
        )
      },
    ],
    [
      'selecting a chat row while the board is up shows its terminal',
      async () => {
        vi.mocked(app.projects.list).mockResolvedValue([projectA])
        vi.mocked(app.chats.list).mockResolvedValue([chatOne])

        render(<App app={app} />)
        fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
        fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
        await screen.findByTestId(TEST_ID.kanbanBoard)
      },
      async () => {
        // A chat row (left navigation) must make its terminal show.
        fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
      },
      async () => {
        await waitFor(() =>
          expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('flex'),
        )
        await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
      },
    ],
    [
      'opening a file from the tree while the board is up shows the preview',
      async () => {
        vi.mocked(app.projects.list).mockResolvedValue([projectA])
        mockListings(app)

        render(<App app={app} />)
        await enterFilesMode(app, 'p1')
        fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
        await waitFor(() => expect(paneDisplay('README.md')).toBe('flex'))

        fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
        await screen.findByTestId(TEST_ID.kanbanBoard)
        expect(paneDisplay('README.md')).toBe('none')
      },
      async () => {
        // A tree click while the board is up opens a fresh preview and returns
        // to its surface, never a hidden strip change.
        fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('notes.txt')))
      },
      async () => {
        await waitFor(() => expect(paneDisplay('notes.txt')).toBe('flex'))
      },
    ],
    [
      'the Files affordance stays a Files gesture while the board is up',
      async () => {
        vi.mocked(app.projects.list).mockResolvedValue([projectA])
        vi.mocked(app.chats.list).mockResolvedValue([chatOne])
        mockListings(app)

        render(<App app={app} />)
        fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
        fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
        await screen.findByTestId(TEST_ID.kanbanBoard)
      },
      async () => {
        // Entering Project Files shows the tree; opening a file from it returns
        // to that file's preview (the board never stays over a Files gesture).
        fireEvent.click(await screen.findByTestId(testIdFor.projectFiles('p1')))
        await screen.findByTestId(TEST_ID.fileTree)
        fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
      },
      async () => {
        await waitFor(() => expect(paneDisplay('README.md')).toBe('flex'))
      },
    ],
  ] as Array<[string, () => Promise<void>, () => Promise<void>, () => Promise<void>]>)(
    '%s',
    async (_title, setup, gesture, outcome) => {
      await setup()
      await gesture()
      await outcome()
      // The shared wiring rule: the gesture's own surface shows and the board
      // is hidden behind its tab, never left over the surface.
      expect(screen.getByTestId(TEST_ID.kanbanBoard).parentElement?.style.display).toBe('none')
    },
  )
})
