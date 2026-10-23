import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AppApi,
  ProjectInfo,
  TaskProgressAdapterInfo,
  TaskProgressBinding,
  TaskProgressChangedEvent,
  TaskProgressItem,
  TaskProgressSnapshot,
} from '../../../../shared/ipc-contract'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { TaskProgressSettings } from './TaskProgressSettings'

afterEach(cleanup)

// Task progress tab (spec task-progress-adapters Behaviour 7-10, Required tests
// "Renderer: zakładka ustawień"): adapter select with None, manifest form,
// Test with unsaved values, Save, None, Copy from project, empty list. The
// app.taskProgress/projects boundary is the typed AppApi.

const EXAMPLE: TaskProgressAdapterInfo = {
  id: 'example',
  name: 'Example',
  environments: ['local'],
  configSchema: [
    { key: 'path', label: 'Snapshot file', type: 'string', required: true, default: 'a.json' },
    { key: 'mode', label: 'Mode', type: 'select', required: false, options: ['fast', 'full'] },
    { key: 'archived', label: 'Include archived', type: 'boolean', required: false },
  ],
}

const OTHER: TaskProgressAdapterInfo = {
  id: 'other',
  name: 'Other',
  environments: ['local', 'wsl'],
  configSchema: [],
}

const PROJECTS: ProjectInfo[] = [
  { id: 'p1', name: 'Current', path: 'D:/code/current', runtimeLabel: null },
  { id: 'p2', name: 'Bound', path: 'D:/code/bound', runtimeLabel: null },
  { id: 'p3', name: 'Unbound', path: 'D:/code/unbound', runtimeLabel: null },
]

let listeners: Array<(event: TaskProgressChangedEvent) => void> = []

function emit(event: TaskProgressChangedEvent): void {
  act(() => {
    for (const listener of listeners) listener(event)
  })
}

function item(id: string, overrides: Partial<TaskProgressItem> = {}): TaskProgressItem {
  return {
    id,
    ref: null,
    title: null,
    state: 'active',
    location: 'live',
    recordState: 'valid',
    errors: [],
    activity: null,
    phases: [{ name: 'A', steps: [{ id: '1', label: 'one', done: false }] }],
    currentStepId: null,
    currentLabel: null,
    corrections: 0,
    reviews: 0,
    nextAction: null,
    blockers: null,
    createdAt: null,
    updatedAt: null,
    completedAt: null,
    checkpoints: [],
    path: null,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function appMock(
  options: {
    adapters?: TaskProgressAdapterInfo[]
    warnings?: string[]
    bindings?: Record<string, TaskProgressBinding>
    saveBinding?: ReturnType<typeof vi.fn>
    test?: ReturnType<typeof vi.fn>
    snapshot?: TaskProgressSnapshot | null
    get?: ReturnType<typeof vi.fn>
  } = {},
): AppApi {
  const bindings = options.bindings ?? {}
  listeners = []
  return {
    taskProgress: {
      adaptersList: vi.fn().mockResolvedValue({
        adapters: options.adapters ?? [EXAMPLE, OTHER],
        warnings: options.warnings ?? [],
      }),
      getBinding: vi.fn(async (projectId: string) => {
        return bindings[projectId] ?? { adapterId: null, config: {} }
      }),
      saveBinding: options.saveBinding ?? vi.fn().mockResolvedValue(undefined),
      test: options.test ?? vi.fn().mockResolvedValue({ ok: true, summary: 'Found 2 tasks.' }),
      get: options.get ?? vi.fn().mockResolvedValue(options.snapshot ?? null),
      onChanged: vi.fn((listener: (event: TaskProgressChangedEvent) => void) => {
        listeners.push(listener)
        return () => {
          listeners = listeners.filter((entry) => entry !== listener)
        }
      }),
    },
    projects: { list: vi.fn().mockResolvedValue(PROJECTS) },
  } as unknown as AppApi
}

async function renderLoaded(app: AppApi, projectId: string | null = 'p1'): Promise<void> {
  render(<TaskProgressSettings app={app} projectId={projectId} />)
  await waitFor(() => expect(screen.queryByTestId(TEST_ID.settingsTaskProgressLoading)).toBeNull())
}

function select(): HTMLSelectElement {
  return screen.getByTestId(TEST_ID.settingsTaskProgressAdapterSelect) as HTMLSelectElement
}

function field(key: string): HTMLInputElement {
  return screen.getByTestId(testIdFor.taskProgressField(key)) as HTMLInputElement
}

describe('TaskProgressSettings', () => {
  it('defaults to None and lists discovered adapters by name and id', async () => {
    await renderLoaded(appMock())
    expect(select().value).toBe('')
    expect([...select().options].map((option) => option.textContent)).toEqual([
      'None',
      'Example · example',
      'Other · other',
    ])
    expect(screen.queryByTestId(testIdFor.taskProgressField('path'))).toBeNull()
    expect(
      (screen.getByTestId(TEST_ID.settingsTaskProgressTest) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('renders the manifest form with defaults and required markers on selection', async () => {
    await renderLoaded(appMock())
    fireEvent.change(select(), { target: { value: 'example' } })
    expect(field('path').value).toBe('a.json')
    expect((field('mode') as unknown as HTMLSelectElement).value).toBe('fast')
    expect(field('archived').checked).toBe(false)
    expect(screen.getByText('Snapshot file').parentElement?.textContent).toContain('*')
  })

  it('shows the stored binding values', async () => {
    const app = appMock({
      bindings: {
        p1: { adapterId: 'example', config: { path: 'b.json', mode: 'full', archived: 'true' } },
      },
    })
    await renderLoaded(app)
    expect(select().value).toBe('example')
    expect(field('path').value).toBe('b.json')
    expect((field('mode') as unknown as HTMLSelectElement).value).toBe('full')
    expect(field('archived').checked).toBe(true)
  })

  it('Test runs with the current unsaved values and shows the summary inline', async () => {
    const app = appMock()
    await renderLoaded(app)
    fireEvent.change(select(), { target: { value: 'example' } })
    fireEvent.change(field('path'), { target: { value: 'draft.json' } })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsTaskProgressTest))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.settingsTaskProgressTestResult).textContent).toBe(
        'Found 2 tasks.',
      ),
    )
    expect(app.taskProgress.test).toHaveBeenCalledWith('p1', 'example', {
      path: 'draft.json',
      mode: 'fast',
      archived: 'false',
    })
    expect(app.taskProgress.saveBinding).not.toHaveBeenCalled()
  })

  it('Test shows a typed error with its code', async () => {
    const test = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'environment_unsupported', message: 'Adapter "example" (test): no WSL.' },
    })
    await renderLoaded(appMock({ test }))
    fireEvent.change(select(), { target: { value: 'example' } })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsTaskProgressTest))
    const result = await screen.findByRole('alert')
    expect(result.textContent).toBe('environment_unsupported: Adapter "example" (test): no WSL.')
  })

  it('Test shows a rejected channel call as an error', async () => {
    const test = vi.fn().mockRejectedValue({
      nekodeAppError: true,
      code: 'not_found',
      message: 'Project "p1" not found.',
    })
    await renderLoaded(appMock({ test }))
    fireEvent.change(select(), { target: { value: 'example' } })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsTaskProgressTest))
    expect((await screen.findByRole('alert')).textContent).toBe('Project "p1" not found.')
  })

  it('Save stores the adapter id and values', async () => {
    const app = appMock()
    await renderLoaded(app)
    fireEvent.change(select(), { target: { value: 'example' } })
    fireEvent.click(field('archived'))
    fireEvent.click(screen.getByTestId(TEST_ID.settingsTaskProgressSave))
    await screen.findByTestId(TEST_ID.settingsTaskProgressSaved)
    expect(app.taskProgress.saveBinding).toHaveBeenCalledWith('p1', 'example', {
      path: 'a.json',
      mode: 'fast',
      archived: 'true',
    })
  })

  it('Save shows a validation error from main inline', async () => {
    const saveBinding = vi.fn().mockRejectedValue({
      nekodeAppError: true,
      code: 'validation',
      message: 'Field "Snapshot file" is required.',
    })
    await renderLoaded(appMock({ saveBinding }))
    fireEvent.change(select(), { target: { value: 'example' } })
    fireEvent.change(field('path'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsTaskProgressSave))
    expect((await screen.findByTestId(TEST_ID.settingsTaskProgressFormError)).textContent).toBe(
      'Field "Snapshot file" is required.',
    )
    expect(screen.queryByTestId(TEST_ID.settingsTaskProgressSaved)).toBeNull()
  })

  it('None saves a null adapter and keeps the stored values for a later selection', async () => {
    const app = appMock({
      bindings: { p1: { adapterId: 'example', config: { path: 'kept.json' } } },
    })
    await renderLoaded(app)
    fireEvent.change(select(), { target: { value: '' } })
    expect(screen.queryByTestId(testIdFor.taskProgressField('path'))).toBeNull()
    fireEvent.click(screen.getByTestId(TEST_ID.settingsTaskProgressSave))
    await screen.findByTestId(TEST_ID.settingsTaskProgressSaved)
    expect(app.taskProgress.saveBinding).toHaveBeenCalledWith('p1', null, {})
    fireEvent.change(select(), { target: { value: 'example' } })
    expect(field('path').value).toBe('kept.json')
  })

  it('Copy from project lists only other bound projects and copies into the form unsaved', async () => {
    const app = appMock({
      bindings: {
        p1: { adapterId: 'other', config: {} },
        p2: { adapterId: 'example', config: { path: 'copied.json', mode: 'full' } },
      },
    })
    await renderLoaded(app)
    fireEvent.click(screen.getByTestId(TEST_ID.settingsTaskProgressCopy))
    const list = await screen.findByTestId(TEST_ID.settingsTaskProgressCopyList)
    expect(list.textContent).toContain('Bound')
    expect(list.textContent).not.toContain('Unbound')
    expect(screen.queryByTestId(testIdFor.taskProgressCopySource('p1'))).toBeNull()
    fireEvent.click(screen.getByTestId(testIdFor.taskProgressCopySource('p2')))
    expect(select().value).toBe('example')
    expect(field('path').value).toBe('copied.json')
    expect((field('mode') as unknown as HTMLSelectElement).value).toBe('full')
    expect(screen.getByTestId(TEST_ID.settingsTaskProgressCopyNotice).textContent).toContain(
      'Bound',
    )
    expect(app.taskProgress.saveBinding).not.toHaveBeenCalled()
  })

  it('Copy from project says when no other project has a binding', async () => {
    await renderLoaded(appMock())
    fireEvent.click(screen.getByTestId(TEST_ID.settingsTaskProgressCopy))
    expect((await screen.findByTestId(TEST_ID.settingsTaskProgressCopyList)).textContent).toContain(
      'No other project',
    )
  })

  it('explains where adapters are installed when none are discovered, without a directory picker', async () => {
    await renderLoaded(appMock({ adapters: [] }))
    const empty = screen.getByTestId(TEST_ID.settingsTaskProgressEmpty)
    expect(empty.textContent).toContain('task-progress-adapters')
    expect(empty.textContent).toContain('adapters/task-progress-example/README.md')
    expect(screen.queryByText(/Browse/)).toBeNull()
    expect(screen.queryByRole('button', { name: /directory|folder/i })).toBeNull()
  })

  it('shows skipped manifest warnings', async () => {
    await renderLoaded(
      appMock({ warnings: ['X/adapter.json: field "kind" must be "task-progress"'] }),
    )
    expect(screen.getByTestId(TEST_ID.settingsTaskProgressWarnings).textContent).toContain(
      'X/adapter.json',
    )
  })

  it('marks a bound adapter that is no longer installed', async () => {
    await renderLoaded(appMock({ bindings: { p1: { adapterId: 'gone', config: {} } } }))
    expect(select().value).toBe('gone')
    expect(screen.getByTestId(TEST_ID.settingsTaskProgressAdapterMissing).textContent).toContain(
      'gone',
    )
  })

  it('rescans the adapters on every mount', async () => {
    const app = appMock()
    await renderLoaded(app)
    cleanup()
    await renderLoaded(app)
    expect(app.taskProgress.adaptersList).toHaveBeenCalledTimes(2)
  })

  it('asks for a project when none is selected', async () => {
    await renderLoaded(appMock(), null)
    expect(screen.getByTestId(TEST_ID.settingsTaskProgressPanel).textContent).toContain(
      'Select a project',
    )
  })

  it('ignores a late Test result after another adapter is selected', async () => {
    const pending = deferred<unknown>()
    const test = vi.fn(() => pending.promise)
    await renderLoaded(appMock({ test }))
    fireEvent.change(select(), { target: { value: 'example' } })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsTaskProgressTest))
    expect(screen.getByTestId(TEST_ID.settingsTaskProgressTestResult).textContent).toBe(
      'Testing...',
    )
    fireEvent.change(select(), { target: { value: 'other' } })
    await act(async () => {
      pending.resolve({ ok: true, summary: 'Result for example.' })
    })
    expect(screen.queryByTestId(TEST_ID.settingsTaskProgressTestResult)).toBeNull()
    expect(screen.queryByText('Result for example.')).toBeNull()
  })

  it('ignores a late Test result after a field value changes', async () => {
    const pending = deferred<unknown>()
    const test = vi.fn(() => pending.promise)
    await renderLoaded(appMock({ test }))
    fireEvent.change(select(), { target: { value: 'example' } })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsTaskProgressTest))
    fireEvent.change(field('path'), { target: { value: 'changed.json' } })
    await act(async () => {
      pending.resolve({ ok: true, summary: 'Result for a.json.' })
    })
    expect(screen.queryByText('Result for a.json.')).toBeNull()
    expect(
      (screen.getByTestId(TEST_ID.settingsTaskProgressTest) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('ignores a late Test result and allows a new Test after the project changes', async () => {
    const pending = deferred<unknown>()
    const app = appMock({
      test: vi.fn(() => pending.promise),
      bindings: { p2: { adapterId: 'example', config: { path: 'b.json' } } },
    })
    const view = render(<TaskProgressSettings app={app} projectId="p1" />)
    await waitFor(() =>
      expect(screen.queryByTestId(TEST_ID.settingsTaskProgressLoading)).toBeNull(),
    )
    fireEvent.change(select(), { target: { value: 'example' } })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsTaskProgressTest))
    view.rerender(<TaskProgressSettings app={app} projectId="p2" />)
    await waitFor(() =>
      expect(screen.queryByTestId(TEST_ID.settingsTaskProgressLoading)).toBeNull(),
    )
    await act(async () => pending.resolve({ ok: true, summary: 'Old project result' }))
    expect(screen.queryByText('Old project result')).toBeNull()
    expect(
      (screen.getByTestId(TEST_ID.settingsTaskProgressTest) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('shows the last read state: time, task count, and the current error', async () => {
    const snapshot: TaskProgressSnapshot = {
      projectId: 'p1',
      adapterId: 'example',
      status: 'stale',
      tasks: [item('a'), item('b')],
      receivedAt: '2026-10-23T09:27:37.000Z',
      error: { code: 'config', message: 'Adapter "example" (snapshot): file missing' },
    }
    const app = appMock({ snapshot })
    await renderLoaded(app)
    const state = await screen.findByTestId(TEST_ID.settingsTaskProgressReadState)
    await waitFor(() => expect(state.textContent).toContain('2 tasks'))
    expect(state.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-23T09:27:37.000Z')
    expect(state.textContent).toContain(
      'Out of date: config: Adapter "example" (snapshot): file missing',
    )
    expect(app.taskProgress.get).toHaveBeenCalledWith('p1')
  })

  it('shows a current retry error without marking the last valid snapshot out of date', async () => {
    await renderLoaded(appMock())
    emit({
      projectId: 'p1',
      adapterId: 'example',
      status: 'ok',
      tasks: [item('a')],
      receivedAt: '2026-10-23T10:00:00.000Z',
      error: { code: 'transient', message: 'busy' },
    })
    const state = screen.getByTestId(TEST_ID.settingsTaskProgressReadState)
    expect(state.textContent).toContain('Retrying: transient: busy')
    expect(state.textContent).toContain('1 task')
    expect(state.textContent).not.toContain('Out of date:')
  })

  it('clears a failed get when a newer snapshot event arrives', async () => {
    await renderLoaded(appMock({ get: vi.fn().mockRejectedValue(new Error('offline')) }))
    const state = screen.getByTestId(TEST_ID.settingsTaskProgressReadState)
    await waitFor(() => expect(state.textContent).toContain('Failed to load'))
    emit({
      projectId: 'p1',
      adapterId: 'example',
      status: 'ok',
      tasks: [item('a')],
      receivedAt: '2026-10-23T10:00:00.000Z',
    })
    expect(state.textContent).toContain('1 task')
    expect(state.textContent).not.toContain('Failed to load')
  })

  it('says when no snapshot was read and when no valid snapshot exists yet', async () => {
    await renderLoaded(appMock())
    const state = screen.getByTestId(TEST_ID.settingsTaskProgressReadState)
    await waitFor(() => expect(state.textContent).toContain('Not read'))
    emit({
      projectId: 'p1',
      adapterId: 'example',
      status: 'stale',
      tasks: [],
      receivedAt: null,
      error: { code: 'transient', message: 'busy' },
    })
    expect(state.textContent).toContain('No valid snapshot yet.')
    expect(state.textContent).toContain('Out of date: transient: busy')
  })

  it('follows change events for this project only and clears on a cleared event', async () => {
    await renderLoaded(appMock())
    const state = screen.getByTestId(TEST_ID.settingsTaskProgressReadState)
    const fresh: TaskProgressSnapshot = {
      projectId: 'p1',
      adapterId: 'example',
      status: 'ok',
      tasks: [item('a')],
      receivedAt: '2026-10-23T10:00:00.000Z',
    }
    emit(fresh)
    expect(state.textContent).toContain('1 task')
    expect(state.textContent).not.toContain('Out of date')
    emit({ ...fresh, projectId: 'p2', tasks: [item('x'), item('y'), item('z')] })
    expect(state.textContent).toContain('1 task')
    emit({ projectId: 'p1', cleared: true })
    expect(state.textContent).toContain('Not read')
  })

  it('keeps a newer change event over a slower get result', async () => {
    const pending = deferred<TaskProgressSnapshot | null>()
    await renderLoaded(appMock({ get: vi.fn(() => pending.promise) }))
    emit({
      projectId: 'p1',
      adapterId: 'example',
      status: 'ok',
      tasks: [item('a'), item('b'), item('c')],
      receivedAt: '2026-10-23T10:00:00.000Z',
    })
    await act(async () => {
      pending.resolve(null)
    })
    expect(screen.getByTestId(TEST_ID.settingsTaskProgressReadState).textContent).toContain(
      '3 tasks',
    )
  })

  it('lists records that are not valid with their errors', async () => {
    await renderLoaded(appMock())
    emit({
      projectId: 'p1',
      adapterId: 'example',
      status: 'ok',
      tasks: [
        item('a'),
        item('broken', { recordState: 'invalid', phases: [], errors: ['no Phase 1'] }),
      ],
      receivedAt: '2026-10-23T10:00:00.000Z',
    })
    expect(screen.getByTestId(TEST_ID.settingsTaskProgressReadState).textContent).toContain(
      'broken (invalid): no Phase 1',
    )
  })

  it('shows a failed get as an error', async () => {
    const get = vi.fn().mockRejectedValue({
      nekodeAppError: true,
      code: 'not_found',
      message: 'Project "p1" not found.',
    })
    await renderLoaded(appMock({ get }))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.settingsTaskProgressReadState).textContent).toContain(
        'Project "p1" not found.',
      ),
    )
  })
})
