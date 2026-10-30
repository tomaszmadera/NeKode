import type { ActionControl, ActionInput, AppApi } from '@shared/ipc-contract'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { ActionSettings } from './ActionSettings'

afterEach(cleanup)

const PS_LABEL = 'Run as a PowerShell script'

// Minimal shell surface for the Shell tab (the default tab runs one detection
// on entry, spec project-shell-selection): these tests exercise the Actions
// tab, so the mocks only need to resolve without probing.
function shellAppMock(): AppApi {
  return {
    terminals: {
      shellDetect: vi.fn().mockResolvedValue([{ id: 'default', label: 'PowerShell' }]),
      shellAddCustom: vi.fn(),
    },
    state: {},
    kanban: {
      adaptersList: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue({ adapterId: null, values: {}, secretKeys: [] }),
    },
  } as unknown as AppApi
}

describe('PowerShell action option', () => {
  // One full save/edit cycle proves the command wrapping, the edit round-trip
  // and the fresh-form checkbox state. The run-mode passthrough varies per
  // mode in the 3-row table below instead of re-running this cycle three times.
  it('saves a PowerShell command and supports editing and disabling it', async () => {
    const command = '"./scripts/zażółć 🐱/start.ps1" -Name "Example value"'
    const create = vi.fn().mockResolvedValue({})
    const update = vi.fn().mockResolvedValue({})
    const app = { ...shellAppMock(), actions: { create, update } } as unknown as AppApi
    const props = {
      app,
      actions: [] as ActionControl[],
      projectId: null,
      projectPath: null,
      autoSend: false,
      onAutoSendChange: vi.fn(),
      onRefresh: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn(),
    }
    const view = render(<ActionSettings {...props} />)
    // The modal opens on the Shell tab; the action form lives on the
    // Actions tab.
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Example' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: command } })
    fireEvent.change(screen.getByLabelText('Run in'), { target: { value: 'background' } })
    fireEvent.click(screen.getByLabelText(PS_LABEL))
    // Checkbox state is read by role/label, never by DOM position.
    expect(screen.getByLabelText(PS_LABEL).getAttribute('aria-checked') === 'true').toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    const saved = create.mock.calls[0][0] as ActionInput
    expect(saved.runMode).toBe('background')
    expect(saved.command).toBe(
      'powershell -NoProfile -ExecutionPolicy Bypass -File "./scripts/zażółć 🐱/start.ps1" -Name "Example value"',
    )
    await waitFor(() => expect(screen.queryByLabelText('Command')).toBeNull())

    view.rerender(<ActionSettings {...props} actions={[{ ...saved, id: 'a1' } as ActionControl]} />)
    expect(screen.getByText(command)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe(command)
    expect(screen.getByLabelText(PS_LABEL).getAttribute('aria-checked') === 'true').toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('a1', saved))
    await waitFor(() => expect(screen.queryByLabelText('Command')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByLabelText(PS_LABEL))
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith('a1', expect.objectContaining({ command })),
    )
    await waitFor(() => expect(screen.queryByLabelText('Command')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    expect(screen.getByLabelText(PS_LABEL).getAttribute('aria-checked') === 'true').toBe(false)
  })

  it.each([['background'], ['new-terminal'], ['bottom-terminal']] as const)(
    'passes the %s runMode through to the save payload',
    async (runMode) => {
      const create = vi.fn().mockResolvedValue({})
      const app = {
        ...shellAppMock(),
        actions: { create, update: vi.fn().mockResolvedValue({}) },
      } as unknown as AppApi
      render(
        <ActionSettings
          app={app}
          actions={[] as ActionControl[]}
          projectId={null}
          projectPath={null}
          autoSend={false}
          onAutoSendChange={vi.fn()}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
          onClose={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
      fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Example' } })
      fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'pnpm build' } })
      fireEvent.change(screen.getByLabelText('Run in'), { target: { value: runMode } })
      fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
      await waitFor(() => expect(create).toHaveBeenCalledOnce())
      expect((create.mock.calls[0][0] as ActionInput).runMode).toBe(runMode)
    },
  )
})

describe('Kanban tab shell', () => {
  function kanbanAppMock(): AppApi {
    return {
      terminals: {
        shellDetect: vi.fn().mockResolvedValue([{ id: 'default', label: 'PowerShell' }]),
        shellAddCustom: vi.fn(),
      },
      kanban: {
        adaptersList: vi.fn().mockResolvedValue([]),
        getConfig: vi.fn().mockResolvedValue({ adapterId: null, values: {}, secretKeys: [] }),
        setConfig: vi.fn(),
        test: vi.fn(),
        listBoard: vi.fn(),
        createItem: vi.fn(),
        updateItem: vi.fn(),
      },
      state: { get: vi.fn().mockResolvedValue(null), set: vi.fn() },
      dialogs: { pickDirectory: vi.fn().mockResolvedValue(null) },
    } as unknown as AppApi
  }

  it('places handoff settings in Tasks and toolbar actions in Actions', async () => {
    const props = {
      app: kanbanAppMock(),
      actions: [] as ActionControl[],
      projectId: 'p1',
      projectPath: 'D:/p',
      autoSend: false,
      onAutoSendChange: vi.fn(),
      onRefresh: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn(),
    }
    render(<ActionSettings {...props} />)
    const kanbanTab = screen.getByTestId(TEST_ID.settingsKanbanTab)
    // Visible section label is Tasks (project-home spec Behaviour 6).
    expect(kanbanTab.textContent).toBe('Tasks')
    expect(kanbanTab.getAttribute('aria-selected')).toBe('false')
    // Handoff settings appear only on the Tasks tab.
    expect(screen.queryByTestId(TEST_ID.settingsConfigSection)).toBeNull()

    fireEvent.click(kanbanTab)
    await screen.findByTestId(TEST_ID.settingsKanbanPanel)
    expect(screen.getByTestId(TEST_ID.settingsConfigSection)).toBeTruthy()

    // Actions has its own toolbar controls.
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    expect(screen.queryByTestId(TEST_ID.settingsConfigSection)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.settingsKanbanPanel)).toBeNull()
  })

  it('Escape in the Teach agents dialog closes only that dialog, and not while the write runs', async () => {
    let finish: (value?: unknown) => void = () => undefined
    const writeSkill = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const base = kanbanAppMock()
    const app = {
      ...base,
      kanban: {
        ...base.kanban,
        adaptersList: vi
          .fn()
          .mockResolvedValue([{ id: 'local-file', name: 'Local file', configSchema: [] }]),
        getConfig: vi
          .fn()
          .mockResolvedValue({ adapterId: 'local-file', values: {}, secretKeys: [] }),
        skillStatus: vi.fn().mockResolvedValue({ exists: false }),
        writeSkill,
      },
      agentProfiles: { get: vi.fn().mockResolvedValue({ defaultId: null, profiles: [] }) },
    } as unknown as AppApi
    const onClose = vi.fn()
    render(
      <ActionSettings
        app={app}
        actions={[] as ActionControl[]}
        projectId="p1"
        projectPath="D:/p"
        autoSend={false}
        onAutoSendChange={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        initialTab="kanban"
        onClose={onClose}
      />,
    )
    fireEvent.click(await screen.findByTestId(TEST_ID.settingsKanbanTeachAgents))
    const firstDialog = await screen.findByTestId(TEST_ID.confirmDialog)
    // ConfirmDialog moves focus in a passive effect, which can run after
    // findBy resolves. Escape is sent to the focused element, so wait for it.
    await waitFor(() => expect(firstDialog.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    await waitFor(() =>
      expect(
        (screen.getByTestId(TEST_ID.settingsKanbanTeachAgents) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    fireEvent.click(screen.getByTestId(TEST_ID.settingsKanbanTeachAgents))
    const dialog = await screen.findByTestId(TEST_ID.confirmDialog)
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogConfirm))
    await waitFor(() => expect(writeSkill).toHaveBeenCalledTimes(1))
    // Chromium drops focus from a `disabled` button (jsdom does not), which
    // would send Escape to the Project Settings window listener.
    expect(screen.getByTestId(TEST_ID.confirmDialogConfirm).hasAttribute('disabled')).toBe(false)
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(screen.getByTestId(TEST_ID.confirmDialog)).toBe(dialog)
    expect(onClose).not.toHaveBeenCalled()

    finish()
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('opens on the requested tab when an initialTab is passed (board Configure)', async () => {
    const props = {
      app: kanbanAppMock(),
      actions: [] as ActionControl[],
      projectId: 'p1',
      projectPath: 'D:/p',
      autoSend: false,
      onAutoSendChange: vi.fn(),
      onRefresh: vi.fn().mockResolvedValue(undefined),
      initialTab: 'kanban' as const,
      onClose: vi.fn(),
    }
    render(<ActionSettings {...props} />)
    // No click: the dialog mounts directly on the Kanban tab.
    expect(screen.getByTestId(TEST_ID.settingsKanbanTab).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByTestId(TEST_ID.settingsKanbanPanel)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.settingsConfigSection)).toBeTruthy()
  })

  it('adds an Agents tab beside Shell, Actions, and Tasks', async () => {
    const selectionGet = vi.fn().mockResolvedValue({ version: 1, selectedIds: [], defaultId: null })
    const app = {
      ...kanbanAppMock(),
      agentProfiles: {
        libraryGet: vi.fn().mockResolvedValue({ version: 1, profiles: [] }),
        selectionGet,
        selectionSet: vi.fn(),
      },
    } as unknown as AppApi
    const props = {
      app,
      actions: [] as ActionControl[],
      projectId: 'p1',
      projectPath: 'D:/p',
      autoSend: false,
      onAutoSendChange: vi.fn(),
      onRefresh: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn(),
    }
    render(<ActionSettings {...props} />)
    const agentsTab = screen.getByTestId(TEST_ID.settingsAgentsTab)
    expect(agentsTab.textContent).toBe('Agents')
    expect(agentsTab.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tab', { name: 'Shell' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Actions' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Tasks' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Kanban' })).toBeNull()

    fireEvent.click(agentsTab)
    expect(await screen.findByTestId(TEST_ID.settingsAgentsEmpty)).toBeTruthy()
    expect(selectionGet).toHaveBeenCalledWith('p1')
    expect(screen.queryByTestId(TEST_ID.settingsConfigSection)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.settingsKanbanPanel)).toBeNull()

    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    expect(screen.queryByTestId(TEST_ID.settingsConfigSection)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.settingsAgentsPanel)).toBeNull()
  })

  it('places the Task progress tab right after Tasks and renders its panel', async () => {
    const app = {
      ...kanbanAppMock(),
      taskProgress: {
        adaptersList: vi.fn().mockResolvedValue({ adapters: [], warnings: [] }),
        getBinding: vi.fn().mockResolvedValue({ adapterId: null, config: {} }),
        get: vi.fn().mockResolvedValue(null),
        onChanged: vi.fn(() => () => undefined),
      },
    } as unknown as AppApi
    render(
      <ActionSettings
        app={app}
        actions={[]}
        projectId="p1"
        projectPath="D:/p"
        autoSend={false}
        onAutoSendChange={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    )
    const labels = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(labels.indexOf('Task progress')).toBe(labels.indexOf('Tasks') + 1)
    fireEvent.click(screen.getByTestId(TEST_ID.settingsTaskProgressTab))
    expect(await screen.findByTestId(TEST_ID.settingsTaskProgressEmpty)).toBeTruthy()
    expect(app.taskProgress.getBinding).toHaveBeenCalledWith('p1')
  })
})

describe('legacy handoff directory removal', () => {
  it('does not render the legacy handoff directory setting', async () => {
    const app = shellAppMock()
    render(
      <ActionSettings
        app={app}
        actions={[]}
        projectId="p1"
        projectPath="D:/p"
        autoSend={false}
        onAutoSendChange={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        initialTab="kanban"
      />,
    )
    expect(screen.queryByTestId(TEST_ID.settingsHandoffDir)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.settingsHandoffDirBrowse)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.settingsHandoffDirSave)).toBeNull()
  })
})

describe('action save error handling and duplicate prevention', () => {
  it('clears the form and surfaces refresh failure separately when create succeeds but refresh fails', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'a1' })
    const app = { ...shellAppMock(), actions: { create } } as unknown as AppApi
    const onRefresh = vi.fn().mockRejectedValue(new Error('Network refresh failed'))
    const props = {
      app,
      actions: [] as ActionControl[],
      projectId: null,
      projectPath: null,
      autoSend: false,
      onAutoSendChange: vi.fn(),
      onRefresh,
      onClose: vi.fn(),
    }
    render(<ActionSettings {...props} initialTab="actions" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My Action' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))

    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    // Mutation succeeded: form must be cleared so user cannot submit a duplicate
    await waitFor(() => expect(screen.queryByLabelText('Command')).toBeNull())
    // The refresh error must be surfaced to the user in its own message (not "Failed to save action.")
    expect((await screen.findByRole('alert')).textContent).toContain('Failed to refresh actions.')

    // Clicking Add Action creates a fresh form without duplicate submission
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Second Action' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo second' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Second Action' }))
  })
})

describe('custom emoji icon selection', () => {
  it('allows selecting custom emoji, entering emoji glyph, saving, and editing without snapping back to none', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'a1' })
    const update = vi.fn().mockResolvedValue({ id: 'a1' })
    const app = { ...shellAppMock(), actions: { create, update } } as unknown as AppApi
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    const props = {
      app,
      actions: [] as ActionControl[],
      projectId: null,
      projectPath: null,
      autoSend: false,
      onAutoSendChange: vi.fn(),
      onRefresh,
      onClose: vi.fn(),
    }
    const view = render(<ActionSettings {...props} initialTab="actions" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Emoji Action' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo emoji' } })

    const iconSelect = screen.getByTestId(TEST_ID.settingsActionIconSelect)
    fireEvent.change(iconSelect, { target: { value: 'custom' } })

    // The select must stay on "custom" and render the emoji input
    expect((iconSelect as HTMLSelectElement).value).toBe('custom')
    const emojiInput = screen.getByTestId(TEST_ID.settingsActionIconEmoji) as HTMLInputElement
    expect(emojiInput).toBeTruthy()
    expect(emojiInput.value).toBe('')

    // Entering emoji
    fireEvent.change(emojiInput, { target: { value: '🚀' } })
    expect(emojiInput.value).toBe('🚀')
    expect((iconSelect as HTMLSelectElement).value).toBe('custom')

    // Saving creates action with emoji icon
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ icon: '🚀' }))

    // Re-editing action with emoji icon
    const savedAction: ActionControl = {
      id: 'a1',
      scope: 'global',
      projectId: null,
      title: 'Emoji Action',
      icon: '🚀',
      command: 'echo emoji',
      cwd: null,
      runMode: 'background',
      confirm: false,
      sortOrder: 0,
    }
    view.rerender(<ActionSettings {...props} actions={[savedAction]} initialTab="actions" />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const editIconSelect = screen.getByTestId(TEST_ID.settingsActionIconSelect)
    expect((editIconSelect as HTMLSelectElement).value).toBe('custom')
    const editEmojiInput = screen.getByTestId(TEST_ID.settingsActionIconEmoji) as HTMLInputElement
    expect(editEmojiInput.value).toBe('🚀')

    // Clearing emoji input does not snap back to none or hide input
    fireEvent.change(editEmojiInput, { target: { value: '' } })
    expect(editEmojiInput.value).toBe('')
    expect((editIconSelect as HTMLSelectElement).value).toBe('custom')
    expect(screen.getByTestId(TEST_ID.settingsActionIconEmoji)).toBeTruthy()

    // Changing emoji to a new one
    fireEvent.change(editEmojiInput, { target: { value: '⚡' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('a1', expect.objectContaining({ icon: '⚡' })),
    )
  })

  it('trims emoji icon and saves null when custom emoji is left blank or changed to none', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'a1' })
    const app = { ...shellAppMock(), actions: { create } } as unknown as AppApi
    const props = {
      app,
      actions: [] as ActionControl[],
      projectId: null,
      projectPath: null,
      autoSend: false,
      onAutoSendChange: vi.fn(),
      onRefresh: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn(),
    }
    render(<ActionSettings {...props} initialTab="actions" />)

    // Case 1: Custom emoji selected but left blank saves icon: null
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Blank Emoji Action' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo 1' } })
    fireEvent.change(screen.getByTestId(TEST_ID.settingsActionIconSelect), {
      target: { value: 'custom' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ icon: null }))

    // Case 2: Custom emoji with whitespace is trimmed
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Trimmed Emoji Action' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo 2' } })
    fireEvent.change(screen.getByTestId(TEST_ID.settingsActionIconSelect), {
      target: { value: 'custom' },
    })
    fireEvent.change(screen.getByTestId(TEST_ID.settingsActionIconEmoji), {
      target: { value: '  🚀  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ icon: '🚀' }))

    // Case 3: Changing from custom back to none hides input and saves icon: null
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Reset To None Action' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo 3' } })
    fireEvent.change(screen.getByTestId(TEST_ID.settingsActionIconSelect), {
      target: { value: 'custom' },
    })
    expect(screen.getByTestId(TEST_ID.settingsActionIconEmoji)).toBeTruthy()
    fireEvent.change(screen.getByTestId(TEST_ID.settingsActionIconSelect), {
      target: { value: 'none' },
    })
    expect(screen.queryByTestId(TEST_ID.settingsActionIconEmoji)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3))
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ icon: null }))
  })
})

describe('mutation in-flight guards and duplicate prevention', () => {
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

  function guardProps(
    app: AppApi,
    projectId: string | null = null,
    projectPath: string | null = null,
    actions: ActionControl[] = [],
  ) {
    return {
      app,
      actions,
      projectId,
      projectPath,
      autoSend: false,
      onAutoSendChange: vi.fn(),
      onRefresh: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn(),
    }
  }

  // Original scenario: 'blocks rapid double activation of action save, disables
  // button during mutation, and unlocks on error'.
  async function actionSaveCase(): Promise<GuardCase> {
    let resolveCreate: (val: unknown) => void = () => {}
    const create = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    const app = { ...shellAppMock(), actions: { create } } as unknown as AppApi
    render(<ActionSettings {...guardProps(app)} initialTab="actions" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Guarded Action' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo 1' } })
    return {
      button: screen.getByRole('button', { name: 'Save action' }) as HTMLButtonElement,
      call: create,
      complete: async () => {
        resolveCreate({ id: 'a1' })
        // Original non-guard step: a successful save closes the form.
        await waitFor(() => expect(screen.queryByLabelText('Command')).toBeNull())
      },
      rearm: () => {
        create.mockRejectedValueOnce({
          nekodeAppError: true,
          code: 'internal',
          message: 'Backend error',
        })
        fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Guarded Action 2' } })
        fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo 2' } })
        return screen.getByRole('button', { name: 'Save action' }) as HTMLButtonElement
      },
      errorMessage: 'Backend error',
    }
  }

  // Original scenario: 'blocks rapid double activation of action remove,
  // disables button during mutation, and unlocks on error'.
  async function actionRemoveCase(): Promise<GuardCase> {
    let resolveDelete: (val: unknown) => void = () => {}
    const del = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve
        }),
    )
    const action: ActionControl = {
      id: 'a1',
      scope: 'global',
      projectId: null,
      title: 'Action 1',
      icon: null,
      command: 'echo 1',
      cwd: null,
      runMode: 'background',
      confirm: false,
      sortOrder: 0,
    }
    const app = { ...shellAppMock(), actions: { delete: del } } as unknown as AppApi
    render(<ActionSettings {...guardProps(app, null, null, [action])} initialTab="actions" />)
    const button = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement
    return {
      button,
      call: del,
      complete: async () => {
        resolveDelete(undefined)
        await waitFor(() => expect(button.disabled).toBe(false))
      },
      rearm: () => {
        del.mockRejectedValueOnce({
          nekodeAppError: true,
          code: 'internal',
          message: 'Delete error',
        })
        return screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement
      },
      errorMessage: 'Delete error',
    }
  }

  const guardRows: Array<[string, () => Promise<GuardCase>]> = [
    ['action save', actionSaveCase],
    ['action remove', actionRemoveCase],
  ]

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
