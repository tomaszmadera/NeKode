import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppApi,
  HandoffCandidatesResult,
  HandoffFileInfo,
  HandoffRejection,
  KanbanLaunchResult,
  WorkItem,
} from '../../../../shared/ipc-contract'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { TaskResumeModal } from './TaskResumeModal'

const item: WorkItem = {
  ref: 'NEKODE-28',
  id: 'native-28',
  title: 'Match the handoff',
  description: 'cached description',
  stateId: 's1',
  stateName: 'Backlog',
  stateGroup: 'backlog',
  priority: null,
  assignee: null,
  url: null,
  updatedAt: null,
}

const candidatesInput = { projectId: 'p1', itemId: 'native-28', ref: 'NEKODE-28' }

function file(name: string, matchKind: HandoffFileInfo['matchKind'], mtime = 1): HandoffFileInfo {
  return { name, path: `h/${name}`, modifiedAt: new Date(mtime).toISOString(), matchKind }
}

function ready(input: {
  files?: HandoffFileInfo[]
  rejections?: HandoffRejection[]
}): HandoffCandidatesResult {
  return {
    state: 'ready',
    files: input.files ?? [],
    rejections: input.rejections ?? [],
  }
}

const EMPTY = ready({})

const profile = {
  id: 'prof-1',
  name: 'Codex',
  executable: 'codex.exe',
  args: ['{prompt}'],
}

function appMock(): AppApi {
  return {
    agentProfiles: {
      get: vi.fn().mockResolvedValue({ defaultId: profile.id, profiles: [profile] }),
    },
    kanban: {
      handoffCandidates: vi.fn().mockResolvedValue(EMPTY),
      launchTask: vi.fn(),
    },
  } as unknown as AppApi
}

function Harness({
  app,
  onCancel,
  onConfigureHandoffs,
}: {
  app: AppApi
  onCancel: () => void
  onConfigureHandoffs: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        data-testid="opener"
        onClick={() => {
          setOpen(true)
        }}
      >
        Open
      </button>
      {open ? (
        <TaskResumeModal
          app={app}
          projectId="p1"
          item={item}
          onCancel={() => {
            setOpen(false)
            onCancel()
          }}
          onConfigureHandoffs={onConfigureHandoffs}
        />
      ) : null}
    </>
  )
}

describe('TaskResumeModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('scans once on open, returns focus, and creates nothing on Cancel, Escape and backdrop', async () => {
    const app = appMock()
    const onCancel = vi.fn()
    render(<Harness app={app} onCancel={onCancel} onConfigureHandoffs={vi.fn()} />)
    const opener = screen.getByTestId('opener')
    opener.focus()
    fireEvent.click(opener)
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId(TEST_ID.kanbanResumeCancel))
    })
    expect(app.kanban.handoffCandidates).toHaveBeenCalledTimes(1)
    expect(app.kanban.handoffCandidates).toHaveBeenCalledWith(candidatesInput)
    expect(screen.getByTestId(TEST_ID.kanbanResumeTask).textContent).toBe(
      'NEKODE-28: Match the handoff',
    )
    // Hovering never triggers a scan.
    fireEvent.mouseOver(screen.getByRole('dialog'))
    expect(app.kanban.handoffCandidates).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeCancel))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(document.activeElement).toBe(opener)
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.click(opener)
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(opener)
    fireEvent.mouseDown(await screen.findByRole('presentation'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(app.kanban.launchTask).not.toHaveBeenCalled()
  })

  it('offers Configure handoffs when no directory is configured', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue({ state: 'not-configured' })
    const onConfigureHandoffs = vi.fn()
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={onConfigureHandoffs}
      />,
    )
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanResumeConfigure))
    expect(onConfigureHandoffs).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId(TEST_ID.kanbanResumeEmpty)).toBeNull()
  })

  it('shows a directory read failure as an error, not as no handoffs', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue({
      state: 'error',
      message: 'Handoff directory not found: D:/code/demo/h',
    })
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    const error = await screen.findByTestId(TEST_ID.kanbanResumeError)
    expect(error.textContent).toContain('Handoff directory not found')
    expect(screen.queryByTestId(TEST_ID.kanbanResumeEmpty)).toBeNull()
  })

  it('shows the empty state without a manual handoff action when nothing matches', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({ files: [file('loose.md', 'none')] }),
    )
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    expect((await screen.findByTestId(TEST_ID.kanbanResumeEmpty)).textContent).toBe(
      'No linked handoff',
    )
    expect(screen.queryByTestId(TEST_ID.kanbanResumeCandidates)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Link handoff' })).toBeNull()
    expect(screen.queryByText('loose.md')).toBeNull()
    expect((screen.getByTestId(TEST_ID.kanbanResumeConfirm) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('selects the newest filename match, never labels candidate kinds, and lists rejections', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({
        files: [
          file('nekode-28-notes.md', 'filename', 30),
          file('meta.md', 'none', 20),
          file('loose.md', 'none', 10),
        ],
        rejections: [
          { name: 'big.md', path: 'h/big.md', reason: 'File is larger than 1 MiB.' },
          { name: 'bad.md', path: 'h/bad.md', reason: 'File is not valid UTF-8.' },
        ],
      }),
    )
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    await screen.findByTestId(TEST_ID.kanbanResumeCandidates)
    const warnings = screen.getByTestId(TEST_ID.kanbanResumeWarnings)
    expect(warnings.textContent).toContain('big.md')
    expect(warnings.textContent).toContain('File is larger than 1 MiB.')
    expect(warnings.textContent).toContain('bad.md')
    // Only a ref-named file is a candidate, and its row carries the name with
    // no match-kind label (NEKODE-30 stage 2).
    const row = screen.getByTestId(testIdFor.kanbanResumeCandidate('nekode-28-notes.md'))
    expect((within(row).getByRole('radio') as HTMLInputElement).checked).toBe(true)
    expect(row.textContent).toBe('nekode-28-notes.md')
    // A file whose name does not carry the ref is never a candidate.
    expect(screen.queryByTestId(testIdFor.kanbanResumeCandidate('meta.md'))).toBeNull()
    expect(screen.queryByTestId(testIdFor.kanbanResumeCandidate('loose.md'))).toBeNull()
  })

  it('ignores a stored legacy handoff link and only offers filename candidates', async () => {
    const app = appMock()
    vi.mocked(app.kanban.launchTask).mockResolvedValue({
      chat: { id: 'chat-linked', projectId: 'p1', name: 'Codex' },
      delivered: true,
    })
    // A scan result that still carries a legacy link document (NEKODE-30
    // stage 2 removed the link) must not add or suppress a candidate.
    const withLegacyLink = {
      ...ready({
        files: [file('nekode-28-notes.md', 'filename', 10), file('meta.md', 'none', 5)],
      }),
      link: { name: 'meta.md', path: 'h/meta.md', modifiedAt: new Date(5).toISOString() },
    } as unknown as HandoffCandidatesResult
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(withLegacyLink)
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    const row = await screen.findByTestId(testIdFor.kanbanResumeCandidate('nekode-28-notes.md'))
    expect((within(row).getByRole('radio') as HTMLInputElement).checked).toBe(true)
    // The legacy link's file is a name miss and stays unselectable.
    expect(screen.queryByTestId(testIdFor.kanbanResumeCandidate('meta.md'))).toBeNull()
    expect(screen.queryByRole('button', { name: 'Link handoff' })).toBeNull()
    const confirm = screen.getByTestId(TEST_ID.kanbanResumeConfirm)
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(app.kanban.launchTask).toHaveBeenCalledWith({
        ...candidatesInput,
        profileId: profile.id,
        attemptId: expect.any(String),
        mode: 'resume',
        fileName: 'nekode-28-notes.md',
        stamp: new Date(10).toISOString(),
      }),
    )
  })

  it('allows choosing another automatic candidate without offering manual assignment', async () => {
    const app = appMock()
    vi.mocked(app.kanban.launchTask).mockResolvedValue({
      chat: { id: 'chat-candidate', projectId: 'p1', name: 'Codex' },
      delivered: true,
    })
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({ files: [file('meta.md', 'none', 10), file('older.md', 'filename', 5)] }),
    )
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    const row = await screen.findByTestId(testIdFor.kanbanResumeCandidate('older.md'))
    fireEvent.click(within(row).getByRole('radio'))
    expect((within(row).getByRole('radio') as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('button', { name: 'Link handoff' })).toBeNull()
    const confirm = screen.getByTestId(TEST_ID.kanbanResumeConfirm)
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(app.kanban.launchTask).toHaveBeenCalledWith({
        ...candidatesInput,
        profileId: profile.id,
        attemptId: expect.any(String),
        mode: 'resume',
        fileName: 'older.md',
        stamp: new Date(5).toISOString(),
      }),
    )
  })

  it('re-scans on Refresh and drops a stale scan from a disposed modal', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates)
      .mockResolvedValueOnce(ready({ files: [file('a.md', 'filename', 1)] }))
      .mockResolvedValueOnce(ready({ files: [file('b.md', 'filename', 2)] }))
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    await screen.findByTestId(testIdFor.kanbanResumeCandidate('a.md'))
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeRefresh))
    await screen.findByTestId(testIdFor.kanbanResumeCandidate('b.md'))
    expect(app.kanban.handoffCandidates).toHaveBeenCalledTimes(2)

    // A late scan after unmount must not touch state: the promise below only
    // resolves after the tree is gone and must not warn or throw.
    let resolveLate: (value: HandoffCandidatesResult) => void = () => undefined
    vi.mocked(app.kanban.handoffCandidates).mockReturnValue(
      new Promise((resolve) => {
        resolveLate = resolve
      }),
    )
    const tree = render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    tree.unmount()
    await act(async () => {
      resolveLate(ready({ files: [file('late.md', 'filename', 3)] }))
    })
    expect(screen.queryByTestId(testIdFor.kanbanResumeCandidate('late.md'))).toBeNull()
  })

  it('enables Resume only after the scan finishes with a still-matching file and a profile', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({ files: [file('nekode-28-notes.md', 'filename', 5)] }),
    )
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    const confirm = await screen.findByTestId(TEST_ID.kanbanResumeConfirm)
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByTestId(testIdFor.kanbanResumeProfile(profile.id))).toBeTruthy()
  })

  it('keeps Resume disabled when no file still matches', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({ files: [file('loose.md', 'none', 5)] }),
    )
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    await screen.findByTestId(TEST_ID.kanbanResumeEmpty)
    expect((screen.getByTestId(TEST_ID.kanbanResumeConfirm) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeConfirm))
    expect(app.kanban.launchTask).not.toHaveBeenCalled()
  })

  it('sends the resume input with the chosen file name and its stamp', async () => {
    const app = appMock()
    const stamp = new Date(5).toISOString()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({ files: [file('nekode-28-notes.md', 'filename', 5)] }),
    )
    vi.mocked(app.kanban.launchTask).mockResolvedValue({
      chat: { id: 'chat-1', projectId: 'p1', name: 'Codex' },
      delivered: true,
    })
    const onLaunched = vi.fn()
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
        onLaunched={onLaunched}
      />,
    )
    const confirm = await screen.findByTestId(TEST_ID.kanbanResumeConfirm)
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(confirm)
    await waitFor(() => expect(app.kanban.launchTask).toHaveBeenCalledTimes(1))
    expect(app.kanban.launchTask).toHaveBeenCalledWith({
      projectId: 'p1',
      itemId: 'native-28',
      ref: 'NEKODE-28',
      profileId: profile.id,
      attemptId: expect.any(String),
      mode: 'resume',
      fileName: 'nekode-28-notes.md',
      stamp,
    })
    expect(onLaunched).toHaveBeenCalledTimes(1)
  })

  it('shows the failure from main and keeps the choice for a fresh attempt', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({ files: [file('nekode-28-notes.md', 'filename', 5)] }),
    )
    vi.mocked(app.kanban.launchTask).mockRejectedValue(new Error('recheck refused'))
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    const confirm = await screen.findByTestId(TEST_ID.kanbanResumeConfirm)
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(confirm)
    const error = await screen.findByTestId(TEST_ID.kanbanResumeError)
    expect(error.textContent).toContain('Failed to resume the task.')
    expect(screen.getByRole('dialog')).toBeTruthy()
    // The failure unlocks Confirm for a fresh confirmation.
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  })

  it('ignores Escape and the backdrop while the resume is in flight and still calls onLaunched', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({ files: [file('nekode-28-notes.md', 'filename', 5)] }),
    )
    let resolveLaunch: (value: KanbanLaunchResult) => void = () => undefined
    vi.mocked(app.kanban.launchTask).mockReturnValue(
      new Promise((resolve) => {
        resolveLaunch = resolve
      }),
    )
    const onCancel = vi.fn()
    const onLaunched = vi.fn()
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={onCancel}
        onConfigureHandoffs={vi.fn()}
        onLaunched={onLaunched}
      />,
    )
    const confirm = await screen.findByTestId(TEST_ID.kanbanResumeConfirm)
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(confirm)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.mouseDown(screen.getByRole('presentation'))
    expect(onCancel).not.toHaveBeenCalled()
    expect((screen.getByTestId(TEST_ID.kanbanResumeCancel) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await act(async () => {
      resolveLaunch({ chat: { id: 'chat-9', projectId: 'p1', name: 'Codex' }, delivered: true })
    })
    expect(onLaunched).toHaveBeenCalledTimes(1)
  })

  it('shows Configure agents and keeps Resume disabled when the project has no profiles', async () => {
    const app = appMock()
    vi.mocked(app.agentProfiles.get).mockResolvedValue({ defaultId: null, profiles: [] })
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({ files: [file('nekode-28-notes.md', 'filename', 5)] }),
    )
    const onConfigureAgents = vi.fn()
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
        onConfigureAgents={onConfigureAgents}
      />,
    )
    await screen.findByTestId(TEST_ID.kanbanResumeProfilesEmpty)
    // The handoff matched, so only the missing profile keeps Resume disabled.
    expect(screen.getByTestId(testIdFor.kanbanResumeCandidate('nekode-28-notes.md'))).toBeTruthy()
    expect(screen.queryByTestId(testIdFor.kanbanResumeProfile(profile.id))).toBeNull()
    expect((screen.getByTestId(TEST_ID.kanbanResumeConfirm) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeConfigureAgents))
    expect(onConfigureAgents).toHaveBeenCalledTimes(1)
  })

  it('shows the agent-profile load failure and keeps Resume disabled', async () => {
    const app = appMock()
    vi.mocked(app.agentProfiles.get).mockRejectedValue({
      nekodeAppError: true,
      code: 'internal',
      message: 'Agent profiles could not be read.',
    })
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({ files: [file('nekode-28-notes.md', 'filename', 5)] }),
    )
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
        onConfigureAgents={vi.fn()}
      />,
    )
    const profileError = await screen.findByTestId(TEST_ID.kanbanResumeProfileError)
    expect(profileError.textContent).toContain('Agent profiles could not be read.')
    // The handoff matched, so only the failed profile load keeps Resume disabled.
    expect(screen.getByTestId(testIdFor.kanbanResumeCandidate('nekode-28-notes.md'))).toBeTruthy()
    expect((screen.getByTestId(TEST_ID.kanbanResumeConfirm) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('keeps Resume disabled while a Refresh rescan is still running', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValueOnce(
      ready({ files: [file('nekode-28-notes.md', 'filename', 5)] }),
    )
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    const confirm = await screen.findByTestId(TEST_ID.kanbanResumeConfirm)
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))

    let resolveRescan: (value: HandoffCandidatesResult) => void = () => undefined
    vi.mocked(app.kanban.handoffCandidates).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRescan = resolve
      }),
    )
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeRefresh))
    // The rescan is pending, so even though the previous scan left a matching
    // selection, Resume stays disabled until the search finishes (Resume.2).
    expect(app.kanban.handoffCandidates).toHaveBeenCalledTimes(2)
    expect((confirm as HTMLButtonElement).disabled).toBe(true)

    await act(async () => {
      resolveRescan(ready({ files: [file('nekode-28-notes.md', 'filename', 5)] }))
    })
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  })
})
