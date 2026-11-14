import {
  DEFAULT_CONTINUE_INSTRUCTION,
  DEFAULT_HANDOFF_INSTRUCTION,
  DEFAULT_RESUME_INSTRUCTION,
  DEFAULT_START_INSTRUCTION,
} from '@shared/contracts/action-instructions-contract'
import type { AppApi } from '@shared/ipc-contract'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { InstructionSettings } from './InstructionSettings'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

interface AppOptions {
  kanbanAdapter?: string | null
  importLegacy?: () => Promise<string | null>
}

function makeApp({ kanbanAdapter = null, importLegacy }: AppOptions = {}): AppApi {
  return {
    projects: {
      list: vi.fn().mockResolvedValue([
        { id: 'p1', name: 'Alpha', path: 'C:/alpha' },
        { id: 'p2', name: 'Beta', path: 'C:/beta' },
      ]),
    },
    kanban: {
      getConfig: vi.fn().mockImplementation((projectId: string) =>
        Promise.resolve({
          projectId,
          adapterId: projectId === 'p2' ? kanbanAdapter : null,
        }),
      ),
    },
    resumeSources: {
      importLegacy: vi.fn(importLegacy ?? (() => Promise.resolve(null))),
    },
  } as unknown as AppApi
}

function renderSettings(
  app: AppApi,
  overrides: Partial<React.ComponentProps<typeof InstructionSettings>> = {},
) {
  const props: React.ComponentProps<typeof InstructionSettings> = {
    app,
    handoffInstruction: DEFAULT_HANDOFF_INSTRUCTION,
    continueInstruction: DEFAULT_CONTINUE_INSTRUCTION,
    startInstruction: DEFAULT_START_INSTRUCTION,
    resumeInstruction: DEFAULT_RESUME_INSTRUCTION,
    handoffInstructionError: null,
    continueInstructionError: null,
    startInstructionError: null,
    resumeInstructionError: null,
    resumeMigrationNotice: null,
    autoSend: false,
    onSaveHandoff: vi.fn().mockReturnValue(null),
    onResetHandoff: vi.fn(),
    onSaveContinue: vi.fn().mockReturnValue(null),
    onResetContinue: vi.fn(),
    onSaveStart: vi.fn().mockReturnValue(null),
    onResetStart: vi.fn(),
    onSaveResume: vi.fn().mockReturnValue(null),
    onResetResume: vi.fn(),
    onDismissResumeMigration: vi.fn(),
    onManageTemplates: vi.fn(),
    ...overrides,
  }
  return { props, view: render(<InstructionSettings {...props} />) }
}

const editorValue = (testId: string) => (screen.getByTestId(testId) as HTMLTextAreaElement).value

describe('InstructionSettings', () => {
  it('shows Start, Resume, Handoff, Continue and Stop and lists affected projects', async () => {
    renderSettings(makeApp())

    for (const name of ['Start', 'Resume', 'Handoff', 'Continue', 'Stop'])
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    expect(screen.getByText(/does not claim that a handoff was saved/)).toBeTruthy()
    expect(screen.getByText(/does not choose a task or a context file/)).toBeTruthy()
    expect(screen.getByText(/start a card from a Kanban board/)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.instructionStopNote).textContent).toContain('Ctrl+C')
    expect((await screen.findByTestId(TEST_ID.instructionsAffectedProjects)).textContent).toBe(
      'Applies to all projects (2): Alpha, Beta',
    )
    expect(editorValue(TEST_ID.instructionStartEditor)).toBe(DEFAULT_START_INSTRUCTION)
    expect(screen.getByTestId(TEST_ID.instructionResumePreview).textContent).toBe(
      DEFAULT_RESUME_INSTRUCTION,
    )
  })

  it('shows the Kanban note only when no project uses a Kanban board', async () => {
    renderSettings(makeApp())
    expect((await screen.findByTestId(TEST_ID.instructionStartKanbanNote)).textContent).toBe(
      'No project uses a Kanban board yet.',
    )
    cleanup()

    const app = makeApp({ kanbanAdapter: 'plane' })
    renderSettings(app)
    await waitFor(() => expect(app.kanban.getConfig).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    expect(screen.queryByTestId(TEST_ID.instructionStartKanbanNote)).toBeNull()
    expect(
      (screen.getByTestId(TEST_ID.instructionStartEditor) as HTMLTextAreaElement).disabled,
    ).toBe(false)
  })

  it('saves multiline Start and Resume text exactly and previews the draft', () => {
    const onSaveStart = vi.fn().mockReturnValue(null)
    const onSaveResume = vi.fn().mockReturnValue(null)
    renderSettings(makeApp(), { onSaveStart, onSaveResume })

    fireEvent.change(screen.getByTestId(TEST_ID.instructionStartEditor), {
      target: { value: 'Start {ref}\n\n{url}' },
    })
    expect(screen.getByTestId(TEST_ID.instructionStartPreview).textContent).toBe(
      'Start {ref}\n\n{url}',
    )
    fireEvent.click(screen.getByTestId(TEST_ID.instructionStartSave))
    expect(onSaveStart).toHaveBeenCalledWith('Start {ref}\n\n{url}')

    fireEvent.change(screen.getByTestId(TEST_ID.instructionResumeEditor), {
      target: { value: 'Resume {taskPath}\nRead it first.' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.instructionResumeSave))
    expect(onSaveResume).toHaveBeenCalledWith('Resume {taskPath}\nRead it first.')
  })

  it('shows Start and Resume validation and keeps the saved preview', () => {
    const onSaveStart = vi.fn().mockReturnValue('Start instruction must contain {ref}.')
    const onSaveResume = vi.fn().mockReturnValue('Resume instruction must contain {taskPath}.')
    renderSettings(makeApp(), { onSaveStart, onSaveResume })

    fireEvent.change(screen.getByTestId(TEST_ID.instructionStartEditor), {
      target: { value: 'No ref here' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.instructionStartSave))
    expect(screen.getByTestId(TEST_ID.instructionStartError).textContent).toBe(
      'Start instruction must contain {ref}.',
    )
    expect(screen.getByTestId(TEST_ID.instructionStartPreview).textContent).toBe(
      DEFAULT_START_INSTRUCTION,
    )

    fireEvent.change(screen.getByTestId(TEST_ID.instructionResumeEditor), {
      target: { value: 'Resume something' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.instructionResumeSave))
    expect(screen.getByTestId(TEST_ID.instructionResumeError).textContent).toBe(
      'Resume instruction must contain {taskPath}.',
    )
  })

  it('resets Start and Resume to their defaults', () => {
    const onResetStart = vi.fn()
    const onResetResume = vi.fn()
    renderSettings(makeApp(), {
      startInstruction: 'Custom {ref}',
      resumeInstruction: 'Custom {taskPath}',
      onResetStart,
      onResetResume,
    })

    fireEvent.click(screen.getByTestId(TEST_ID.instructionStartReset))
    fireEvent.click(screen.getByTestId(TEST_ID.instructionResumeReset))

    expect(onResetStart).toHaveBeenCalledTimes(1)
    expect(onResetResume).toHaveBeenCalledTimes(1)
    expect(editorValue(TEST_ID.instructionStartEditor)).toBe(DEFAULT_START_INSTRUCTION)
    expect(editorValue(TEST_ID.instructionResumeEditor)).toBe(DEFAULT_RESUME_INSTRUCTION)
  })

  it('shows an invalid stored Resume value with the default preview', () => {
    renderSettings(makeApp(), {
      resumeInstructionError:
        'The saved Resume instruction is invalid. The default is used until you save a valid instruction.',
    })
    expect(screen.getByTestId(TEST_ID.instructionResumeError).textContent).toContain(
      'The saved Resume instruction is invalid.',
    )
    expect(screen.getByTestId(TEST_ID.instructionResumePreview).textContent).toBe(
      DEFAULT_RESUME_INSTRUCTION,
    )
  })

  it('imports the legacy template into the Resume draft without saving it', async () => {
    const onSaveResume = vi.fn().mockReturnValue(null)
    renderSettings(makeApp({ importLegacy: () => Promise.resolve('Legacy {handoffPath}\nmore') }), {
      onSaveResume,
    })

    fireEvent.click(screen.getByTestId(TEST_ID.instructionResumeImport))
    await waitFor(() =>
      expect(editorValue(TEST_ID.instructionResumeEditor)).toBe('Legacy {handoffPath}\nmore'),
    )
    expect(onSaveResume).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId(TEST_ID.instructionResumeSave))
    expect(onSaveResume).toHaveBeenCalledWith('Legacy {handoffPath}\nmore')
  })

  it('reports a missing or failed legacy import and keeps the draft', async () => {
    renderSettings(makeApp(), { resumeInstruction: 'Mine {taskPath}' })

    fireEvent.click(screen.getByTestId(TEST_ID.instructionResumeImport))
    expect(
      (
        await screen.findByText('No legacy Resume template was found in settings.json.')
      ).getAttribute('role'),
    ).toBe('alert')
    expect(editorValue(TEST_ID.instructionResumeEditor)).toBe('Mine {taskPath}')
    cleanup()

    renderSettings(makeApp({ importLegacy: () => Promise.reject(new Error('boom')) }))
    fireEvent.click(screen.getByTestId(TEST_ID.instructionResumeImport))
    expect(
      await screen.findByText('Instructions could not be loaded. Retry the operation.'),
    ).toBeTruthy()
    expect(editorValue(TEST_ID.instructionResumeEditor)).toBe(DEFAULT_RESUME_INSTRUCTION)
  })

  it('lists the previous Resume prompts with Copy and Dismiss', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const onDismissResumeMigration = vi.fn()
    renderSettings(makeApp(), {
      onDismissResumeMigration,
      resumeMigrationNotice: {
        prompts: [
          { prompt: 'Resume task {taskPath}', templates: ['Agent Harness'] },
          { prompt: 'Read {taskPath} first', templates: ['Local', 'Notes'] },
        ],
      },
    })

    const notice = screen.getByTestId(TEST_ID.instructionResumeMigration)
    expect(notice.textContent).toContain('Read {taskPath} first')
    expect(notice.textContent).toContain('Local, Notes')
    expect(notice.textContent).toContain('copy what you need first')
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[1])
    expect(writeText).toHaveBeenCalledWith('Read {taskPath} first')
    fireEvent.click(screen.getByTestId(TEST_ID.instructionResumeMigrationDismiss))
    expect(onDismissResumeMigration).toHaveBeenCalledTimes(1)
  })

  it('keeps Handoff and Continue editing unchanged', () => {
    const onSaveHandoff = vi.fn().mockReturnValue(null)
    const onResetContinue = vi.fn()
    renderSettings(makeApp(), { onSaveHandoff, onResetContinue, continueInstruction: 'Go on' })

    fireEvent.change(screen.getByTestId(TEST_ID.instructionHandoffEditor), {
      target: { value: 'Record {state}\nand stop' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.instructionHandoffSave))
    expect(onSaveHandoff).toHaveBeenCalledWith('Record {state}\nand stop')
    expect(screen.getByText('Saved')).toBeTruthy()
    fireEvent.click(screen.getByTestId(TEST_ID.instructionContinueReset))
    expect(onResetContinue).toHaveBeenCalledTimes(1)
    expect(editorValue(TEST_ID.instructionContinueEditor)).toBe(DEFAULT_CONTINUE_INSTRUCTION)
  })

  it('routes Manage Resume sources to the source editor', () => {
    const onManageTemplates = vi.fn()
    renderSettings(makeApp(), { onManageTemplates })
    fireEvent.click(screen.getByTestId(TEST_ID.instructionManageTemplates))
    expect(onManageTemplates).toHaveBeenCalledTimes(1)
  })
})
