import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionControl, AppApi } from '../../../../shared/ipc-contract'
import { ActionBar } from './ActionBar'

afterEach(cleanup)

function makeAppMock(): AppApi {
  return {
    actions: {
      status: vi.fn().mockResolvedValue({ status: 'idle', exitCode: null }),
      execute: vi.fn().mockResolvedValue({ status: 'success', exitCode: 0 }),
    },
    terminals: {
      write: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as AppApi
}

const customAction: ActionControl = {
  id: 'action-1',
  scope: 'global',
  projectId: null,
  title: 'Start',
  icon: null,
  command: 'npm start',
  cwd: null,
  runMode: 'background',
  confirm: false,
  sortOrder: 0,
}

describe('ActionBar', () => {
  it('renders fixed buttons on the left and custom actions on the right in non-kanban mode', async () => {
    const app = makeAppMock()
    render(
      <ActionBar
        app={app}
        actions={[customAction]}
        projectId="p1"
        activeChatId="c1"
        chatIsLive={true}
        onNewTerminal={vi.fn()}
        onBottomTerminal={vi.fn()}
        onPromptCommand={vi.fn()}
        onResume={vi.fn()}
        onError={vi.fn()}
        markdownView={null}
        isKanban={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'Handoff' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
    const customBtn = screen.getByRole('button', { name: 'Start' })
    expect(customBtn).toBeTruthy()

    // Custom button is inside the right ml-auto container across all tabs
    const rightContainer = customBtn.closest('div.ml-auto')
    expect(rightContainer).not.toBeNull()
  })

  it('in kanban mode, hides fixed buttons, renders kanban controls on the left, and custom actions on the right', async () => {
    const app = makeAppMock()
    const onSortByChange = vi.fn()
    const onToggleSortDirection = vi.fn()
    const onRefresh = vi.fn()
    const onNewTask = vi.fn()
    const onCloseReview = vi.fn()

    render(
      <ActionBar
        app={app}
        actions={[customAction]}
        projectId="p1"
        activeChatId="c1"
        chatIsLive={true}
        onNewTerminal={vi.fn()}
        onBottomTerminal={vi.fn()}
        onPromptCommand={vi.fn()}
        onResume={vi.fn()}
        onError={vi.fn()}
        markdownView={null}
        isKanban={true}
        kanbanControls={{
          phase: 'ready',
          refreshing: false,
          isReviewing: false,
          creatingBusy: false,
          sortState: { sortBy: 'slug', direction: 'asc' },
          onSortByChange,
          onToggleSortDirection,
          onRefresh,
          onNewTask,
          onCloseReview,
        }}
      />,
    )

    // Fixed buttons should not exist on kanban view
    expect(screen.queryByRole('button', { name: 'Handoff' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()

    // Kanban controls exist on the left
    expect(screen.getByTestId('kanban-sort-by')).toBeTruthy()
    expect(screen.getByTestId('kanban-sort-direction')).toBeTruthy()
    expect(screen.getByTestId('kanban-board-refresh')).toBeTruthy()
    expect(screen.getByTestId('kanban-search-input')).toBeTruthy()
    expect(screen.getByTestId('kanban-new-task')).toBeTruthy()

    // Search input has the expected placeholder and is disabled
    const searchInput = screen.getByTestId('kanban-search-input') as HTMLInputElement
    expect(searchInput.placeholder).toBe('Search... (not working yet)')
    expect(searchInput.disabled).toBe(true)

    // Interacting with controls invokes callbacks
    fireEvent.change(screen.getByTestId('kanban-sort-by'), { target: { value: 'priority' } })
    expect(onSortByChange).toHaveBeenCalledWith('priority')

    fireEvent.click(screen.getByTestId('kanban-sort-direction'))
    expect(onToggleSortDirection).toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('kanban-board-refresh'))
    expect(onRefresh).toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('kanban-new-task'))
    expect(onNewTask).toHaveBeenCalled()

    // Custom button is on the right
    const customBtn = screen.getByRole('button', { name: 'Start' })
    expect(customBtn).toBeTruthy()
    expect(customBtn.closest('div.ml-auto')).not.toBeNull()

    fireEvent.click(customBtn)
    await waitFor(() => {
      expect(app.actions.execute).toHaveBeenCalledWith('action-1', 'p1', false)
    })
  })

  it('in kanban mode reviewing an item, renders the Back button', () => {
    const app = makeAppMock()
    const onCloseReview = vi.fn()

    render(
      <ActionBar
        app={app}
        actions={[]}
        projectId="p1"
        activeChatId={null}
        chatIsLive={false}
        onNewTerminal={vi.fn()}
        onBottomTerminal={vi.fn()}
        onPromptCommand={vi.fn()}
        onResume={vi.fn()}
        onError={vi.fn()}
        markdownView={null}
        isKanban={true}
        kanbanControls={{
          phase: 'ready',
          refreshing: false,
          isReviewing: true,
          creatingBusy: false,
          sortState: { sortBy: 'slug', direction: 'asc' },
          onSortByChange: vi.fn(),
          onToggleSortDirection: vi.fn(),
          onRefresh: vi.fn(),
          onNewTask: vi.fn(),
          onCloseReview,
        }}
      />,
    )

    const backButton = screen.getByTestId('kanban-review-back')
    expect(backButton).toBeTruthy()
    fireEvent.click(backButton)
    expect(onCloseReview).toHaveBeenCalled()

    // New task button is not rendered during review
    expect(screen.queryByTestId('kanban-new-task')).toBeNull()
  })
})
