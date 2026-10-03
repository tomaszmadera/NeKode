import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionControl, ActionInput, AppApi } from '../../../../shared/ipc-contract'
import { ActionSettings } from './ActionSettings'

afterEach(cleanup)

describe('PowerShell action option', () => {
  it.each(['background', 'new-terminal', 'bottom-terminal'] as const)(
    'saves a PowerShell command in %s mode and supports editing and disabling it',
    async (runMode) => {
      const command = '"./scripts/zażółć 🐱/start.ps1" -Name "Example value"'
      const create = vi.fn().mockResolvedValue({})
      const update = vi.fn().mockResolvedValue({})
      const app = { actions: { create, update }, state: {} } as unknown as AppApi
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
      fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Example' } })
      fireEvent.change(screen.getByLabelText('Command'), { target: { value: command } })
      fireEvent.change(screen.getByLabelText('Run In'), { target: { value: runMode } })
      fireEvent.click(screen.getByLabelText('Run with PowerShell NoProfile'))
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
      expect(
        (screen.getByLabelText('Run with PowerShell NoProfile') as HTMLInputElement).checked,
      ).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(update).toHaveBeenCalledWith('a1', saved))
      await waitFor(() => expect(screen.queryByLabelText('Command')).toBeNull())

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      fireEvent.click(screen.getByLabelText('Run with PowerShell NoProfile'))
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(update).toHaveBeenLastCalledWith('a1', expect.objectContaining({ command })),
      )
      await waitFor(() => expect(screen.queryByLabelText('Command')).toBeNull())
      fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
      expect(
        (screen.getByLabelText('Run with PowerShell NoProfile') as HTMLInputElement).checked,
      ).toBe(false)
    },
  )
})
