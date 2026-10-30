import type { ResumeSourceLibrary, ResumeSourcePreview } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppApiStub } from '../../test/app-api-stub'
import { ResumeTemplatesSettings } from './ResumeTemplatesSettings'

afterEach(cleanup)
const library = (): ResumeSourceLibrary => ({
  revision: 1,
  templates: [
    {
      id: 'notes',
      revision: 1,
      name: 'Notes',
      prompt: 'Resume from {taskPath}',
      source: {
        kind: 'files',
        directory: '.',
        pattern: 'progress.txt',
        recursive: true,
        identity: 'parent',
      },
    },
  ],
})
const result = (projectId = 'p1'): ResumeSourcePreview => ({
  projectId,
  templateId: 'notes',
  revision: 1,
  candidates: [
    {
      id: 'TASK-1',
      title: 'progress.txt',
      path: '/repo/TASK-1/progress.txt',
      displayPath: 'TASK-1/progress.txt',
      modifiedAt: '2026-10-29T00:00:00Z',
    },
  ],
  rejections: [],
})

async function setup() {
  const app = createAppApiStub()
  vi.mocked(app.resumeSources.list).mockResolvedValue(library())
  vi.mocked(app.projects.list).mockResolvedValue([
    { id: 'p1', name: 'One', path: '/one', runtimeLabel: null },
    { id: 'p2', name: 'Two', path: '/two', runtimeLabel: null },
  ])
  vi.mocked(app.resumeSources.put).mockResolvedValue({ ...library(), revision: 2 })
  const view = render(<ResumeTemplatesSettings app={app} />)
  await screen.findByRole('option', { name: 'Notes' })
  fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'notes' } })
  fireEvent.change(screen.getByLabelText('Test project'), { target: { value: 'p1' } })
  return { app, ...view }
}

describe('Resume templates settings', () => {
  it('previews the saved template for a selected registered project without editing project settings', async () => {
    const { app } = await setup()
    vi.mocked(app.resumeSources.test).mockResolvedValue(result())
    fireEvent.click(screen.getByRole('button', { name: 'Test saved template' }))
    expect(await screen.findByText('TASK-1/progress.txt')).not.toBeNull()
    expect(app.resumeSources.test).toHaveBeenCalledWith('notes', 'p1', 1, expect.any(String))
    expect(app.state.set).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Test project'), { target: { value: 'p2' } })
    expect(screen.queryByText('TASK-1/progress.txt')).toBeNull()
  })

  it('creates file templates and edits source fields and multiline instructions before saving', async () => {
    const { app } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'New template' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Progress' } })
    fireEvent.change(screen.getByLabelText('Directory'), { target: { value: 'work' } })
    fireEvent.change(screen.getByLabelText('File name filter'), {
      target: { value: 'progress.txt' },
    })
    fireEvent.click(screen.getByLabelText('Search subdirectories'))
    fireEvent.change(screen.getByLabelText('Candidate identity'), { target: { value: 'parent' } })
    fireEvent.change(screen.getByLabelText('Resume instruction'), {
      target: { value: 'Resume {taskPath}\nKeep {unknown} and $literal' },
    })
    expect(
      (screen.getByRole('button', { name: 'Test saved template' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() =>
      expect(app.resumeSources.put).toHaveBeenCalledWith({
        id: null,
        revision: null,
        name: 'Progress',
        prompt: 'Resume {taskPath}\nKeep {unknown} and $literal',
        source: {
          kind: 'files',
          directory: 'work',
          pattern: 'progress.txt',
          recursive: true,
          identity: 'parent',
        },
      }),
    )
  })

  it('keeps executable and argv separate and exposes the Harness preset explicitly', async () => {
    const { app } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'New template' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Custom' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'generic' } })
    fireEvent.change(screen.getByLabelText('Executable'), { target: { value: 'inventory' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add argument' }))
    fireEvent.change(screen.getByLabelText('Argument 1'), {
      target: { value: 'path with spaces; $x' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() =>
      expect(app.resumeSources.put).toHaveBeenCalledWith(
        expect.objectContaining({
          source: {
            kind: 'command',
            protocol: 'generic',
            executable: 'inventory',
            args: ['path with spaces; $x'],
          },
        }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'New template' }))
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'agent-harness' } })
    expect((screen.getByLabelText('Resume instruction') as HTMLTextAreaElement).value).toBe(
      'Resume task {taskPath}',
    )
    expect(screen.queryByLabelText('Executable')).toBeNull()
    expect(screen.getByText(/Requires Agent Harness/)).not.toBeNull()
  })

  it('shows recoverable source errors and protects an edited saved revision', async () => {
    const { app } = await setup()
    vi.mocked(app.resumeSources.test)
      .mockRejectedValueOnce(new AppError('config', 'Install Agent Harness in this project.'))
      .mockResolvedValue(result())
    fireEvent.click(screen.getByRole('button', { name: 'Test saved template' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Install Agent Harness')
    fireEvent.click(screen.getByRole('button', { name: 'Test saved template' }))
    expect(await screen.findByText('TASK-1/progress.txt')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    vi.mocked(app.resumeSources.put).mockRejectedValueOnce(
      new AppError('conflict', 'The Resume template changed. Reload it and retry.'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect((await screen.findByRole('alert')).textContent).toContain('changed')
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Notes')
  })

  it('discards late Test responses on project changes, revision events and unmount', async () => {
    const { app, unmount } = await setup()
    let finish!: (preview: ResumeSourcePreview) => void
    vi.mocked(app.resumeSources.test).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Test saved template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Testing...' }))
    expect(app.resumeSources.test).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Test project'), { target: { value: 'p2' } })
    await act(async () => {
      finish(result())
    })
    expect(screen.queryByText('TASK-1/progress.txt')).toBeNull()
    expect(app.resumeSources.cancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Test saved template' }))
    const event = vi.mocked(app.resumeSources.onChanged).mock.calls[0][0]
    await act(async () => {
      event({ templateId: 'notes', revision: 2 })
      finish(result())
    })
    expect(screen.queryByText('TASK-1/progress.txt')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Test saved template' }))
    unmount()
    await act(async () => {
      finish(result())
    })
    expect(app.resumeSources.cancel).toHaveBeenCalledTimes(3)
  })

  it('duplicates and deletes a saved template with revision guards', async () => {
    const { app } = await setup()
    vi.mocked(app.resumeSources.duplicate).mockResolvedValue({
      revision: 2,
      templates: [
        ...library().templates,
        { ...library().templates[0], id: 'copy', revision: 2, name: 'Notes copy' },
      ],
    })
    vi.mocked(app.resumeSources.delete).mockResolvedValue({
      revision: 3,
      templates: library().templates,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    await waitFor(() => expect(app.resumeSources.duplicate).toHaveBeenCalledWith('notes', 1))
    await screen.findByRole('option', { name: 'Notes copy' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(app.resumeSources.delete).toHaveBeenCalledWith('copy', 2))
  })

  it('imports legacy Resume template from settings.json into the editor', async () => {
    const { app } = await setup()
    vi.mocked(app.resumeSources.importLegacy).mockResolvedValue('Imported prompt {handoffPath}')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const importBtn = screen.getByRole('button', { name: 'Import legacy template' })
    fireEvent.click(importBtn)
    await waitFor(() => {
      expect(app.resumeSources.importLegacy).toHaveBeenCalledOnce()
      expect((screen.getByLabelText('Resume instruction') as HTMLTextAreaElement).value).toBe(
        'Imported prompt {handoffPath}',
      )
    })
  })
})
