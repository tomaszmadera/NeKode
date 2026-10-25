import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatInfo, ProjectInfo } from '../../../../shared/ipc-contract'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { LeftNavigation } from './LeftNavigation'

afterEach(cleanup)

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
  it('shows the Kanban ref with an agent badge and uses its identity for selection and closing', () => {
    const props = defaultProps()
    const chat: ChatInfo = {
      id: 'task',
      projectId: 'p1',
      name: '[PS7] Analysis',
      taskRef: 'NEKODE-42',
      agentName: 'Codex',
    }
    render(<LeftNavigation {...props} chatsByProject={{ p1: [chat] }} />)
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
    render(<LeftNavigation {...defaultProps()} chatsByProject={{ p1: chats }} />)
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
    render(<LeftNavigation {...props} />)
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
      activity: new Set(['t1']), // running
      attention: { t2: { message: 'Approval required' } }, // waiting
      // t3 has neither -> idle
    }
    render(<LeftNavigation {...props} />)

    // Running session (t1)
    const row1 = screen.getByTestId(testIdFor.chatRow('t1'))
    const dot1 = screen.getByTestId(testIdFor.chatStatusDot('t1'))
    expect(dot1.getAttribute('aria-hidden')).toBe('true')
    expect(dot1.style.backgroundColor).toBe('rgb(74, 222, 128)') // #4ADE80
    expect(row1.getAttribute('title')).toBe('Chat 1: running')
    expect(row1.getAttribute('aria-label')).toBe('Chat 1, running, now')
    // Active session styling: selected-row and project-title theme tokens
    expect(row1.className).toContain('bg-selected')
    expect(row1.className).toContain('text-project-title')

    // Waiting session (t2)
    const row2 = screen.getByTestId(testIdFor.chatRow('t2'))
    const dot2 = screen.getByTestId(testIdFor.chatStatusDot('t2'))
    expect(dot2.getAttribute('aria-hidden')).toBe('true')
    expect(dot2.style.backgroundColor).toBe('rgb(245, 158, 11)') // #F59E0B
    expect(row2.getAttribute('title')).toBe('Chat 2: waiting for input')
    expect(row2.getAttribute('aria-label')).toBe('Chat 2, waiting for input, now')
    // Inactive session styling: transparent bg, no border
    expect(row2.className).toContain('bg-transparent')
    expect(row2.className).toContain('border-0')

    // Idle session (t3)
    const row3 = screen.getByTestId(testIdFor.chatRow('t3'))
    const dot3 = screen.getByTestId(testIdFor.chatStatusDot('t3'))
    expect(dot3.getAttribute('aria-hidden')).toBe('true')
    expect(dot3.style.backgroundColor).toBe('rgb(138, 144, 166)') // #8A90A6
    expect(row3.getAttribute('title')).toBe('Chat 3: idle')
    expect(row3.getAttribute('aria-label')).toBe('Chat 3, idle, now')
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
          },
          {
            id: 't2',
            projectId: 'p1',
            name: 'Plain session',
          },
        ],
      },
      sessionTasks: { t1: { taskId: 'NEKODE-42', step: 5, totalSteps: 8 } },
    }
    render(<LeftNavigation {...props} />)

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
    const view = render(<LeftNavigation {...props} />)
    const row = screen.getByTestId(testIdFor.chatRow('t1'))
    const dot = screen.getByTestId(testIdFor.chatStatusDot('t1'))

    // Starts idle
    expect(dot.style.backgroundColor).toBe('rgb(138, 144, 166)')
    expect(row.getAttribute('title')).toBe('Chat 1: idle')
    expect(screen.getByTestId(testIdFor.chatTime('t1')).textContent).toBe('now')

    // Becomes running via activity
    view.rerender(<LeftNavigation {...props} activity={new Set(['t1'])} />)
    expect(dot.style.backgroundColor).toBe('rgb(74, 222, 128)') // #4ADE80
    expect(row.getAttribute('title')).toBe('Chat 1: running')
    expect(screen.getByTestId(testIdFor.chatTime('t1')).textContent).toBe('now')

    // Becomes waiting via attention
    view.rerender(
      <LeftNavigation
        {...props}
        activity={new Set(['t1'])}
        attention={{ t1: { message: 'Confirm?' } }}
      />,
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
    render(<LeftNavigation {...props} />)
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
    render(<LeftNavigation {...props} />)

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
    render(<LeftNavigation {...props} />)

    const avatar1 = screen.getByTestId(testIdFor.projectAvatar('p1'))
    expect(avatar1.style.color).toBe('rgb(244, 114, 182)') // #F472B6
    expect(avatar1.style.backgroundColor).toContain('244, 114, 182')
  })

  it('does not render avatars in DOM when showProjectIcons is false', () => {
    const props = defaultProps()
    props.showProjectIcons = false
    render(<LeftNavigation {...props} />)

    expect(screen.queryByTestId(testIdFor.projectAvatar('p1'))).toBeNull()
    expect(screen.queryByTestId(testIdFor.projectAvatar('p2'))).toBeNull()
  })

  it('folds with the chevron only and opens the project only from its icon and name (NEKODE-96)', () => {
    const props = defaultProps()
    render(<LeftNavigation {...props} />)

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
    render(<LeftNavigation {...props} />)

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
    render(<LeftNavigation {...props} />)

    const btn1 = screen.getByTestId(testIdFor.projectSelect('p1'))
    expect(btn1.className).toContain('text-project-title')

    const btn2 = screen.getByTestId(testIdFor.projectSelect('p2'))
    expect(btn2.className).toContain('text-project-title-collapsed')
    expect(btn2.className).toContain('hover:text-project-title')
    expect(btn2.className).toContain('transition-colors')
  })

  it('renders project row flush left with no hover background and enlarged action buttons', () => {
    const props = defaultProps()
    render(<LeftNavigation {...props} />)

    const row = screen.getByTestId(testIdFor.projectRow('p1'))
    expect(row.className).not.toContain('hover:bg-row-hover')
    expect(row.className).toContain('pl-0')
    expect(row.className).toContain('pr-0')

    const selectBtn = screen.getByTestId(testIdFor.projectSelect('p1'))
    expect(selectBtn.className).toContain('pl-0')

    const newChatBtn = within(row).getByTestId(TEST_ID.newChatButton)
    expect(newChatBtn.className).toContain('h-7')
    expect(newChatBtn.className).toContain('w-7')
    const newChatIcon = newChatBtn.querySelector('svg')
    expect(newChatIcon?.getAttribute('width')).toBe('14')
    expect(newChatIcon?.getAttribute('height')).toBe('14')

    const projectFilesBtn = screen.getByTestId(testIdFor.projectFiles('p1'))
    expect(projectFilesBtn.className).toContain('h-7')
    expect(projectFilesBtn.className).toContain('w-7')
    const projectFilesIcon = projectFilesBtn.querySelector('svg')
    expect(projectFilesIcon?.getAttribute('width')).toBe('14')
    expect(projectFilesIcon?.getAttribute('height')).toBe('14')
  })

  it('does not render Kanban pill under project and aligns session status dot at 20px', () => {
    const props = {
      ...defaultProps(),
      kanbanProjectIds: new Set(['p1']),
      chatsByProject: {
        p1: [{ id: 't1', projectId: 'p1', name: 'Chat 1' }],
      },
    }
    render(<LeftNavigation {...props} />)

    // Kanban pill under project row is retired
    expect(screen.queryByTestId(testIdFor.projectKanban('p1'))).toBeNull()

    // Session alignment at 20px (pl-5 / pr-5 / right-5)
    const chatBtn = screen.getByTestId(testIdFor.chatRow('t1'))
    expect(chatBtn.className).toContain('pl-5')
    expect(chatBtn.className).toContain('pr-5')
    const dot = screen.getByTestId(testIdFor.chatStatusDot('t1'))
    expect(dot.className).toContain('h-2')
    expect(dot.className).toContain('w-2')

    const timeSpan = screen.getByTestId(testIdFor.chatTime('t1'))
    expect(timeSpan).toBeTruthy()

    const closeBtn = screen.getByTestId(testIdFor.chatClose('t1'))
    expect(closeBtn.className).toContain('right-5')
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
      sessionTasks: {
        n74: {
          taskId: 'NEKODE-74',
          step: 5,
          totalSteps: 8,
          stale: true,
          staleReason: 'Source unavailable',
          ariaLabel: 'Out of date: Source unavailable. Task progress: step 5 of 8, Fixes',
        },
      },
    }
    render(<LeftNavigation {...props} />)

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
})
