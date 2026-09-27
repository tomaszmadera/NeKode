import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppApi,
  GitStatus,
  GitWorktreeStatus,
  ProjectInfo,
} from '../../../../shared/ipc-contract'
import { emptyGitWorktree } from '../../../../shared/ipc-contract'
import { TEST_ID } from '../../lib/test-ids'
import {
  gitHoverDetails,
  gitStatusText,
  MAX_RUNTIME_BADGES,
  runtimeLabels,
  StatusBar,
} from './StatusBar'

// Status bar (UX-UI §14–16 / center-layout-tabs-actions spec Behaviour 18):
// project name, visually truncated path (full on hover), runtime badges with
// `+N` collapse, git branch form (U+E0A0 + space + name) and worktree status
// forms with hover details; empty project section with no project and the
// "no git" degradation (no branch, neutral status, no error banner).

const BRANCH_GLYPH = String.fromCharCode(0xe0a0)

const projectA: ProjectInfo = {
  id: 'p1',
  name: 'gerde.pl',
  path: 'D:/Projects/gerde.pl',
  runtimeLabel: 'PHP 8.5',
}

function createAppApiStub(gitStatus?: Partial<GitStatus>): AppApi {
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
      add: vi.fn().mockResolvedValue(null),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    chats: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 't1', projectId: 'p1', name: 'PowerShell' }),
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
      onData: vi.fn().mockReturnValue(() => undefined),
      onExit: vi.fn().mockReturnValue(() => undefined),
    },
    git: {
      getStatus: vi.fn().mockResolvedValue({
        branch: 'main',
        dirty: false,
        worktree: emptyGitWorktree(),
        ...gitStatus,
      }),
    },
    files: {
      list: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue({ kind: 'text', content: '', language: null }),
      openExternal: vi.fn().mockResolvedValue(undefined),
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

  it('renders the project name and the full path with truncation and full-on-hover', async () => {
    render(<StatusBar app={app} project={projectA} />)
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('gerde.pl')
    const path = screen.getByTestId(TEST_ID.statusProjectPath)
    // Visually truncated via CSS, shown fully on hover (title).
    expect(path.textContent).toBe('D:/Projects/gerde.pl')
    expect(path.getAttribute('title')).toBe('D:/Projects/gerde.pl')
    expect(path.className).toContain('truncate')
    await waitFor(() => expect(app.git.getStatus).toHaveBeenCalledWith('D:/Projects/gerde.pl'))
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
    expect(screen.getByTestId(TEST_ID.statusBar)).toBeTruthy()
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

  it('renders the branch form (U+E0A0 + space + name) and the changes form with hover details', async () => {
    app = createAppApiStub({
      branch: 'feature/meta-pixel',
      dirty: true,
      worktree: worktree({ modified: 4, added: 2, untracked: 1, ahead: 3 }),
    })
    render(<StatusBar app={app} project={projectA} />)
    const branch = await screen.findByTestId(TEST_ID.statusGitBranch)
    expect(branch.textContent).toBe(`${BRANCH_GLYPH} feature/meta-pixel`)
    const status = screen.getByTestId(TEST_ID.statusGitStatus)
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
    expect((await screen.findByTestId(TEST_ID.statusGitStatus)).textContent).toBe('✓ clean')
    expect(screen.getByTestId(TEST_ID.statusGitBranch).textContent).toBe(`${BRANCH_GLYPH} main`)
  })

  it('renders the conflicts form when the worktree has conflicts', async () => {
    app = createAppApiStub({
      branch: 'main',
      dirty: true,
      worktree: worktree({ modified: 1, conflicts: 2 }),
    })
    render(<StatusBar app={app} project={projectA} />)
    expect((await screen.findByTestId(TEST_ID.statusGitStatus)).textContent).toBe('! 2 conflicts')
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
