import type { AppApi, GitStatus, GitWorktreeStatus, ProjectInfo } from '@shared/ipc-contract'
import { emptyGitWorktree } from '@shared/ipc-contract'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { createAppApiStub as appApiStub } from '../../test/app-api-stub'
import {
  gitHoverDetails,
  gitStatusText,
  MAX_RUNTIME_BADGES,
  runtimeLabels,
  STATUS_BAR_GIT_REFRESH_INTERVAL_MS,
  StatusBar,
} from './StatusBar'

// Status bar (UX-UI §14–16 / center-layout-tabs-actions spec Behaviour 18):
// project name, visually truncated path (full on hover), runtime badges with
// `+N` collapse, git branch form (git icon + name) and worktree status forms
// with hover details; empty project section with no project and the "no git"
// degradation (no branch, neutral status, no error banner).

const projectA: ProjectInfo = {
  id: 'p1',
  name: 'gerde.pl',
  path: 'D:/Projects/gerde.pl',
  runtimeLabel: 'PHP 8.5',
}

function createAppApiStub(gitStatus?: Partial<GitStatus>): AppApi {
  // Divergences from the shared factory: chats.create names this file's chat,
  // and git.getStatus spreads the caller's status over the clean default.
  const stub = appApiStub()
  return {
    ...stub,
    chats: {
      ...stub.chats,
      create: vi.fn().mockResolvedValue({ id: 't1', projectId: 'p1', name: 'PowerShell' }),
    },
    git: {
      ...stub.git,
      getStatus: vi.fn().mockResolvedValue({
        branch: 'main',
        dirty: false,
        worktree: emptyGitWorktree(),
        ...gitStatus,
      }),
    },
  }
}
function worktree(values: Partial<GitWorktreeStatus>): GitWorktreeStatus {
  return { ...emptyGitWorktree(), ...values }
}

describe('status bar — project context (UX-UI §14)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })
  afterEach(() => {
    cleanup()
  })

  it('renders the project name and the full path with the full value on hover', async () => {
    render(<StatusBar app={app} project={projectA} />)
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('gerde.pl')
    const path = screen.getByTestId(TEST_ID.statusProjectPath)
    // The full path renders and the hover title repeats it (the CSS truncation
    // itself is not observable in jsdom).
    expect(path.textContent).toBe('D:/Projects/gerde.pl')
    expect(path.getAttribute('title')).toBe('D:/Projects/gerde.pl')
    await waitFor(() => expect(app.git.getStatus).toHaveBeenCalledWith('p1'))
  })

  it('shows a path under the home directory as ~ and keeps the full path on hover', async () => {
    app = { ...createAppApiStub(), platform: 'win32', homeDir: 'C:\\Users\\demo' }
    render(
      <StatusBar app={app} project={{ ...projectA, path: 'C:\\Users\\demo\\projects\\atlas' }} />,
    )
    const path = screen.getByTestId(TEST_ID.statusProjectPath)
    expect(path.textContent).toBe('~\\projects\\atlas')
    expect(path.getAttribute('title')).toBe('C:\\Users\\demo\\projects\\atlas')
    await waitFor(() => expect(app.git.getStatus).toHaveBeenCalledWith('p1'))
  })

  it('renders runtime badges and collapses the overflow to +N (UX-UI §15)', async () => {
    app = createAppApiStub()
    render(
      <StatusBar
        app={app}
        project={{ ...projectA, runtimeLabel: 'PHP 8.5, Node 24, Docker, Python 3.14, Unity 6' }}
      />,
    )
    const runtimes = screen.getByTestId(TEST_ID.statusRuntimes)
    expect(runtimes.textContent).toContain('PHP 8.5')
    expect(runtimes.textContent).toContain('Node 24')
    expect(runtimes.textContent).toContain('Docker')
    // The overflow is collapsed to `+2` and never shown as badges.
    const more = screen.getByTestId(TEST_ID.statusRuntimeMore)
    expect(more.textContent).toBe('+2')
    expect(more.getAttribute('title')).toBe('Python 3.14, Unity 6')
    expect(runtimes.textContent).not.toContain('Unity 6')
  })

  it('shows at most three runtime badges with no collapse marker for few labels', () => {
    render(<StatusBar app={app} project={projectA} />)
    expect(screen.getByTestId(TEST_ID.statusBar).getAttribute('data-panel-visible')).toBe('true')
    expect(screen.getByTestId(TEST_ID.statusBar).getAttribute('data-slide-state')).toBe('open')
    const runtimes = screen.getByTestId(TEST_ID.statusRuntimes)
    expect(runtimes.textContent).toBe('PHP 8.5')
    expect(screen.queryByTestId(TEST_ID.statusRuntimeMore)).toBeNull()
  })

  it('omits the runtime section when the project has no runtime label', () => {
    render(<StatusBar app={app} project={{ ...projectA, runtimeLabel: null }} />)
    expect(screen.queryByTestId(TEST_ID.statusRuntimes)).toBeNull()
  })

  it('keeps the bar with an empty project section when no project is active', () => {
    render(<StatusBar app={app} project={null} />)
    const bar = screen.getByTestId(TEST_ID.statusBar)
    expect(bar).toBeTruthy()
    expect(bar.getAttribute('data-panel-visible')).toBe('false')
    expect(bar.getAttribute('data-slide-state')).toBe('closed')
    expect(screen.queryByTestId(TEST_ID.statusProjectName)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.statusGitBranch)).toBeNull()
    expect(app.git.getStatus).not.toHaveBeenCalled()
  })
})

describe('status bar — git forms (UX-UI §16)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })
  afterEach(() => {
    cleanup()
  })

  it('renders the branch form (git icon + name) and the changes form with hover details', async () => {
    app = createAppApiStub({
      branch: 'feature/meta-pixel',
      dirty: true,
      worktree: worktree({ modified: 4, added: 2, untracked: 1, ahead: 3 }),
    })
    render(<StatusBar app={app} project={projectA} />)
    const branch = await screen.findByTestId(TEST_ID.statusGitBranch)
    expect(branch.textContent).toBe('feature/meta-pixel')
    const status = screen.getByTestId(TEST_ID.statusGitStatus)
    // The visible short form wires the worktree counts (StatusBar.tsx:180).
    expect(status.textContent).toBe('● 7 changes')
    const details = status.getAttribute('title') ?? ''
    expect(details).toContain('Modified')
    expect(details).toContain('Added')
    expect(details).toContain('Deleted')
    expect(details).toContain('Untracked')
    expect(details).toContain('Conflicts')
    expect(details).toContain('Ahead')
    expect(details).toContain('Behind')
    expect(details).toContain('4')
    expect(details).toContain('3')
  })

  it('renders the clean form for a clean worktree', async () => {
    app = createAppApiStub({ branch: 'main', dirty: false, worktree: worktree({}) })
    render(<StatusBar app={app} project={projectA} />)
    await screen.findByTestId(TEST_ID.statusGitStatus)
    expect(screen.getByTestId(TEST_ID.statusGitBranch).textContent).toBe('main')
  })

  it('renders the conflicts form when the worktree has conflicts', async () => {
    app = createAppApiStub({
      branch: 'main',
      dirty: true,
      worktree: worktree({ modified: 1, conflicts: 2 }),
    })
    render(<StatusBar app={app} project={projectA} />)
    await screen.findByTestId(TEST_ID.statusGitStatus)
  })

  it('degrades to the neutral "no git" state when git fails (never an error banner)', async () => {
    app = createAppApiStub()
    vi.mocked(app.git.getStatus).mockRejectedValue(new Error('git missing'))
    render(<StatusBar app={app} project={projectA} />)
    await screen.findByTestId(TEST_ID.statusGitNone)
    expect(screen.queryByTestId(TEST_ID.statusGitBranch)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    // The project context stays rendered despite the git failure.
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('gerde.pl')
  })

  it('degrades to "no git" for a project without a repository (no branch)', async () => {
    app = createAppApiStub({ branch: null, dirty: false, worktree: worktree({}) })
    render(<StatusBar app={app} project={projectA} />)
    await screen.findByTestId(TEST_ID.statusGitNone)
    expect(screen.queryByTestId(TEST_ID.statusGitBranch)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.statusGitStatus)).toBeNull()
  })

  it('refetches git status on window focus event', async () => {
    app = createAppApiStub()
    render(<StatusBar app={app} project={projectA} />)
    await waitFor(() => expect(app.git.getStatus).toHaveBeenCalledTimes(1))

    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(app.git.getStatus).toHaveBeenCalledTimes(2))
  })

  it('refetches git status on periodic interval when document is visible', async () => {
    vi.useFakeTimers()
    app = createAppApiStub()
    render(<StatusBar app={app} project={projectA} />)
    expect(app.git.getStatus).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(STATUS_BAR_GIT_REFRESH_INTERVAL_MS)
    expect(app.git.getStatus).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('refetches git status when refreshTrigger prop changes', async () => {
    app = createAppApiStub()
    const { rerender } = render(<StatusBar app={app} project={projectA} refreshTrigger={1} />)
    await waitFor(() => expect(app.git.getStatus).toHaveBeenCalledTimes(1))

    rerender(<StatusBar app={app} project={projectA} refreshTrigger={2} />)
    await waitFor(() => expect(app.git.getStatus).toHaveBeenCalledTimes(2))
  })
})

describe('status bar helpers (UX-UI §15–16 forms)', () => {
  it('splits the stored runtime label list and caps visible badges at three', () => {
    expect(runtimeLabels('PHP 8.5, Node 24, Docker, Python 3.14, Unity 6')).toHaveLength(5)
    expect(runtimeLabels(null)).toEqual([])
    expect(runtimeLabels('  ,  ')).toEqual([])
    expect(MAX_RUNTIME_BADGES).toBe(3)
  })

  it('builds the three worktree status forms', () => {
    expect(gitStatusText(worktree({}))).toBe('✓ clean')
    expect(gitStatusText(worktree({ modified: 4, added: 2, untracked: 1 }))).toBe('● 7 changes')
    expect(gitStatusText(worktree({ conflicts: 2, modified: 1 }))).toBe('! 2 conflicts')
  })

  it('builds the hover-details table rows (UX-UI §16)', () => {
    const details = gitHoverDetails(worktree({ modified: 4, added: 2, untracked: 1, ahead: 3 }))
    const rows = details.split(String.fromCharCode(10))
    expect(rows).toHaveLength(7)
    expect(rows[0]).toContain('Modified')
    expect(rows[0].endsWith('4')).toBe(true)
    expect(rows[5]).toContain('Ahead')
    expect(rows[5].endsWith('3')).toBe(true)
  })
})

describe('status bar — quick theme switcher', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })
  afterEach(() => {
    cleanup()
  })

  it('does not render quick theme switcher when quickThemeSwitch is false or omitted', () => {
    render(<StatusBar app={app} project={projectA} theme="nekode-flat" onThemeChange={vi.fn()} />)
    expect(screen.queryByTestId(TEST_ID.statusThemeSwitcher)).toBeNull()

    render(
      <StatusBar
        app={app}
        project={projectA}
        theme="nekode-flat"
        quickThemeSwitch={false}
        onThemeChange={vi.fn()}
      />,
    )
    expect(screen.queryByTestId(TEST_ID.statusThemeSwitcher)).toBeNull()
  })

  it('renders quick theme switcher with current theme name when quickThemeSwitch is true', () => {
    render(
      <StatusBar
        app={app}
        project={projectA}
        theme="nekode-flat"
        quickThemeSwitch={true}
        onThemeChange={vi.fn()}
      />,
    )
    const switcher = screen.getByTestId(TEST_ID.statusThemeSwitcher)
    expect(switcher).toBeTruthy()
    expect(switcher.textContent).toContain('NeKode Flat')
    expect(switcher.className).toContain('ml-auto')
  })

  it('calls onThemeChange with the next theme when clicked', () => {
    const onThemeChange = vi.fn()
    const { rerender } = render(
      <StatusBar
        app={app}
        project={projectA}
        theme="nekode-flat"
        quickThemeSwitch={true}
        onThemeChange={onThemeChange}
      />,
    )
    const switcher = screen.getByTestId(TEST_ID.statusThemeSwitcher)
    fireEvent.click(switcher)
    expect(onThemeChange).toHaveBeenCalledWith('nekode-float')

    rerender(
      <StatusBar
        app={app}
        project={projectA}
        theme="nekode-float"
        quickThemeSwitch={true}
        onThemeChange={onThemeChange}
      />,
    )
    expect(screen.getByTestId(TEST_ID.statusThemeSwitcher).textContent).toContain('NeKode Float')
    fireEvent.click(screen.getByTestId(TEST_ID.statusThemeSwitcher))
    expect(onThemeChange).toHaveBeenCalledWith('nekode-flat')
  })

  it('renders quick theme switcher on the right even when project is null', () => {
    render(
      <StatusBar
        app={app}
        project={null}
        theme="nekode-flat"
        quickThemeSwitch={true}
        onThemeChange={vi.fn()}
      />,
    )
    const switcher = screen.getByTestId(TEST_ID.statusThemeSwitcher)
    expect(switcher).toBeTruthy()
    expect(switcher.textContent).toContain('NeKode Flat')
    expect(switcher.className).toContain('ml-auto')
  })
})

describe('status bar — git sync (NEKODE-1)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })
  afterEach(() => {
    cleanup()
  })

  it('renders Sync button next to Git branch when branch is present', async () => {
    render(<StatusBar app={app} project={projectA} />)
    await waitFor(() => expect(screen.getByTestId(TEST_ID.statusGitBranch)).toBeTruthy())
    const syncButton = screen.getByTestId(TEST_ID.statusGitSync)
    expect(syncButton).toBeTruthy()
    expect(syncButton.textContent).toContain('Sync')
    expect(syncButton.getAttribute('disabled')).toBeNull()
  })

  it('does not render Sync button when branch is null (no git)', async () => {
    app = createAppApiStub({ branch: null })
    render(<StatusBar app={app} project={projectA} />)
    await waitFor(() => expect(screen.getByTestId(TEST_ID.statusGitNone)).toBeTruthy())
    expect(screen.queryByTestId(TEST_ID.statusGitSync)).toBeNull()
  })

  it('does not render Sync button when project is null', () => {
    render(<StatusBar app={app} project={null} />)
    expect(screen.queryByTestId(TEST_ID.statusGitSync)).toBeNull()
  })

  it('invokes app.git.sync, disables button during sync, and refreshes git status on completion', async () => {
    let resolveSync!: () => void
    const syncPromise = new Promise<void>((resolve) => {
      resolveSync = resolve
    })
    app.git.sync = vi.fn().mockImplementation(() => syncPromise)

    render(<StatusBar app={app} project={projectA} />)
    await waitFor(() => expect(screen.getByTestId(TEST_ID.statusGitSync)).toBeTruthy())

    const syncButton = screen.getByTestId(TEST_ID.statusGitSync)
    expect(syncButton.hasAttribute('disabled')).toBe(false)

    fireEvent.click(syncButton)

    expect(app.git.sync).toHaveBeenCalledWith('p1')
    expect(syncButton.hasAttribute('disabled')).toBe(true)

    // Settle sync
    resolveSync()
    await waitFor(() => expect(syncButton.hasAttribute('disabled')).toBe(false))
    // Verifies git.getStatus was called again on completion
    await waitFor(() => expect(app.git.getStatus).toHaveBeenCalledTimes(2))
  })

  it('calls onError callback when app.git.sync rejects', async () => {
    const onError = vi.fn()
    app.git.sync = vi.fn().mockRejectedValue(new Error('git push failed: remote rejected'))

    render(<StatusBar app={app} project={projectA} onError={onError} />)
    await waitFor(() => expect(screen.getByTestId(TEST_ID.statusGitSync)).toBeTruthy())

    const syncButton = screen.getByTestId(TEST_ID.statusGitSync)
    fireEvent.click(syncButton)

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('git push failed: remote rejected')
    })
    await waitFor(() => expect(syncButton.hasAttribute('disabled')).toBe(false))
  })

  it('preserves syncing state per project when switching projects', async () => {
    let resolveSync!: () => void
    const syncPromise = new Promise<void>((resolve) => {
      resolveSync = resolve
    })
    app.git.sync = vi.fn().mockImplementation(() => syncPromise)

    const projectB: ProjectInfo = { id: 'p2', name: 'Project 2', path: 'D:/p2', runtimeLabel: null }

    const { rerender } = render(<StatusBar app={app} project={projectA} />)
    await waitFor(() => expect(screen.getByTestId(TEST_ID.statusGitSync)).toBeTruthy())

    const syncButton = screen.getByTestId(TEST_ID.statusGitSync)
    fireEvent.click(syncButton)
    expect(syncButton.hasAttribute('disabled')).toBe(true)

    // Switch to projectB: it is not syncing
    rerender(<StatusBar app={app} project={projectB} />)
    await waitFor(() => expect(screen.getByTestId(TEST_ID.statusGitSync)).toBeTruthy())
    const projectBSyncButton = screen.getByTestId(TEST_ID.statusGitSync)
    expect(projectBSyncButton.hasAttribute('disabled')).toBe(false)

    // Switch back to projectA: still syncing
    rerender(<StatusBar app={app} project={projectA} />)
    await waitFor(() => expect(screen.getByTestId(TEST_ID.statusGitSync)).toBeTruthy())
    expect(screen.getByTestId(TEST_ID.statusGitSync).hasAttribute('disabled')).toBe(true)

    // Settle sync
    resolveSync()
    await waitFor(() => {
      expect(screen.getByTestId(TEST_ID.statusGitSync).hasAttribute('disabled')).toBe(false)
    })
  })
})

describe('status bar — bottom terminal toggle', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })
  afterEach(() => {
    cleanup()
  })

  it('does not render bottom terminal toggle when onToggleBottom is omitted', () => {
    render(<StatusBar app={app} project={projectA} />)
    expect(screen.queryByTestId(TEST_ID.statusTerminalToggle)).toBeNull()
  })

  it('renders bottom terminal toggle button on the right with ml-auto when onToggleBottom is provided and quick theme switcher is disabled', () => {
    render(<StatusBar app={app} project={projectA} onToggleBottom={vi.fn()} />)
    const toggle = screen.getByTestId(TEST_ID.statusTerminalToggle)
    expect(toggle).toBeTruthy()
    expect(toggle.textContent).toBe('')
    expect(toggle.className).toContain('ml-auto')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.getAttribute('aria-label')).toBe('Open bottom terminal')
    expect(toggle.getAttribute('title')).toBe('Open bottom terminal (Ctrl+`)')
  })

  it('renders bottom terminal toggle after quick theme switcher without ml-auto when quickThemeSwitch is enabled', () => {
    render(
      <StatusBar
        app={app}
        project={projectA}
        theme="nekode-flat"
        quickThemeSwitch={true}
        onThemeChange={vi.fn()}
        onToggleBottom={vi.fn()}
      />,
    )
    const switcher = screen.getByTestId(TEST_ID.statusThemeSwitcher)
    const toggle = screen.getByTestId(TEST_ID.statusTerminalToggle)
    expect(switcher.className).toContain('ml-auto')
    expect(toggle.className).not.toContain('ml-auto')
  })

  it('calls onToggleBottom when clicked', () => {
    const onToggle = vi.fn()
    render(<StatusBar app={app} project={projectA} onToggleBottom={onToggle} />)
    const toggle = screen.getByTestId(TEST_ID.statusTerminalToggle)
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('reflects open state when bottomOpen is true', () => {
    render(<StatusBar app={app} project={projectA} bottomOpen={true} onToggleBottom={vi.fn()} />)
    const toggle = screen.getByTestId(TEST_ID.statusTerminalToggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toBe('Close bottom terminal')
    expect(toggle.getAttribute('title')).toBe('Close bottom terminal (Ctrl+`)')
    expect(toggle.className).toContain('bg-highlight')
  })

  it('renders bottom terminal toggle on the right even when project is null', () => {
    render(<StatusBar app={app} project={null} onToggleBottom={vi.fn()} />)
    const toggle = screen.getByTestId(TEST_ID.statusTerminalToggle)
    expect(toggle).toBeTruthy()
    expect(toggle.className).toContain('ml-auto')
  })
})
