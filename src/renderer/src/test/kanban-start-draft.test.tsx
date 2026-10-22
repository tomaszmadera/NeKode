import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppApi,
  KanbanBoard as KanbanBoardData,
  ProjectInfo,
} from '../../../shared/ipc-contract'
import { projectKanbanAdapterKey } from '../../../shared/ipc-contract'
import { App, TEST_ID, testIdFor } from '../App'
import { createAppApiStub } from './app-api-stub'
import { resetMockFitAddons } from './fit-addon-mock'
import { resetMockTerminals } from './xterm-mock'

// Start without sending (NEKODE-99, spec kanban-adapter-interface): a draft
// launch adopts the new chat and fills its prompt input with the prompt main
// returned; nothing reaches the PTY until the user sends it.
vi.mock('@xterm/xterm', () => import('./xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('./fit-addon-mock'))

const projectA: ProjectInfo = {
  id: 'p1',
  name: 'Demo',
  path: 'D:/code/demo',
  runtimeLabel: 'Node 24',
}

const board: KanbanBoardData = {
  states: [{ id: 's1', name: 'Backlog', group: 'backlog', order: 1 }],
  items: [
    {
      ref: 'NEKODE-99',
      id: 'native-99',
      title: 'Start menu',
      description: null,
      stateId: 's1',
      stateName: 'Backlog',
      stateGroup: 'backlog',
      priority: null,
      assignee: null,
      url: null,
      updatedAt: null,
    },
  ],
}

const profile = { id: 'prof-1', name: 'Claude Code', executable: 'claude', args: ['{prompt}'] }
const DRAFT = 'Work on task NEKODE-99: Start menu.\n\nThis task has no description.'

describe('kanban Start without sending', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })

  afterEach(() => {
    cleanup()
  })

  it('fills the new chat prompt input with the returned prompt and writes nothing', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(board)
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === projectKanbanAdapterKey('p1') ? 'demo' : null,
    )
    vi.mocked(app.agentProfiles.get).mockResolvedValue({
      defaultId: profile.id,
      profiles: [profile],
    })
    vi.mocked(app.kanban.launchTask).mockResolvedValue({
      chat: { id: 'c99', projectId: 'p1', name: '[PowerShell] Claude Code', taskRef: 'NEKODE-99' },
      delivered: true,
      draftPrompt: DRAFT,
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
    const start = await screen.findByTestId(testIdFor.kanbanItemStart('NEKODE-99'))
    fireEvent.contextMenu(start)
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanStartMenuDraft))

    const dialog = await screen.findByTestId(TEST_ID.kanbanStartDialog)
    expect(dialog.textContent).toContain('Start task without sending')
    await screen.findByTestId(testIdFor.kanbanStartProfile(profile.id))
    const confirm = screen.getByTestId(TEST_ID.kanbanStartConfirm)
    expect(confirm.textContent).toBe('Start without sending')
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(app.kanban.launchTask).toHaveBeenCalledTimes(1)
    })
    expect(vi.mocked(app.kanban.launchTask).mock.calls[0]?.[0].mode).toBe('draft')
    await waitFor(() => {
      const input = screen.getByTestId(TEST_ID.terminalPromptInput) as HTMLTextAreaElement
      expect(input.value).toBe(DRAFT)
    })
    expect(screen.queryByTestId(TEST_ID.kanbanStartDialog)).toBeNull()
    const written = vi.mocked(app.terminals.write).mock.calls.map(([, data]) => data)
    expect(written.some((data) => data.includes('Work on task'))).toBe(false)
  })

  it('fills the prompt input only after a held draft launch is retried', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(board)
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === projectKanbanAdapterKey('p1') ? 'demo' : null,
    )
    vi.mocked(app.agentProfiles.get).mockResolvedValue({
      defaultId: profile.id,
      profiles: [profile],
    })
    const chat = { id: 'c99', projectId: 'p1', name: '[PowerShell] Claude Code' }
    vi.mocked(app.kanban.launchTask)
      .mockResolvedValueOnce({ chat, delivered: false })
      .mockResolvedValueOnce({ chat, delivered: true, draftPrompt: DRAFT })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
    fireEvent.contextMenu(await screen.findByTestId(testIdFor.kanbanItemStart('NEKODE-99')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanStartMenuDraft))
    await screen.findByTestId(testIdFor.kanbanStartProfile(profile.id))
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanStartConfirm))

    const retry = await screen.findByTestId(TEST_ID.terminalRetry)
    expect(screen.queryByDisplayValue(DRAFT)).toBeNull()
    fireEvent.click(retry)
    await waitFor(() => {
      expect(app.kanban.launchTask).toHaveBeenCalledTimes(2)
    })
    const calls = vi.mocked(app.kanban.launchTask).mock.calls
    expect(calls[1]?.[0]).toEqual(calls[0]?.[0])
    expect(calls[1]?.[0].mode).toBe('draft')
    await waitFor(() => {
      const input = screen.getByTestId(TEST_ID.terminalPromptInput) as HTMLTextAreaElement
      expect(input.value).toBe(DRAFT)
    })
    const written = vi.mocked(app.terminals.write).mock.calls.map(([, data]) => data)
    expect(written.some((data) => data.includes('Work on task'))).toBe(false)
  })
})
