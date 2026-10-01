import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionControl, AppApi, ChatInfo, ProjectInfo } from '../../../shared/ipc-contract'
import { APP_STATE_KEY, emptyGitWorktree } from '../../../shared/ipc-contract'
import { App, TEST_ID, testIdFor } from '../App'
import { resetMockFitAddons } from './fit-addon-mock'
import { resetMockTerminals } from './xterm-mock'

// Regression guard for the bottom-terminal delivery contract (review:4
// follow-ups): once a `bottom-terminal` action has staged its command, the
// staged entry must not survive lifecycle events that make the tab unable to
// receive it. The observable is app.terminals.write: a stale staged entry that
// survives a close/exit/abort would deliver the command LATER (redelivery on
// a future ready event or a future tab), which these tests pin to zero.
vi.mock('@xterm/xterm', () => import('./xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('./fit-addon-mock'))

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
      add: vi.fn().mockResolvedValue({
        id: 'p1',
        name: 'Demo',
        path: 'D:/code/demo',
        runtimeLabel: 'Node',
      }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    chats: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: 't1',
        projectId: 'p1',
        name: 'Demo chat',
      }),
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
const chatOne: ChatInfo = { id: 't1', projectId: 'p1', name: 'First chat' }
const bottomAction: ActionControl = {
  id: 'a1',
  scope: 'project',
  projectId: 'p1',
  title: 'Build',
  icon: null,
  command: 'pnpm test',
  cwd: 'D:/code/demo/app',
  runMode: 'bottom-terminal',
  confirm: false,
  sortOrder: 0,
}

function stageActionAndBlockSpawn(app: AppApi, tabId: string): (id: string) => void {
  let finishSpawn: ((id: string) => void) | undefined
  vi.mocked(app.actions.list).mockResolvedValue([bottomAction])
  vi.mocked(app.actions.execute).mockResolvedValue({
    status: 'success',
    exitCode: null,
    completedAt: '2026-09-27T15:00:00Z',
    error: null,
    bottomTabId: tabId,
    terminalCommand: bottomAction.command,
    terminalCwd: bottomAction.cwd ?? '',
  })
  // Hold the new tab's terminal spawn open so the command stays staged while
  // the test acts on the tab (close/exit). Resolve with finishSpawn.
  vi.mocked(app.terminals.create).mockImplementation((id) =>
    id.startsWith('bottom:')
      ? new Promise<string>((resolve) => {
          finishSpawn = resolve
          return resolve
        })
      : Promise.resolve(id),
  )
  return (id: string) => finishSpawn?.(id)
}

describe('staged bottom-terminal commands do not outlive their tab', () => {
  let app: AppApi
  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  async function renderSelectedChat(): Promise<void> {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === APP_STATE_KEY.selectedProjectId
        ? 'p1'
        : key === APP_STATE_KEY.selectedChatId
          ? 't1'
          : null,
    )
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
  }

  it('closing the pending tab before it is ready never delivers the staged command', async () => {
    const releaseSpawn = stageActionAndBlockSpawn(app, 'bottom:p1:tab-1')
    await renderSelectedChat()
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await waitFor(() =>
      expect(app.terminals.create).toHaveBeenCalledWith('bottom:p1:tab-1', 'D:/code/demo/app'),
    )
    // Staged and waiting: nothing written before the terminal view is ready.
    expect(vi.mocked(app.terminals.write).mock.calls).toEqual([])

    // Close the tab before ready.
    fireEvent.click(screen.getByTestId(testIdFor.bottomTabClose('bottom:p1:tab-1')))
    await waitFor(() =>
      expect(screen.queryByTestId(testIdFor.bottomTab('bottom:p1:tab-1'))).toBeNull(),
    )

    // The spawn promise of the dead tab resolves afterwards: its ready event
    // must deliver nothing.
    await act(async () => {
      releaseSpawn('bottom:p1:tab-1')
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(vi.mocked(app.terminals.write).mock.calls).toEqual([])
  })

  it('exiting the pending tab before it is ready never delivers the staged command', async () => {
    stageActionAndBlockSpawn(app, 'bottom:p1:tab-1')
    await renderSelectedChat()
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await waitFor(() =>
      expect(app.terminals.create).toHaveBeenCalledWith('bottom:p1:tab-1', 'D:/code/demo/app'),
    )
    expect(vi.mocked(app.terminals.write).mock.calls).toEqual([])

    // The PTY reports exit before the view is ready.
    const exitCall = vi
      .mocked(app.terminals.onExit)
      .mock.calls.find(([id]) => id === 'bottom:p1:tab-1')
    expect(exitCall).toBeDefined()
    await act(async () => {
      exitCall?.[1](0)
    })
    await waitFor(() =>
      expect(screen.queryByTestId(testIdFor.bottomTab('bottom:p1:tab-1'))).toBeNull(),
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(vi.mocked(app.terminals.write).mock.calls).toEqual([])
  })

  it('aborting the action with a doomed spawn never delivers the staged command', async () => {
    let finishSpawn: ((id: string) => void) | undefined
    vi.mocked(app.actions.list).mockResolvedValue([bottomAction])
    vi.mocked(app.actions.execute).mockResolvedValue({
      status: 'success',
      exitCode: null,
      completedAt: '2026-09-27T15:00:00Z',
      error: null,
      bottomTabId: 'bottom:p1:tab-1',
      terminalCommand: bottomAction.command,
      terminalCwd: bottomAction.cwd ?? '',
    })
    vi.mocked(app.terminals.create).mockImplementation((id) =>
      id.startsWith('bottom:')
        ? new Promise<string>((resolve) => {
            finishSpawn = resolve
            return resolve
          })
        : Promise.resolve(id),
    )
    await renderSelectedChat()
    // The project is removed while the createBottomTab work is in flight (the
    // spawn promise is still unresolved). The tombstone rules drop the tab.
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await waitFor(() =>
      expect(app.terminals.create).toHaveBeenCalledWith('bottom:p1:tab-1', 'D:/code/demo/app'),
    )
    vi.mocked(app.chats.remove).mockResolvedValue(undefined)
    vi.mocked(app.projects.remove).mockResolvedValue(undefined)
    fireEvent.contextMenu(screen.getByTestId(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))
    await waitFor(() =>
      expect(screen.queryByTestId(testIdFor.bottomTab('bottom:p1:tab-1'))).toBeNull(),
    )

    // The abandoned spawn resolves afterwards: no ready delivery may happen.
    await act(async () => {
      finishSpawn?.('bottom:p1:tab-1')
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(vi.mocked(app.terminals.write).mock.calls).toEqual([])
  })

  it('a spawn error keeps the staged command for retry redelivery, once', async () => {
    vi.mocked(app.actions.list).mockResolvedValue([bottomAction])
    vi.mocked(app.actions.execute).mockResolvedValue({
      status: 'success',
      exitCode: null,
      completedAt: '2026-09-27T15:00:00Z',
      error: null,
      bottomTabId: 'bottom:p1:tab-1',
      terminalCommand: bottomAction.command,
      terminalCwd: bottomAction.cwd ?? '',
    })
    // First spawn attempt of the bottom tab fails; retry succeeds.
    vi.mocked(app.terminals.create).mockImplementation((id) =>
      id === 'bottom:p1:tab-1' && vi.mocked(app.terminals.create).mock.calls.length === 2
        ? Promise.reject(new Error('spawn failed'))
        : Promise.resolve(id),
    )
    await renderSelectedChat()
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await waitFor(() => {
      expect(screen.getByTestId(TEST_ID.bottomTerminalError)).toBeTruthy()
    })
    // Nothing delivered yet (no ready event happened).
    expect(vi.mocked(app.terminals.write).mock.calls).toEqual([])

    fireEvent.click(screen.getByTestId(TEST_ID.bottomTerminalRetry))
    // The retry remounts the terminal view; its ready event delivers the
    // staged command exactly once (contract: command + CR, once).
    await waitFor(() =>
      expect(app.terminals.write).toHaveBeenCalledWith('bottom:p1:tab-1', 'pnpm test\r'),
    )
    expect(vi.mocked(app.terminals.write).mock.calls).toEqual([['bottom:p1:tab-1', 'pnpm test\r']])
  })
})
