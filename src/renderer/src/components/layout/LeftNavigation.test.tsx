import type { ChatInfo, ProjectInfo, TaskProgressSnapshot } from '@shared/ipc-contract'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { ChatStoreContext, createChatStore } from '../../stores/useChatStore'
import { createProjectStore, ProjectStoreContext } from '../../stores/useProjectStore'
import { LeftNavigation, SESSION_CAPTION_CLASS } from './LeftNavigation'

afterEach(cleanup)

type NavigationFixture = React.ComponentProps<typeof LeftNavigation> & {
  projects: ProjectInfo[]
  projectColors: Record<string, string>
  chatsByProject: Record<string, ChatInfo[]>
  expandedProjectIds: ReadonlySet<string>
  selectedProjectId: string | null
  selectedChatId: string | null
  attention: Record<string, { message: string | null }>
  activity?: ReadonlySet<string>
  taskSnapshots?: Record<string, TaskProgressSnapshot>
  kanbanProjectIds: ReadonlySet<string>
}

function navigation(
  {
    projects,
    projectColors,
    chatsByProject,
    expandedProjectIds,
    selectedProjectId,
    selectedChatId,
    attention,
    activity = new Set(),
    taskSnapshots = {},
    kanbanProjectIds,
    ...props
  }: NavigationFixture,
  projectStore = createProjectStore(),
  chatStore = createChatStore(),
): React.JSX.Element {
  projectStore.setState({
    projects,
    projectColors,
    expandedProjectIds,
    selectedProjectId,
    kanbanProjectIds,
  })
  chatStore.setState({
    chatsByProject,
    selectedChatId,
    chatAttention: attention,
    chatActivity: activity,
    taskSnapshots,
  })
  return (
    <ProjectStoreContext.Provider value={projectStore}>
      <ChatStoreContext.Provider value={chatStore}>
        <LeftNavigation {...props} />
      </ChatStoreContext.Provider>
    </ProjectStoreContext.Provider>
  )
}

function progressSnapshot(ref: string, stale = false): TaskProgressSnapshot {
  return {
    projectId: 'p1',
    adapterId: 'example',
    status: stale ? 'stale' : 'ok',
    receivedAt: null,
    ...(stale ? { error: { code: 'transient' as const, message: 'Source unavailable' } } : {}),
    tasks: [
      {
        id: ref.toLowerCase(),
        ref,
        title: null,
        state: 'active',
        location: 'live',
        recordState: 'valid',
        errors: [],
        activity: null,
        phases: [
          {
            name: 'Work',
            steps: Array.from({ length: 8 }, (_, index) => ({
              id: `step-${index + 1}`,
              label: index === 4 ? 'Fixes' : `Step ${index + 1}`,
              done: index < 4,
            })),
          },
        ],
        currentStepId: 'step-5',
        currentLabel: null,
        corrections: 0,
        reviews: 0,
        nextAction: null,
        blockers: null,
        createdAt: null,
        updatedAt: null,
        completedAt: null,
        checkpoints: [],
        path: '.agents/tasks/example/task.md',
      },
    ],
  }
}

function defaultProps() {
  const projects: ProjectInfo[] = [
    { id: 'p1', name: 'NEKODE', path: 'F:/projects/NeKode', runtimeLabel: null },
    { id: 'p2', name: 'AGENT-HARNESS', path: 'F:/projects/agent-harness', runtimeLabel: null },
  ]
  return {
    projects,
    projectNamesUppercase: true,
    showProjectIcons: true,
    projectColors: {},
    chatsByProject: {},
    expandedProjectIds: new Set(['p1']),
    selectedProjectId: 'p1',
    selectedChatId: null,
    attention: {},
    attentionBadgeEnabled: true,
    attentionActiveIndicatorEnabled: true,
    onSelectProject: vi.fn(),
    onToggleProject: vi.fn(),
    onSelectChat: vi.fn(),
    onAddProject: vi.fn(),
    onRemoveProject: vi.fn(),
    onOpenProjectFiles: vi.fn(),
    kanbanProjectIds: new Set<string>(),
    onOpenProjectKanban: vi.fn(),
    onOpenProjectSettings: vi.fn(),
    onCreateChat: vi.fn().mockResolvedValue(true),
    onCreateAgentChat: vi.fn().mockResolvedValue(true),
    loadAgentProfiles: vi.fn().mockResolvedValue({ version: 1, profiles: [] }),
    onConfigureAgents: vi.fn(),
    onOpenInFileExplorer: vi.fn(),
    onRequestCloseChat: vi.fn(),
    notice: null,
  }
}

describe('LeftNavigation session status indicators', () => {
  it('subscribes directly to project and chat store updates without domain props', () => {
    const projectStore = createProjectStore()
    const chatStore = createChatStore()
    render(
      navigation(
        { ...defaultProps(), projects: [], expandedProjectIds: new Set(), selectedProjectId: null },
        projectStore,
        chatStore,
      ),
    )
    expect(screen.queryByTestId(testIdFor.projectSelect('p1'))).toBeNull()
    act(() => {
      projectStore.getState().setProjects(defaultProps().projects)
      projectStore.getState().setExpandedProjectIds(new Set(['p1']))
      projectStore.getState().setSelectedProjectId('p1')
      chatStore
        .getState()
        .setChatsByProject({ p1: [{ id: 'c1', projectId: 'p1', name: 'Direct' }] })
      chatStore.getState().setSelectedChatId('c1')
      chatStore.getState().setChatAttention({ c1: { message: 'Confirm?' } })
    })
    expect(screen.getByTestId(testIdFor.chatRow('c1')).getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId(testIdFor.chatAttentionBadge('c1')).getAttribute('title')).toBe(
      'Confirm?',
    )
    act(() => {
      chatStore.getState().reset()
      projectStore.getState().reset()
    })
    expect(screen.queryByTestId(testIdFor.projectSelect('p1'))).toBeNull()
  })

  it('shows the Kanban ref with an agent badge and uses its identity for selection and closing', () => {
    const props = defaultProps()
    const chat: ChatInfo = {
      id: 'task',
      projectId: 'p1',
      name: '[PS7] Analysis',
      taskRef: 'NEKODE-42',
      agentName: 'Codex',
    }
    render(navigation({ ...props, chatsByProject: { p1: [chat] } }))
    const row = screen.getByTestId(testIdFor.chatRow(chat.id))
    expect(within(row).getByText('NEKODE-42')).toBeTruthy()
    expect(within(row).getByText('Codex')).toBeTruthy()
    expect(row.textContent).not.toContain('[PS7]')
    expect(row.textContent).not.toContain('Analysis')
    expect(row.getAttribute('aria-label')).toBe('NEKODE-42, Codex, idle, now')
    expect(row.getAttribute('title')).toContain('NEKODE-42')
    fireEvent.click(row)
    expect(props.onSelectChat).toHaveBeenCalledWith('p1', 'task')
    fireEvent.mouseEnter(row)
    fireEvent.click(screen.getByRole('button', { name: 'Close chat NEKODE-42, Codex' }))
    expect(props.onRequestCloseChat).toHaveBeenCalledWith('task')
  })

  it('shows a non-Kanban profile name, plain Terminal, and legacy names without guessed agents', () => {
    const chats: ChatInfo[] = [
      { id: 'agent', projectId: 'p1', name: '[PS7] Code analysis', agentName: 'Claude' },
      { id: 'shell', projectId: 'p1', name: '[bash]' },
      { id: 'legacy', projectId: 'p1', name: '[WSL] Old profile' },
      { id: 'custom', projectId: 'p1', name: 'Existing name' },
    ]
    render(navigation({ ...defaultProps(), chatsByProject: { p1: chats } }))
    const agent = screen.getByTestId(testIdFor.chatRow('agent'))
    expect(within(agent).getByText('Code analysis')).toBeTruthy()
    expect(within(agent).getByText('Claude')).toBeTruthy()
    expect(
      within(screen.getByTestId(testIdFor.chatRow('shell'))).getByText('Terminal'),
    ).toBeTruthy()
    const legacy = screen.getByTestId(testIdFor.chatRow('legacy'))
    expect(within(legacy).getByText('Old profile')).toBeTruthy()
    expect(legacy.textContent).not.toContain('WSL')
    expect(
      within(screen.getByTestId(testIdFor.chatRow('custom'))).getByText('Existing name'),
    ).toBeTruthy()
  })

  it.each([
    '\\\\wsl.localhost\\Ubuntu\\home\\user\\Project',
    '\\\\wsl$\\Ubuntu\\home\\user\\Project',
  ])('marks only WSL project locations and exposes the distribution: %s', (path) => {
    const props = defaultProps()
    props.projects[0].path = path
    props.projects[1].runtimeLabel = 'WSL: misleading legacy label'
    render(navigation({ ...props }))
    const wslProject = screen.getByTestId(testIdFor.projectSelect('p1'))
    const badge = within(wslProject).getByText('WSL')
    expect(badge.getAttribute('title')).toBe('WSL: Ubuntu')
    expect(within(screen.getByTestId(testIdFor.projectSelect('p2'))).queryByText('WSL')).toBeNull()
  })

  it('renders state dot for every session with correct color, label, and accessibility', () => {
    const props = {
      ...defaultProps(),
      selectedChatId: 't1',
      chatsByProject: {
        p1: [
          { id: 't1', projectId: 'p1', name: 'Chat 1' },
          { id: 't2', projectId: 'p1', name: 'Chat 2' },
          { id: 't3', projectId: 'p1', name: 'Chat 3' },
        ],
      },
      sessionStatuses: { t1: 'running' as const },
      attention: { t2: { message: 'Approval required' } }, // waiting
      // t3 has neither -> idle
    }
    render(navigation({ ...props }))

    // Running session (t1)
    const row1 = screen.getByTestId(testIdFor.chatRow('t1'))
    const dot1 = screen.getByTestId(testIdFor.chatStatusDot('t1'))
    expect(dot1.getAttribute('aria-hidden')).toBe('true')
    expect(dot1.style.backgroundColor).toBe('rgb(74, 222, 128)') // #4ADE80
    expect(row1.getAttribute('title')).toBe('Chat 1: running')
    expect(row1.getAttribute('aria-label')).toBe('Chat 1, running, now')
    // Active session: 1px accent border, 8% accent fill (spec §4.3)
    expect(row1.getAttribute('data-selected')).toBe('true')
    expect(row1.getAttribute('aria-current')).toBe('true')
    expect(row1.style.border).toContain('var(--color-accent)')
    expect(row1.style.backgroundColor).toContain('8%')

    // Waiting session (t2)
    const row2 = screen.getByTestId(testIdFor.chatRow('t2'))
    const dot2 = screen.getByTestId(testIdFor.chatStatusDot('t2'))
    expect(dot2.getAttribute('aria-hidden')).toBe('true')
    expect(dot2.style.backgroundColor).toBe('rgb(245, 158, 11)') // #F59E0B
    expect(row2.getAttribute('title')).toBe('Chat 2: waiting for input')
    expect(row2.getAttribute('aria-label')).toBe('Chat 2, waiting for input, now')
    // Inactive session: 1px border, card surface background
    expect(row2.getAttribute('aria-current')).toBe('false')
    expect(row2.style.border).toContain('var(--color-edge)')
    expect(row2.style.backgroundColor).toBe('var(--color-group)')

    // Idle session (t3)
    const row3 = screen.getByTestId(testIdFor.chatRow('t3'))
    const dot3 = screen.getByTestId(testIdFor.chatStatusDot('t3'))
    expect(dot3.getAttribute('aria-hidden')).toBe('true')
    expect(dot3.style.backgroundColor).toBe('rgb(138, 144, 166)') // #8A90A6
    expect(row3.getAttribute('title')).toBe('Chat 3: idle')
    expect(row3.getAttribute('aria-label')).toBe('Chat 3, idle, now')
    expect(row3.getAttribute('aria-current')).toBe('false')
    expect(row3.style.border).toContain('var(--color-edge)')
    expect(row3.style.backgroundColor).toBe('var(--color-group)')
  })

  it('renders task progress badge only when normalized progress is supplied', () => {
    const props = {
      ...defaultProps(),
      chatsByProject: {
        p1: [
          {
            id: 't1',
            projectId: 'p1',
            name: 'Task session',
            taskRef: 'NEKODE-42',
          },
          {
            id: 't2',
            projectId: 'p1',
            name: 'Plain session',
          },
        ],
      },
      taskSnapshots: { p1: progressSnapshot('NEKODE-42') },
    }
    render(navigation({ ...props }))

    const badge1 = screen.getByTestId(testIdFor.chatTaskProgress('t1'))
    expect(badge1.textContent).toBe('5/8')
    expect(badge1.getAttribute('title')).toBe('Task NEKODE-42: step 5 of 8')
    expect(badge1.style.color).toBe('rgb(90, 169, 255)') // #5AA9FF
    expect(badge1.style.backgroundColor).toContain('rgba(90, 169, 255, 0.12)')
    expect(badge1.className).toContain('font-mono')

    expect(screen.queryByTestId(testIdFor.chatTaskProgress('t2'))).toBeNull()
  })

  it('immediately updates dot color and resets time upon status change', () => {
    const props = {
      ...defaultProps(),
      chatsByProject: {
        p1: [{ id: 't1', projectId: 'p1', name: 'Chat 1' }],
      },
    }
    const view = render(navigation({ ...props }))
    const row = screen.getByTestId(testIdFor.chatRow('t1'))
    const dot = screen.getByTestId(testIdFor.chatStatusDot('t1'))

    // Starts idle
    expect(dot.style.backgroundColor).toBe('rgb(138, 144, 166)')
    expect(row.getAttribute('title')).toBe('Chat 1: idle')
    expect(screen.getByTestId(testIdFor.chatTime('t1')).textContent).toBe('now')

    // Becomes running via sessionStatuses
    view.rerender(navigation({ ...props, sessionStatuses: { t1: 'running' } }))
    expect(dot.style.backgroundColor).toBe('rgb(74, 222, 128)') // #4ADE80
    expect(row.getAttribute('title')).toBe('Chat 1: running')
    expect(screen.getByTestId(testIdFor.chatTime('t1')).textContent).toBe('now')

    // Becomes waiting via attention
    view.rerender(
      navigation({
        ...props,
        sessionStatuses: { t1: 'running' as const },
        attention: { t1: { message: 'Confirm?' } },
      }),
    )
    expect(dot.style.backgroundColor).toBe('rgb(245, 158, 11)') // #F59E0B
    expect(row.getAttribute('title')).toBe('Chat 1: waiting for input')
    expect(screen.getByTestId(testIdFor.chatTime('t1')).textContent).toBe('now')
  })

  it('reveals close control on hover and focus without removing the state dot', () => {
    const props = {
      ...defaultProps(),
      chatsByProject: {
        p1: [{ id: 't1', projectId: 'p1', name: 'Chat 1' }],
      },
    }
    render(navigation({ ...props }))
    const row = screen.getByTestId(testIdFor.chatRow('t1'))
    const dot = screen.getByTestId(testIdFor.chatStatusDot('t1'))
    const closeBtn = screen.getByTestId(testIdFor.chatClose('t1'))
    const timeSpan = screen.getByTestId(testIdFor.chatTime('t1'))

    expect(closeBtn.className).toContain('hidden')
    expect(timeSpan.className).not.toContain('invisible')
    expect(dot).toBeTruthy()

    // Hover reveals close button and hides time
    fireEvent.mouseEnter(row)
    expect(closeBtn.className).toContain('flex')
    expect(timeSpan.className).toContain('invisible')
    expect(dot).toBeTruthy() // Dot on the left remains visible

    // Leave restores time and hides close button
    fireEvent.mouseLeave(row.closest('li') as HTMLElement)
    expect(closeBtn.className).toContain('hidden')
    expect(timeSpan.className).not.toContain('invisible')
    expect(dot).toBeTruthy()
  })
})

describe('LeftNavigation project avatar and initials', () => {
  it('renders project avatar with initials and stable color by default', () => {
    const props = defaultProps()
    render(navigation({ ...props }))

    const avatar1 = screen.getByTestId(testIdFor.projectAvatar('p1'))
    expect(avatar1).toBeTruthy()
    expect(avatar1.textContent).toBe('N')
    expect(avatar1.getAttribute('aria-hidden')).toBe('true')
    // jsdom normalizes hex colors to rgb(...)
    expect(avatar1.style.color).toBe('rgb(139, 124, 246)') // #8B7CF6

    const avatar2 = screen.getByTestId(testIdFor.projectAvatar('p2'))
    expect(avatar2).toBeTruthy()
    expect(avatar2.textContent).toBe('AH')
    expect(avatar2.getAttribute('aria-hidden')).toBe('true')
    expect(avatar2.style.color).toBe('rgb(90, 169, 255)') // #5AA9FF
  })

  it('uses custom project color when provided in projectColors', () => {
    const props = defaultProps()
    props.projectColors = { p1: '#F472B6' }
    render(navigation({ ...props }))

    const avatar1 = screen.getByTestId(testIdFor.projectAvatar('p1'))
    expect(avatar1.style.color).toBe('rgb(244, 114, 182)') // #F472B6
    expect(avatar1.style.backgroundColor).toContain('244, 114, 182')
  })

  it('does not render avatars in DOM when showProjectIcons is false', () => {
    const props = defaultProps()
    props.showProjectIcons = false
    render(navigation({ ...props }))

    expect(screen.queryByTestId(testIdFor.projectAvatar('p1'))).toBeNull()
    expect(screen.queryByTestId(testIdFor.projectAvatar('p2'))).toBeNull()
  })

  it('folds with the chevron only and opens the project only from its icon and name (NEKODE-96)', () => {
    const props = defaultProps()
    render(navigation({ ...props }))

    // The chevron of an unselected project unfolds it without selecting it.
    const toggle2 = screen.getByTestId(testIdFor.projectToggle('p2'))
    expect(toggle2.getAttribute('aria-expanded')).toBe('false')
    expect(toggle2.getAttribute('aria-label')).toBe('Expand AGENT-HARNESS')
    fireEvent.click(toggle2)
    expect(props.onToggleProject).toHaveBeenCalledWith('p2')
    expect(props.onSelectProject).not.toHaveBeenCalled()

    // The chevron of the selected project folds it, still without selecting.
    const toggle1 = screen.getByTestId(testIdFor.projectToggle('p1'))
    expect(toggle1.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle1)
    expect(props.onToggleProject).toHaveBeenLastCalledWith('p1')
    expect(props.onSelectProject).not.toHaveBeenCalled()

    // The name of an unselected project opens it and does not toggle.
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p2')))
    expect(props.onSelectProject).toHaveBeenCalledWith('p2')
    expect(props.onToggleProject).toHaveBeenCalledTimes(2)

    // The name of the already-open project still reaches the host, which
    // opens its home tab and keeps the chat (project-home spec Behaviour 4).
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p1')))
    expect(props.onSelectProject).toHaveBeenCalledTimes(2)
    expect(props.onSelectProject).toHaveBeenLastCalledWith('p1')
    expect(props.onToggleProject).toHaveBeenCalledTimes(2)
  })

  it('applies bold font to expanded or active projects and regular to collapsed projects', () => {
    const props = defaultProps()
    // p1 is expanded and selected; p2 is neither
    props.expandedProjectIds = new Set(['p1'])
    props.selectedProjectId = 'p1'
    render(navigation({ ...props }))

    const btn1 = screen.getByTestId(testIdFor.projectSelect('p1'))
    const nameSpan1 = btn1.querySelector('span.truncate')
    expect(nameSpan1?.className).toContain('font-semibold')

    const btn2 = screen.getByTestId(testIdFor.projectSelect('p2'))
    const nameSpan2 = btn2.querySelector('span.truncate')
    expect(nameSpan2?.className).toContain('font-normal')
  })

  it('applies lighter font color on hover to collapsed projects matching active project color', () => {
    const props = defaultProps()
    // p1 is expanded and selected; p2 is collapsed and unselected
    props.expandedProjectIds = new Set(['p1'])
    props.selectedProjectId = 'p1'
    render(navigation({ ...props }))

    const btn1 = screen.getByTestId(testIdFor.projectSelect('p1'))
    expect(btn1.className).toContain('text-project-title')

    const btn2 = screen.getByTestId(testIdFor.projectSelect('p2'))
    expect(btn2.className).toContain('text-project-title-collapsed')
    expect(btn2.className).toContain('hover:text-project-title')
    expect(btn2.className).toContain('transition-colors')
  })

  it('highlights only the active project and labels its open session list', () => {
    const props = {
      ...defaultProps(),
      expandedProjectIds: new Set(['p1', 'p2']),
      selectedProjectId: 'p1',
      chatsByProject: {
        p1: [{ id: 't1', projectId: 'p1', name: 'Chat 1' }],
        p2: [{ id: 't2', projectId: 'p2', name: 'Chat 2' }],
      },
    }
    const view = render(navigation({ ...props }))

    const active = screen.getByTestId(testIdFor.projectRow('p1'))
    const inactive = screen.getByTestId(testIdFor.projectRow('p2'))
    expect(active.className).toContain('bg-selected')
    expect(inactive.className).not.toContain('bg-selected')
    expect(screen.getAllByText('Recent sessions')).toHaveLength(2)
    expect(active.closest('li')?.textContent).toContain('Recent sessions')
    expect(inactive.closest('li')?.textContent).toContain('Recent sessions')

    // Folding the selected project hides its heading. The other open
    // project keeps the heading because it still has sessions.
    view.rerender(navigation({ ...props, expandedProjectIds: new Set(['p2']) }))
    expect(screen.getAllByText('Recent sessions')).toHaveLength(1)
    expect(screen.getByTestId(testIdFor.projectRow('p1')).closest('li')?.textContent).not.toContain(
      'Recent sessions',
    )
    expect(screen.getByTestId(testIdFor.projectRow('p2')).closest('li')?.textContent).toContain(
      'Recent sessions',
    )
    expect(screen.getByTestId(testIdFor.projectRow('p1')).className).toContain('bg-selected')
  })

  it('shows only No active sessions when an open project has no sessions', () => {
    render(navigation({ ...defaultProps() }))
    const empty = screen.getByText('No active sessions')
    expect(screen.queryByText('Recent sessions')).toBeNull()
    expect(empty.className).toBe(SESSION_CAPTION_CLASS)
  })

  it('renders 34px project row with 32x32 action buttons (spec §4.1)', () => {
    const props = defaultProps()
    render(navigation({ ...props }))

    const row = screen.getByTestId(testIdFor.projectRow('p1'))
    expect(row.style.height).toBe('34px')

    const newChatBtn = within(row).getByTestId(TEST_ID.newChatButton)
    expect(newChatBtn.style.width).toBe('32px')
    expect(newChatBtn.style.height).toBe('32px')
    const newChatIcon = newChatBtn.querySelector('svg')
    expect(newChatIcon?.getAttribute('width')).toBe('16')
    expect(newChatIcon?.getAttribute('height')).toBe('16')

    const projectFilesBtn = screen.getByTestId(testIdFor.projectFiles('p1'))
    expect(projectFilesBtn.style.width).toBe('32px')
    expect(projectFilesBtn.style.height).toBe('32px')
    const projectFilesIcon = projectFilesBtn.querySelector('svg')
    expect(projectFilesIcon?.getAttribute('width')).toBe('16')
    expect(projectFilesIcon?.getAttribute('height')).toBe('16')
  })

  it('indents session cards 28px on the left (spec §4.3)', () => {
    const props = {
      ...defaultProps(),
      kanbanProjectIds: new Set(['p1']),
      chatsByProject: {
        p1: [{ id: 't1', projectId: 'p1', name: 'Chat 1' }],
      },
    }
    render(navigation({ ...props }))

    // Kanban pill under project row is retired
    expect(screen.queryByTestId(testIdFor.projectKanban('p1'))).toBeNull()

    const container = screen.getByTestId(testIdFor.projectChats('p1'))
    expect(container.style.paddingLeft).toBe('28px')
    const dot = screen.getByTestId(testIdFor.chatStatusDot('t1'))
    expect(dot.style.width).toBe('8px')
    expect(dot.style.height).toBe('8px')

    const timeSpan = screen.getByTestId(testIdFor.chatTime('t1'))
    expect(timeSpan).toBeTruthy()

    const closeBtn = screen.getByTestId(testIdFor.chatClose('t1'))
    expect(closeBtn.className).toContain('absolute')
  })

  it('dims stale progress and exposes its error in the title and accessible label', () => {
    const props = {
      ...defaultProps(),
      chatsByProject: {
        p1: [
          {
            id: 'n74',
            projectId: 'p1',
            name: 'NEKODE-74',
          },
        ],
      },
      taskSnapshots: { p1: progressSnapshot('NEKODE-74', true) },
    }
    render(navigation({ ...props }))

    const badge = screen.getByTestId(testIdFor.chatTaskProgress('n74'))
    expect(badge).toBeTruthy()
    expect(badge.textContent).toBe('5/8')
    expect(badge.style.opacity).toBe('0.5')
    expect(badge.getAttribute('title')).toBe(
      'Out of date: Source unavailable. Task NEKODE-74: step 5 of 8',
    )
    expect(badge.getAttribute('aria-label')).toBe(
      'Out of date: Source unavailable. Task progress: step 5 of 8, Fixes',
    )
  })

  it('switches between Projects and Sessions view via segmented control (spec §3 & §5)', () => {
    const props = {
      ...defaultProps(),
      chatsByProject: {
        p1: [
          { id: 'c1', projectId: 'p1', name: 'Chat 1' },
          { id: 'c2', projectId: 'p1', name: 'Chat 2' },
        ],
        p2: [{ id: 'c3', projectId: 'p2', name: 'Chat 3' }],
      },
      sessionStatuses: { c2: 'running' as const },
      attention: { c1: { message: 'Input required' } }, // waiting
    }
    render(navigation({ ...props }))

    // Segmented control has role="group" and aria-label="Sidebar view"
    const group = screen.getByRole('group', { name: 'Sidebar view' })
    expect(group).toBeTruthy()

    const projectsBtn = within(group).getByRole('button', { name: 'Projects' })
    const sessionsBtn = within(group).getByRole('button', { name: /^Sessions/ })
    expect(projectsBtn.getAttribute('aria-pressed')).toBe('true')
    expect(sessionsBtn.getAttribute('aria-pressed')).toBe('false')

    // Shows total session count
    expect(sessionsBtn.textContent).toContain('3')

    // Add project button is visible in Projects view
    expect(screen.getByTestId(TEST_ID.addProjectButton)).toBeTruthy()

    // Switch to Sessions view
    fireEvent.click(sessionsBtn)
    expect(sessionsBtn.getAttribute('aria-pressed')).toBe('true')
    expect(projectsBtn.getAttribute('aria-pressed')).toBe('false')

    // Add project button is hidden in Sessions view
    expect(screen.queryByTestId(TEST_ID.addProjectButton)).toBeNull()

    // Flat list of sessions remains in project and start order (never re-sorted by attention/status)
    const flatRows = screen.getAllByRole('button', { name: /Chat/ })
    expect(flatRows.length).toBe(3)
    expect(flatRows[0].textContent).toContain('Chat 1')
    expect(flatRows[1].textContent).toContain('Chat 2')
    expect(flatRows[2].textContent).toContain('Chat 3')

    // Clicking a flat session row selects it
    fireEvent.click(flatRows[0])
    expect(props.onSelectChat).toHaveBeenCalledWith('p1', 'c1')
  })

  it('does not re-sort the sessions view or change idle status when an idle session is selected or has terminal activity', () => {
    const props = {
      ...defaultProps(),
      chatsByProject: {
        p1: [
          { id: 'c1', projectId: 'p1', name: 'Chat 1' },
          { id: 'c2', projectId: 'p1', name: 'Chat 2' },
          { id: 'c3', projectId: 'p1', name: 'Chat 3' },
        ],
      },
      sessionStatuses: { c1: 'running' as const },
    }
    const view = render(navigation({ ...props }))

    // Switch to Sessions view
    const group = screen.getByRole('group', { name: 'Sidebar view' })
    const sessionsBtn = within(group).getByRole('button', { name: /^Sessions/ })
    fireEvent.click(sessionsBtn)

    // c1 is running (first), c2 is idle (second), c3 is idle (third)
    let rows = screen.getAllByRole('button', { name: /Chat/ })
    expect(rows[0].textContent).toContain('Chat 1')
    expect(rows[1].textContent).toContain('Chat 2')
    expect(rows[2].textContent).toContain('Chat 3')

    // Selecting c3 and emitting activity on it (simulating terminal resize redraw on click)
    view.rerender(
      navigation({
        ...props,
        selectedChatId: 'c3',
        activity: new Set(['c3']),
      }),
    )

    // c3 remains idle and its position does not jump to the top
    rows = screen.getAllByRole('button', { name: /Chat/ })
    expect(rows[0].textContent).toContain('Chat 1')
    expect(rows[1].textContent).toContain('Chat 2')
    expect(rows[2].textContent).toContain('Chat 3')
  })

  it('new session agent menu renders in a portal with clamped positioning and block items', async () => {
    const props = {
      ...defaultProps(),
      loadAgentProfiles: vi.fn().mockResolvedValue({
        version: 1,
        profiles: [
          { id: 'p-1', name: 'Hermes Coder' },
          { id: 'p-2', name: 'Hermes MiMo-v2.6-Pro' },
        ],
      }),
    }
    render(navigation({ ...props }))

    const newChatBtn = screen.getAllByTestId(TEST_ID.newChatButton)[0]
    fireEvent.contextMenu(newChatBtn, { clientX: 9999, clientY: 9999 })

    const menu = await screen.findByTestId(TEST_ID.newChatAgentMenu)
    expect(menu.parentElement?.parentElement).toBe(document.body)

    const profileItem = await screen.findByTestId(testIdFor.newChatAgentProfile('p-1'))
    expect(profileItem.className).toContain('block')
    expect(profileItem.className).toContain('whitespace-nowrap')
    // Clamped coordinates should not be 9999
    expect(Number.parseInt(menu.style.left, 10)).toBeLessThan(9999)
    expect(Number.parseInt(menu.style.top, 10)).toBeLessThan(9999)
  })

  it('does not render git branch info on the project row', () => {
    const props = defaultProps()
    render(navigation({ ...props }))

    const projectRow = screen.getByTestId(testIdFor.projectRow('p1'))
    expect(projectRow.textContent).toContain('NEKODE')
    expect(projectRow.textContent).not.toContain('main')
    expect(projectRow.textContent).not.toContain('master')
  })
})
