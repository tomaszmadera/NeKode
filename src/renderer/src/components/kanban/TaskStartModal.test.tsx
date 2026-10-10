import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppApi, KanbanLaunchResult, WorkItem } from '../../../../shared/ipc-contract'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { TaskStartModal } from './TaskStartModal'

const item: WorkItem = {
  ref: 'NK-1',
  id: 'native-1',
  title: 'Ship the launch',
  description: 'cached description must not be sent',
  stateId: 's1',
  stateName: 'Backlog',
  stateGroup: 'backlog',
  priority: null,
  assignee: null,
  url: 'https://example.test/cached',
  updatedAt: null,
}

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
      put: vi.fn(),
      delete: vi.fn(),
    },
    kanban: {
      launchTask: vi.fn(),
    },
  } as unknown as AppApi
}

function Harness({
  app,
  onLaunched,
  onConfigureAgents,
}: {
  app: AppApi
  onLaunched: (result: unknown) => void
  onConfigureAgents: () => void
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
        <TaskStartModal
          app={app}
          projectId="p1"
          item={item}
          onCancel={() => {
            setOpen(false)
          }}
          onConfigureAgents={onConfigureAgents}
          onLaunched={onLaunched}
        />
      ) : null}
    </>
  )
}

describe('TaskStartModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('returns focus and creates no chat on Cancel, Escape, and backdrop dismiss', async () => {
    const app = appMock()
    const onLaunched = vi.fn()
    const onConfigureAgents = vi.fn()
    render(<Harness app={app} onLaunched={onLaunched} onConfigureAgents={onConfigureAgents} />)
    const opener = screen.getByTestId('opener')
    opener.focus()
    fireEvent.click(opener)
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId(TEST_ID.kanbanStartCancel))
    })
    expect(screen.getByTestId(TEST_ID.kanbanStartTask).textContent).toBe('NK-1: Ship the launch')
    fireEvent.click(screen.getByTestId(TEST_ID.kanbanStartCancel))
    await waitFor(() => {
      expect(document.activeElement).toBe(opener)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(app.kanban.launchTask).not.toHaveBeenCalled()

    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
    expect(app.kanban.launchTask).not.toHaveBeenCalled()

    opener.focus()
    fireEvent.click(opener)
    fireEvent.mouseDown(await screen.findByRole('presentation'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
    expect(app.kanban.launchTask).not.toHaveBeenCalled()
    expect(onLaunched).not.toHaveBeenCalled()
  })

  it('offers Configure agents and creates no chat when the project has no profiles', async () => {
    const app = appMock()
    vi.mocked(app.agentProfiles.get).mockResolvedValue({ defaultId: null, profiles: [] })
    const onConfigureAgents = vi.fn()
    render(
      <TaskStartModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureAgents={onConfigureAgents}
        onLaunched={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanStartConfigure))
    expect(screen.getByTestId(TEST_ID.kanbanStartEmpty)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.kanbanStartConfirm)).toBeNull()
    expect(onConfigureAgents).toHaveBeenCalledTimes(1)
    expect(app.kanban.launchTask).not.toHaveBeenCalled()
  })

  it('drops a stale profile load and a stale launch result', async () => {
    const app = appMock()
    let resolveProfiles: (value: { defaultId: null; profiles: [] }) => void = () => undefined
    vi.mocked(app.agentProfiles.get).mockReturnValue(
      new Promise((resolve) => {
        resolveProfiles = resolve
      }),
    )
    const onLaunched = vi.fn()
    const onConfigureAgents = vi.fn()
    const hidden = render(
      <TaskStartModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={vi.fn()}
        onConfigureAgents={onConfigureAgents}
        onLaunched={onLaunched}
      />,
    )
    hidden.unmount()
    await act(async () => {
      resolveProfiles({ defaultId: null, profiles: [] })
    })
    expect(onConfigureAgents).not.toHaveBeenCalled()
    expect(onLaunched).not.toHaveBeenCalled()

    let resolveLaunch: (value: KanbanLaunchResult) => void = () => undefined
    vi.mocked(app.agentProfiles.get).mockResolvedValue({
      defaultId: profile.id,
      profiles: [profile],
    })
    vi.mocked(app.kanban.launchTask).mockReturnValue(
      new Promise((resolve) => {
        resolveLaunch = resolve
      }),
    )
    const tree = render(
      <Harness app={app} onLaunched={onLaunched} onConfigureAgents={onConfigureAgents} />,
    )
    fireEvent.click(screen.getByTestId('opener'))
    const confirm = await screen.findByTestId(TEST_ID.kanbanStartConfirm)
    expect(await screen.findByTestId(testIdFor.kanbanStartProfile(profile.id))).toBeTruthy()
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(app.kanban.launchTask).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(app.kanban.launchTask).mock.calls[0]?.[0]
    expect(Object.keys(sent ?? {}).sort()).toEqual([
      'attemptId',
      'itemId',
      'mode',
      'profileId',
      'projectId',
      'ref',
    ])
    expect(sent).toMatchObject({
      projectId: 'p1',
      itemId: 'native-1',
      ref: 'NK-1',
      profileId: profile.id,
      mode: 'start',
    })
    expect(JSON.stringify(sent)).not.toContain('cached description')
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    tree.unmount()
    await act(async () => {
      resolveLaunch({
        chat: { id: 'chat-1', projectId: 'p1', name: 'Codex' },
        delivered: true,
      })
    })
    expect(onLaunched).not.toHaveBeenCalled()
  })

  function busyLaunchSetup(): {
    app: AppApi
    onCancel: ReturnType<typeof vi.fn>
    onLaunched: ReturnType<typeof vi.fn>
    resolveLaunch: (value: KanbanLaunchResult) => void
  } {
    const app = appMock()
    let resolveLaunch: (value: KanbanLaunchResult) => void = () => undefined
    vi.mocked(app.kanban.launchTask).mockReturnValue(
      new Promise((resolve) => {
        resolveLaunch = resolve
      }),
    )
    const onCancel = vi.fn()
    const onLaunched = vi.fn()
    render(
      <TaskStartModal
        app={app}
        projectId="p1"
        item={item}
        onCancel={onCancel}
        onConfigureAgents={vi.fn()}
        onLaunched={onLaunched}
      />,
    )
    return {
      app,
      onCancel,
      onLaunched,
      resolveLaunch: (value) => {
        resolveLaunch(value)
      },
    }
  }

  it('ignores Escape while a launch is in flight and still calls onLaunched', async () => {
    const { app, onCancel, onLaunched, resolveLaunch } = busyLaunchSetup()
    const confirm = await screen.findByTestId(TEST_ID.kanbanStartConfirm)
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(confirm)
    await waitFor(() => expect(app.kanban.launchTask).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()

    await act(async () => {
      resolveLaunch({ chat: { id: 'chat-1', projectId: 'p1', name: 'Codex' }, delivered: true })
    })
    expect(onLaunched).toHaveBeenCalledTimes(1)
    expect(onLaunched.mock.calls[0]?.[0]).toMatchObject({
      delivered: true,
      input: { projectId: 'p1', itemId: 'native-1', ref: 'NK-1', mode: 'start' },
    })
  })

  it('ignores the backdrop while a launch is in flight and still calls onLaunched', async () => {
    const { app, onCancel, onLaunched, resolveLaunch } = busyLaunchSetup()
    const confirm = await screen.findByTestId(TEST_ID.kanbanStartConfirm)
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(confirm)
    await waitFor(() => expect(app.kanban.launchTask).toHaveBeenCalledTimes(1))

    fireEvent.mouseDown(screen.getByRole('presentation'))

    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()

    await act(async () => {
      resolveLaunch({ chat: { id: 'chat-2', projectId: 'p1', name: 'Codex' }, delivered: true })
    })
    expect(onLaunched).toHaveBeenCalledTimes(1)
    expect(onLaunched.mock.calls[0]?.[0]).toMatchObject({
      delivered: true,
      input: { ref: 'NK-1', mode: 'start' },
    })
  })

  it('ignores Cancel while a launch is in flight and still calls onLaunched', async () => {
    const { app, onCancel, onLaunched, resolveLaunch } = busyLaunchSetup()
    const confirm = await screen.findByTestId(TEST_ID.kanbanStartConfirm)
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(confirm)
    await waitFor(() => expect(app.kanban.launchTask).toHaveBeenCalledTimes(1))

    const cancel = screen.getByTestId(TEST_ID.kanbanStartCancel)
    expect((cancel as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(cancel)

    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()

    await act(async () => {
      resolveLaunch({ chat: { id: 'chat-3', projectId: 'p1', name: 'Codex' }, delivered: true })
    })
    expect(onLaunched).toHaveBeenCalledTimes(1)
    expect(onLaunched.mock.calls[0]?.[0]).toMatchObject({
      delivered: true,
      input: { ref: 'NK-1', mode: 'start' },
    })
  })
})
