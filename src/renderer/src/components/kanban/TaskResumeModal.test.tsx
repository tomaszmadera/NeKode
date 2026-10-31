import type {
  AppApi,
  ResumeDiscoveryCandidate,
  ResumeSourceDiscovery,
  WorkItem,
} from '@shared/ipc-contract'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
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

function candidate(
  id: string,
  overrides: Partial<ResumeDiscoveryCandidate> = {},
): ResumeDiscoveryCandidate {
  return {
    token: `tok-${id}`,
    id,
    title: id,
    displayPath: `h/${id}.md`,
    modifiedAt: new Date(100).toISOString(),
    ...overrides,
  }
}

function discovery(input: {
  candidates?: ResumeDiscoveryCandidate[]
  rejections?: Array<{ path: string; reason: string }>
}): ResumeSourceDiscovery {
  return {
    projectId: 'p1',
    templateId: 'tmpl-1',
    revision: 1,
    candidates: input.candidates ?? [],
    rejections: input.rejections ?? [],
  }
}

const EMPTY_DISCOVERY = discovery({})

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
    resumeSources: {
      binding: vi.fn().mockResolvedValue({ projectId: 'p1', templateId: 'tmpl-1' }),
      discover: vi.fn().mockResolvedValue(EMPTY_DISCOVERY),
      prepare: vi.fn().mockResolvedValue('Resume from candidate prompt'),
    },
    kanban: {
      launchTask: vi.fn().mockResolvedValue({
        chat: { id: 'chat-1', name: '[PowerShell] Codex' },
        delivered: true,
      }),
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
    expect(app.resumeSources.binding).toHaveBeenCalledTimes(1)
    expect(app.resumeSources.binding).toHaveBeenCalledWith('p1')
    expect(app.resumeSources.discover).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId(TEST_ID.kanbanResumeTask).textContent).toBe(
      'NEKODE-28: Match the handoff',
    )
    // Hovering never triggers a scan.
    fireEvent.mouseOver(screen.getByRole('dialog'))
    expect(app.resumeSources.discover).toHaveBeenCalledTimes(1)

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

  it('offers Configure Resume when no template is configured', async () => {
    const app = appMock()
    vi.mocked(app.resumeSources.binding).mockResolvedValue({ projectId: 'p1', templateId: null })
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
    expect(app.resumeSources.discover).not.toHaveBeenCalled()
  })

  it('shows a discovery read failure as an error, not as no handoffs', async () => {
    const app = appMock()
    vi.mocked(app.resumeSources.discover).mockRejectedValue(
      new Error('Failed to execute resume discovery'),
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
    const error = await screen.findByTestId(TEST_ID.kanbanResumeError)
    expect(error.textContent).toContain('Failed to execute resume discovery')
    expect(screen.queryByTestId(TEST_ID.kanbanResumeEmpty)).toBeNull()
  })

  it('shows the empty state when nothing matches the task ref', async () => {
    const app = appMock()
    vi.mocked(app.resumeSources.discover).mockResolvedValue(
      discovery({ candidates: [candidate('loose')] }),
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
      'No resume context found for this task.',
    )
    expect(screen.queryByTestId(TEST_ID.kanbanResumeContext)).toBeNull()
    expect((screen.getByTestId(TEST_ID.kanbanResumeConfirm) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeConfirm))
    expect(app.resumeSources.prepare).not.toHaveBeenCalled()
    expect(app.kanban.launchTask).not.toHaveBeenCalled()
  })

  it('shows only the matching identity and full path as read-only context and lists rejections', async () => {
    const app = appMock()
    vi.mocked(app.resumeSources.discover).mockResolvedValue(
      discovery({
        candidates: [
          candidate('nekode-28-notes', {
            title: item.title,
            displayPath: '.agents/tasks/nekode-28-notes/task.md',
          }),
          candidate('meta'),
          candidate('loose'),
        ],
        rejections: [
          { path: 'big.md', reason: 'File is larger than 1 MiB.' },
          { path: 'bad.md', reason: 'File is not valid UTF-8.' },
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
    const context = await screen.findByTestId(TEST_ID.kanbanResumeContext)
    const warnings = screen.getByTestId(TEST_ID.kanbanResumeWarnings)
    expect(warnings.textContent).toContain('big.md')
    expect(warnings.textContent).toContain('File is larger than 1 MiB.')
    expect(warnings.textContent).toContain('bad.md')

    expect(context.textContent).toContain('nekode-28-notes')
    expect(context.textContent).toContain('.agents/tasks/nekode-28-notes/task.md')
    expect(within(context).queryByRole('radio')).toBeNull()
    expect(screen.queryByText('Resume source')).toBeNull()
    expect(screen.getAllByText(`NEKODE-28: ${item.title}`)).toHaveLength(1)
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    expect(screen.queryByText('meta')).toBeNull()
    expect(screen.queryByText('loose')).toBeNull()
  })

  it.each([undefined, false, true])(
    'automatically launches the unique unfinished context with handoff wait %s',
    async (awaitingResumption) => {
      const app = appMock()
      vi.mocked(app.resumeSources.discover).mockResolvedValue(
        discovery({
          candidates: [
            candidate('nekode-28-stage-2', {
              status: 'active',
              awaiting_resumption: awaitingResumption,
            }),
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
      const confirm = screen.getByTestId(TEST_ID.kanbanResumeConfirm)
      await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(confirm)

      await waitFor(() => {
        expect(app.resumeSources.prepare).toHaveBeenCalledWith(
          'p1',
          'tok-nekode-28-stage-2',
          expect.any(String),
        )
        expect(app.kanban.launchTask).toHaveBeenCalledWith({
          projectId: 'p1',
          itemId: 'native-28',
          ref: 'NEKODE-28',
          profileId: profile.id,
          attemptId: expect.any(String),
          mode: 'resume',
          prompt: 'Resume from candidate prompt',
        })
      })
    },
  )

  it('blocks ambiguous matches and names every conflicting identity and path', async () => {
    const app = appMock()
    vi.mocked(app.resumeSources.discover).mockResolvedValue(
      discovery({ candidates: [candidate('nekode-28'), candidate('nekode-28-notes')] }),
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
    const alert = await screen.findByTestId(TEST_ID.kanbanResumeAmbiguous)
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('Multiple resume contexts match this task.')
    expect(alert.textContent).toContain('h/nekode-28.md')
    expect(alert.textContent).toContain('h/nekode-28-notes.md')
    expect(within(alert).getByText('nekode-28')).toBeTruthy()
    expect(within(alert).getByText('nekode-28-notes')).toBeTruthy()
    expect(within(alert).queryByRole('radio')).toBeNull()
    expect(screen.queryByTestId(TEST_ID.kanbanResumeContext)).toBeNull()
    const confirm = screen.getByTestId(TEST_ID.kanbanResumeConfirm) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(app.resumeSources.prepare).not.toHaveBeenCalled()
    expect(app.kanban.launchTask).not.toHaveBeenCalled()
  })

  it('re-evaluates uniqueness on refresh and blocks confirmation while scanning', async () => {
    const app = appMock()
    let resolveScan!: (value: ResumeSourceDiscovery) => void
    vi.mocked(app.resumeSources.discover)
      .mockResolvedValueOnce(discovery({ candidates: [candidate('nekode-28')] }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveScan = resolve
          }),
      )
      .mockResolvedValueOnce(discovery({ candidates: [candidate('nekode-28-new')] }))
      .mockResolvedValueOnce(EMPTY_DISCOVERY)
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    const confirm = screen.getByTestId(TEST_ID.kanbanResumeConfirm) as HTMLButtonElement
    await waitFor(() => expect(confirm.disabled).toBe(false))
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeRefresh))
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(app.resumeSources.prepare).not.toHaveBeenCalled()
    await waitFor(() => expect(app.resumeSources.discover).toHaveBeenCalledTimes(2))
    await act(async () => {
      resolveScan(discovery({ candidates: [candidate('nekode-28'), candidate('nekode-28-other')] }))
    })
    await screen.findByTestId(TEST_ID.kanbanResumeAmbiguous)
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeRefresh))
    expect((await screen.findByTestId(TEST_ID.kanbanResumeContext)).textContent).toContain(
      'nekode-28-new',
    )
    expect(confirm.disabled).toBe(false)
    expect(screen.queryByTestId(TEST_ID.kanbanResumeAmbiguous)).toBeNull()
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeRefresh))
    await screen.findByTestId(TEST_ID.kanbanResumeEmpty)
    expect(confirm.disabled).toBe(true)
    expect(screen.queryByTestId(TEST_ID.kanbanResumeContext)).toBeNull()
    expect(app.kanban.launchTask).not.toHaveBeenCalled()
  })

  it('prepares and launches the automatic context only once during repeated confirmation', async () => {
    const app = appMock()
    let resolvePrompt!: (value: string) => void
    vi.mocked(app.resumeSources.discover).mockResolvedValue(
      discovery({ candidates: [candidate('nekode-28')] }),
    )
    vi.mocked(app.resumeSources.prepare).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve
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
    const confirm = screen.getByTestId(TEST_ID.kanbanResumeConfirm) as HTMLButtonElement
    await waitFor(() => expect(confirm.disabled).toBe(false))
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(confirm.disabled).toBe(true)
    expect(app.resumeSources.prepare).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolvePrompt('Resume task h/nekode-28.md')
    })
    expect(app.kanban.launchTask).toHaveBeenCalledTimes(1)
  })

  it('re-scans on Refresh and drops a stale scan from a disposed modal', async () => {
    const app = appMock()
    vi.mocked(app.resumeSources.discover)
      .mockResolvedValueOnce(discovery({ candidates: [candidate('nekode-28-a')] }))
      .mockResolvedValueOnce(discovery({ candidates: [candidate('nekode-28-b')] }))
    render(
      <TaskResumeModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureHandoffs={vi.fn()}
      />,
    )
    await screen.findByText('h/nekode-28-a.md')
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanResumeRefresh))
    await screen.findByText('h/nekode-28-b.md')
    expect(app.resumeSources.discover).toHaveBeenCalledTimes(2)

    let resolveLate: (value: ResumeSourceDiscovery) => void = () => undefined
    vi.mocked(app.resumeSources.discover).mockReturnValue(
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
      resolveLate(discovery({ candidates: [candidate('nekode-28-late')] }))
    })
    expect(screen.queryByText('h/nekode-28-late.md')).toBeNull()
  })

  it('shows error when prepare fails due to candidate change or conflict', async () => {
    const app = appMock()
    vi.mocked(app.resumeSources.discover).mockResolvedValue(
      discovery({ candidates: [candidate('nekode-28-notes')] }),
    )
    vi.mocked(app.resumeSources.prepare).mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'conflict',
      message: 'The selected candidate has changed. Refresh the Resume list.',
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
    await screen.findByTestId(TEST_ID.kanbanResumeContext)
    const confirm = screen.getByTestId(TEST_ID.kanbanResumeConfirm)
    fireEvent.click(confirm)

    const error = await screen.findByTestId(TEST_ID.kanbanResumeError)
    expect(error.textContent).toBe('The selected candidate has changed. Refresh the Resume list.')
    expect(app.kanban.launchTask).not.toHaveBeenCalled()
  })
})
