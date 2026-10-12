import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type ActionControl,
  type ActionInput,
  type AppApi,
  projectHandoffDirKey,
} from '../../../../shared/ipc-contract'
import { TEST_ID } from '../../lib/test-ids'
import { ActionSettings } from './ActionSettings'

afterEach(cleanup)

const PS_LABEL = 'Run with powershell -NoProfile -ExecutionPolicy Bypass -File'

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
  } as unknown as AppApi
}

describe('PowerShell action option', () => {
  it.each(['background', 'new-terminal', 'bottom-terminal'] as const)(
    'saves a PowerShell command in %s mode and supports editing and disabling it',
    async (runMode) => {
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
      // Actions & Configuration tab.
      fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
      fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Example' } })
      fireEvent.change(screen.getByLabelText('Command'), { target: { value: command } })
      fireEvent.change(screen.getByLabelText('Run In'), { target: { value: runMode } })
      fireEvent.click(screen.getByLabelText(PS_LABEL))
      // The checkbox sits directly under the Command field (user-pinned layout).
      const commandInput = screen.getByLabelText('Command')
      const powerShellInput = screen.getByLabelText(PS_LABEL)
      expect(
        commandInput.compareDocumentPosition(powerShellInput) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(powerShellInput.closest('label')?.nextElementSibling?.textContent ?? '').toContain(
        'Working Directory',
      )
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(create).toHaveBeenCalledOnce())
      const saved = create.mock.calls[0][0] as ActionInput
      expect(saved.runMode).toBe(runMode)
      expect(saved.command).toBe(
        'powershell -NoProfile -ExecutionPolicy Bypass -File "./scripts/zażółć 🐱/start.ps1" -Name "Example value"',
      )
      await waitFor(() => expect(screen.queryByLabelText('Command')).toBeNull())

      view.rerender(
        <ActionSettings {...props} actions={[{ ...saved, id: 'a1' } as ActionControl]} />,
      )
      expect(screen.getByText(command)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe(command)
      expect((screen.getByLabelText(PS_LABEL) as HTMLInputElement).checked).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(update).toHaveBeenCalledWith('a1', saved))
      await waitFor(() => expect(screen.queryByLabelText('Command')).toBeNull())

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      fireEvent.click(screen.getByLabelText(PS_LABEL))
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(update).toHaveBeenLastCalledWith('a1', expect.objectContaining({ command })),
      )
      await waitFor(() => expect(screen.queryByLabelText('Command')).toBeNull())
      fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
      expect((screen.getByLabelText(PS_LABEL) as HTMLInputElement).checked).toBe(false)
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

  it('renders Kanban as its own tab and keeps the Configuration/Actions sections on theirs', async () => {
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
    expect(kanbanTab.textContent).toBe('Kanban')
    expect(kanbanTab.getAttribute('aria-selected')).toBe('false')
    // The Configuration section is not part of the Kanban tab.
    expect(screen.queryByTestId(TEST_ID.settingsConfigSection)).toBeNull()

    fireEvent.click(kanbanTab)
    await screen.findByTestId(TEST_ID.settingsKanbanPanel)
    expect(screen.queryByTestId(TEST_ID.settingsConfigSection)).toBeNull()

    // The existing sections are untouched: back on Actions & Configuration.
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    expect(screen.getByTestId(TEST_ID.settingsConfigSection)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.settingsKanbanPanel)).toBeNull()
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
    expect(screen.queryByTestId(TEST_ID.settingsConfigSection)).toBeNull()
  })

  it('adds an Agents tab beside Shell, Actions, and Kanban', async () => {
    const get = vi.fn().mockResolvedValue({ defaultId: null, profiles: [] })
    const app = {
      ...kanbanAppMock(),
      agentProfiles: { get, put: vi.fn(), delete: vi.fn() },
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
    expect(screen.getByRole('tab', { name: 'Actions & Configuration' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Kanban' })).toBeTruthy()

    fireEvent.click(agentsTab)
    expect(await screen.findByTestId(TEST_ID.settingsAgentsEmpty)).toBeTruthy()
    expect(get).toHaveBeenCalledWith('p1')
    expect(screen.queryByTestId(TEST_ID.settingsConfigSection)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.settingsKanbanPanel)).toBeNull()

    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    expect(screen.getByTestId(TEST_ID.settingsConfigSection)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.settingsAgentsPanel)).toBeNull()
  })
})

describe('handoff directory save', () => {
  it('persists the directory and invalidates the previous availability result', async () => {
    const set = vi.fn().mockResolvedValue(undefined)
    const onKanbanInvalidate = vi.fn()
    const app = {
      terminals: {
        shellDetect: vi.fn().mockResolvedValue([{ id: 'default', label: 'PowerShell' }]),
        shellAddCustom: vi.fn(),
      },
      state: { get: vi.fn().mockResolvedValue('old/dir'), set },
      dialogs: { pickDirectory: vi.fn().mockResolvedValue(null) },
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
        initialTab="actions"
        onKanbanInvalidate={onKanbanInvalidate}
      />,
    )
    const input = await screen.findByTestId(TEST_ID.settingsHandoffDir)
    fireEvent.change(input, { target: { value: '.agents/handoffs' } })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsHandoffDirSave))
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(projectHandoffDirKey('p1'), '.agents/handoffs'),
    )
    expect(onKanbanInvalidate).toHaveBeenCalledWith('p1')
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
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My Action' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    // Mutation succeeded: form must be cleared so user cannot submit a duplicate
    await waitFor(() => expect(screen.queryByLabelText('Command')).toBeNull())
    // The refresh error must be surfaced to the user in its own message (not "Failed to save action.")
    expect((await screen.findByRole('alert')).textContent).toContain('Failed to refresh actions.')

    // Clicking Add Action creates a fresh form without duplicate submission
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Second Action' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo second' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Blank Emoji Action' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo 1' } })
    fireEvent.change(screen.getByTestId(TEST_ID.settingsActionIconSelect), {
      target: { value: 'custom' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ icon: null }))

    // Case 2: Custom emoji with whitespace is trimmed
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Trimmed Emoji Action' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo 2' } })
    fireEvent.change(screen.getByTestId(TEST_ID.settingsActionIconSelect), {
      target: { value: 'custom' },
    })
    fireEvent.change(screen.getByTestId(TEST_ID.settingsActionIconEmoji), {
      target: { value: '  🚀  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ icon: '🚀' }))

    // Case 3: Changing from custom back to none hides input and saves icon: null
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3))
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ icon: null }))
  })
})

describe('mutation in-flight guards and duplicate prevention', () => {
  it('blocks rapid double activation of action save, disables button during mutation, and unlocks on error', async () => {
    let resolveCreate: (val: unknown) => void = () => {}
    const create = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
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
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Guarded Action' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo 1' } })

    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(false)

    // First click initiates save
    fireEvent.click(saveButton)
    expect(create).toHaveBeenCalledTimes(1)
    expect(saveButton.disabled).toBe(true)

    // Rapid second click is guarded
    fireEvent.click(saveButton)
    expect(create).toHaveBeenCalledTimes(1)

    // Complete save
    resolveCreate({ id: 'a1' })
    await waitFor(() => expect(screen.queryByLabelText('Command')).toBeNull())

    // Reopen form and test unlock on error
    create.mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'internal',
      message: 'Backend error',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Guarded Action 2' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo 2' } })
    const saveButton2 = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(saveButton2.disabled).toBe(false)
    fireEvent.click(saveButton2)
    await screen.findByText('Backend error')
    expect(saveButton2.disabled).toBe(false)
  })

  it('blocks rapid double activation of action remove, disables button during mutation, and unlocks on error', async () => {
    let resolveDelete: (val: unknown) => void = () => {}
    const del = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve
        }),
    )
    const app = { ...shellAppMock(), actions: { delete: del } } as unknown as AppApi
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
    const props = {
      app,
      actions: [action],
      projectId: null,
      projectPath: null,
      autoSend: false,
      onAutoSendChange: vi.fn(),
      onRefresh: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn(),
    }
    render(<ActionSettings {...props} initialTab="actions" />)
    const deleteButton = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement
    expect(deleteButton.disabled).toBe(false)

    // First click initiates remove
    fireEvent.click(deleteButton)
    expect(del).toHaveBeenCalledTimes(1)
    expect(deleteButton.disabled).toBe(true)

    // Rapid second click is guarded
    fireEvent.click(deleteButton)
    expect(del).toHaveBeenCalledTimes(1)

    // Complete remove
    resolveDelete(undefined)
    await waitFor(() => expect(deleteButton.disabled).toBe(false))

    // Test unlock on error
    del.mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'internal',
      message: 'Delete error',
    })
    fireEvent.click(deleteButton)
    await screen.findByText('Delete error')
    expect(deleteButton.disabled).toBe(false)
  })

  it('blocks rapid double activation of saveHandoffDir, disables button during mutation, and unlocks on error', async () => {
    let resolveSet: () => void = () => {}
    const set = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSet = resolve
        }),
    )
    const app = {
      ...shellAppMock(),
      state: { get: vi.fn().mockResolvedValue('old/dir'), set },
      dialogs: { pickDirectory: vi.fn().mockResolvedValue(null) },
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
    render(<ActionSettings {...props} initialTab="actions" />)
    const input = await screen.findByTestId(TEST_ID.settingsHandoffDir)
    fireEvent.change(input, { target: { value: '.agents/handoffs' } })
    const saveButton = screen.getByTestId(TEST_ID.settingsHandoffDirSave) as HTMLButtonElement
    expect(saveButton.disabled).toBe(false)

    // First click initiates save
    fireEvent.click(saveButton)
    expect(set).toHaveBeenCalledTimes(1)
    expect(saveButton.disabled).toBe(true)

    // Rapid second click is guarded
    fireEvent.click(saveButton)
    expect(set).toHaveBeenCalledTimes(1)

    // Complete save
    resolveSet()
    await waitFor(() => expect(saveButton.disabled).toBe(false))

    // Test unlock on error
    set.mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'internal',
      message: 'Save dir error',
    })
    fireEvent.change(input, { target: { value: '.agents/other' } })
    fireEvent.click(saveButton)
    await screen.findByText('Save dir error')
    expect(saveButton.disabled).toBe(false)
  })

  it('blocks rapid double activation of browseHandoffDir, disables button during mutation, and unlocks on error', async () => {
    let resolvePick: (path: string | null) => void = () => {}
    const pickDirectory = vi.fn().mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolvePick = resolve
        }),
    )
    const app = {
      ...shellAppMock(),
      state: { get: vi.fn().mockResolvedValue('old/dir'), set: vi.fn() },
      dialogs: { pickDirectory },
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
    render(<ActionSettings {...props} initialTab="actions" />)
    const browseButton = (await screen.findByTestId(
      TEST_ID.settingsHandoffDirBrowse,
    )) as HTMLButtonElement
    expect(browseButton.disabled).toBe(false)

    // First click initiates browse
    fireEvent.click(browseButton)
    expect(pickDirectory).toHaveBeenCalledTimes(1)
    expect(browseButton.disabled).toBe(true)

    // Rapid second click is guarded
    fireEvent.click(browseButton)
    expect(pickDirectory).toHaveBeenCalledTimes(1)

    // Complete browse
    resolvePick('D:/p/new-dir')
    await waitFor(() => expect(browseButton.disabled).toBe(false))

    // Test unlock on error
    pickDirectory.mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'internal',
      message: 'Dialog error',
    })
    fireEvent.click(browseButton)
    await screen.findByText('Dialog error')
    expect(browseButton.disabled).toBe(false)
  })
})
