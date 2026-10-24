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
// result, the "(missing)" binding, and the fixed adapters directory (no
// override). The app.kanban/state boundary is the typed AppApi.

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
    bindLocalFile?: ReturnType<typeof vi.fn>
    skillStatus?: ReturnType<typeof vi.fn>
    writeSkill?: ReturnType<typeof vi.fn>
    agentProfilesGet?: ReturnType<typeof vi.fn>
  } = {},
): AppApi {
  return {
    kanban: {
      adaptersList: options.adaptersList ?? vi.fn().mockResolvedValue([]),
      getConfig: options.getConfig ?? vi.fn().mockResolvedValue(emptyConfig()),
      setConfig: options.setConfig ?? vi.fn().mockResolvedValue(undefined),
      test: options.test ?? vi.fn().mockResolvedValue(undefined),
      bindLocalFile: options.bindLocalFile ?? vi.fn().mockResolvedValue(undefined),
      skillStatus: options.skillStatus ?? vi.fn().mockResolvedValue({ exists: false }),
      writeSkill: options.writeSkill ?? vi.fn().mockResolvedValue(undefined),
      listBoard: vi.fn(),
      createItem: vi.fn(),
      updateItem: vi.fn(),
    },
    state: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    agentProfiles: {
      get: options.agentProfilesGet ?? vi.fn().mockResolvedValue({ defaultId: null, profiles: [] }),
    },
  } as unknown as AppApi
}

async function renderLoaded(app: AppApi, projectId = 'p1'): Promise<void> {
  render(<KanbanSettings app={app} projectId={projectId} />)
  await waitFor(() => expect(screen.queryByTestId(TEST_ID.settingsKanbanLoading)).toBeNull())
}

describe('KanbanSettings', () => {
  it('invalidates only after persistence succeeds', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce({ nekodeAppError: true, code: 'internal', message: 'Save failed' })
      .mockResolvedValue(undefined)
    const app = appMock({
      setConfig: save,
      adaptersList: vi.fn().mockResolvedValue([SECOND]),
    })
    const invalidate = vi.fn()
    render(<KanbanSettings app={app} projectId="p1" onInvalidate={invalidate} />)
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.settingsKanbanLoading)).toBeNull())
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))
    await screen.findByText('Save failed')
    expect(invalidate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanSave))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith('p1'))
    expect(invalidate.mock.calls).toEqual([['p1']])
  })
  it('asks for a project in Tasks wording when none is selected (project-home Behaviour 6)', async () => {
    render(<KanbanSettings app={appMock()} projectId={null} />)
    expect(await screen.findByText('Select a project to connect a task source.')).toBeTruthy()
    expect(screen.queryByText(/kanban/i)).toBeNull()
  })

  it('shows the fixed install folder in the empty state and offers no directory choice', async () => {
    const app = appMock()
    await renderLoaded(app)
    expect(screen.getByTestId(TEST_ID.settingsKanbanEmpty).textContent).toContain(
      'kanban-adapters folder of the NeKode application data directory',
    )
    const select = screen.getByTestId(TEST_ID.settingsKanbanAdapterSelect) as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.value)).toEqual([''])
    expect(screen.queryByText(/Adapters directory/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Browse/ })).toBeNull()
    expect(app.state.get).not.toHaveBeenCalled()
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

  it('warns that secrets are session-only when no keyring is available', async () => {
    const getConfig = vi.fn().mockResolvedValue({
      adapterId: 'plane',
      values: { workspace: 'acme', region: 'eu', group: 'todo', tls: 'false' },
      secretKeys: [],
      sessionOnlySecrets: true,
    } satisfies KanbanProjectConfig)
    await renderLoaded(appMock({ adaptersList: vi.fn().mockResolvedValue([PLANE]), getConfig }))
    expect(screen.getByTestId(TEST_ID.settingsKanbanSecretSessionOnly).textContent).toContain(
      'never saved in plain text',
    )
  })

  it('shows no keyring warning when secrets are encrypted at rest', async () => {
    const getConfig = vi.fn().mockResolvedValue({
      adapterId: 'plane',
      values: { workspace: 'acme', region: 'eu', group: 'todo', tls: 'false' },
      secretKeys: ['api_key'],
    } satisfies KanbanProjectConfig)
    await renderLoaded(appMock({ adaptersList: vi.fn().mockResolvedValue([PLANE]), getConfig }))
    expect(screen.queryByTestId(TEST_ID.settingsKanbanSecretSessionOnly)).toBeNull()
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
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTest))
    expect(test).not.toHaveBeenCalled()
  })

  // One parameterized contract for the guarded handlers, one named row per
  // original scenario. Every row keeps the same failure mode provable: a rapid
  // double activation must not start a second mutation, the button is disabled
  // while the mutation is in flight, and it re-enables after resolve and after
  // rejection (unlock on error).
  interface GuardCase {
    /** The control the guard protects. */
    button: HTMLButtonElement
    /** The mutation's call. */
    call: ReturnType<typeof vi.fn>
    /** Resolves the in-flight mutation and asserts the row's completion state. */
    complete: () => Promise<void>
    /** Arms the rejection and re-triggers the mutation; returns the control. */
    rearm: () => HTMLButtonElement
    /** Message the rejected mutation surfaces. */
    errorMessage: string
  }

  // Original scenario: 'blocks rapid double activation of save, disables button
  // during mutation, and unlocks on error'.
  async function saveCase(): Promise<GuardCase> {
    let resolveSetConfig: () => void = () => {}
    const setConfig = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSetConfig = resolve
        }),
    )
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([SECOND]),
      setConfig,
    })
    await renderLoaded(app)
    fireEvent.change(screen.getByTestId(TEST_ID.settingsKanbanAdapterSelect), {
      target: { value: 'second' },
    })
    const button = screen.getByTestId(TEST_ID.settingsKanbanSave) as HTMLButtonElement
    return {
      button,
      call: setConfig,
      complete: async () => {
        resolveSetConfig()
        await waitFor(() => expect(button.disabled).toBe(false))
        // Original non-guard step: a resolved save shows the saved indicator.
        expect(screen.getByTestId(TEST_ID.settingsKanbanSaved)).toBeTruthy()
      },
      rearm: () => {
        setConfig.mockRejectedValueOnce({
          nekodeAppError: true,
          code: 'internal',
          message: 'Failed to write config',
        })
        return button
      },
      errorMessage: 'Failed to write config',
    }
  }

  const guardRows: Array<[string, () => Promise<GuardCase>]> = [['save', saveCase]]

  it.each(guardRows)(
    'blocks rapid double activation of %s, disables button during mutation, and unlocks on error',
    async (_name, mount) => {
      const guard = await mount()
      expect(guard.button.disabled).toBe(false)

      // First activation starts the mutation.
      fireEvent.click(guard.button)
      expect(guard.call).toHaveBeenCalledTimes(1)
      expect(guard.button.disabled).toBe(true)

      // Rapid second activation is blocked: one call only.
      fireEvent.click(guard.button)
      expect(guard.call).toHaveBeenCalledTimes(1)

      // Resolve: the row's completion state lands and the guard releases.
      await guard.complete()

      // Rejection: the error surfaces and the button unlocks.
      const retryButton = guard.rearm()
      expect(retryButton.disabled).toBe(false)
      fireEvent.click(retryButton)
      await screen.findByText(guard.errorMessage)
      expect(retryButton.disabled).toBe(false)
    },
  )
})

describe('KanbanSettings - Local file (project-home spec Behaviour 6-7, 10)', () => {
  const LOCAL: KanbanAdapterInfo = { id: 'local-file', name: 'Local file', configSchema: [] }

  function localConfig(): KanbanProjectConfig {
    return { adapterId: 'local-file', values: {}, secretKeys: [] }
  }

  it('offers Use a local task list while unbound; it binds, invalidates and shows the path', async () => {
    const getConfig = vi.fn().mockResolvedValueOnce(emptyConfig()).mockResolvedValue(localConfig())
    const bindLocalFile = vi.fn().mockResolvedValue(undefined)
    const onInvalidate = vi.fn()
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([LOCAL, PLANE]),
      getConfig,
      bindLocalFile,
    })
    render(<KanbanSettings app={app} projectId="p1" onInvalidate={onInvalidate} />)
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.settingsKanbanLoading)).toBeNull())
    const select = screen.getByTestId(TEST_ID.settingsKanbanAdapterSelect) as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      '(none)',
      'Local file',
      'Plane · plane',
    ])

    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanUseLocal))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.settingsKanbanLocalPath).textContent).toBe(
        '.nekode/tasks.json',
      ),
    )
    expect(bindLocalFile).toHaveBeenCalledWith('p1')
    expect(onInvalidate).toHaveBeenCalledWith('p1')
    expect(select.value).toBe('local-file')
    // Bound now: the action is absent.
    expect(screen.queryByTestId(TEST_ID.settingsKanbanUseLocal)).toBeNull()
  })

  it('does not offer Use a local task list while a source is bound', async () => {
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([LOCAL, PLANE]),
      getConfig: vi.fn().mockResolvedValue({ adapterId: 'plane', values: {}, secretKeys: [] }),
    })
    await renderLoaded(app)
    expect(screen.queryByTestId(TEST_ID.settingsKanbanUseLocal)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.settingsKanbanLocalPath)).toBeNull()
  })

  it('shows a failed Use a local task list inline and stays unbound', async () => {
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([LOCAL]),
      bindLocalFile: vi.fn().mockRejectedValue({
        nekodeAppError: true,
        code: 'validation_error',
        message: '.nekode/tasks.json resolves outside the project folder.',
      }),
    })
    await renderLoaded(app)
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanUseLocal))
    expect((await screen.findByRole('alert')).textContent).toBe(
      '.nekode/tasks.json resolves outside the project folder.',
    )
    expect(screen.getByTestId(TEST_ID.settingsKanbanUseLocal)).toBeTruthy()
  })

  it('Test parses the file and reports it readable, or the typed error inline', async () => {
    const test = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'validation_error',
      message: 'The task file .nekode/tasks.json is not valid: it is not valid JSON.',
    })
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([LOCAL]),
      getConfig: vi.fn().mockResolvedValue(localConfig()),
      test,
    })
    await renderLoaded(app)
    expect(screen.getByTestId(TEST_ID.settingsKanbanLocalPath).textContent).toBe(
      '.nekode/tasks.json',
    )
    // The adapters-directory notice counts discovered adapters only.
    expect(screen.getByTestId(TEST_ID.settingsKanbanEmpty)).toBeTruthy()
    const testButton = screen.getByTestId(TEST_ID.settingsKanbanTest)
    expect(testButton.textContent).toBe('Test')
    fireEvent.click(testButton)
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.settingsKanbanTestResult).textContent).toBe(
        'The task file is readable.',
      ),
    )
    expect(test).toHaveBeenCalledWith('p1', {})
    fireEvent.click(testButton)
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.settingsKanbanTestResult).textContent).toBe(
        'The task file .nekode/tasks.json is not valid: it is not valid JSON.',
      ),
    )
  })
})

describe('KanbanSettings - Teach agents (project-home spec Behaviour 11, AC8)', () => {
  const LOCAL: KanbanAdapterInfo = { id: 'local-file', name: 'Local file', configSchema: [] }
  const SKILL_PATH = '.agents/skills/nekode-tasks/SKILL.md'

  function bound(adapterId: string) {
    return vi.fn().mockResolvedValue({ adapterId, values: {}, secretKeys: [] })
  }

  function profiles(...names: string[]) {
    return vi.fn().mockResolvedValue({
      defaultId: null,
      profiles: names.map((name, index) => ({
        id: `profile-${index}`,
        name,
        executable: name.toLowerCase(),
        args: [],
      })),
    })
  }

  it('is absent while no source is bound, even with a selected unsaved adapter', async () => {
    const app = appMock({ adaptersList: vi.fn().mockResolvedValue([LOCAL, PLANE]) })
    await renderLoaded(app)
    expect(screen.queryByTestId(TEST_ID.settingsKanbanTeachAgents)).toBeNull()
    fireEvent.change(screen.getByTestId(TEST_ID.settingsKanbanAdapterSelect), {
      target: { value: 'plane' },
    })
    expect(screen.queryByTestId(TEST_ID.settingsKanbanTeachAgents)).toBeNull()
  })

  it('is present while a source is bound', async () => {
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([LOCAL, PLANE]),
      getConfig: bound('local-file'),
    })
    await renderLoaded(app)
    expect(screen.getByTestId(TEST_ID.settingsKanbanTeachAgents).textContent).toBe('Teach agents')
  })

  it('names the file and lists the selected profiles; Cancel writes nothing', async () => {
    const writeSkill = vi.fn().mockResolvedValue(undefined)
    const skillStatus = vi.fn().mockResolvedValue({ exists: false })
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([PLANE]),
      getConfig: bound('plane'),
      writeSkill,
      skillStatus,
      agentProfilesGet: profiles('Claude', 'Grok'),
    })
    await renderLoaded(app)
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTeachAgents))
    const dialog = await screen.findByTestId(TEST_ID.confirmDialog)
    expect(skillStatus).toHaveBeenCalledWith('p1')
    expect(app.agentProfiles.get).toHaveBeenCalledWith('p1')
    expect(screen.getByTestId(TEST_ID.settingsKanbanTeachFile).textContent).toBe(SKILL_PATH)
    const items = screen.getByTestId(TEST_ID.settingsKanbanTeachProfiles).querySelectorAll('li')
    expect(Array.from(items).map((item) => item.textContent)).toEqual(['Claude', 'Grok'])
    expect(screen.queryByTestId(TEST_ID.settingsKanbanTeachNoProfiles)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.settingsKanbanTeachReplace)).toBeNull()
    expect(dialog.textContent).not.toMatch(/\.claude|\.grok/)

    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogCancel))
    expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull()
    expect(writeSkill).not.toHaveBeenCalled()
  })

  it('says that no agent profile is selected and still offers the file', async () => {
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([LOCAL]),
      getConfig: bound('local-file'),
    })
    await renderLoaded(app)
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTeachAgents))
    await screen.findByTestId(TEST_ID.confirmDialog)
    expect(screen.getByTestId(TEST_ID.settingsKanbanTeachNoProfiles).textContent).toBe(
      'No agent profile is selected for this project.',
    )
    expect(screen.getByTestId(TEST_ID.settingsKanbanTeachFile).textContent).toBe(SKILL_PATH)
    expect(screen.getByTestId(TEST_ID.confirmDialogConfirm)).toBeTruthy()
  })

  it('shows the replace copy when the file exists and Confirm writes it', async () => {
    const writeSkill = vi.fn().mockResolvedValue(undefined)
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([LOCAL]),
      getConfig: bound('local-file'),
      skillStatus: vi.fn().mockResolvedValue({ exists: true }),
      writeSkill,
      agentProfilesGet: profiles('Claude'),
    })
    await renderLoaded(app)
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTeachAgents))
    await screen.findByTestId(TEST_ID.confirmDialog)
    expect(screen.getByTestId(TEST_ID.settingsKanbanTeachReplace).textContent).toBe(
      `This replaces ${SKILL_PATH}.`,
    )
    expect(writeSkill).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogConfirm))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull())
    expect(writeSkill).toHaveBeenCalledTimes(1)
    expect(writeSkill).toHaveBeenCalledWith('p1')
    expect(screen.getByTestId(TEST_ID.settingsKanbanTeachDone).textContent).toBe(
      `Wrote ${SKILL_PATH}.`,
    )
  })

  it('shows a failed write inline and keeps the dialog open', async () => {
    const writeSkill = vi
      .fn()
      .mockRejectedValueOnce({
        nekodeAppError: true,
        code: 'validation_error',
        message: '.agents resolves outside the project folder.',
      })
      .mockResolvedValueOnce(undefined)
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([PLANE]),
      getConfig: bound('plane'),
      writeSkill,
    })
    await renderLoaded(app)
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTeachAgents))
    await screen.findByTestId(TEST_ID.confirmDialog)
    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogConfirm))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.settingsKanbanTeachError).textContent).toBe(
        '.agents resolves outside the project folder.',
      ),
    )
    expect(screen.getByTestId(TEST_ID.confirmDialog)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.settingsKanbanTeachDone)).toBeNull()
    // A retry from the same dialog closes it on success.
    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogConfirm))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull())
    expect(writeSkill).toHaveBeenCalledTimes(2)
  })

  it('ignores Cancel, Escape, and the backdrop while the write runs, and keeps focus inside', async () => {
    let finish: (value?: unknown) => void = () => undefined
    let fail: (reason: unknown) => void = () => undefined
    const writeSkill = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve
          fail = reject
        }),
    )
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([LOCAL]),
      getConfig: bound('local-file'),
      writeSkill,
    })
    await renderLoaded(app)
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTeachAgents))
    const dialog = await screen.findByTestId(TEST_ID.confirmDialog)
    const confirm = screen.getByTestId(TEST_ID.confirmDialogConfirm)
    // ConfirmDialog focuses Confirm in a passive effect, which can run after
    // findBy resolves.
    await waitFor(() => expect(document.activeElement).toBe(confirm))
    fireEvent.click(confirm)
    await waitFor(() => expect(confirm.getAttribute('aria-disabled')).toBe('true'))
    // The confirm keeps focus (no `disabled` attribute), so keys stay in the dialog.
    expect(confirm.hasAttribute('disabled')).toBe(false)
    expect(document.activeElement).toBe(confirm)

    fireEvent.click(confirm)
    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogCancel))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    fireEvent.mouseDown(dialog.parentElement as Element)
    expect(screen.getByTestId(TEST_ID.confirmDialog)).toBe(dialog)
    expect(writeSkill).toHaveBeenCalledTimes(1)

    fail({ nekodeAppError: true, code: 'unknown', message: `Could not write ${SKILL_PATH}.` })
    await screen.findByTestId(TEST_ID.settingsKanbanTeachError)
    expect(confirm.hasAttribute('aria-disabled')).toBe(false)
    expect(dialog.contains(document.activeElement)).toBe(true)
    // After the write ends, Escape closes the dialog again.
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull()
    finish()
  })

  it('returns focus to Teach agents on close even if focus dropped while the status loaded', async () => {
    let answer: (value: { exists: boolean }) => void = () => undefined
    const skillStatus = vi.fn(
      () =>
        new Promise<{ exists: boolean }>((resolve) => {
          answer = resolve
        }),
    )
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([LOCAL]),
      getConfig: bound('local-file'),
      skillStatus,
    })
    await renderLoaded(app)
    const teach = screen.getByTestId(TEST_ID.settingsKanbanTeachAgents) as HTMLButtonElement
    teach.focus()
    fireEvent.click(teach)
    await waitFor(() => expect(teach.disabled).toBe(true))
    // Chromium moves focus off a button that becomes disabled; jsdom does
    // not, so focus is dropped to the body through a removed element.
    const stand = document.createElement('input')
    document.body.append(stand)
    stand.focus()
    stand.remove()
    expect(document.activeElement).toBe(document.body)
    answer({ exists: false })
    await screen.findByTestId(TEST_ID.confirmDialog)
    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogCancel))
    expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(teach))

    // A successful write returns focus there too.
    fireEvent.click(teach)
    await waitFor(() => expect(skillStatus).toHaveBeenCalledTimes(2))
    answer({ exists: false })
    await screen.findByTestId(TEST_ID.confirmDialog)
    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogConfirm))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(teach))
  })

  it('shows a failed status read inline in the section and opens no dialog', async () => {
    const app = appMock({
      adaptersList: vi.fn().mockResolvedValue([LOCAL]),
      getConfig: bound('local-file'),
      skillStatus: vi.fn().mockRejectedValue({
        nekodeAppError: true,
        code: 'unknown',
        message: 'Could not resolve .agents: it exists but its link cannot be followed.',
      }),
    })
    await renderLoaded(app)
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTeachAgents))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not resolve .agents: it exists but its link cannot be followed.',
    )
    expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull()
    expect(app.kanban.writeSkill).not.toHaveBeenCalled()
  })
})
