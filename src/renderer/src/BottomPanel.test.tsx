import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatInfo, ProjectInfo } from '../../shared/ipc-contract'
import { APP_STATE_KEY, type AppApi, emptyGitWorktree } from '../../shared/ipc-contract'
import { App, TEST_ID, testIdFor } from './App'
import { resetMockFitAddons } from './test/fit-addon-mock'
import { mockTerminalInstances, resetMockTerminals } from './test/xterm-mock'

vi.mock('@xterm/xterm', () => import('./test/xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('./test/fit-addon-mock'))
vi.mock('./components/files/MonacoPreview', () => ({
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
  name: 'Plain',
  path: 'D:/code/plain',
  runtimeLabel: null,
}
const chatOne: ChatInfo = { id: 't1', projectId: 'p1', name: 'First chat' }

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
      create: vi.fn(),
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

function pressChord(init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, {
    code: 'Backquote',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  })
}

function bottomRegion(): HTMLElement {
  return screen.getByTestId(TEST_ID.bottomRegion)
}

describe('bottom auxiliary terminal panel', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })

  afterEach(() => {
    cleanup()
  })

  async function renderSelectedProject(): Promise<void> {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockImplementation(async (projectId) =>
      projectId === 'p1' ? [chatOne] : [],
    )
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't1'
      return null
    })
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
  }

  it('toggles on Ctrl+Backquote without writing the chord, and ignores Shift and an open modal', async () => {
    await renderSelectedProject()
    expect(bottomRegion().style.display).toBe('none')

    pressChord()
    await waitFor(() => expect(bottomRegion().style.display).not.toBe('none'))
    expect(app.terminals.write).not.toHaveBeenCalled()
    expect(app.chats.create).not.toHaveBeenCalled()

    const terminal = mockTerminalInstances[0]
    expect(terminal).toBeDefined()
    const swallowed = terminal?.keyHandler?.(
      new KeyboardEvent('keydown', {
        code: 'Backquote',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(swallowed).toBe(false)
    expect(app.terminals.write).not.toHaveBeenCalled()

    pressChord()
    expect(bottomRegion().style.display).toBe('none')

    pressChord({ shiftKey: true })
    expect(bottomRegion().style.display).toBe('none')
    pressChord({ altKey: true })
    expect(bottomRegion().style.display).toBe('none')

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    pressChord()
    expect(bottomRegion().style.display).toBe('none')
  })

  it('starts hidden, restores only an open flag of 1, and clamps the height', async () => {
    const store = new Map<string, string>([
      [APP_STATE_KEY.bottomRegionOpen, 'yes'],
      [APP_STATE_KEY.bottomRegionHeight, '9999'],
    ])
    vi.mocked(app.state.get).mockImplementation(async (key) => store.get(key) ?? null)
    const view = render(<App app={app} />)
    await waitFor(() => expect(app.state.get).toHaveBeenCalledWith(APP_STATE_KEY.bottomRegionOpen))
    expect(bottomRegion().style.display).toBe('none')
    expect(bottomRegion().style.height).toBe('560px')

    store.set(APP_STATE_KEY.bottomRegionOpen, '0')
    store.set(APP_STATE_KEY.bottomRegionHeight, '10')
    view.unmount()
    render(<App app={app} />)
    await waitFor(() => expect(bottomRegion().style.height).toBe('160px'))
    expect(bottomRegion().style.display).toBe('none')

    store.set(APP_STATE_KEY.bottomRegionOpen, '1')
    store.set(APP_STATE_KEY.bottomRegionHeight, '300')
    cleanup()
    render(<App app={app} />)
    await waitFor(() => expect(bottomRegion().style.display).not.toBe('none'))
    expect(bottomRegion().style.height).toBe('300px')
    expect(screen.getByTestId(TEST_ID.bottomEmpty)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'PowerShell' })).toBeNull()
  })

  it('keeps the panel above the status bar and full width of the shell', async () => {
    render(<App app={app} />)
    await waitFor(() => expect(app.projects.list).toHaveBeenCalled())
    const shell = screen.getByTestId(TEST_ID.appShell)
    const bottom = bottomRegion()
    const status = screen.getByTestId(TEST_ID.statusBar)
    expect(bottom.parentElement).toBe(shell)
    expect(bottom.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('focuses the bottom terminal on open and restores the previous focus on hide', async () => {
    await renderSelectedProject()
    const addProject = screen.getByTestId(TEST_ID.addProjectButton)
    addProject.focus()
    pressChord()
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('data-testid') ?? '').toMatch(
        /^terminal-canvas-bottom:/,
      )
    })
    const disposed = mockTerminalInstances.filter((terminal) => terminal.disposed)
    expect(disposed).toEqual([])
    pressChord()
    await waitFor(() => expect(document.activeElement).toBe(addProject))
    expect(bottomRegion().style.display).toBe('none')
    expect(mockTerminalInstances.every((terminal) => !terminal.disposed)).toBe(true)
    expect(app.terminals.create).toHaveBeenCalledTimes(2)
    pressChord()
    await waitFor(() => expect(bottomRegion().style.display).not.toBe('none'))
    expect(app.terminals.create).toHaveBeenCalledTimes(2)
  })

  it('focuses the center surface when the previous focus element is gone', async () => {
    await renderSelectedProject()
    const orphan = document.createElement('button')
    document.body.appendChild(orphan)
    orphan.focus()
    pressChord()
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('data-testid') ?? '').toMatch(
        /^terminal-canvas-bottom:/,
      )
    })
    orphan.remove()
    pressChord()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId(TEST_ID.centerSurface)),
    )
  })

  it('focuses the center surface when the saved focus is a chat terminal hidden by a file tab', async () => {
    await renderSelectedProject()
    const canvas = screen.getByTestId('terminal-canvas-t1')
    canvas.focus()
    expect(document.activeElement).toBe(canvas)

    pressChord()
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('data-testid') ?? '').toMatch(
        /^terminal-canvas-bottom:/,
      )
    })

    vi.mocked(app.files.list).mockResolvedValue([
      { name: 'README.md', relativePath: 'README.md', kind: 'file' },
    ])
    vi.mocked(app.files.read).mockResolvedValue({
      kind: 'text',
      content: '# Demo',
      language: 'markdown',
    })
    fireEvent.click(screen.getByTestId(testIdFor.projectFiles('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.fileEntry('README.md')))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('none'),
    )
    // The selected chat terminal stays mounted and display:block; the host
    // above it is display:none. isConnected stays true.
    expect(canvas.isConnected).toBe(true)
    expect(canvas.style.display).not.toBe('none')

    const creates = vi.mocked(app.terminals.create).mock.calls.length
    pressChord()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId(TEST_ID.centerSurface)),
    )
    expect(bottomRegion().style.display).toBe('none')
    expect(app.terminals.terminate).not.toHaveBeenCalled()
    expect(vi.mocked(app.terminals.create).mock.calls.length).toBe(creates)
    expect(mockTerminalInstances.every((terminal) => !terminal.disposed)).toBe(true)
  })

  it('creates, switches, and closes tabs without listing them as chats', async () => {
    await renderSelectedProject()
    pressChord()
    const first = await screen.findByRole('button', { name: 'PowerShell' })
    expect(first.getAttribute('data-selected')).toBe('true')
    expect(app.chats.create).not.toHaveBeenCalled()
    expect(screen.queryByTestId(/^chat-row-bottom:/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'PowerShell' })).toHaveLength(3),
    )
    const ids = bottomTabIds()
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    for (const id of ids) {
      expect(id.startsWith('bottom:p1:')).toBe(true)
      expect(screen.queryByTestId(testIdFor.chatRow(id))).toBeNull()
    }

    fireEvent.click(labelButton(ids[1] ?? ''))
    expect(
      screen.getByTestId(testIdFor.bottomTab(ids[1] ?? '')).getAttribute('data-selected'),
    ).toBe('true')
    fireEvent.click(screen.getByTestId(testIdFor.bottomTabClose(ids[1] ?? '')))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.bottomTab(ids[1] ?? ''))).toBeNull())
    expect(
      screen.getByTestId(testIdFor.bottomTab(ids[2] ?? '')).getAttribute('data-selected'),
    ).toBe('true')
    expect(screen.getByTestId(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')
    expect(app.chats.remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId(testIdFor.bottomTabClose(ids[2] ?? '')))
    await waitFor(() =>
      expect(
        screen.getByTestId(testIdFor.bottomTab(ids[0] ?? '')).getAttribute('data-selected'),
      ).toBe('true'),
    )
    fireEvent.click(screen.getByTestId(testIdFor.bottomTabClose(ids[0] ?? '')))
    expect(await screen.findByTestId(TEST_ID.bottomEmpty)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New terminal' })).toBeTruthy()
    expect(bottomRegion().style.display).not.toBe('none')
    expect(screen.getByTestId(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')
  })

  it('keeps each project tabs inside one run and drops them after a restarted state fixture', async () => {
    const store = new Map<string, string>([
      [APP_STATE_KEY.selectedProjectId, 'p1'],
      [APP_STATE_KEY.selectedChatId, 't1'],
    ])
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockImplementation(async (projectId) =>
      projectId === 'p1' ? [chatOne] : [],
    )
    vi.mocked(app.state.get).mockImplementation(async (key) => store.get(key) ?? null)
    vi.mocked(app.state.set).mockImplementation(async (key, value) => {
      store.set(key, value)
    })
    const view = render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    pressChord()
    await screen.findByRole('button', { name: 'PowerShell' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'PowerShell' })).toHaveLength(2),
    )
    const projectOneIds = bottomTabIds()
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p2')))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'PowerShell' })).toBeNull())
    expect(screen.getByTestId(TEST_ID.bottomEmpty)).toBeTruthy()
    for (const id of projectOneIds) {
      expect(screen.getByTestId(testIdFor.bottomTerminal(id)).style.display).toBe('none')
    }
    expect(mockTerminalInstances.every((terminal) => !terminal.disposed)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('button', { name: 'PowerShell' })
    const createsAfterSwitch = vi.mocked(app.terminals.create).mock.calls.length
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p1')))
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'PowerShell' })).toHaveLength(2),
    )
    expect(vi.mocked(app.terminals.create).mock.calls.length).toBe(createsAfterSwitch)
    expect(mockTerminalInstances.every((terminal) => !terminal.disposed)).toBe(true)

    view.unmount()
    render(<App app={app} />)
    await waitFor(() => expect(bottomRegion().style.display).not.toBe('none'))
    expect(screen.queryByRole('button', { name: 'PowerShell' })).toBeNull()
    expect(screen.getByTestId(TEST_ID.bottomEmpty)).toBeTruthy()
    expect(app.chats.remove).not.toHaveBeenCalled()
    expect(await screen.findByTestId(testIdFor.chatRow('t1'))).toBeTruthy()
  })

  it('removes only the exited bottom tab and leaves the chat', async () => {
    const exits = new Map<string, (code: number) => void>()
    vi.mocked(app.terminals.onExit).mockImplementation((id, listener) => {
      exits.set(id, listener)
      return () => {
        exits.delete(id)
      }
    })
    await renderSelectedProject()
    pressChord()
    await screen.findByRole('button', { name: 'PowerShell' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'PowerShell' })).toHaveLength(2),
    )
    const [first, second] = bottomTabIds()
    const exit = exits.get(first ?? '')
    expect(exit).toBeTypeOf('function')
    exit?.(0)
    await waitFor(() => expect(screen.queryByTestId(testIdFor.bottomTab(first ?? ''))).toBeNull())
    expect(screen.getByTestId(testIdFor.bottomTab(second ?? ''))).toBeTruthy()
    expect(screen.getByTestId(testIdFor.chatRow('t1'))).toBeTruthy()
    expect(app.chats.remove).not.toHaveBeenCalled()
  })

  it('shows the empty-project notice and does not create a tab without a project', async () => {
    render(<App app={app} />)
    await waitFor(() => expect(app.projects.list).toHaveBeenCalled())
    pressChord()
    expect(bottomRegion().style.display).not.toBe('none')
    expect(app.terminals.shellName).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    expect((await screen.findByTestId(TEST_ID.actionNotice)).textContent).toBe(
      'Select or add a project before starting a terminal.',
    )
    expect(screen.queryByRole('button', { name: 'PowerShell' })).toBeNull()
    expect(app.chats.create).not.toHaveBeenCalled()
    pressChord()
    expect(bottomRegion().style.display).toBe('none')
  })

  it('an executed bottom-terminal action opening the hidden panel restores the pre-open focus on hide', async () => {
    const action = {
      id: 'a1',
      scope: 'project' as const,
      projectId: 'p1',
      title: 'Build',
      icon: null,
      command: 'pnpm test',
      cwd: 'D:/code/demo/app',
      runMode: 'bottom-terminal' as const,
      confirm: false,
      sortOrder: 0,
    }
    vi.mocked(app.actions.list).mockResolvedValue([action])
    vi.mocked(app.actions.execute).mockResolvedValue({
      status: 'success',
      exitCode: null,
      completedAt: '2026-09-27T15:00:00Z',
      error: null,
      bottomTabId: 'bottom:p1:tab-1',
      terminalCommand: 'pnpm test',
      terminalCwd: 'D:/code/demo/app',
    })
    await renderSelectedProject()
    // Focus an element that will survive the whole flow, run the action.
    const addProject = screen.getByTestId(TEST_ID.addProjectButton)
    addProject.focus()
    expect(document.activeElement).toBe(addProject)
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.bottomTab('bottom:p1:tab-1'))).toBeTruthy(),
    )
    expect(bottomRegion().style.display).not.toBe('none')

    // Hiding the panel must restore the element focused before the action
    // opened the hidden panel (Behaviour 4 on this path), not the center
    // surface fallback.
    pressChord()
    await waitFor(() => expect(bottomRegion().style.display).toBe('none'))
    await waitFor(() => expect(document.activeElement).toBe(addProject))
  })

  it('shows a spawn error and retries only that tab', async () => {
    vi.mocked(app.terminals.create).mockImplementation(async (id: string) => {
      if (id.startsWith('bottom:')) {
        throw {
          nekodeAppError: true,
          code: 'not_found',
          message:
            'The project directory does not exist. Terminal sessions need an existing project directory.',
        }
      }
      return id
    })
    await renderSelectedProject()
    pressChord()
    expect((await screen.findByTestId(TEST_ID.bottomTerminalError)).textContent).toContain(
      'The project directory does not exist.',
    )
    expect(
      vi.mocked(app.terminals.create).mock.calls.filter(([id]) => id.startsWith('bottom:')),
    ).toHaveLength(1)
    fireEvent.click(screen.getByTestId(TEST_ID.bottomTerminalRetry))
    await waitFor(() =>
      expect(
        vi.mocked(app.terminals.create).mock.calls.filter(([id]) => id.startsWith('bottom:')),
      ).toHaveLength(2),
    )
    expect(screen.getByTestId(testIdFor.chatRow('t1'))).toBeTruthy()
  })

  it('fixed chat buttons still write only to the active chat', async () => {
    await renderSelectedProject()
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Handoff' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    pressChord()
    await screen.findByRole('button', { name: 'PowerShell' })
    for (const label of ['Handoff', 'Resume', 'Stop', 'Continue']) {
      fireEvent.click(screen.getByRole('button', { name: label }))
    }
    // Paste-only default (spec handoff-resume-flow): Stop and Continue write
    // to the active chat PTY only; the bottom tab never receives bytes.
    // Continue is a split-write submission: the line, then the CR (0 ms gap).
    await waitFor(() => expect(app.terminals.write).toHaveBeenCalledTimes(3))
    expect(vi.mocked(app.terminals.write).mock.calls).toEqual([
      ['t1', '\x03'],
      ['t1', 'Continue'],
      ['t1', '\r'],
    ])
    // Handoff pastes English into the active chat's dedicated input; Resume
    // opens the handoff picker (unconfigured in this fixture -> modal only).
    // The chat and bottom terminals each own a prompt input: scope to the chat.
    await waitFor(() =>
      expect(
        (
          within(screen.getByTestId(testIdFor.terminalView('t1'))).getByTestId(
            TEST_ID.terminalPromptInput,
          ) as HTMLInputElement
        ).value,
      ).toBe('Write a handoff'),
    )
    await screen.findByTestId(TEST_ID.handoffPicker)
  })

  it('surfaces a rejected open-flag write and keeps the panel open', async () => {
    await renderSelectedProject()
    vi.mocked(app.state.set).mockImplementation(async (key: string) => {
      if (key === APP_STATE_KEY.bottomRegionOpen) {
        throw { nekodeAppError: true, code: 'sqlite', message: 'Database is locked.' }
      }
    })
    pressChord()
    expect(bottomRegion().style.display).not.toBe('none')
    expect((await screen.findByTestId(TEST_ID.actionNotice)).textContent).toContain(
      'Database is locked.',
    )
  })

  it('drops a removed project bottom tabs and does not remove chats', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockImplementation(async (projectId) =>
      projectId === 'p1' ? [chatOne] : [],
    )
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't1'
      return null
    })
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    pressChord()
    await screen.findByRole('button', { name: 'PowerShell' })
    const [tabId] = bottomTabIds()
    fireEvent.contextMenu(screen.getByTestId(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))
    await waitFor(() =>
      expect(screen.queryByTestId(testIdFor.bottomTerminal(tabId ?? ''))).toBeNull(),
    )
    expect(app.chats.remove).not.toHaveBeenCalled()
  })

  it('does not spawn a bottom terminal for a project removed while its shell name is loading', async () => {
    await renderSelectedProject()
    pressChord()
    await screen.findByRole('button', { name: 'PowerShell' })
    const [existingId] = bottomTabIds()
    expect(existingId).toBeTruthy()
    const createsBefore = bottomCreateIds(app)

    let resolveShell: (name: string) => void = () => undefined
    vi.mocked(app.terminals.shellName).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveShell = resolve
        }),
    )
    let resolveRemove: () => void = () => undefined
    vi.mocked(app.projects.remove).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemove = () => {
            resolve()
          }
        }),
    )

    const shellCalls = vi.mocked(app.terminals.shellName).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await waitFor(() =>
      expect(vi.mocked(app.terminals.shellName).mock.calls.length).toBe(shellCalls + 1),
    )
    fireEvent.contextMenu(screen.getByTestId(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))

    await act(async () => {
      resolveShell('PowerShell')
    })
    expect(screen.getAllByRole('button', { name: 'PowerShell' })).toHaveLength(1)
    expect(bottomCreateIds(app)).toEqual(createsBefore)

    await act(async () => {
      resolveRemove()
    })
    await waitFor(() =>
      expect(screen.queryByTestId(testIdFor.bottomTerminal(existingId ?? ''))).toBeNull(),
    )
    expect(screen.queryByRole('button', { name: 'PowerShell' })).toBeNull()
    expect(bottomCreateIds(app)).toEqual(createsBefore)
    expect(vi.mocked(app.terminals.terminate).mock.calls.map(([id]) => id)).toContain(existingId)
    const terminated = new Set(vi.mocked(app.terminals.terminate).mock.calls.map(([id]) => id))
    for (const id of bottomCreateIds(app)) {
      expect(terminated.has(id)).toBe(true)
    }
  })

  it('still opens a bottom terminal after project removal fails', async () => {
    await renderSelectedProject()
    vi.mocked(app.projects.remove).mockRejectedValue({
      nekodeAppError: true,
      code: 'sqlite',
      message: 'Database is locked.',
    })
    fireEvent.contextMenu(screen.getByTestId(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    expect((await screen.findByTestId(TEST_ID.actionNotice)).textContent).toContain(
      'Database is locked.',
    )
    pressChord()
    expect(await screen.findByRole('button', { name: 'PowerShell' })).toBeTruthy()
    expect(bottomCreateIds(app)).toHaveLength(1)
  })

  it('does not spawn a bottom terminal when an earlier removal fails and a later one succeeds', async () => {
    await renderSelectedProject()
    const removeCalls: Array<{ resolve: () => void; reject: (error: unknown) => void }> = []
    vi.mocked(app.projects.remove).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          removeCalls.push({ resolve, reject })
        }),
    )
    let resolveShell: (name: string) => void = () => undefined
    vi.mocked(app.terminals.shellName).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveShell = resolve
        }),
    )

    fireEvent.contextMenu(screen.getByTestId(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(removeCalls).toHaveLength(1))
    fireEvent.contextMenu(screen.getByTestId(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(removeCalls).toHaveLength(2))

    const shellCalls = vi.mocked(app.terminals.shellName).mock.calls.length
    await act(async () => {
      removeCalls[0]?.reject({
        nekodeAppError: true,
        code: 'sqlite',
        message: 'Database is locked.',
      })
    })
    pressChord()
    await act(async () => {
      resolveShell('PowerShell')
    })
    expect(vi.mocked(app.terminals.shellName).mock.calls.length).toBe(shellCalls)
    expect(bottomCreateIds(app)).toEqual([])

    await act(async () => {
      removeCalls[1]?.resolve()
    })
    expect(bottomCreateIds(app)).toEqual([])
    expect(screen.queryByRole('button', { name: 'PowerShell' })).toBeNull()
  })
})

function bottomTabIds(): string[] {
  return screen.getAllByTestId(/^bottom-tab-bottom:/).map((element) => {
    const testId = element.getAttribute('data-testid') ?? ''
    return testId.slice('bottom-tab-'.length)
  })
}

function bottomCreateIds(app: AppApi): string[] {
  return vi
    .mocked(app.terminals.create)
    .mock.calls.map(([id]) => id)
    .filter((id) => id.startsWith('bottom:'))
}

function labelButton(tabId: string): HTMLElement {
  const tab = screen.getByTestId(testIdFor.bottomTab(tabId))
  const button = tab.querySelector('button')
  expect(button).toBeTruthy()
  return button as HTMLElement
}
