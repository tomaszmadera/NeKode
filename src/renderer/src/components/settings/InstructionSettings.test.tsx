import {
  DEFAULT_CONTINUE_INSTRUCTION,
  DEFAULT_HANDOFF_INSTRUCTION,
} from '@shared/contracts/action-instructions-contract'
import type { AppApi } from '@shared/ipc-contract'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { InstructionSettings } from './InstructionSettings'

afterEach(() => {
  cleanup()
})

const TEMPLATE = {
  id: 't1',
  revision: 1,
  name: 'Harness',
  prompt: 'Resume task {taskPath}\nRead the record.',
  source: {
    kind: 'command' as const,
    protocol: 'agent-harness' as const,
    executable: 'python',
    args: ['.agents/scripts/taskctl', 'list', '--json'],
  },
}

function makeApp(boundTemplateId: string | null = 't1'): AppApi {
  return {
    projects: {
      list: vi.fn().mockResolvedValue([
        { id: 'p1', name: 'Alpha', path: 'C:/alpha' },
        { id: 'p2', name: 'Beta', path: 'C:/beta' },
      ]),
    },
    resumeSources: {
      list: vi.fn().mockResolvedValue({ revision: 1, templates: [TEMPLATE] }),
      binding: vi.fn().mockResolvedValue({ projectId: 'p1', templateId: boundTemplateId }),
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
    handoffInstructionError: null,
    continueInstructionError: null,
    autoSend: false,
    onSaveHandoff: vi.fn().mockReturnValue(null),
    onResetHandoff: vi.fn(),
    onSaveContinue: vi.fn().mockReturnValue(null),
    onResetContinue: vi.fn(),
    onManageTemplates: vi.fn(),
    ...overrides,
  }
  return { props, view: render(<InstructionSettings {...props} />) }
}

describe('InstructionSettings', () => {
  it('describes every action, lists affected projects and leaves Stop read-only', async () => {
    const app = makeApp()
    renderSettings(app)

    expect(screen.getByRole('heading', { name: 'Handoff' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Continue' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Resume' })).toBeTruthy()
    expect(screen.getByText(/does not claim that a handoff was saved/)).toBeTruthy()
    expect(screen.getByText(/does not choose a task or a context file/)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.instructionStopNote).textContent).toContain('Ctrl+C')
    expect((await screen.findByTestId(TEST_ID.instructionsAffectedProjects)).textContent).toBe(
      'Applies to all projects (2): Alpha, Beta',
    )

    const prompt = await screen.findByTestId(TEST_ID.instructionResumePrompt)
    expect(prompt.textContent).toBe(TEMPLATE.prompt)
  })

  it('saves multiline Handoff and Continue text exactly and previews the draft', () => {
    const app = makeApp()
    const onSaveHandoff = vi.fn().mockReturnValue(null)
    const onSaveContinue = vi.fn().mockReturnValue(null)
    renderSettings(app, { onSaveHandoff, onSaveContinue })

    fireEvent.change(screen.getByTestId(TEST_ID.instructionHandoffEditor), {
      target: { value: 'Record {state}\nand stop' },
    })
    expect(screen.getByTestId(TEST_ID.instructionHandoffPreview).textContent).toBe(
      'Record {state}\nand stop',
    )
    fireEvent.click(screen.getByTestId(TEST_ID.instructionHandoffSave))
    expect(onSaveHandoff).toHaveBeenCalledWith('Record {state}\nand stop')
    expect(screen.getByText('Saved')).toBeTruthy()

    fireEvent.change(screen.getByTestId(TEST_ID.instructionContinueEditor), {
      target: { value: 'Keep going\nfrom here' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.instructionContinueSave))
    expect(onSaveContinue).toHaveBeenCalledWith('Keep going\nfrom here')
  })

  it('shows a validation message and keeps the saved text when saving is rejected', () => {
    const app = makeApp()
    const onSaveHandoff = vi
      .fn()
      .mockReturnValue('Instruction cannot be empty. Use Reset to default.')
    renderSettings(app, { onSaveHandoff })

    fireEvent.change(screen.getByTestId(TEST_ID.instructionHandoffEditor), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.instructionHandoffSave))

    expect(screen.getByTestId(TEST_ID.instructionHandoffError).textContent).toBe(
      'Instruction cannot be empty. Use Reset to default.',
    )
    expect(screen.getByTestId(TEST_ID.instructionHandoffPreview).textContent).toBe(
      DEFAULT_HANDOFF_INSTRUCTION,
    )
  })

  it('shows an invalid stored value without hiding the default preview', () => {
    const app = makeApp()
    renderSettings(app, {
      handoffInstructionError:
        'The saved Handoff instruction is invalid. The default is used until you save a valid instruction.',
    })

    expect(screen.getByTestId(TEST_ID.instructionHandoffError).textContent).toContain(
      'The saved Handoff instruction is invalid.',
    )
    expect(screen.getByTestId(TEST_ID.instructionHandoffPreview).textContent).toBe(
      DEFAULT_HANDOFF_INSTRUCTION,
    )
  })

  it('restores defaults and reports the reset', () => {
    const app = makeApp()
    const onResetHandoff = vi.fn()
    renderSettings(app, { onResetHandoff, handoffInstruction: 'Custom handoff' })

    expect(
      (screen.getByTestId(TEST_ID.instructionHandoffEditor) as HTMLTextAreaElement).value,
    ).toBe('Custom handoff')
    fireEvent.click(screen.getByTestId(TEST_ID.instructionHandoffReset))

    expect(onResetHandoff).toHaveBeenCalledTimes(1)
    expect(
      (screen.getByTestId(TEST_ID.instructionHandoffEditor) as HTMLTextAreaElement).value,
    ).toBe(DEFAULT_HANDOFF_INSTRUCTION)
    expect(screen.getByText('Default restored')).toBeTruthy()
  })

  it('shows the unconfigured Resume state and routes to the template editor', async () => {
    const app = makeApp(null)
    const onManageTemplates = vi.fn()
    renderSettings(app, { onManageTemplates })

    expect(
      (await screen.findByTestId(TEST_ID.instructionResumeUnconfigured)).textContent,
    ).toContain('No Resume template selected for Alpha.')
    fireEvent.click(screen.getByTestId(TEST_ID.instructionManageTemplates))
    expect(onManageTemplates).toHaveBeenCalledTimes(1)
  })
})
