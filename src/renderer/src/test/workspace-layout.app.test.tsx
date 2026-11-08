import { APP_STATE_KEY, type AppApi, type ChatInfo, type ProjectInfo } from '@shared/ipc-contract'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { TEST_ID, testIdFor } from '../lib/test-ids'
import { THEME_STORAGE_KEY } from '../lib/theme'
import { createAppApiStub } from './app-api-stub'
import { resetMockFitAddons } from './fit-addon-mock'
import { openProjectHome } from './open-project-home'
import { resetMockTerminals } from './xterm-mock'

// Workspace layout modes (docs/features/workspace-layout/spec.md). xterm is
// mocked because the shell mounts the chat workspace in jsdom.

vi.mock('@xterm/xterm', () => import('./xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('./fit-addon-mock'))

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

function getByTestIdString(testId: string): HTMLElement {
  const element = screen.getByTestId(testId)
  expect(element).toBeTruthy()
  return element
}

describe('workspace layout modes', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectB])
    vi.mocked(app.chats.list).mockImplementation(async (projectId) =>
      projectId === 'p1' ? [chatOne] : [],
    )
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  async function selectSessionInDemo(): Promise<void> {
    render(<App app={app} />)
    openProjectHome(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await waitFor(() => {
      expect(getByTestIdString(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')
    })
  }

  it('uses the status-bar right toggle for layout and defaults to two panels', async () => {
    render(<App app={app} />)
    const titleBar = await screen.findByTestId(TEST_ID.titleBar)
    const toggle = screen.getByTestId(TEST_ID.statusRightToggle)
    expect(within(titleBar).queryByRole('group', { name: 'Workspace layout' })).toBeNull()
    expect(toggle.hasAttribute('disabled')).toBe(false)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.getAttribute('aria-label')).toBe('Show right panel')
    expect(screen.queryByTestId(TEST_ID.rightRegion)).toBeNull()

    fireEvent.click(toggle)
    await waitFor(() => {
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.workspaceLayout, 'three')
    })
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.rightRegionOpen, '1')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toBe('Hide right panel')
    expect(screen.getByTestId(TEST_ID.rightFilesEmpty).textContent).toBe(
      'Select a project to browse its files.',
    )
  })

  it('opens the left tree from the chevron and returns with Back', async () => {
    render(<App app={app} />)
    const filesButton = await screen.findByTestId(testIdFor.projectFiles('p1'))
    expect(filesButton.getAttribute('aria-label')).toBe('Open file tree of Demo')
    expect(filesButton.hasAttribute('disabled')).toBe(false)
    fireEvent.click(filesButton)
    const back = await screen.findByRole('button', { name: 'Back to projects' })
    expect(within(screen.getByTestId(TEST_ID.leftNav)).getByTestId(TEST_ID.fileTree)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.rightRegion)).toBeNull()
    fireEvent.click(back)
    await waitFor(() => {
      expect(within(screen.getByTestId(TEST_ID.leftNav)).queryByTestId(TEST_ID.fileTree)).toBeNull()
    })
  })

  it('keeps the three-panel tree on the resolved project and returns it to the left only in two-panel mode', async () => {
    await selectSessionInDemo()
    fireEvent.click(screen.getByTestId(testIdFor.projectFiles('p2')))
    await screen.findByTestId(TEST_ID.fileTree)
    expect(getByTestIdString(TEST_ID.filesProjectName).textContent).toBe('OTHER')

    fireEvent.click(screen.getByTestId(TEST_ID.statusRightToggle))
    const right = await screen.findByTestId(TEST_ID.rightRegion)
    await waitFor(() => {
      expect(within(right).getByTestId(TEST_ID.filesProjectName).textContent).toBe('DEMO')
    })
    expect(within(screen.getByTestId(TEST_ID.leftNav)).queryByTestId(TEST_ID.fileTree)).toBeNull()
    expect(within(right).queryByRole('button', { name: 'Back to projects' })).toBeNull()
    expect(within(right).getByTestId(TEST_ID.filesRefreshButton)).toBeTruthy()

    const chevron = screen.getByTestId(testIdFor.projectFiles('p1'))
    expect(chevron.hasAttribute('disabled')).toBe(true)
    expect(chevron.getAttribute('aria-label')).toBe('File tree of Demo')
    expect(chevron.getAttribute('title')).toBe('File tree')
    fireEvent.click(chevron)
    expect(within(screen.getByTestId(TEST_ID.leftNav)).queryByTestId(TEST_ID.fileTree)).toBeNull()
    expect(within(right).getByTestId(TEST_ID.filesProjectName).textContent).toBe('DEMO')
    expect(getByTestIdString(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')

    openProjectHome(screen.getByTestId(testIdFor.projectSelect('p2')))
    await waitFor(() => {
      expect(within(right).getByTestId(TEST_ID.filesProjectName).textContent).toBe('OTHER')
    })
    expect(getByTestIdString(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('false')

    fireEvent.click(screen.getByTestId(TEST_ID.statusRightToggle))
    await waitFor(() => {
      expect(screen.queryByTestId(TEST_ID.rightRegion)).toBeNull()
    })
    expect(screen.getByTestId(TEST_ID.statusRightToggle).getAttribute('aria-pressed')).toBe('false')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.rightRegionOpen, '0')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.workspaceLayout, 'two')

    const leftTree = await screen.findByTestId(TEST_ID.fileTree)
    expect(screen.getByTestId(TEST_ID.leftNav).contains(leftTree)).toBe(true)
    expect(screen.queryByTestId(TEST_ID.rightRegion)).toBeNull()
    expect(getByTestIdString(TEST_ID.filesProjectName).textContent).toBe('OTHER')
    expect(screen.getByRole('button', { name: 'Back to projects' })).toBeTruthy()
  })

  it('shows the left slot before sliding its tree in when the slot was hidden', async () => {
    render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectFiles('p1'))
    fireEvent.click(screen.getByTestId(TEST_ID.statusLeftToggle))
    expect(screen.getByTestId(TEST_ID.leftNav).parentElement?.className).toContain('hidden')
    fireEvent.click(screen.getByTestId(testIdFor.projectFiles('p1')))
    await waitFor(() => {
      expect(screen.getByTestId(TEST_ID.leftNav).parentElement?.className).not.toContain('hidden')
    })
    expect(within(screen.getByTestId(TEST_ID.leftNav)).getByTestId(TEST_ID.fileTree)).toBeTruthy()
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.leftRegionOpen, '1')
  })

  it('restores layout, clamped right width, and open flags', async () => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.workspaceLayout) return 'three'
      if (key === APP_STATE_KEY.rightRegionWidth) return '900'
      if (key === APP_STATE_KEY.leftRegionOpen) return '0'
      if (key === APP_STATE_KEY.rightRegionOpen) return '1'
      return null
    })
    render(<App app={app} />)
    await waitFor(() => {
      expect(screen.getByTestId(TEST_ID.statusRightToggle).getAttribute('aria-pressed')).toBe(
        'true',
      )
    })
    expect(screen.getByTestId(TEST_ID.leftNav).parentElement?.className).toContain('hidden')
    expect(getByTestIdString(TEST_ID.rightRegion).style.width).toBe('480px')
  })

  it('keeps a stored right width without rendering a right slot in two-panel mode', async () => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.workspaceLayout) return 'sideways'
      if (key === APP_STATE_KEY.rightRegionWidth) return '300'
      if (key === APP_STATE_KEY.rightRegionOpen) return '1'
      return null
    })
    render(<App app={app} />)
    await waitFor(() => expect(app.projects.list).toHaveBeenCalled())
    expect(screen.getByTestId(TEST_ID.statusRightToggle).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByTestId(TEST_ID.rightRegion)).toBeNull()
    fireEvent.click(screen.getByTestId(TEST_ID.statusRightToggle))
    await waitFor(() => {
      expect(getByTestIdString(TEST_ID.rightRegion).style.width).toBe('300px')
    })
  })

  it('reopens a previously hidden three-panel layout with the same right toggle', async () => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.workspaceLayout) return 'three'
      if (key === APP_STATE_KEY.rightRegionOpen) return '0'
      return null
    })
    render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectSelect('p1'))
    const toggle = screen.getByTestId(TEST_ID.statusRightToggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByTestId(TEST_ID.rightRegion)).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId(TEST_ID.rightRegion)).toBeTruthy()
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.rightRegionOpen, '1')
  })

  it('shows a failed panel write when the left slot is hidden', async () => {
    vi.mocked(app.state.set).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.leftRegionOpen) {
        throw new Error('disk')
      }
    })
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(TEST_ID.statusLeftToggle))
    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('Failed to save the left panel.')
    expect(notice.closest('.hidden')).toBeNull()
    expect(screen.getByTestId(TEST_ID.leftNav).parentElement?.className).toContain('hidden')
  })

  it('does not let hydration overwrite a layout or open toggle that landed first', async () => {
    let resolveLayout: (value: string | null) => void = () => undefined
    let resolveLeft: (value: string | null) => void = () => undefined
    let resolveRight: (value: string | null) => void = () => undefined
    const layoutGate = new Promise<string | null>((resolve) => {
      resolveLayout = resolve
    })
    const leftGate = new Promise<string | null>((resolve) => {
      resolveLeft = resolve
    })
    const rightGate = new Promise<string | null>((resolve) => {
      resolveRight = resolve
    })
    vi.mocked(app.state.get).mockImplementation((key) => {
      if (key === APP_STATE_KEY.workspaceLayout) return layoutGate
      if (key === APP_STATE_KEY.leftRegionOpen) return leftGate
      if (key === APP_STATE_KEY.rightRegionOpen) return rightGate
      return Promise.resolve(null)
    })
    render(<App app={app} />)
    await screen.findByTestId(TEST_ID.statusRightToggle)
    fireEvent.click(screen.getByTestId(TEST_ID.statusRightToggle))
    fireEvent.click(screen.getByTestId(TEST_ID.statusLeftToggle))
    resolveLayout('two')
    resolveLeft('1')
    resolveRight('0')
    await waitFor(() => expect(app.projects.list).toHaveBeenCalled())
    await act(async () => {
      await layoutGate
      await leftGate
      await rightGate
    })
    expect(screen.getByTestId(TEST_ID.statusRightToggle).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId(TEST_ID.leftNav).parentElement?.className).toContain('hidden')
    expect(screen.getByTestId(TEST_ID.statusLeftToggle).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId(TEST_ID.rightRegion)).toBeTruthy()
  })

  it('keeps the new layout when saving it fails and shows the notice', async () => {
    vi.mocked(app.state.set).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.workspaceLayout) {
        throw new Error('disk')
      }
    })
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(TEST_ID.statusRightToggle))
    expect((await screen.findByTestId(TEST_ID.actionNotice)).textContent).toContain(
      'Failed to save the layout.',
    )
    expect(screen.getByTestId(TEST_ID.statusRightToggle).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId(TEST_ID.rightRegion)).toBeTruthy()
  })

  it('writes a finished right-edge resize and leaves the bottom terminal flag to its own control', async () => {
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(TEST_ID.statusRightToggle))
    const handle = await screen.findByTestId(TEST_ID.rightResizeHandle)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    await waitFor(() => {
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.rightRegionWidth, '296')
    })
    expect(getByTestIdString(TEST_ID.rightRegion).style.width).toBe('296px')

    const right = screen.getByTestId(TEST_ID.statusRightToggle)
    expect(right.hasAttribute('disabled')).toBe(false)
    fireEvent.click(right)
    expect(right.hasAttribute('disabled')).toBe(false)
    expect(right.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByTestId(TEST_ID.rightRegion)).toBeNull()
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.workspaceLayout, 'two')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.rightRegionOpen, '0')
    fireEvent.click(right)
    expect(screen.getByTestId(TEST_ID.rightRegion).style.width).toBe('296px')

    const callsBeforeTerminal = vi.mocked(app.state.set).mock.calls.length
    fireEvent.click(screen.getByTestId(TEST_ID.statusTerminalToggle))
    await waitFor(() => {
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.bottomRegionOpen, '1')
    })
    const terminalWrites = vi.mocked(app.state.set).mock.calls.slice(callsBeforeTerminal)
    expect(terminalWrites).toEqual([[APP_STATE_KEY.bottomRegionOpen, '1']])
  })

  it('uses the left slot detached treatment on the right slot in the float theme', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'nekode-float')
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(TEST_ID.statusRightToggle))
    const right = await screen.findByTestId(TEST_ID.rightRegion)
    const left = screen.getByTestId(TEST_ID.leftNav)
    expect(right.className).toContain('m-2')
    expect(right.className).toContain('rounded-[10px]')
    expect(right.className).toContain('border')
    expect(left.closest('.nk-workspace-row')).not.toBeNull()
    expect(left.className).toContain('rounded-[10px]')
    expect(right.className).not.toContain('border-l')
  })

  it('gives the right slot a left border outside the float theme', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'nekode-flat')
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(TEST_ID.statusRightToggle))
    const right = await screen.findByTestId(TEST_ID.rightRegion)
    expect(right.className).toContain('border-l')
    expect(right.className).not.toContain('m-2')
  })

  it('toggles left panel on Ctrl+B and right panel on Ctrl+Alt+B, and ignores chords when a modal is open', async () => {
    render(<App app={app} />)
    await screen.findByTestId(TEST_ID.statusLeftToggle)

    // Initially left is open, right is closed
    expect(screen.getByTestId(TEST_ID.statusLeftToggle).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId(TEST_ID.statusRightToggle).getAttribute('aria-pressed')).toBe('false')

    // Ctrl+B toggles left panel closed
    fireEvent.keyDown(window, { code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true })
    await waitFor(() => {
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.leftRegionOpen, '0')
    })
    expect(screen.getByTestId(TEST_ID.statusLeftToggle).getAttribute('aria-pressed')).toBe('false')

    // Ctrl+B toggles left panel open again
    fireEvent.keyDown(window, { code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true })
    await waitFor(() => {
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.leftRegionOpen, '1')
    })
    expect(screen.getByTestId(TEST_ID.statusLeftToggle).getAttribute('aria-pressed')).toBe('true')

    // Ctrl+Alt+B toggles right panel open
    fireEvent.keyDown(window, {
      code: 'KeyB',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    await waitFor(() => {
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.workspaceLayout, 'three')
    })
    expect(screen.getByTestId(TEST_ID.statusRightToggle).getAttribute('aria-pressed')).toBe('true')

    // Ctrl+Alt+B toggles right panel closed
    fireEvent.keyDown(window, {
      code: 'KeyB',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    await waitFor(() => {
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.workspaceLayout, 'two')
    })
    expect(screen.getByTestId(TEST_ID.statusRightToggle).getAttribute('aria-pressed')).toBe('false')

    // Open modal dialog: chords should be ignored
    fireEvent.click(screen.getByRole('button', { name: 'App settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'App Settings' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    const leftPressedBefore = screen
      .getByTestId(TEST_ID.statusLeftToggle)
      .getAttribute('aria-pressed')
    const rightPressedBefore = screen
      .getByTestId(TEST_ID.statusRightToggle)
      .getAttribute('aria-pressed')

    fireEvent.keyDown(window, { code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true })
    fireEvent.keyDown(window, {
      code: 'KeyB',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })

    expect(screen.getByTestId(TEST_ID.statusLeftToggle).getAttribute('aria-pressed')).toBe(
      leftPressedBefore,
    )
    expect(screen.getByTestId(TEST_ID.statusRightToggle).getAttribute('aria-pressed')).toBe(
      rightPressedBefore,
    )
  })
})
