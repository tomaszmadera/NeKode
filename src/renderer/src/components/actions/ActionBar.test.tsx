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
  group: null,
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

  it('renders exactly one icon: emoji when custom emoji is set, without svg status icon', () => {
    const app = makeAppMock()
    const emojiAction: ActionControl = {
      ...customAction,
      id: 'action-emoji',
      icon: '🚀',
      title: 'Deploy',
    }
    render(
      <ActionBar
        app={app}
        actions={[emojiAction]}
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

    const button = screen.getByTestId(testIdFor.actionButton('action-emoji'))
    expect(button.textContent).toContain('🚀')
    expect(button.textContent).toContain('Deploy')
    // No svg status icon inside button when emoji is present
    expect(button.querySelector('svg')).toBeNull()
  })

  it('renders svg icon when preset icon is chosen, without duplicate spans', () => {
    const app = makeAppMock()
    const presetAction: ActionControl = {
      ...customAction,
      id: 'action-preset',
      icon: 'run',
      title: 'Run Tests',
    }
    render(
      <ActionBar
        app={app}
        actions={[presetAction]}
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

    const button = screen.getByTestId(testIdFor.actionButton('action-preset'))
    expect(button.querySelector('svg')).not.toBeNull()
    // No extra emoji span
    expect(button.querySelector('span[aria-hidden="true"]')).toBeNull()
  })
})

describe('action groups', () => {
  function groupedAction(
    id: string,
    title: string,
    group: string | null,
    sortOrder: number,
    extra: Partial<ActionControl> = {},
  ): ActionControl {
    return {
      id,
      scope: 'global',
      projectId: null,
      title,
      icon: null,
      group,
      command: `${title} cmd`,
      cwd: null,
      runMode: 'background',
      confirm: false,
      sortOrder,
      ...extra,
    }
  }

  function barElement(app: AppApi, actions: ActionControl[], isKanban = false, projectId = 'p1') {
    return (
      <ActionBar
        app={app}
        actions={actions}
        projectId={projectId}
        activeChatId="c1"
        chatIsLive={true}
        onNewTerminal={vi.fn()}
        onBottomTerminal={vi.fn()}
        onPromptCommand={vi.fn()}
        onResume={vi.fn()}
        onError={vi.fn()}
        markdownView={null}
        isKanban={isKanban}
      />
    )
  }

  function renderBar(app: AppApi, actions: ActionControl[], isKanban = false) {
    return render(barElement(app, actions, isKanban))
  }

  it('collapses grouped actions into one trigger and runs the chosen member', async () => {
    const app = makeAppMock()
    renderBar(app, [
      groupedAction('a1', 'Build', 'Build', 0),
      groupedAction('a2', 'Build all', 'Build', 1),
      groupedAction('a3', 'Start', null, 2),
    ])

    expect(screen.getByTestId(testIdFor.actionButton('a3'))).toBeTruthy()
    expect(screen.queryByTestId(testIdFor.actionButton('a1'))).toBeNull()
    expect(screen.queryByTestId(testIdFor.actionButton('a2'))).toBeNull()

    fireEvent.click(screen.getByTestId(testIdFor.actionGroup('Build')))
    expect(screen.getByTestId(testIdFor.actionGroupMenu('Build'))).toBeTruthy()
    fireEvent.click(screen.getByTestId(testIdFor.actionButton('a2')))

    await waitFor(() => expect(app.actions.execute).toHaveBeenCalledWith('a2', 'p1', false))
    expect(screen.queryByTestId(testIdFor.actionGroupMenu('Build'))).toBeNull()
  })

  it('keeps a one-member group as the member button', () => {
    const app = makeAppMock()
    renderBar(app, [groupedAction('a1', 'Build', 'Build', 0), groupedAction('a2', 'Lint', null, 1)])

    expect(screen.queryByTestId(testIdFor.actionGroup('Build'))).toBeNull()
    expect(screen.getByTestId(testIdFor.actionButton('a1'))).toBeTruthy()
    expect(screen.getByTestId(testIdFor.actionButton('a2'))).toBeTruthy()
  })

  it('groups a global and a project action that share a name', () => {
    const app = makeAppMock()
    renderBar(app, [
      groupedAction('a1', 'Build', 'Release', 0),
      groupedAction('a2', 'Publish', 'Release', 1, { scope: 'project', projectId: 'p1' }),
    ])

    expect(screen.getByTestId(testIdFor.actionGroup('Release'))).toBeTruthy()
    expect(screen.queryByTestId(testIdFor.actionButton('a1'))).toBeNull()
    expect(screen.queryByTestId(testIdFor.actionButton('a2'))).toBeNull()
  })

  it('asks before running a confirmed member and runs nothing on cancel', () => {
    const app = makeAppMock()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderBar(app, [
      groupedAction('a1', 'Deploy', 'Ops', 0, { confirm: true }),
      groupedAction('a2', 'Restart', 'Ops', 1),
    ])

    fireEvent.click(screen.getByTestId(testIdFor.actionGroup('Ops')))
    fireEvent.click(screen.getByTestId(testIdFor.actionButton('a1')))

    expect(confirm).toHaveBeenCalledWith('Run Deploy?')
    expect(app.actions.execute).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('marks the trigger active while a member runs and disables only that member', async () => {
    const app = makeAppMock()
    vi.mocked(app.actions.status).mockImplementation(async (id: string) =>
      id === 'a1'
        ? { status: 'running', exitCode: null, completedAt: null, error: null }
        : { status: 'idle', exitCode: null, completedAt: null, error: null },
    )
    renderBar(app, [groupedAction('a1', 'Build', 'Ops', 0), groupedAction('a2', 'Test', 'Ops', 1)])

    fireEvent.click(screen.getByTestId(testIdFor.actionGroup('Ops')))
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.actionButton('a1')).hasAttribute('disabled')).toBe(true),
    )
    expect(screen.getByTestId(testIdFor.actionGroup('Ops')).getAttribute('data-active')).toBe(
      'true',
    )
    expect(screen.getByTestId(testIdFor.actionButton('a2')).hasAttribute('disabled')).toBe(false)
  })

  it('closes the menu on Escape and on an outside click', () => {
    const app = makeAppMock()
    renderBar(app, [groupedAction('a1', 'Build', 'Ops', 0), groupedAction('a2', 'Test', 'Ops', 1)])

    fireEvent.click(screen.getByTestId(testIdFor.actionGroup('Ops')))
    expect(screen.getByTestId(testIdFor.actionGroupMenu('Ops'))).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId(testIdFor.actionGroupMenu('Ops'))).toBeNull()

    fireEvent.click(screen.getByTestId(testIdFor.actionGroup('Ops')))
    fireEvent.click(screen.getByTestId(testIdFor.actionGroupMenu('Ops')))
    expect(screen.queryByTestId(testIdFor.actionGroupMenu('Ops'))).toBeNull()
  })

  it('keeps the copy-command menu available on a group item', async () => {
    const app = makeAppMock()
    const clipboard = stubClipboard()
    renderBar(app, [groupedAction('a1', 'Build', 'Ops', 0), groupedAction('a2', 'Test', 'Ops', 1)])

    fireEvent.click(screen.getByTestId(testIdFor.actionGroup('Ops')))
    fireEvent.contextMenu(screen.getByTestId(testIdFor.actionButton('a1')))

    expect(screen.queryByTestId(testIdFor.actionGroupMenu('Ops'))).toBeNull()
    fireEvent.click(screen.getByTestId(TEST_ID.actionContextCopyCommand))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('Build cmd'))
  })

  it('groups actions in kanban mode as well', () => {
    const app = makeAppMock()
    renderBar(
      app,
      [groupedAction('a1', 'Build', 'Ops', 0), groupedAction('a2', 'Test', 'Ops', 1)],
      true,
    )

    expect(screen.queryByRole('button', { name: 'Handoff' })).toBeNull()
    expect(screen.getByTestId(testIdFor.actionGroup('Ops'))).toBeTruthy()
  })

  it('lists the grouped members in configured order with their titles', () => {
    const app = makeAppMock()
    renderBar(app, [
      groupedAction('a1', 'Build', 'Ops', 0),
      groupedAction('a2', 'Test suite', 'Ops', 1),
      groupedAction('a3', 'Deploy', 'Ops', 2),
    ])

    fireEvent.click(screen.getByTestId(testIdFor.actionGroup('Ops')))

    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Build', 'Test suite', 'Deploy'])
    expect(items.map((item) => item.getAttribute('data-testid'))).toEqual([
      testIdFor.actionButton('a1'),
      testIdFor.actionButton('a2'),
      testIdFor.actionButton('a3'),
    ])
  })

  it('colors a failed member inside the menu and leaves the trigger unmarked', async () => {
    const app = makeAppMock()
    vi.mocked(app.actions.status).mockImplementation(async (id: string) =>
      id === 'a1'
        ? { status: 'failed', exitCode: 1, completedAt: null, error: null }
        : { status: 'idle', exitCode: null, completedAt: null, error: null },
    )
    renderBar(app, [groupedAction('a1', 'Build', 'Ops', 0), groupedAction('a2', 'Test', 'Ops', 1)])

    fireEvent.click(screen.getByTestId(testIdFor.actionGroup('Ops')))

    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.actionButton('a1')).getAttribute('data-status')).toBe(
        'failed',
      ),
    )
    expect(screen.getByTestId(testIdFor.actionButton('a1')).className).toContain('text-error')
    expect(screen.getByTestId(testIdFor.actionGroup('Ops')).getAttribute('data-active')).toBe(
      'false',
    )
  })

  it('closes the menu when the group disappears or the project changes', () => {
    const app = makeAppMock()
    const members = [groupedAction('a1', 'Build', 'Ops', 0), groupedAction('a2', 'Test', 'Ops', 1)]
    const view = renderBar(app, members)

    fireEvent.click(screen.getByTestId(testIdFor.actionGroup('Ops')))
    expect(screen.getByTestId(testIdFor.actionGroupMenu('Ops'))).toBeTruthy()

    view.rerender(barElement(app, [members[0]]))
    expect(screen.queryByTestId(testIdFor.actionGroupMenu('Ops'))).toBeNull()

    view.rerender(barElement(app, members))
    fireEvent.click(screen.getByTestId(testIdFor.actionGroup('Ops')))
    expect(screen.getByTestId(testIdFor.actionGroupMenu('Ops'))).toBeTruthy()

    view.rerender(barElement(app, members, false, 'p2'))
    expect(screen.queryByTestId(testIdFor.actionGroupMenu('Ops'))).toBeNull()
  })
})
