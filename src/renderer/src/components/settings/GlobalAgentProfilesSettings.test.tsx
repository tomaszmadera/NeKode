import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAgentCommand, serializeAgentCommand } from '../../../../shared/agent-command'
import type { AgentProfile } from '../../../../shared/ipc-contract'
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
  ])
  vi.mocked(app.agentProfiles.put).mockImplementation(async (input) => ({
    version: 1,
    profiles: [{ id: input.id ?? 'new-id', name: input.name, ...parseAgentCommand(input.command) }],
  }))
  render(<GlobalAgentProfilesSettings app={app} />)
  return app
}

describe('global agent library editor', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(app.agentProfiles.put).toHaveBeenCalledWith({
        id: null,
        name: 'Claude work',
        command: 'claude "{prompt}"',
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toContain('shell scripts are not supported')
    expect(app.agentProfiles.put).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'agent "{prompt}"' } })
    vi.mocked(app.agentProfiles.put).mockRejectedValue({
      nekodeAppError: true,
      code: 'sqlite',
      message: 'Cannot save.',
      channel: 'agentProfiles:put',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
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
    expect(await screen.findByText('Deselect in Project one.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit Alpha' })).toBeTruthy()
  })

  it('renames a legacy multiline-argument profile through a lossless single-line command', async () => {
    const legacy = { ...alpha, args: ['line\r\nbreak', '`n literal', '{prompt}'] }
    const app = harness([legacy])
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Alpha' }))
    const command = (screen.getByLabelText('Command') as HTMLInputElement).value
    expect(command).not.toMatch(/[\r\n]/)
    expect(parseAgentCommand(command)).toEqual({ executable: legacy.executable, args: legacy.args })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(app.agentProfiles.put).toHaveBeenCalled())
    expect(parseAgentCommand(vi.mocked(app.agentProfiles.put).mock.calls[0][0].command)).toEqual({
      executable: legacy.executable,
      args: legacy.args,
    })
  })
})
