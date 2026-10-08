import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentProfilePut,
  AgentProfilesDocument,
  AppApi,
} from '../../../../shared/ipc-contract'
import { AGENT_PROMPT_PLACEHOLDER } from '../../../../shared/ipc-contract'
import { TEST_ID } from '../../lib/test-ids'
import { AgentProfilesSettings } from './AgentProfilesSettings'

afterEach(cleanup)

const EMPTY: AgentProfilesDocument = { defaultId: null, profiles: [] }

function profile(id: string, name: string) {
  return {
    id,
    name,
    executable: name.toLowerCase(),
    args: [AGENT_PROMPT_PLACEHOLDER],
  }
}

function renderProfiles(
  projectId: string | null,
  options: {
    get?: ReturnType<typeof vi.fn>
    put?: ReturnType<typeof vi.fn>
    delete?: ReturnType<typeof vi.fn>
  } = {},
): {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  deleteProfile: ReturnType<typeof vi.fn>
} {
  const get = options.get ?? vi.fn().mockResolvedValue(EMPTY)
  const put = options.put ?? vi.fn()
  const deleteProfile = options.delete ?? vi.fn()
  const app = {
    agentProfiles: { get, put, delete: deleteProfile },
  } as unknown as AppApi
  render(<AgentProfilesSettings app={app} projectId={projectId} />)
  return { get, put, deleteProfile }
}

describe('AgentProfilesSettings', () => {
  it('shows an empty state when the project has no profiles', async () => {
    const { get } = renderProfiles('p1')
    expect(await screen.findByTestId(TEST_ID.settingsAgentsEmpty)).toBeTruthy()
    expect(screen.getByText('No agent profiles for this project.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit Alpha' })).toBeNull()
    expect(get).toHaveBeenCalledWith('p1')
  })

  it('rejects an invalid form without saving, then saves a valid profile', async () => {
    const put = vi.fn().mockImplementation(async (_projectId: string, input: AgentProfilePut) => ({
      defaultId: input.isDefault ? 'minted' : null,
      profiles: [
        {
          id: 'minted',
          name: input.name,
          executable: input.executable,
          args: input.args,
        },
      ],
    }))
    const { put: save } = renderProfiles('p1', { put })
    await screen.findByTestId(TEST_ID.settingsAgentsEmpty)
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByTestId(TEST_ID.settingsAgentsError).textContent).toContain(
      'Name is required.',
    )
    expect(save).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Claude  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByTestId(TEST_ID.settingsAgentsError).textContent).toContain(
      'Executable is required.',
    )
    expect(save).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Executable'), { target: { value: '  claude.exe  ' } })
    fireEvent.change(screen.getByLabelText('Argument 1'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByTestId(TEST_ID.settingsAgentsError).textContent).toContain('{prompt}')
    expect(save).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Argument 1'), { target: { value: '{prompt}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add argument' }))
    fireEvent.change(screen.getByLabelText('Argument 2'), { target: { value: '{prompt}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByTestId(TEST_ID.settingsAgentsError).textContent).toContain('exactly once')
    expect(save).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove argument 2' }))
    fireEvent.click(screen.getByLabelText('Default profile'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save).toHaveBeenCalledWith('p1', {
      id: null,
      name: 'Claude',
      executable: 'claude.exe',
      args: ['{prompt}'],
      isDefault: true,
    })
    expect(screen.getByText('Claude')).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.settingsAgentsDefaultBadge).textContent).toBe('Default')
    expect(screen.queryByTestId(TEST_ID.settingsAgentsEmpty)).toBeNull()
  })

  it('edits a profile in place and clears the default badge when that profile is deleted', async () => {
    const initial: AgentProfilesDocument = {
      defaultId: 'a',
      profiles: [profile('a', 'Alpha'), profile('b', 'Beta')],
    }
    const put = vi.fn().mockImplementation(async (_projectId: string, input: AgentProfilePut) => ({
      defaultId: input.isDefault ? input.id : null,
      profiles: [
        {
          id: input.id,
          name: input.name,
          executable: input.executable,
          args: input.args,
        },
        profile('b', 'Beta'),
      ],
    }))
    const deleteProfile = vi.fn().mockResolvedValue({
      defaultId: null,
      profiles: [profile('b', 'Beta')],
    })
    renderProfiles('p1', {
      get: vi.fn().mockResolvedValue(initial),
      put,
      delete: deleteProfile,
    })
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.settingsAgentsDefaultBadge)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Alpha' }))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Alpha')
    expect((screen.getByLabelText('Default profile') as HTMLInputElement).checked).toBe(true)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alpha Two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(put).toHaveBeenCalledOnce())
    expect(put).toHaveBeenCalledWith('p1', {
      id: 'a',
      name: 'Alpha Two',
      executable: 'alpha',
      args: [AGENT_PROMPT_PLACEHOLDER],
      isDefault: true,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha Two' }))
    await waitFor(() => expect(deleteProfile).toHaveBeenCalledWith('p1', 'a'))
    expect(screen.queryByText('Alpha Two')).toBeNull()
    expect(screen.queryByTestId(TEST_ID.settingsAgentsDefaultBadge)).toBeNull()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('does not keep another project’s profiles on screen', async () => {
    const get = vi.fn(async (projectId: string) => {
      if (projectId === 'p1') {
        return { defaultId: 'a', profiles: [profile('a', 'Alpha')] }
      }
      return { defaultId: null, profiles: [profile('b', 'Beta')] }
    })
    const app = { agentProfiles: { get, put: vi.fn(), delete: vi.fn() } } as unknown as AppApi
    const view = render(<AgentProfilesSettings app={app} projectId="p1" />)
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(screen.queryByText('Beta')).toBeNull()

    view.rerender(<AgentProfilesSettings app={app} projectId="p2" />)
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(await screen.findByText('Beta')).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(get).toHaveBeenCalledWith('p2')
  })
})
