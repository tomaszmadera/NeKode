import {
  parseAgentArguments,
  parseAgentCommand,
  serializeAgentCommand,
} from '@shared/agent-command'
import type { AgentProfile } from '@shared/ipc-contract'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { createAppApiStub } from '../../test/app-api-stub'
import { GlobalAgentProfilesSettings } from './GlobalAgentProfilesSettings'

afterEach(cleanup)
const alpha: AgentProfile = {
  id: 'a',
  name: 'Alpha',
  executable: 'C:\\Tools\\agent.exe',
  args: ['', 'C:\\path\\', '"q"', '{prompt}'],
}

function harness(profiles: AgentProfile[] = []) {
  const app = createAppApiStub()
  vi.mocked(app.agentProfiles.libraryGet).mockResolvedValue({ version: 1, profiles })
  vi.mocked(app.agentProfiles.templatesGet).mockResolvedValue([
    { id: 'claude', name: 'Claude Code', command: 'claude "{prompt}"' },
    {
      id: 'opencode',
      name: 'OpenCode',
      command: 'opencode --prompt "{prompt}"',
      interactiveArgs: [],
    },
  ])
  vi.mocked(app.agentProfiles.put).mockImplementation(async (input) => ({
    version: 1,
    profiles: [
      {
        id: input.id ?? 'new-id',
        name: input.name,
        ...parseAgentCommand(input.command),
        ...(input.interactiveArgs === undefined ? {} : { interactiveArgs: input.interactiveArgs }),
      },
    ],
  }))
  render(<GlobalAgentProfilesSettings app={app} />)
  return app
}

describe('global agent library editor', () => {
  it('saves an explicit empty override and disabling it removes the override on the next edit', async () => {
    const app = harness([alpha])
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Alpha' }))
    expect(screen.queryByLabelText('New Chat arguments')).toBeNull()
    fireEvent.click(screen.getByLabelText('Override arguments for New Chat'))
    fireEvent.change(screen.getByLabelText('New Chat arguments'), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() =>
      expect(app.agentProfiles.put).toHaveBeenCalledWith({
        id: alpha.id,
        name: alpha.name,
        command: serializeAgentCommand(alpha),
        interactiveArgs: [],
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Alpha' }))
    expect(
      screen.getByLabelText('Override arguments for New Chat').getAttribute('aria-checked'),
    ).toBe('true')
    expect((screen.getByLabelText('New Chat arguments') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByLabelText('Override arguments for New Chat'))
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() =>
      expect(app.agentProfiles.put).toHaveBeenLastCalledWith({
        id: alpha.id,
        name: alpha.name,
        command: serializeAgentCommand(alpha),
      }),
    )
  })

  it.each(['Edit', 'Copy'])(
    'preserves exact interactive argv through %s and save',
    async (action) => {
      const interactiveArgs = [
        'C:\\Agent tools\\cli.js',
        '',
        '"quoted"',
        'line\r\nbreak',
        '`n literal',
      ]
      const app = harness([{ ...alpha, interactiveArgs }])
      fireEvent.click(await screen.findByRole('button', { name: `${action} Alpha` }))
      const text = (screen.getByLabelText('New Chat arguments') as HTMLInputElement).value
      expect(parseAgentArguments(text)).toEqual(interactiveArgs)
      fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
      await waitFor(() =>
        expect(app.agentProfiles.put).toHaveBeenCalledWith({
          id: action === 'Copy' ? null : alpha.id,
          name: alpha.name,
          command: serializeAgentCommand(alpha),
          interactiveArgs,
        }),
      )
    },
  )

  it.each(['{prompt}', 'prefix{prompt}', '"unclosed', '--flag | echo'])(
    'keeps the form and refuses invalid interactive text %j',
    async (value) => {
      const app = harness([alpha])
      fireEvent.click(await screen.findByRole('button', { name: 'Edit Alpha' }))
      fireEvent.click(screen.getByLabelText('Override arguments for New Chat'))
      fireEvent.change(screen.getByLabelText('New Chat arguments'), { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
      expect(screen.getByRole('alert').textContent).toBeTruthy()
      expect((screen.getByLabelText('New Chat arguments') as HTMLInputElement).value).toBe(value)
      expect(app.agentProfiles.put).not.toHaveBeenCalled()
    },
  )

  it('adds a custom command without project context or argument rows', async () => {
    const app = harness()
    fireEvent.click(await screen.findByRole('button', { name: 'Add agent' }))
    expect(screen.getByRole('option', { name: 'Custom' })).toBeTruthy()
    expect(screen.queryByLabelText('Executable')).toBeNull()
    expect(screen.queryByLabelText('Argument 1')).toBeNull()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Custom agent' } })
    fireEvent.change(screen.getByLabelText('Command'), {
      target: { value: 'agent --model "my model" "{prompt}"' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() =>
      expect(app.agentProfiles.put).toHaveBeenCalledWith({
        id: null,
        name: 'Custom agent',
        command: 'agent --model "my model" "{prompt}"',
      }),
    )
    expect(await screen.findByRole('button', { name: 'Edit Custom agent' })).toBeTruthy()
    expect(app.agentProfiles.selectionSet).not.toHaveBeenCalled()
    expect(app.chats.createWithAgent).not.toHaveBeenCalled()
  })

  it('fills a complete template and leaves it editable before saving', async () => {
    const app = harness()
    fireEvent.click(await screen.findByRole('button', { name: 'Add agent' }))
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'claude' } })
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Claude Code')
    expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('claude "{prompt}"')
    expect(app.agentProfiles.put).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Claude work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() =>
      expect(app.agentProfiles.put).toHaveBeenCalledWith({
        id: null,
        name: 'Claude work',
        command: 'claude "{prompt}"',
      }),
    )
  })

  it('fills the interactive override a template proposes and saves it', async () => {
    const app = harness()
    fireEvent.click(await screen.findByRole('button', { name: 'Add agent' }))
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'opencode' } })
    expect((screen.getByLabelText('New Chat arguments') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'claude' } })
    expect(screen.queryByLabelText('New Chat arguments')).toBeNull()
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'opencode' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() =>
      expect(app.agentProfiles.put).toHaveBeenCalledWith({
        id: null,
        name: 'OpenCode',
        command: 'opencode --prompt "{prompt}"',
        interactiveArgs: [],
      }),
    )
  })

  it('copies into an unsaved independent form and editing round-trips exact argv with its original id', async () => {
    const app = harness([alpha])
    fireEvent.click(await screen.findByRole('button', { name: 'Copy Alpha' }))
    expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe(
      serializeAgentCommand(alpha),
    )
    expect(app.agentProfiles.put).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() =>
      expect(app.agentProfiles.put).toHaveBeenCalledWith({
        id: null,
        name: 'Alpha',
        command: serializeAgentCommand(alpha),
      }),
    )
    expect(app.agentProfiles.selectionSet).not.toHaveBeenCalled()
    cleanup()
    const editApp = harness([alpha])
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Alpha' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() =>
      expect(editApp.agentProfiles.put).toHaveBeenCalledWith({
        id: 'a',
        name: 'Alpha',
        command: serializeAgentCommand(alpha),
      }),
    )
    expect(
      parseAgentCommand(vi.mocked(editApp.agentProfiles.put).mock.calls[0][0].command),
    ).toEqual({ executable: alpha.executable, args: alpha.args })
  })

  it('shows validation and persistence errors without discarding the form; blocked deletion keeps the profile', async () => {
    const app = harness([alpha])
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Alpha' }))
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'agent | echo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    expect(screen.getByRole('alert').textContent).toContain('shell scripts are not supported')
    expect(app.agentProfiles.put).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'agent "{prompt}"' } })
    vi.mocked(app.agentProfiles.put).mockRejectedValue({
      nekodeAppError: true,
      code: 'sqlite',
      message: 'Cannot save.',
      channel: 'agentProfiles:put',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    expect(await screen.findByText('Cannot save.')).toBeTruthy()
    expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('agent "{prompt}"')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    vi.mocked(app.agentProfiles.delete).mockRejectedValue({
      nekodeAppError: true,
      code: 'conflict',
      message: 'Deselect in Project one.',
      channel: 'agentProfiles:delete',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }))
    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogConfirm))
    expect(await screen.findByText('Deselect in Project one.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit Alpha' })).toBeTruthy()
  })

  it('asks for confirmation before deleting a profile and preserves it on cancel', async () => {
    const app = harness([alpha])
    await screen.findByRole('button', { name: 'Delete Alpha' })

    // Clicking delete opens confirm dialog
    fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }))
    const dialog = screen.getByTestId(TEST_ID.confirmDialog)
    expect(dialog.textContent).toContain('Delete agent profile "Alpha"?')
    expect(app.agentProfiles.delete).not.toHaveBeenCalled()

    // Canceling closes dialog without calling delete
    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogCancel))
    expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull()
    expect(app.agentProfiles.delete).not.toHaveBeenCalled()

    // Confirming deletes the profile
    fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }))
    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogConfirm))
    await waitFor(() => expect(app.agentProfiles.delete).toHaveBeenCalledWith('a'))
  })

  it('renames a legacy multiline-argument profile through a lossless single-line command', async () => {
    const legacy = { ...alpha, args: ['line\r\nbreak', '`n literal', '{prompt}'] }
    const app = harness([legacy])
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Alpha' }))
    const command = (screen.getByLabelText('Command') as HTMLInputElement).value
    expect(command).not.toMatch(/[\r\n]/)
    expect(parseAgentCommand(command)).toEqual({ executable: legacy.executable, args: legacy.args })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() => expect(app.agentProfiles.put).toHaveBeenCalled())
    expect(parseAgentCommand(vi.mocked(app.agentProfiles.put).mock.calls[0][0].command)).toEqual({
      executable: legacy.executable,
      args: legacy.args,
    })
  })
})

// Host-program warning below Command (spec project-environment-clarity
// Behaviour 14): advice only, the save path and the stored command never change.
describe('host program warning', () => {
  async function openNewAgent(): Promise<HTMLInputElement> {
    fireEvent.click(await screen.findByRole('button', { name: 'Add agent' }))
    return screen.getByLabelText('Command') as HTMLInputElement
  }

  it.each([
    ['ssh host "{prompt}"'],
    ['ssh.exe -p 2222 host "{prompt}"'],
    ['wsl -d Ubuntu claude "{prompt}"'],
    ['WSL.EXE -d Ubuntu claude "{prompt}"'],
    ['"C:\\Windows\\System32\\wsl.exe" -d Ubuntu claude "{prompt}"'],
    ['C:\\tools/bin/wsl.exe -d Ubuntu claude "{prompt}"'],
  ])('warns for %j', async (command) => {
    harness([])
    fireEvent.change(await openNewAgent(), { target: { value: command } })
    expect(screen.getByTestId(TEST_ID.settingsAgentCommandWarning)).toBeTruthy()
  })

  it.each([['sshpass -p pw ssh host "{prompt}"'], ['claude "{prompt}"'], ['"unclosed']])(
    'does not warn for %j',
    async (command) => {
      harness([])
      fireEvent.change(await openNewAgent(), { target: { value: command } })
      expect(screen.queryByTestId(TEST_ID.settingsAgentCommandWarning)).toBeNull()
    },
  )

  it('states the cause and the alternative for each host program', async () => {
    harness([])
    const input = await openNewAgent()
    fireEvent.change(input, { target: { value: 'wsl -d Ubuntu "{prompt}"' } })
    expect(screen.getByTestId(TEST_ID.settingsAgentCommandWarning).textContent).toContain(
      "This starts WSL as a host program, so NeKode does not choose the distribution or map the project directory. To run agents inside WSL, set the project's shell to WSL or add a WSL project.",
    )
    fireEvent.change(input, { target: { value: 'ssh host "{prompt}"' } })
    expect(screen.getByTestId(TEST_ID.settingsAgentCommandWarning).textContent).toContain(
      'This starts ssh as a host program, so NeKode does not change into the project directory on the remote host. To work on a remote host, add the project as an SSH project.',
    )
  })

  it('follows edits live and disappears when the command changes', async () => {
    harness([])
    const input = await openNewAgent()
    fireEvent.change(input, { target: { value: 'ssh host "{prompt}"' } })
    expect(screen.getByTestId(TEST_ID.settingsAgentCommandWarning)).toBeTruthy()
    fireEvent.change(input, { target: { value: 'claude "{prompt}"' } })
    expect(screen.queryByTestId(TEST_ID.settingsAgentCommandWarning)).toBeNull()
  })

  it('saves the unchanged command with the warning shown', async () => {
    const app = harness([])
    const input = await openNewAgent()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Remote' } })
    fireEvent.change(input, { target: { value: 'ssh host "{prompt}"' } })
    expect(screen.getByTestId(TEST_ID.settingsAgentCommandWarning)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    await waitFor(() =>
      expect(app.agentProfiles.put).toHaveBeenCalledWith({
        id: null,
        name: 'Remote',
        command: 'ssh host "{prompt}"',
      }),
    )
    expect(screen.queryByTestId(TEST_ID.settingsAgentCommandWarning)).toBeNull()
  })

  it('keeps the parse error and shows no warning for an unparsable command', async () => {
    const app = harness([])
    const input = await openNewAgent()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Broken' } })
    fireEvent.change(input, { target: { value: '"unclosed {prompt}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    expect((await screen.findByRole('alert')).textContent).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.settingsAgentCommandWarning)).toBeNull()
    expect(app.agentProfiles.put).not.toHaveBeenCalled()
  })
})
