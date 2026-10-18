import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectInfo } from '../../../../shared/ipc-contract'
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
    expect(row1.getAttribute('title')).toBe('running')
    expect(row1.getAttribute('aria-label')).toBe('Chat 1, running, now')
    // Active session styling: #262B3F bg and white text
    expect(row1.className).toContain('bg-[#262B3F]')
    expect(row1.className).toContain('text-white')

    // Waiting session (t2)
    const row2 = screen.getByTestId(testIdFor.chatRow('t2'))
    const dot2 = screen.getByTestId(testIdFor.chatStatusDot('t2'))
    expect(dot2.getAttribute('aria-hidden')).toBe('true')
    expect(dot2.style.backgroundColor).toBe('rgb(245, 158, 11)') // #F59E0B
    expect(row2.getAttribute('title')).toBe('waiting for input')
    expect(row2.getAttribute('aria-label')).toBe('Chat 2, waiting for input, now')
    // Inactive session styling: transparent bg, no border
    expect(row2.className).toContain('bg-transparent')
    expect(row2.className).toContain('border-0')

    // Idle session (t3)
    const row3 = screen.getByTestId(testIdFor.chatRow('t3'))
    const dot3 = screen.getByTestId(testIdFor.chatStatusDot('t3'))
    expect(dot3.getAttribute('aria-hidden')).toBe('true')
    expect(dot3.style.backgroundColor).toBe('rgb(138, 144, 166)') // #8A90A6
    expect(row3.getAttribute('title')).toBe('idle')
    expect(row3.getAttribute('aria-label')).toBe('Chat 3, idle, now')
  })

  it('renders task progress badge only when session has a Kanban task', () => {
    const props = {
      ...defaultProps(),
      chatsByProject: {
        p1: [
          {
            id: 't1',
            projectId: 'p1',
            name: 'Task session',
            task: { taskId: 'NEKODE-42', step: 5, totalSteps: 8 },
          },
          {
            id: 't2',
            projectId: 'p1',
            name: 'Plain session',
          },
        ],
      },
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
    expect(row.getAttribute('title')).toBe('idle')
    expect(screen.getByTestId(testIdFor.chatTime('t1')).textContent).toBe('now')

    // Becomes running via activity
    view.rerender(<LeftNavigation {...props} activity={new Set(['t1'])} />)
    expect(dot.style.backgroundColor).toBe('rgb(74, 222, 128)') // #4ADE80
    expect(row.getAttribute('title')).toBe('running')
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
    expect(row.getAttribute('title')).toBe('waiting for input')
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
})
