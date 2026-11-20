import { WORK_RECORD_SKILL_FILE_PATH } from '@shared/ipc-contract'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { createAppApiStub, workRecordSkillPreviewStub } from '../../test/app-api-stub'
import { ProjectResumeSettings } from './ProjectResumeSettings'

afterEach(cleanup)

/** A project bound to the local work record source with one template. */
function localRecordApp() {
  const app = createAppApiStub()
  vi.mocked(app.resumeSources.list).mockResolvedValue({
    revision: 1,
    templates: [
      {
        id: 'local-progress',
        revision: 1,
        name: 'Local work record',
        source: {
          kind: 'files',
          directory: 'work',
          pattern: 'progress.md',
          recursive: true,
          identity: 'parent',
        },
      },
    ],
  })
  vi.mocked(app.resumeSources.binding).mockResolvedValue({
    projectId: 'p1',
    templateId: 'local-progress',
  })
  return app
}

describe('ProjectResumeSettings', () => {
  it('shows the selected source summary without a per-source instruction', async () => {
    const app = createAppApiStub()
    vi.mocked(app.resumeSources.list).mockResolvedValue({
      revision: 1,
      templates: [
        {
          id: 'local-progress',
          revision: 1,
          name: 'Local work record',
          source: {
            kind: 'files',
            directory: 'work',
            pattern: 'progress.md',
            recursive: true,
            identity: 'parent',
          },
        },
      ],
    })
    vi.mocked(app.resumeSources.binding).mockResolvedValue({
      projectId: 'p1',
      templateId: 'local-progress',
    })

    render(<ProjectResumeSettings app={app} projectId="p1" />)

    const summary = await screen.findByTestId('project-resume-source-summary')
    expect(screen.getByRole('region', { name: 'Work record' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Work record', level: 3 })).toMatchInlineSnapshot(`
      <h3
        class="m-0 flex-1 text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase"
      >
        Work record
      </h3>
    `)
    expect(screen.getByLabelText('Work record source')).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Local work record' })).toBeTruthy()
    expect(summary.textContent).toContain(
      'Files: work / progress.md, including subdirectories, identity: immediate parent directory',
    )
    expect(summary.textContent).not.toContain('{taskPath}')
    expect(screen.getByText(/where Resume finds the record of work on a work item/)).toBeTruthy()
    expect(screen.getByText(/Resume instruction is set in Application settings/)).toBeTruthy()
  })

  it('loads templates and current project binding, and saves template choice', async () => {
    const app = createAppApiStub()
    vi.mocked(app.resumeSources.list).mockResolvedValue({
      revision: 1,
      templates: [
        {
          id: 'agent-harness',
          revision: 1,
          name: 'Agent Harness',
          source: { kind: 'command', protocol: 'agent-harness', executable: 'python', args: [] },
        },
        {
          id: 'custom-files',
          revision: 1,
          name: 'Custom Files',
          source: {
            kind: 'files',
            directory: '.',
            pattern: '*.md',
            recursive: false,
            identity: 'stem',
          },
        },
      ],
    })
    vi.mocked(app.resumeSources.binding).mockResolvedValue({
      projectId: 'p1',
      templateId: 'agent-harness',
    })

    const onManageTemplates = vi.fn()
    render(<ProjectResumeSettings app={app} projectId="p1" onManageTemplates={onManageTemplates} />)

    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    expect(select.value).toBe('agent-harness')

    fireEvent.change(select, { target: { value: 'custom-files' } })
    expect(select.value).toBe('custom-files')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(app.resumeSources.bind).toHaveBeenCalledWith('p1', 'custom-files')
      expect(screen.getByTestId('project-resume-saved')).toBeTruthy()
    })

    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(app.resumeSources.bind).toHaveBeenCalledWith('p1', null)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Manage sources' }))
    expect(onManageTemplates).toHaveBeenCalledOnce()
  })

  it('offers Teach agents only while a work record source is bound', async () => {
    const app = createAppApiStub()
    vi.mocked(app.resumeSources.list).mockResolvedValue({
      revision: 1,
      templates: [
        {
          id: 'local-progress',
          revision: 1,
          name: 'Local work record',
          source: {
            kind: 'files',
            directory: 'work',
            pattern: 'progress.md',
            recursive: true,
            identity: 'parent',
          },
        },
      ],
    })
    vi.mocked(app.resumeSources.binding).mockResolvedValue({
      projectId: 'p1',
      templateId: null,
    })
    render(<ProjectResumeSettings app={app} projectId="p1" />)
    await screen.findByRole('combobox')
    expect(screen.queryByTestId(TEST_ID.settingsWorkRecordTeachAgents)).toBeNull()
  })

  it('previews and writes the work record skill without touching the work item skill', async () => {
    const app = createAppApiStub()
    vi.mocked(app.resumeSources.list).mockResolvedValue({
      revision: 1,
      templates: [
        {
          id: 'local-progress',
          revision: 1,
          name: 'Local work record',
          source: {
            kind: 'files',
            directory: 'work',
            pattern: 'progress.md',
            recursive: true,
            identity: 'parent',
          },
        },
      ],
    })
    vi.mocked(app.resumeSources.binding).mockResolvedValue({
      projectId: 'p1',
      templateId: 'local-progress',
    })
    vi.mocked(app.resumeSources.skillPreview).mockResolvedValue(
      workRecordSkillPreviewStub({ text: 'record skill text\n' }),
    )
    vi.mocked(app.agentProfiles.get).mockResolvedValue({
      defaultId: 'a1',
      profiles: [
        {
          id: 'a1',
          name: 'Agent One',
          command: 'agent',
          interactiveArgs: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    } as never)

    render(<ProjectResumeSettings app={app} projectId="p1" />)
    const teach = await screen.findByTestId(TEST_ID.settingsWorkRecordTeachAgents)
    fireEvent.click(teach)

    expect(
      await screen
        .findByTestId(TEST_ID.settingsWorkRecordTeachFile)
        .then((node) => node.textContent),
    ).toBe(WORK_RECORD_SKILL_FILE_PATH)
    expect(screen.getByTestId(TEST_ID.settingsWorkRecordTeachOrigin).textContent).toBe(
      'Local work record instructions',
    )
    expect(screen.getByTestId(TEST_ID.settingsWorkRecordTeachText).textContent).toBe(
      'record skill text\n',
    )
    expect(screen.getByTestId(TEST_ID.settingsWorkRecordTeachProfiles).textContent).toContain(
      'Agent One',
    )

    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogConfirm))
    await waitFor(() =>
      expect(app.resumeSources.writeSkill).toHaveBeenCalledWith('p1', 'd'.repeat(64)),
    )
    expect((await screen.findByTestId(TEST_ID.settingsWorkRecordTeachDone)).textContent).toBe(
      `Wrote ${WORK_RECORD_SKILL_FILE_PATH}.`,
    )
  })

  it('a stale work record preview writes nothing and needs a new confirm', async () => {
    const app = createAppApiStub()
    vi.mocked(app.resumeSources.list).mockResolvedValue({
      revision: 1,
      templates: [
        {
          id: 'local-progress',
          revision: 1,
          name: 'Local work record',
          source: {
            kind: 'files',
            directory: 'work',
            pattern: 'progress.md',
            recursive: true,
            identity: 'parent',
          },
        },
      ],
    })
    vi.mocked(app.resumeSources.binding).mockResolvedValue({
      projectId: 'p1',
      templateId: 'local-progress',
    })
    vi.mocked(app.resumeSources.skillPreview)
      .mockResolvedValueOnce(workRecordSkillPreviewStub({ text: 'first\n', token: '1'.repeat(64) }))
      .mockResolvedValueOnce(
        workRecordSkillPreviewStub({ text: 'second\n', token: '2'.repeat(64) }),
      )
    vi.mocked(app.resumeSources.writeSkill)
      .mockRejectedValueOnce({
        nekodeAppError: true,
        code: 'conflict',
        message: 'The skill file or its source changed. Review the new preview.',
      })
      .mockResolvedValueOnce(undefined)

    render(<ProjectResumeSettings app={app} projectId="p1" />)
    fireEvent.click(await screen.findByTestId(TEST_ID.settingsWorkRecordTeachAgents))
    fireEvent.click(await screen.findByTestId(TEST_ID.confirmDialogConfirm))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.settingsWorkRecordTeachNotice).textContent).toBe(
        'The skill file or its source changed. Review the new preview.',
      ),
    )
    expect(screen.getByTestId(TEST_ID.settingsWorkRecordTeachText).textContent).toBe('second\n')
    expect(screen.queryByTestId(TEST_ID.settingsWorkRecordTeachDone)).toBeNull()
    expect(app.resumeSources.writeSkill).toHaveBeenCalledWith('p1', '1'.repeat(64))
  })

  it('shows Teach agents only for the saved binding, not the draft selection', async () => {
    const app = createAppApiStub()
    vi.mocked(app.resumeSources.list).mockResolvedValue({
      revision: 1,
      templates: [
        {
          id: 'local-progress',
          revision: 1,
          name: 'Local work record',
          source: {
            kind: 'files',
            directory: 'work',
            pattern: 'progress.md',
            recursive: true,
            identity: 'parent',
          },
        },
        {
          id: 'custom-files',
          revision: 1,
          name: 'Custom Files',
          source: {
            kind: 'files',
            directory: '.',
            pattern: '*.md',
            recursive: false,
            identity: 'stem',
          },
        },
      ],
    })
    vi.mocked(app.resumeSources.binding).mockResolvedValue({ projectId: 'p1', templateId: null })

    render(<ProjectResumeSettings app={app} projectId="p1" />)
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    expect(select.value).toBe('')
    expect(screen.queryByTestId(TEST_ID.settingsWorkRecordTeachAgents)).toBeNull()

    fireEvent.change(select, { target: { value: 'local-progress' } })
    expect(screen.queryByTestId(TEST_ID.settingsWorkRecordTeachAgents)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByTestId(TEST_ID.settingsWorkRecordTeachAgents)).toBeTruthy()
  })

  it('saving another binding reloads the open preview', async () => {
    const app = createAppApiStub()
    vi.mocked(app.resumeSources.list).mockResolvedValue({
      revision: 1,
      templates: [
        {
          id: 'local-progress',
          revision: 1,
          name: 'Local work record',
          source: {
            kind: 'files',
            directory: 'work',
            pattern: 'progress.md',
            recursive: true,
            identity: 'parent',
          },
        },
        {
          id: 'custom-files',
          revision: 1,
          name: 'Custom Files',
          source: {
            kind: 'files',
            directory: '.',
            pattern: '*.md',
            recursive: false,
            identity: 'stem',
          },
        },
      ],
    })
    vi.mocked(app.resumeSources.binding).mockResolvedValue({
      projectId: 'p1',
      templateId: 'local-progress',
    })
    vi.mocked(app.resumeSources.skillPreview)
      .mockResolvedValueOnce(workRecordSkillPreviewStub({ text: 'local\n', token: '1'.repeat(64) }))
      .mockResolvedValueOnce(
        workRecordSkillPreviewStub({
          origin: 'file-source',
          sourceName: 'Custom Files',
          text: 'custom\n',
          token: '2'.repeat(64),
        }),
      )

    render(<ProjectResumeSettings app={app} projectId="p1" />)
    fireEvent.click(await screen.findByTestId(TEST_ID.settingsWorkRecordTeachAgents))
    await screen.findByTestId(TEST_ID.settingsWorkRecordTeachText)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'custom-files' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.settingsWorkRecordTeachOrigin).textContent).toBe(
        'Instructions for the Custom Files file source',
      ),
    )
    expect(screen.getByTestId(TEST_ID.settingsWorkRecordTeachNotice)).toBeTruthy()
    expect(app.resumeSources.skillPreview).toHaveBeenCalledTimes(2)
  })

  it('clearing the binding while the dialog is open closes it', async () => {
    const app = createAppApiStub()
    vi.mocked(app.resumeSources.list).mockResolvedValue({
      revision: 1,
      templates: [
        {
          id: 'local-progress',
          revision: 1,
          name: 'Local work record',
          source: {
            kind: 'files',
            directory: 'work',
            pattern: 'progress.md',
            recursive: true,
            identity: 'parent',
          },
        },
      ],
    })
    vi.mocked(app.resumeSources.binding).mockResolvedValue({
      projectId: 'p1',
      templateId: 'local-progress',
    })

    render(<ProjectResumeSettings app={app} projectId="p1" />)
    fireEvent.click(await screen.findByTestId(TEST_ID.settingsWorkRecordTeachAgents))
    await screen.findByTestId(TEST_ID.settingsWorkRecordTeachText)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull())
    expect(app.resumeSources.writeSkill).not.toHaveBeenCalled()
  })

  it('cancel closes the dialog, restores focus, and writes nothing', async () => {
    const app = createAppApiStub()
    vi.mocked(app.resumeSources.list).mockResolvedValue({
      revision: 1,
      templates: [
        {
          id: 'local-progress',
          revision: 1,
          name: 'Local work record',
          source: {
            kind: 'files',
            directory: 'work',
            pattern: 'progress.md',
            recursive: true,
            identity: 'parent',
          },
        },
      ],
    })
    vi.mocked(app.resumeSources.binding).mockResolvedValue({
      projectId: 'p1',
      templateId: 'local-progress',
    })

    render(<ProjectResumeSettings app={app} projectId="p1" />)
    const teach = await screen.findByTestId(TEST_ID.settingsWorkRecordTeachAgents)
    fireEvent.click(teach)
    await screen.findByTestId(TEST_ID.settingsWorkRecordTeachText)
    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogCancel))

    await waitFor(() => expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull())
    expect(document.activeElement).toBe(teach)
    expect(app.resumeSources.writeSkill).not.toHaveBeenCalled()
  })

  it('shows the replace diff and the empty profile note', async () => {
    const app = localRecordApp()
    vi.mocked(app.resumeSources.skillPreview).mockResolvedValue(
      workRecordSkillPreviewStub({ exists: true, current: 'old line\n', text: 'new line\n' }),
    )

    render(<ProjectResumeSettings app={app} projectId="p1" />)
    fireEvent.click(await screen.findByTestId(TEST_ID.settingsWorkRecordTeachAgents))

    expect(await screen.findByTestId(TEST_ID.settingsWorkRecordTeachReplace)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.settingsWorkRecordTeachReplace).textContent).toContain(
      WORK_RECORD_SKILL_FILE_PATH,
    )
    expect(
      screen.getByTestId(TEST_ID.settingsWorkRecordTeachDiff).querySelectorAll('[data-diff]')
        .length,
    ).toBeGreaterThan(0)
    expect(screen.queryByTestId(TEST_ID.settingsWorkRecordTeachNoChanges)).toBeNull()
    expect(screen.getByTestId(TEST_ID.settingsWorkRecordTeachNoProfiles).textContent).toBe(
      'No agent profile is selected for this project.',
    )
    expect(screen.getByTestId(TEST_ID.settingsWorkRecordTeachBoundary).textContent).toContain(
      'installs and configures nothing',
    )
  })

  it('shows No changes and the hidden-current notice', async () => {
    const same = localRecordApp()
    vi.mocked(same.resumeSources.skillPreview).mockResolvedValue(
      workRecordSkillPreviewStub({ exists: true, current: 'same\n', text: 'same\n' }),
    )
    render(<ProjectResumeSettings app={same} projectId="p1" />)
    fireEvent.click(await screen.findByTestId(TEST_ID.settingsWorkRecordTeachAgents))
    expect((await screen.findByTestId(TEST_ID.settingsWorkRecordTeachNoChanges)).textContent).toBe(
      'No changes',
    )
    cleanup()

    const hidden = localRecordApp()
    vi.mocked(hidden.resumeSources.skillPreview).mockResolvedValue(
      workRecordSkillPreviewStub({ exists: true, current: null, text: 'new\n' }),
    )
    render(<ProjectResumeSettings app={hidden} projectId="p1" />)
    fireEvent.click(await screen.findByTestId(TEST_ID.settingsWorkRecordTeachAgents))
    expect(
      (await screen.findByTestId(TEST_ID.settingsWorkRecordTeachCurrentHidden)).textContent,
    ).toBe('The current file cannot be shown.')
  })
})
