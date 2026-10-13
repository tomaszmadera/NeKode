import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppApi } from '../../../../shared/ipc-contract'
import { TEST_ID } from '../../lib/test-ids'
import { ShellTab } from './ShellTab'

afterEach(cleanup)

// ShellTab unit tests (spec project-shell-selection, renderer level): the
// tab-entry detection contract, the per-project choice round-trip, and the
// custom-path add. app.terminals/state are the real boundary (typed AppApi).

function appMock(options?: {
  detect?: ReturnType<typeof vi.fn>
  get?: ReturnType<typeof vi.fn>
  set?: ReturnType<typeof vi.fn>
  addCustom?: ReturnType<typeof vi.fn>
}): AppApi {
  return {
    terminals: {
      shellDetect:
        options?.detect ?? vi.fn().mockResolvedValue([{ id: 'default', label: 'PowerShell' }]),
      shellAddCustom:
        options?.addCustom ?? vi.fn().mockResolvedValue({ id: 'custom:D:\\n.exe', label: 'n.exe' }),
    },
    state: {
      get: options?.get ?? vi.fn().mockResolvedValue(null),
      set: options?.set ?? vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as AppApi
}

describe('ShellTab', () => {
  it('uses project context for Linux custom shells and displays Default for a historic host choice', async () => {
    const detect = vi.fn().mockResolvedValue([
      { id: 'default', label: 'Default (WSL: Ubuntu)' },
      { id: 'custom:/bin/bash', label: 'bash' },
    ])
    const addCustom = vi.fn().mockResolvedValue({ id: 'custom:/bin/fish', label: 'fish' })
    render(
      <ShellTab
        app={appMock({ detect, addCustom, get: vi.fn().mockResolvedValue('powershell') })}
        projectId="wsl"
      />,
    )
    await waitFor(() => expect(screen.getByTestId(TEST_ID.settingsShellSelect)).toBeTruthy())
    expect((screen.getByTestId(TEST_ID.settingsShellSelect) as HTMLSelectElement).value).toBe(
      'default',
    )
    expect(detect).toHaveBeenCalledWith('wsl')
    fireEvent.change(screen.getByTestId(TEST_ID.settingsShellCustomInput), {
      target: { value: '/bin/fish' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsShellCustomAdd))
    await waitFor(() => expect(addCustom).toHaveBeenCalledWith('/bin/fish', 'wsl'))
    expect(screen.getByText(/WSL uses its distribution default/)).toBeTruthy()
  })
  it('runs exactly one detection on entry and shows the pending indicator until it lands', async () => {
    let resolveDetect: (value: Array<{ id: string; label: string }>) => void = () => {}
    const detect = vi.fn().mockImplementation(
      () =>
        new Promise<Array<{ id: string; label: string }>>((resolve) => {
          resolveDetect = resolve
        }),
    )
    render(<ShellTab app={appMock({ detect })} projectId="p1" />)
    expect(detect).toHaveBeenCalledTimes(1)
    expect(detect).toHaveBeenCalledWith('p1')
    // Visible pending state, no select yet (nothing detected).
    expect(screen.getByTestId(TEST_ID.settingsShellDetecting).textContent).toContain(
      'Detecting shells',
    )
    resolveDetect([
      { id: 'default', label: 'PowerShell' },
      { id: 'wsl:Ubuntu-24.04', label: 'WSL: Ubuntu-24.04' },
    ])
    await waitFor(() => expect(screen.getByTestId(TEST_ID.settingsShellSelect)).toBeTruthy())
    const options = (screen.getByTestId(TEST_ID.settingsShellSelect) as HTMLSelectElement).options
    expect(Array.from(options).map((option) => option.value)).toEqual([
      'default',
      'wsl:Ubuntu-24.04',
    ])
  })

  it('saves a non-default choice under the project shell key', async () => {
    const set = vi.fn().mockResolvedValue(undefined)
    render(
      <ShellTab
        app={appMock({
          detect: vi.fn().mockResolvedValue([
            { id: 'default', label: 'PowerShell' },
            { id: 'wsl:Ubuntu-24.04', label: 'WSL: Ubuntu-24.04' },
          ]),
          set,
        })}
        projectId="p1"
      />,
    )
    await waitFor(() => expect(screen.getByTestId(TEST_ID.settingsShellSelect)).toBeTruthy())
    fireEvent.change(screen.getByTestId(TEST_ID.settingsShellSelect), {
      target: { value: 'wsl:Ubuntu-24.04' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsShellSave))
    await waitFor(() => expect(set).toHaveBeenCalledWith('project.shell:p1', 'wsl:Ubuntu-24.04'))
    expect(screen.getByTestId(TEST_ID.settingsShellSaved)).toBeTruthy()
  })

  it('stores an empty value when Default is chosen (missing means default)', async () => {
    const set = vi.fn().mockResolvedValue(undefined)
    const get = vi.fn().mockResolvedValue('cmd')
    render(
      <ShellTab
        app={appMock({
          detect: vi.fn().mockResolvedValue([
            { id: 'default', label: 'PowerShell' },
            { id: 'cmd', label: 'cmd' },
          ]),
          get,
          set,
        })}
        projectId="p1"
      />,
    )
    await waitFor(() => expect(screen.getByTestId(TEST_ID.settingsShellSelect)).toBeTruthy())
    expect((screen.getByTestId(TEST_ID.settingsShellSelect) as HTMLSelectElement).value).toBe('cmd')
    fireEvent.change(screen.getByTestId(TEST_ID.settingsShellSelect), {
      target: { value: 'default' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsShellSave))
    await waitFor(() => expect(set).toHaveBeenCalledWith('project.shell:p1', ''))
  })

  it('adds a custom path via main and merges the entry into the list', async () => {
    const addCustom = vi.fn().mockResolvedValue({ id: 'custom:D:\\tools\\nu.exe', label: 'nu.exe' })
    render(
      <ShellTab
        app={appMock({
          detect: vi.fn().mockResolvedValue([{ id: 'default', label: 'PowerShell' }]),
          addCustom,
        })}
        projectId="p1"
      />,
    )
    await waitFor(() => expect(screen.getByTestId(TEST_ID.settingsShellSelect)).toBeTruthy())
    fireEvent.change(screen.getByTestId(TEST_ID.settingsShellCustomInput), {
      target: { value: 'D:\\tools\\nu.exe' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsShellCustomAdd))
    await waitFor(() => expect(addCustom).toHaveBeenCalledWith('D:\\tools\\nu.exe', 'p1'))
    await waitFor(() => {
      const values = Array.from(
        (screen.getByTestId(TEST_ID.settingsShellSelect) as HTMLSelectElement).options,
      ).map((option) => option.value)
      expect(values).toContain('custom:D:\\tools\\nu.exe')
    })
  })

  it('shows a validation error when main rejects the custom path', async () => {
    const addCustom = vi.fn().mockRejectedValue({
      nekodeAppError: true,
      code: 'validation',
      message: 'The shell path does not point to an executable file.',
    })
    render(
      <ShellTab
        app={appMock({
          detect: vi.fn().mockResolvedValue([{ id: 'default', label: 'PowerShell' }]),
          addCustom,
        })}
        projectId="p1"
      />,
    )
    await waitFor(() => expect(screen.getByTestId(TEST_ID.settingsShellSelect)).toBeTruthy())
    fireEvent.change(screen.getByTestId(TEST_ID.settingsShellCustomInput), {
      target: { value: 'D:\\missing.exe' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsShellCustomAdd))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('executable file'))
  })

  it('surfaces a visible error when reading the stored shell choice fails and keeps detected shells available', async () => {
    const get = vi.fn().mockRejectedValue({
      nekodeAppError: true,
      code: 'internal',
      message: 'Failed to read SQLite database.',
    })
    const detect = vi.fn().mockResolvedValue([
      { id: 'default', label: 'PowerShell' },
      { id: 'cmd', label: 'Command Prompt' },
    ])
    render(
      <ShellTab
        app={appMock({
          detect,
          get,
        })}
        projectId="p1"
      />,
    )
    await waitFor(() => expect(screen.getByTestId(TEST_ID.settingsShellSelect)).toBeTruthy())
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Failed to read SQLite database.')
    const options = (screen.getByTestId(TEST_ID.settingsShellSelect) as HTMLSelectElement).options
    expect(Array.from(options).map((o) => o.value)).toEqual(['default', 'cmd'])
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

  // Original scenario: 'blocks rapid double activation of addCustom, disables
  // button during mutation, and unlocks on error'.
  async function addCustomCase(): Promise<GuardCase> {
    let resolveAdd: (val: { id: string; label: string }) => void = () => {}
    const addCustom = vi.fn().mockImplementation(
      () =>
        new Promise<{ id: string; label: string }>((resolve) => {
          resolveAdd = resolve
        }),
    )
    render(
      <ShellTab
        app={appMock({
          detect: vi.fn().mockResolvedValue([{ id: 'default', label: 'PowerShell' }]),
          addCustom,
        })}
        projectId="p1"
      />,
    )
    await waitFor(() => expect(screen.getByTestId(TEST_ID.settingsShellSelect)).toBeTruthy())
    const input = screen.getByTestId(TEST_ID.settingsShellCustomInput)
    const button = screen.getByTestId(TEST_ID.settingsShellCustomAdd) as HTMLButtonElement
    fireEvent.change(input, { target: { value: 'D:\\tools\\nu.exe' } })
    return {
      button,
      call: addCustom,
      complete: async () => {
        resolveAdd({ id: 'custom:D:\\tools\\nu.exe', label: 'nu.exe' })
        // Original non-guard step: the completed add clears the input, so Add
        // disables again once the guard released.
        await waitFor(() => expect(button.disabled).toBe(true))
      },
      rearm: () => {
        addCustom.mockRejectedValueOnce({
          nekodeAppError: true,
          code: 'validation',
          message: 'Invalid executable path',
        })
        fireEvent.change(input, { target: { value: 'D:\\invalid.exe' } })
        return button
      },
      errorMessage: 'Invalid executable path',
    }
  }

  // Original scenario: 'blocks rapid double activation of save, disables button
  // during mutation, and unlocks on error'.
  async function saveCase(): Promise<GuardCase> {
    let resolveSet: () => void = () => {}
    const set = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSet = resolve
        }),
    )
    render(
      <ShellTab
        app={appMock({
          detect: vi.fn().mockResolvedValue([
            { id: 'default', label: 'PowerShell' },
            { id: 'cmd', label: 'Command Prompt' },
          ]),
          set,
        })}
        projectId="p1"
      />,
    )
    await waitFor(() => expect(screen.getByTestId(TEST_ID.settingsShellSelect)).toBeTruthy())
    const select = screen.getByTestId(TEST_ID.settingsShellSelect)
    const button = screen.getByTestId(TEST_ID.settingsShellSave) as HTMLButtonElement
    fireEvent.change(select, { target: { value: 'cmd' } })
    return {
      button,
      call: set,
      complete: async () => {
        resolveSet()
        // Original non-guard step: a resolved save shows the saved indicator.
        await waitFor(() => expect(screen.getByTestId(TEST_ID.settingsShellSaved)).toBeTruthy())
      },
      rearm: () => {
        set.mockRejectedValueOnce({
          nekodeAppError: true,
          code: 'internal',
          message: 'Write failed',
        })
        fireEvent.change(select, { target: { value: 'default' } })
        return button
      },
      errorMessage: 'Write failed',
    }
  }

  const guardRows: Array<[string, () => Promise<GuardCase>]> = [
    ['addCustom', addCustomCase],
    ['save', saveCase],
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
