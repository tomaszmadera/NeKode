import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppApi, ChatInfo, FileEntry, ProjectInfo } from '../../../../shared/ipc-contract'
import { APP_STATE_KEY, emptyGitWorktree } from '../../../../shared/ipc-contract'
import { App } from '../../App'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
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
const chatTwo: ChatInfo = { id: 't2', projectId: 'p1', name: 'Second chat' }
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
    expect(strip.firstElementChild).toBe(terminalTab)

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
    // `+ New chat` sits at the right end of the strip (Behaviour 8).
    expect(strip.lastElementChild?.getAttribute('data-testid')).toBe(TEST_ID.tabNewChat)
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

  it('`+ New chat` runs the existing new-chat flow and shows the new chat terminal', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.chats.create).mockResolvedValue(chatTwo)
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))

    fireEvent.click(screen.getByTestId(TEST_ID.tabNewChat))
    await waitFor(() => expect(app.chats.create).toHaveBeenCalledWith('p1'))
    // The created chat is selected and its terminal shows in the terminal tab.
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('Second chat'),
    )
    expect(screen.getByTestId(TEST_ID.tabTerminal).getAttribute('data-selected')).toBe('true')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t2', 'D:/code/demo'))
  })

  it('`+ New chat` with no active project is noticed instead of a silent no-op (Behaviour 8)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectRow('p1'))
    // The control is always present, but the new-chat flow cannot run without
    // an active project: the dead click surfaces a notice, never nothing.
    fireEvent.click(screen.getByTestId(TEST_ID.tabNewChat))
    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('Select or add a project')
    expect(app.chats.create).not.toHaveBeenCalled()
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
    expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('flex')

    fireEvent.click(screen.getByTestId(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    expect(screen.getByTestId(TEST_ID.tabTerminal).getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('flex')
    expect(app.terminals.create).toHaveBeenCalledTimes(1)
  })

  it('a file deleted with its tab open errors in that tab only (Behaviour 7)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    mockListings(app)
    vi.mocked(app.files.read).mockImplementation(async (_projectId, relativePath) => {
      if (relativePath === 'README.md') {
        throw { nekodeAppError: true, code: 'not_found', message: 'File not found.' }
      }
      return { kind: 'text' as const, content: 'still here', language: null }
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await enterFilesMode(app, 'p1')
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    fireEvent.click(screen.getByTestId(testIdFor.fileEntry('notes.txt')))

    const failingPane = await screen.findByTestId(testIdFor.filePreviewPane('README.md'))
    await waitFor(() =>
      expect(within(failingPane).getByTestId(TEST_ID.filePreviewError).textContent).toContain(
        'File not found.',
      ),
    )
    // The other tab and the terminal are untouched.
    const otherPane = screen.getByTestId(testIdFor.filePreviewPane('notes.txt'))
    expect(otherPane.textContent).toContain('still here')
    expect(within(otherPane).queryByTestId(TEST_ID.filePreviewError)).toBeNull()
    expect(screen.getByTestId(testIdFor.tabFile('notes.txt'))).toBeTruthy()
  })
})

describe('terminal tab and surface pin to the tab-strip project (Files-mode divergence)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  it('Files mode of an unselected project row shows the Behaviour 2 empty state, not the other project terminal', async () => {
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

    // Files action on the unselected project row (Behaviour 19 unchanged):
    // the strip becomes p2's while the chat selection stays on p1's chat.
    await enterFilesMode(app, 'p2')

    // The terminal-chat tab never labels itself with the other project's chat.
    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('Chat')
    // The terminal surface is the Behaviour 2 empty state (Start new chat);
    // the other project's terminal is hidden, never shown here.
    expect(await screen.findByTestId(TEST_ID.startNewChatState)).toBeTruthy()
    expect(screen.getByTestId(testIdFor.terminalView('t1')).style.display).toBe('none')
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
    // AC9: the status bar context is the tab-strip project.
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Other')
    expect(screen.getByTestId(TEST_ID.statusProjectPath).textContent).toBe('D:/code/other')

    // Leaving Files mode dissolves the divergence: the active chat terminal
    // returns with its live session (no respawn), exactly as before.
    fireEvent.click(screen.getByTestId(TEST_ID.filesBackButton))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.fileTree)).toBeNull())
    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('First chat')
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.terminalView('t1')).style.display).toBe('block'),
    )
    expect(screen.queryByTestId(TEST_ID.startNewChatState)).toBeNull()
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Demo')
    expect(app.terminals.create).toHaveBeenCalledTimes(1)
  })

  it('Start new chat in the divergence creates in the tab-strip project and dissolves it', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockImplementation(async (projectId) =>
      projectId === 'p1' ? [chatOne] : [],
    )
    vi.mocked(app.chats.create).mockResolvedValue({ id: 't9', projectId: 'p2', name: 'PowerShell' })
    mockListings(app)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await enterFilesMode(app, 'p2')
    fireEvent.click(await screen.findByTestId(TEST_ID.startNewChatButton))

    // The chat is created in the tab-strip project — never in the selected one.
    await waitFor(() => expect(app.chats.create).toHaveBeenCalledWith('p2'))
    expect(app.chats.create).not.toHaveBeenCalledWith('p1')
    // The created chat becomes the tab-strip project's active chat: the split
    // is gone and its terminal shows (Behaviour 8 new-chat flow unchanged).
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('PowerShell'),
    )
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t9', 'D:/code/other'))
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Other')
  })

  it('the divergence empty state shows even when the tab-strip project has chats of its own', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockImplementation(async (projectId) =>
      projectId === 'p1' ? [chatOne] : [chatOther],
    )
    mockListings(app)

    render(<App app={app} />)
    // p2's chat list is loaded before the split (its node is expanded once).
    fireEvent.click(await screen.findByTestId(testIdFor.projectToggle('p2')))
    await screen.findByTestId(testIdFor.chatRow('t8'))
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await enterFilesMode(app, 'p2')

    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('Chat')
    expect(await screen.findByTestId(TEST_ID.startNewChatState)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
    // p2's own chat never steals the surface without a selection of its own.
    expect(screen.queryByTestId(testIdFor.terminalView('t8'))).toBeNull()
    expect(app.terminals.create).toHaveBeenCalledTimes(1)
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
