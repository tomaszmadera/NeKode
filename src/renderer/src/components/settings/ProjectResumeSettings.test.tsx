import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppApiStub } from '../../test/app-api-stub'
import { ProjectResumeSettings } from './ProjectResumeSettings'

afterEach(cleanup)

describe('ProjectResumeSettings', () => {
  it('loads templates and current project binding, and saves template choice', async () => {
    const app = createAppApiStub()
    vi.mocked(app.resumeSources.list).mockResolvedValue({
      revision: 1,
      templates: [
        {
          id: 'agent-harness',
          revision: 1,
          name: 'Agent Harness',
          prompt: 'Resume {taskPath}',
          source: { kind: 'command', protocol: 'agent-harness', executable: 'python', args: [] },
        },
        {
          id: 'custom-files',
          revision: 1,
          name: 'Custom Files',
          prompt: 'Resume {taskPath}',
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

    fireEvent.click(screen.getByRole('button', { name: 'Manage templates' }))
    expect(onManageTemplates).toHaveBeenCalledOnce()
  })
})
