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
    await waitFor(() => expect(addCustom).toHaveBeenCalledWith('D:\\tools\\nu.exe'))
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
})
