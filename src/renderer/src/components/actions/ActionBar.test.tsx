import type { ActionControl, AppApi } from '@shared/ipc-contract'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { restoreClipboard, stubClipboard } from '../../test/clipboard-stub'
import { ActionBar } from './ActionBar'

afterEach(() => {
  cleanup()
  restoreClipboard()
})

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
    const onSearchQueryChange = vi.fn()

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
          searchQuery: 'first',
          onSearchQueryChange,
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

    // Search is controlled by the active board session.
    const searchInput = screen.getByTestId('kanban-search-input') as HTMLInputElement
    expect(searchInput.placeholder).toBe('Search titles...')
    expect(searchInput.disabled).toBe(false)
    expect(searchInput.value).toBe('first')
    fireEvent.change(searchInput, { target: { value: 'second' } })
    expect(onSearchQueryChange).toHaveBeenCalledWith('second')
    fireEvent.keyDown(searchInput, { key: 'Escape' })
    expect(onSearchQueryChange).toHaveBeenLastCalledWith('')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onSearchQueryChange).toHaveBeenLastCalledWith('')

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
          searchQuery: 'first',
          onSearchQueryChange: vi.fn(),
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
    expect(screen.getByRole('textbox', { name: 'Search titles' })).toHaveProperty('disabled', true)
  })

  it('renders TaskProgressButton with exact aria-label when task is present in session mode', async () => {
    const app = makeAppMock()
    render(
      <ActionBar
        app={app}
        actions={[]}
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
        task={{
          taskId: 'NEKODE-74',
          step: 5,
          totalSteps: 8,
          stepName: 'Fixes',
          fix: 3,
        }}
      />,
    )

    const progressBtn = screen.getByRole('button', {
      name: 'Task progress: step 5 of 8, Fixes, fix 3',
    })
    expect(progressBtn).toBeTruthy()
    expect(progressBtn.getAttribute('aria-label')).toBe('Task progress: step 5 of 8, Fixes, fix 3')
  })

  it('does not render TaskProgressButton when task is undefined', async () => {
    const app = makeAppMock()
    render(
      <ActionBar
        app={app}
        actions={[]}
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

    expect(screen.queryByTestId('task-progress-button')).toBeNull()
  })

  it('opens context menu on right click of custom action button and copies command to clipboard', async () => {
    const app = makeAppMock()
    const clipboard = stubClipboard()
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

    const actionBtn = screen.getByTestId(testIdFor.actionButton('action-1'))
    fireEvent.contextMenu(actionBtn)

    const menu = screen.getByTestId(TEST_ID.actionContextMenu)
    expect(menu).toBeTruthy()

    const copyItem = screen.getByTestId(TEST_ID.actionContextCopyCommand)
    expect(copyItem.textContent).toBe('Copy command')

    fireEvent.click(copyItem)

    await waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith('npm start')
    })
    expect(screen.queryByTestId(TEST_ID.actionContextMenu)).toBeNull()
  })

  it('copies full command including PowerShell prefix when configured on the action', async () => {
    const app = makeAppMock()
    const clipboard = stubClipboard()
    const psAction: ActionControl = {
      id: 'action-ps',
      scope: 'global',
      projectId: null,
      title: 'Run Script',
      icon: null,
      command: 'powershell -NoProfile -ExecutionPolicy Bypass -File .\\script.ps1',
      cwd: null,
      runMode: 'background',
      confirm: false,
      sortOrder: 0,
    }

    render(
      <ActionBar
        app={app}
        actions={[psAction]}
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

    const actionBtn = screen.getByTestId(testIdFor.actionButton('action-ps'))
    fireEvent.contextMenu(actionBtn)

    const copyItem = screen.getByTestId(TEST_ID.actionContextCopyCommand)
    fireEvent.click(copyItem)

    await waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith(
        'powershell -NoProfile -ExecutionPolicy Bypass -File .\\script.ps1',
      )
    })
    expect(screen.queryByTestId(TEST_ID.actionContextMenu)).toBeNull()
  })

  it('opens context menu via ContextMenu and Shift+F10 keyboard shortcuts', () => {
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

    const actionBtn = screen.getByTestId(testIdFor.actionButton('action-1'))

    // ContextMenu key
    fireEvent.keyDown(actionBtn, { key: 'ContextMenu' })
    expect(screen.getByTestId(TEST_ID.actionContextMenu)).toBeTruthy()

    // Escape closes it
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId(TEST_ID.actionContextMenu)).toBeNull()

    // Shift+F10
    fireEvent.keyDown(actionBtn, { key: 'F10', shiftKey: true })
    expect(screen.getByTestId(TEST_ID.actionContextMenu)).toBeTruthy()
  })

  it('dismisses context menu on backdrop click', () => {
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

    const actionBtn = screen.getByTestId(testIdFor.actionButton('action-1'))
    fireEvent.contextMenu(actionBtn)

    const overlay = screen.getByRole('menu', { name: 'Action' })
    fireEvent.click(overlay)
    expect(screen.queryByTestId(TEST_ID.actionContextMenu)).toBeNull()
  })

  it('does not open action context menu when right clicking fixed buttons', () => {
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

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Handoff' }))
    expect(screen.queryByTestId(TEST_ID.actionContextMenu)).toBeNull()
  })

  it('renders the new session button on the left without text and triggers onNewChat when clicked', () => {
    const app = makeAppMock()
    const onNewChat = vi.fn()
    render(
      <ActionBar
        app={app}
        actions={[]}
        projectId="p1"
        activeChatId="c1"
        chatIsLive={true}
        onNewChat={onNewChat}
        onNewTerminal={vi.fn()}
        onBottomTerminal={vi.fn()}
        onPromptCommand={vi.fn()}
        onResume={vi.fn()}
        onError={vi.fn()}
        markdownView={null}
        isKanban={false}
      />,
    )

    const btn = screen.getByTestId(TEST_ID.actionNewChat)
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-label')).toBe('New session')
    expect(btn.getAttribute('title')).toBe('New session')
    expect(btn.textContent).toBe('')
    expect(btn.hasAttribute('disabled')).toBe(false)

    fireEvent.click(btn)
    expect(onNewChat).toHaveBeenCalledTimes(1)
  })

  it('disables the new session button when projectId is null or onNewChat is missing', () => {
    const app = makeAppMock()
    const { rerender } = render(
      <ActionBar
        app={app}
        actions={[]}
        projectId={null}
        activeChatId={null}
        chatIsLive={false}
        onNewChat={vi.fn()}
        onNewTerminal={vi.fn()}
        onBottomTerminal={vi.fn()}
        onPromptCommand={vi.fn()}
        onResume={vi.fn()}
        onError={vi.fn()}
        markdownView={null}
        isKanban={false}
      />,
    )

    const btn = screen.getByTestId(TEST_ID.actionNewChat)
    expect(btn.hasAttribute('disabled')).toBe(true)

    rerender(
      <ActionBar
        app={app}
        actions={[]}
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
    expect(screen.getByTestId(TEST_ID.actionNewChat).hasAttribute('disabled')).toBe(true)
  })

  it('renders the new session button on the left in kanban mode as well', () => {
    const app = makeAppMock()
    render(
      <ActionBar
        app={app}
        actions={[]}
        projectId="p1"
        activeChatId={null}
        chatIsLive={false}
        onNewChat={vi.fn()}
        onNewTerminal={vi.fn()}
        onBottomTerminal={vi.fn()}
        onPromptCommand={vi.fn()}
        onResume={vi.fn()}
        onError={vi.fn()}
        markdownView={null}
        isKanban={true}
      />,
    )

    const btn = screen.getByTestId(TEST_ID.actionNewChat)
    expect(btn).toBeTruthy()
    expect(btn.hasAttribute('disabled')).toBe(false)
  })
})
