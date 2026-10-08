import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AppApi,
  HandoffCandidatesResult,
  HandoffFileInfo,
  HandoffLinkedFile,
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
  link?: HandoffLinkedFile | null
}): HandoffCandidatesResult {
  return {
    state: 'ready',
    files: input.files ?? [],
    rejections: input.rejections ?? [],
    link: input.link ?? null,
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
      linkHandoff: vi.fn().mockResolvedValue(EMPTY),
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
    expect(app.kanban.linkHandoff).not.toHaveBeenCalled()
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

  it('shows the no-linked-handoff text and a Link handoff action when nothing matches', async () => {
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
    expect(screen.getByTestId(TEST_ID.kanbanResumeLink)).toBeTruthy()
  })

  it('selects the newest metadata match and lists candidate kinds beside rejections', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({
        files: [
          file('newest-filename.md', 'filename', 30),
          file('meta.md', 'metadata', 20),
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
    // The metadata match is the default selection even though another file is newer.
    const metaRow = screen.getByTestId(testIdFor.kanbanResumeCandidate('meta.md'))
    expect((within(metaRow).getByRole('radio') as HTMLInputElement).checked).toBe(true)
    expect(metaRow.textContent).toContain('Metadata match')
    expect(
      screen.getByTestId(testIdFor.kanbanResumeCandidate('newest-filename.md')).textContent,
    ).toContain('Filename match')
    expect(screen.queryByTestId(testIdFor.kanbanResumeCandidate('loose.md'))).toBeNull()
  })

  it('links a chosen file name from the picker and shows the link surviving the update', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({ files: [file('loose.md', 'none', 5)] }),
    )
    vi.mocked(app.kanban.linkHandoff).mockResolvedValue(
      ready({
        files: [file('loose.md', 'none', 5)],
        link: { name: 'loose.md', path: 'h/loose.md', modifiedAt: new Date(5).toISOString() },
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
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanResumeLink))
    const option = screen.getByTestId(testIdFor.kanbanResumeLinkOption('loose.md'))
    fireEvent.click(within(option).getByRole('radio'))
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeLinkConfirm))
    await waitFor(() => {
      expect(app.kanban.linkHandoff).toHaveBeenCalledWith({
        ...candidatesInput,
        fileName: 'loose.md',
      })
    })
    await waitFor(() => {
      expect(screen.queryByTestId(TEST_ID.kanbanResumeLinkList)).toBeNull()
    })
    const row = screen.getByTestId(testIdFor.kanbanResumeCandidate('loose.md'))
    expect(row.textContent).toContain('Linked')
    expect((within(row).getByRole('radio') as HTMLInputElement).checked).toBe(true)
  })

  it('keeps the dismiss controls locked while a link write is in flight', async () => {
    const app = appMock()
    vi.mocked(app.kanban.handoffCandidates).mockResolvedValue(
      ready({ files: [file('loose.md', 'none', 5)] }),
    )
    let resolveLink: (value: HandoffCandidatesResult) => void = () => undefined
    vi.mocked(app.kanban.linkHandoff).mockReturnValue(
      new Promise((resolve) => {
        resolveLink = resolve
      }),
    )
    const onCancel = vi.fn()
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={onCancel}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanResumeLink))
    fireEvent.click(
      within(screen.getByTestId(testIdFor.kanbanResumeLinkOption('loose.md'))).getByRole('radio'),
    )
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeLinkConfirm))
    expect(app.kanban.linkHandoff).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.mouseDown(screen.getByRole('presentation'))
    const cancel = screen.getByTestId(TEST_ID.kanbanResumeCancel)
    expect((cancel as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(cancel)
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()

    await act(async () => {
      resolveLink(
        ready({
          files: [file('loose.md', 'none', 5)],
          link: { name: 'loose.md', path: 'h/loose.md', modifiedAt: new Date(5).toISOString() },
        }),
      )
    })
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByTestId(testIdFor.kanbanResumeCandidate('loose.md')).textContent).toContain(
      'Linked',
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
