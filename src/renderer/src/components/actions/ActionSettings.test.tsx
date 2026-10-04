import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionControl, ActionInput, AppApi } from '../../../../shared/ipc-contract'
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
      const app = { actions: { create, update }, ...shellAppMock() } as unknown as AppApi
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
