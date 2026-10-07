import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AppApi,
  KanbanAdapterInfo,
  KanbanConfigField,
  KanbanProjectConfig,
} from '../../../../shared/ipc-contract'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { KanbanSettings } from './KanbanSettings'

afterEach(cleanup)

// KanbanSettings unit tests (spec kanban-adapter-interface Behaviour 7–8,
// 12–13, renderer level): the fresh-scan adapter select, the manifest-driven
// config form with the secret keep/clear save rules, Test connection's inline
// result, the "(missing)" binding, and the adapters-directory override. The
// app.kanban/state/dialogs boundary is the typed AppApi.

const PLANE_SCHEMA: KanbanConfigField[] = [
  { key: 'workspace', label: 'Workspace slug', type: 'string', required: true },
  { key: 'region', label: 'Region', type: 'string', required: false },
  { key: 'api_key', label: 'API key', type: 'secret', required: true },
  {
    key: 'group',
    label: 'Default group',
    type: 'select',
    required: false,
    options: ['todo', 'done'],
  },
  { key: 'tls', label: 'Use TLS', type: 'boolean', required: false },
]

const PLANE: KanbanAdapterInfo = { id: 'plane', name: 'Plane', configSchema: PLANE_SCHEMA }
const SECOND: KanbanAdapterInfo = { id: 'second', name: 'Second', configSchema: [] }

function emptyConfig(): KanbanProjectConfig {
  return { adapterId: null, values: {}, secretKeys: [] }
}

function appMock(
  options: {
    adaptersList?: ReturnType<typeof vi.fn>
    getConfig?: ReturnType<typeof vi.fn>
    setConfig?: ReturnType<typeof vi.fn>
    test?: ReturnType<typeof vi.fn>
    stateGet?: ReturnType<typeof vi.fn>
    stateSet?: ReturnType<typeof vi.fn>
    pickDirectory?: ReturnType<typeof vi.fn>
  } = {},
): AppApi {
  return {
    kanban: {
      adaptersList: options.adaptersList ?? vi.fn().mockResolvedValue([]),
      getConfig: options.getConfig ?? vi.fn().mockResolvedValue(emptyConfig()),
      setConfig: options.setConfig ?? vi.fn().mockResolvedValue(undefined),
      test: options.test ?? vi.fn().mockResolvedValue(undefined),
      listBoard: vi.fn(),
      createItem: vi.fn(),
      updateItem: vi.fn(),
    },
    state: {
      get: options.stateGet ?? vi.fn().mockResolvedValue(null),
      set: options.stateSet ?? vi.fn().mockResolvedValue(undefined),
    },
    dialogs: {
      pickDirectory: options.pickDirectory ?? vi.fn().mockResolvedValue(null),
    },
  } as unknown as AppApi
}

async function renderLoaded(app: AppApi, projectId = 'p1'): Promise<void> {
  render(<KanbanSettings app={app} projectId={projectId} />)
  await waitFor(() => expect(screen.queryByTestId(TEST_ID.settingsKanbanLoading)).toBeNull())
}

describe('KanbanSettings', () => {
  it('invalidates only after persistence succeeds, including directory changes before a failed rescan', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce({ nekodeAppError: true, code: 'internal', message: 'Save failed' })
      .mockResolvedValue(undefined)
    const scan = vi
      .fn()
      .mockResolvedValueOnce([SECOND])
      .mockRejectedValueOnce({ nekodeAppError: true, code: 'internal', message: 'Scan failed' })
    const app = appMock({
      setConfig: save,
      adaptersList: scan,
      pickDirectory: vi.fn().mockResolvedValue('D:/new-adapters'),
    })
    const invalidate = vi.fn()
    render(<KanbanSettings app={app} projectId="p1" onInvalidate={invalidate} />)
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.settingsKanbanLoading)).toBeNull())
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))
    await screen.findByText('Save failed')
    expect(invalidate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith('p1'))
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanDirBrowse))
    await screen.findByText('Scan failed')
    expect(app.state.set).toHaveBeenCalled()
    expect(invalidate.mock.calls).toEqual([['p1'], [null]])
  })
  it('shows the empty state and the default directory when no adapters are discovered', async () => {
    await renderLoaded(appMock())
    expect(screen.getByTestId(TEST_ID.settingsKanbanEmpty).textContent).toContain(
      'No adapters found',
    )
    const select = screen.getByTestId(TEST_ID.settingsKanbanAdapterSelect) as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.value)).toEqual([''])
    expect(screen.getByTestId(TEST_ID.settingsKanbanDir).textContent).toContain('Default')
  })

  it('renders exactly the manifest fields with their widget per type and masks the secret', async () => {
    const getConfig = vi.fn().mockResolvedValue({
      adapterId: 'plane',
      values: { workspace: 'acme', region: 'eu', group: 'todo', tls: 'false' },
      secretKeys: ['api_key'],
    } satisfies KanbanProjectConfig)
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([PLANE]),
      getConfig,
    })
    await renderLoaded(app)

    expect((screen.getByTestId(testIdFor.kanbanField('workspace')) as HTMLInputElement).value).toBe(
      'acme',
    )
    const secret = screen.getByTestId(testIdFor.kanbanField('api_key')) as HTMLInputElement
    expect(secret.type).toBe('password')
    expect(secret.value).toBe('')
    expect(screen.getByTestId(testIdFor.kanbanSecretStored('api_key')).textContent).toBe('stored')
    expect((screen.getByTestId(testIdFor.kanbanField('group')) as HTMLSelectElement).value).toBe(
      'todo',
    )
    expect((screen.getByTestId(testIdFor.kanbanField('tls')) as HTMLInputElement).checked).toBe(
      false,
    )
  })

  it('keeps an empty secret, clears an empty non-secret, and never re-renders the stored secret', async () => {
    const setConfig = vi.fn().mockResolvedValue(undefined)
    const getConfig = vi.fn().mockResolvedValue({
      adapterId: 'plane',
      values: { workspace: 'acme', region: 'eu', group: 'todo', tls: 'false' },
      secretKeys: ['api_key'],
    } satisfies KanbanProjectConfig)
    await renderLoaded(
      appMock({ adaptersList: vi.fn().mockResolvedValue([PLANE]), getConfig, setConfig }),
    )

    // Untouched save: the empty secret is omitted (keep stored), non-secrets verbatim.
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))
    await waitFor(() =>
      expect(setConfig).toHaveBeenCalledWith('p1', {
        adapterId: 'plane',
        values: { workspace: 'acme', region: 'eu', group: 'todo', tls: 'false' },
      }),
    )
    const first = setConfig.mock.calls[0][1] as { values: Record<string, string> }
    expect('api_key' in first.values).toBe(false)

    // A typed secret is sent once, then dropped from the form after save.
    fireEvent.change(screen.getByTestId(testIdFor.kanbanField('api_key')), {
      target: { value: 'super-secret-token' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))
    await waitFor(() =>
      expect(setConfig).toHaveBeenLastCalledWith('p1', {
        adapterId: 'plane',
        values: {
          workspace: 'acme',
          region: 'eu',
          api_key: 'super-secret-token',
          group: 'todo',
          tls: 'false',
        },
      }),
    )
    await waitFor(() =>
      expect((screen.getByTestId(testIdFor.kanbanField('api_key')) as HTMLInputElement).value).toBe(
        '',
      ),
    )
    expect(document.body.textContent ?? '').not.toContain('super-secret-token')
    for (const input of Array.from(document.body.querySelectorAll('input'))) {
      expect(input.value).not.toContain('super-secret-token')
    }

    // Emptying a non-secret clears it: the payload carries the empty string.
    fireEvent.change(screen.getByTestId(testIdFor.kanbanField('region')), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))
    await waitFor(() =>
      expect(setConfig).toHaveBeenLastCalledWith('p1', {
        adapterId: 'plane',
        values: { workspace: 'acme', region: '', group: 'todo', tls: 'false' },
      }),
    )
  })

  it('blocks save and renders an inline error when a required field is empty', async () => {
    const setConfig = vi.fn().mockResolvedValue(undefined)
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([PLANE]),
      getConfig: vi.fn().mockResolvedValue({
        adapterId: 'plane',
        values: {},
        secretKeys: ['api_key'],
      } satisfies KanbanProjectConfig),
      setConfig,
    })
    await renderLoaded(app)
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Workspace slug'))
    expect(setConfig).not.toHaveBeenCalled()
  })

  it('renders Test connection in progress then success inline', async () => {
    let resolveTest: () => void = () => {}
    const test = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveTest = resolve
        }),
    )
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([PLANE]),
      getConfig: vi.fn().mockResolvedValue({
        adapterId: 'plane',
        values: { workspace: 'acme' },
        secretKeys: ['api_key'],
      } satisfies KanbanProjectConfig),
      test,
    })
    await renderLoaded(app)
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTest))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.settingsKanbanTestResult).textContent).toContain('Testing'),
    )
    resolveTest()
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.settingsKanbanTestResult).textContent).toContain(
        'Connection succeeded',
      ),
    )
  })

  it('renders a typed adapter failure inline, not as a toast', async () => {
    const test = vi.fn().mockRejectedValue({
      nekodeAppError: true,
      code: 'auth',
      message: 'Invalid API key.',
    })
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([PLANE]),
      getConfig: vi.fn().mockResolvedValue({
        adapterId: 'plane',
        values: { workspace: 'acme' },
        secretKeys: ['api_key'],
      } satisfies KanbanProjectConfig),
      test,
    })
    await renderLoaded(app)
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTest))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.settingsKanbanTestResult).textContent).toContain(
        'Invalid API key.',
      ),
    )
    expect(screen.getByRole('alert').textContent).toContain('Invalid API key.')
  })

  it('marks a stored binding whose adapter is gone "(missing)" and still allows clearing it', async () => {
    const setConfig = vi.fn().mockResolvedValue(undefined)
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([PLANE]),
      getConfig: vi.fn().mockResolvedValue({
        adapterId: 'plane-gone',
        values: {},
        secretKeys: [],
      } satisfies KanbanProjectConfig),
      setConfig,
    })
    await renderLoaded(app)
    const select = screen.getByTestId(TEST_ID.settingsKanbanAdapterSelect) as HTMLSelectElement
    expect(select.value).toBe('plane-gone')
    expect(Array.from(select.options).map((option) => option.textContent)).toContain(
      'plane-gone (missing)',
    )
    expect(screen.getByTestId(TEST_ID.settingsKanbanAdapterMissing).textContent).toContain(
      'not installed',
    )

    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))
    await waitFor(() =>
      expect(setConfig).toHaveBeenCalledWith('p1', { adapterId: null, values: {} }),
    )
    expect(screen.getByTestId(TEST_ID.settingsKanbanSaved)).toBeTruthy()
  })

  it('persists a Browse override to kanban.adaptersDir and re-scans immediately', async () => {
    const adaptersList = vi
      .fn()
      .mockResolvedValueOnce([PLANE])
      .mockResolvedValueOnce([PLANE, SECOND])
    const stateSet = vi.fn().mockResolvedValue(undefined)
    const app = appMock({
      adaptersList,
      getConfig: vi.fn().mockResolvedValue(emptyConfig()),
      stateGet: vi.fn().mockResolvedValue('C:\\old-adapters'),
      stateSet,
      pickDirectory: vi.fn().mockResolvedValue('C:\\new-adapters'),
    })
    await renderLoaded(app)
    expect(screen.getByTestId(TEST_ID.settingsKanbanDir).textContent).toBe('C:\\old-adapters')

    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanDirBrowse))
    await waitFor(() =>
      expect(stateSet).toHaveBeenCalledWith('kanban.adaptersDir', 'C:\\new-adapters'),
    )
    expect(adaptersList).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId(TEST_ID.settingsKanbanDir).textContent).toBe('C:\\new-adapters')
    await waitFor(() => {
      const values = Array.from(
        (screen.getByTestId(TEST_ID.settingsKanbanAdapterSelect) as HTMLSelectElement).options,
      ).map((option) => option.value)
      expect(values).toContain('second')
    })
  })

  it('disables Test connection and does not test while the selected adapter is unsaved', async () => {
    const test = vi.fn().mockResolvedValue(undefined)
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([PLANE, SECOND]),
      getConfig: vi.fn().mockResolvedValue(emptyConfig()),
      test,
    })
    await renderLoaded(app)

    fireEvent.change(screen.getByTestId(TEST_ID.settingsKanbanAdapterSelect), {
      target: { value: 'plane' },
    })

    const button = screen.getByTestId(TEST_ID.settingsKanbanTest) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByTestId(TEST_ID.settingsKanbanTestHint)).toBeTruthy()
    fireEvent.click(button)
    expect(test).not.toHaveBeenCalled()
    expect(screen.queryByTestId(TEST_ID.settingsKanbanTestResult)).toBeNull()
  })

  it('keeps a binding unsaved and shows the inline error when saving rejects', async () => {
    const setConfig = vi.fn().mockRejectedValue({
      nekodeAppError: true,
      code: 'internal',
      message: 'Save failed.',
    })
    const test = vi.fn()
    await renderLoaded(
      appMock({
        adaptersList: vi.fn().mockResolvedValue([SECOND]),
        setConfig,
        test,
      }),
    )
    fireEvent.change(screen.getByTestId(TEST_ID.settingsKanbanAdapterSelect), {
      target: { value: 'second' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Save failed.'))
    expect(setConfig).toHaveBeenCalledExactlyOnceWith('p1', { adapterId: 'second', values: {} })
    expect(screen.queryByTestId(TEST_ID.settingsKanbanSaved)).toBeNull()
    const button = screen.getByTestId(TEST_ID.settingsKanbanTest) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByTestId(TEST_ID.settingsKanbanTestHint)).toBeTruthy()
    fireEvent.click(button)
    expect(test).not.toHaveBeenCalled()
    expect(screen.queryByTestId(TEST_ID.settingsKanbanTestResult)).toBeNull()
  })

  it('enables Test connection after save and tests the entered values', async () => {
    const setConfig = vi.fn().mockResolvedValue(undefined)
    const test = vi.fn().mockResolvedValue(undefined)
    const getConfig = vi
      .fn()
      .mockResolvedValueOnce(emptyConfig())
      .mockResolvedValue({
        adapterId: 'plane',
        values: { workspace: 'acme', region: '', group: 'todo', tls: 'false' },
        secretKeys: ['api_key'],
      } satisfies KanbanProjectConfig)
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([PLANE, SECOND]),
      getConfig,
      setConfig,
      test,
    })
    await renderLoaded(app)

    fireEvent.change(screen.getByTestId(TEST_ID.settingsKanbanAdapterSelect), {
      target: { value: 'plane' },
    })
    fireEvent.change(screen.getByTestId(testIdFor.kanbanField('workspace')), {
      target: { value: 'acme' },
    })
    fireEvent.change(screen.getByTestId(testIdFor.kanbanField('api_key')), {
      target: { value: 'tok' },
    })
    // Unsaved: the control is still gated before the save round-trips.
    expect((screen.getByTestId(TEST_ID.settingsKanbanTest) as HTMLButtonElement).disabled).toBe(
      true,
    )

    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))
    await waitFor(() =>
      expect(setConfig).toHaveBeenCalledWith('p1', {
        adapterId: 'plane',
        values: { workspace: 'acme', region: '', api_key: 'tok', group: 'todo', tls: 'false' },
      }),
    )
    await waitFor(() =>
      expect((screen.getByTestId(TEST_ID.settingsKanbanTest) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    expect(screen.queryByTestId(TEST_ID.settingsKanbanTestHint)).toBeNull()

    // Behaviour 8: the test sends the CURRENTLY entered values, not the stored
    // ones the post-save reload repopulated. Edit after save and prove the edit
    // is what the adapter receives, without a second persistence.
    fireEvent.change(screen.getByTestId(testIdFor.kanbanField('workspace')), {
      target: { value: 'edited' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTest))
    await waitFor(() =>
      expect(test).toHaveBeenCalledWith('p1', {
        workspace: 'edited',
        region: '',
        group: 'todo',
        tls: 'false',
      }),
    )
    expect(setConfig).toHaveBeenCalledTimes(1)
  })

  it('keeps the saved binding testable when the post-save reload fails', async () => {
    const setConfig = vi.fn().mockResolvedValue(undefined)
    const test = vi.fn().mockResolvedValue(undefined)
    const getConfig = vi.fn().mockResolvedValueOnce(emptyConfig()).mockRejectedValue({
      nekodeAppError: true,
      code: 'internal',
      message: 'Reload failed.',
    })
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([PLANE]),
      getConfig,
      setConfig,
      test,
    })
    await renderLoaded(app)

    fireEvent.change(screen.getByTestId(TEST_ID.settingsKanbanAdapterSelect), {
      target: { value: 'plane' },
    })
    fireEvent.change(screen.getByTestId(testIdFor.kanbanField('workspace')), {
      target: { value: 'acme' },
    })
    fireEvent.change(screen.getByTestId(testIdFor.kanbanField('api_key')), {
      target: { value: 'tok' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))

    // setConfig resolved, so main holds the binding: the displayed adapter is
    // testable even though the follow-up reload rejected (Behaviour 7–8).
    await waitFor(() =>
      expect((screen.getByTestId(TEST_ID.settingsKanbanTest) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    expect(screen.queryByTestId(TEST_ID.settingsKanbanTestHint)).toBeNull()
    expect(screen.getByTestId(TEST_ID.settingsKanbanSaved)).toBeTruthy()
    // The reload failure is still surfaced inline.
    expect(screen.getByRole('alert').textContent).toContain('Reload failed.')

    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTest))
    await waitFor(() => expect(test).toHaveBeenCalledWith('p1', expect.any(Object)))
  })

  it('disables Test connection again when the select changes after a save', async () => {
    const setConfig = vi.fn().mockResolvedValue(undefined)
    const test = vi.fn().mockResolvedValue(undefined)
    const getConfig = vi
      .fn()
      .mockResolvedValueOnce(emptyConfig())
      .mockResolvedValue({
        adapterId: 'plane',
        values: { workspace: 'acme', region: '', group: 'todo', tls: 'false' },
        secretKeys: ['api_key'],
      } satisfies KanbanProjectConfig)
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([PLANE, SECOND]),
      getConfig,
      setConfig,
      test,
    })
    await renderLoaded(app)

    const select = screen.getByTestId(TEST_ID.settingsKanbanAdapterSelect)
    fireEvent.change(select, { target: { value: 'plane' } })
    fireEvent.change(screen.getByTestId(testIdFor.kanbanField('workspace')), {
      target: { value: 'acme' },
    })
    fireEvent.change(screen.getByTestId(testIdFor.kanbanField('api_key')), {
      target: { value: 'tok' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))
    await waitFor(() =>
      expect((screen.getByTestId(TEST_ID.settingsKanbanTest) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )

    fireEvent.change(select, { target: { value: 'second' } })
    await waitFor(() =>
      expect((screen.getByTestId(TEST_ID.settingsKanbanTest) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    )
    expect(screen.getByTestId(TEST_ID.settingsKanbanTestHint)).toBeTruthy()
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTest))
    expect(test).not.toHaveBeenCalled()
  })
})
