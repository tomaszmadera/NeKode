import type { AgentProfile, AgentProjectSelection, AppApi } from '@shared/ipc-contract'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppApiStub } from '../../test/app-api-stub'
import { AgentProfilesSettings } from './AgentProfilesSettings'

afterEach(cleanup)
const alpha: AgentProfile = { id: 'a', name: 'Alpha', executable: 'alpha', args: ['{prompt}'] }
const beta: AgentProfile = { id: 'b', name: 'Beta', executable: 'beta', args: ['{prompt}'] }
const EMPTY: AgentProjectSelection = { version: 1, selectedIds: [], defaultId: null }

function appStub() {
  const app = createAppApiStub()
  vi.mocked(app.agentProfiles.libraryGet).mockResolvedValue({ version: 1, profiles: [alpha, beta] })
  vi.mocked(app.agentProfiles.selectionSet).mockImplementation(async (_id, input) => ({
    version: 1,
    ...input,
  }))
  return app
}

describe('project agent opt-in', () => {
  it('saves unchanged and default-only drafts without the stored format version', async () => {
    const app = appStub()
    vi.mocked(app.agentProfiles.selectionGet).mockResolvedValue({
      version: 1,
      selectedIds: ['a'],
      defaultId: null,
    })
    render(<AgentProfilesSettings app={app} projectId="p1" />)
    await screen.findByRole('checkbox', { name: /Enable Alpha/ })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(app.agentProfiles.selectionSet).toHaveBeenLastCalledWith('p1', {
        selectedIds: ['a'],
        defaultId: null,
      }),
    )
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(app.agentProfiles.selectionSet).toHaveBeenLastCalledWith('p1', {
        selectedIds: ['a'],
        defaultId: 'a',
      }),
    )
  })
  it('has an empty selection despite populated library and never selects a default automatically', async () => {
    const app = appStub()
    render(<AgentProfilesSettings app={app} projectId="p1" />)
    const checkbox = await screen.findByRole('checkbox', { name: /Enable Alpha/ })
    expect((checkbox as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText(/No agents selected for this project/)).toBeTruthy()
    expect(screen.queryByLabelText('Command')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add agent' })).toBeNull()
    fireEvent.click(checkbox)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(app.agentProfiles.selectionSet).toHaveBeenCalledWith('p1', {
        selectedIds: ['a'],
        defaultId: null,
      }),
    )
  })

  it('clears the default on deselection and Cancel restores saved choices without persistence', async () => {
    const app = appStub()
    vi.mocked(app.agentProfiles.selectionGet).mockResolvedValue({
      version: 1,
      selectedIds: ['a'],
      defaultId: 'a',
    })
    render(<AgentProfilesSettings app={app} projectId="p1" />)
    const alphaInput = await screen.findByRole('checkbox', { name: /Enable Alpha/ })
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('a')
    expect(screen.queryByRole('option', { name: /Beta/ })).toBeNull()
    fireEvent.click(alphaInput)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect((alphaInput as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('a')
    expect(app.agentProfiles.selectionSet).not.toHaveBeenCalled()
    fireEvent.click(alphaInput)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(app.agentProfiles.selectionSet).toHaveBeenCalledWith('p1', {
        selectedIds: [],
        defaultId: null,
      }),
    )
  })

  it('refreshes definitions after Manage agents while preserving unsaved opt-in and default choices', async () => {
    const app = appStub()
    const manage = vi.fn()
    const view = render(<AgentProfilesSettings app={app} projectId="p1" onManageAgents={manage} />)
    fireEvent.click(await screen.findByRole('checkbox', { name: /Enable Alpha/ }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Manage agents' }))
    expect(manage).toHaveBeenCalledOnce()
    vi.mocked(app.agentProfiles.libraryGet).mockResolvedValue({
      version: 1,
      profiles: [{ ...alpha, name: 'Edited' }, beta, { ...beta, id: 'c', name: 'Copy' }],
    })
    view.rerender(
      <AgentProfilesSettings
        app={app}
        projectId="p1"
        onManageAgents={manage}
        libraryRefreshKey={1}
      />,
    )
    expect(
      ((await screen.findByRole('checkbox', { name: /Enable Edited/ })) as HTMLInputElement)
        .checked,
    ).toBe(true)
    expect(
      (screen.getByRole('checkbox', { name: /Enable Copy/ }) as HTMLInputElement).checked,
    ).toBe(false)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('a')
    expect(app.agentProfiles.selectionGet).toHaveBeenCalledOnce()
    expect(app.agentProfiles.selectionSet).not.toHaveBeenCalled()
  })

  it('keeps the draft after save rejection and reports empty-library and read errors distinctly', async () => {
    const app = appStub()
    vi.mocked(app.agentProfiles.selectionSet).mockRejectedValue({
      nekodeAppError: true,
      code: 'validation',
      message: 'Agent no longer exists.',
      channel: 'agentProfiles:selectionSet',
    })
    render(<AgentProfilesSettings app={app} projectId="p1" />)
    const input = await screen.findByRole('checkbox', { name: /Enable Alpha/ })
    fireEvent.click(input)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Agent no longer exists.',
    )
    expect((input as HTMLInputElement).checked).toBe(true)
    cleanup()
    vi.mocked(app.agentProfiles.libraryGet).mockResolvedValue({ version: 1, profiles: [] })
    render(<AgentProfilesSettings app={app} projectId="p1" />)
    expect(await screen.findByText(/No global agents/)).toBeTruthy()
    cleanup()
    vi.mocked(app.agentProfiles.libraryGet).mockRejectedValue(new Error('failed'))
    render(<AgentProfilesSettings app={app} projectId="p1" />)
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Failed to load agent profiles.',
    )
    expect(screen.queryByText(/No global agents/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('ignores delayed load and save responses from the previous project', async () => {
    const app = appStub()
    let resolveLoad!: (selection: AgentProjectSelection) => void
    vi.mocked(app.agentProfiles.selectionGet).mockImplementation(async (id) =>
      id === 'p1'
        ? new Promise((resolve) => {
            resolveLoad = resolve
          })
        : EMPTY,
    )
    const view = render(<AgentProfilesSettings app={app} projectId="p1" />)
    view.rerender(<AgentProfilesSettings app={app} projectId="p2" />)
    await screen.findByRole('checkbox', { name: /Enable Alpha/ })
    resolveLoad({ version: 1, selectedIds: ['a'], defaultId: 'a' })
    await waitFor(() =>
      expect(
        (screen.getByRole('checkbox', { name: /Enable Alpha/ }) as HTMLInputElement).checked,
      ).toBe(false),
    )
    let resolveSave!: (selection: AgentProjectSelection) => void
    vi.mocked(app.agentProfiles.selectionSet).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable Alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(app.agentProfiles.selectionSet).toHaveBeenCalledWith('p2', {
      selectedIds: ['a'],
      defaultId: null,
    })
    view.rerender(<AgentProfilesSettings app={app} projectId="p3" />)
    await screen.findByRole('checkbox', { name: /Enable Alpha/ })
    resolveSave({ version: 1, selectedIds: ['a'], defaultId: 'a' })
    await waitFor(() =>
      expect(
        (screen.getByRole('checkbox', { name: /Enable Alpha/ }) as HTMLInputElement).checked,
      ).toBe(false),
    )
  })

  it('does not read project configuration without a project', () => {
    const app: AppApi = appStub()
    render(<AgentProfilesSettings app={app} projectId={null} />)
    expect(screen.getByText('Select a project to choose agents.')).toBeTruthy()
    expect(app.agentProfiles.selectionGet).not.toHaveBeenCalled()
  })
})
