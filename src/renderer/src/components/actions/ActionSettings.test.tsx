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
