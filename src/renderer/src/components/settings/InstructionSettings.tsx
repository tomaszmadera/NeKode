import {
  DEFAULT_CONTINUE_INSTRUCTION,
  DEFAULT_HANDOFF_INSTRUCTION,
  INSTRUCTION_MAX_LENGTH,
} from '@shared/contracts/action-instructions-contract'
import type {
  AppApi,
  ProjectInfo,
  ResumeSourceLibrary,
  ResumeSourceTemplate,
} from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import { useEffect, useState } from 'react'
import { summarizeResumeSource } from '../../lib/resume-source-summary'
import { TEST_ID } from '../../lib/test-ids'
import {
  GroupBox,
  GroupFooter,
  PageIntro,
  primaryClass,
  quietClass,
  SectionLabel,
  SettingsGroup,
  SettingsSelect,
  textClass,
} from './settings-ui'

export interface InstructionSettingsProps {
  app: AppApi
  handoffInstruction: string
  continueInstruction: string
  handoffInstructionError: string | null
  continueInstructionError: string | null
  autoSend: boolean
  onSaveHandoff: (value: string) => string | null
  onResetHandoff: () => void
  onSaveContinue: (value: string) => string | null
  onResetContinue: () => void
  onManageTemplates: () => void
}

const errorMessage = (cause: unknown) =>
  parseAppErrorPayload(cause)?.message ?? 'Instructions could not be loaded. Retry the operation.'

const HANDOFF_PURPOSE =
  'Asks the running agent to record transfer context and stop. In an Agent Harness project the agent updates the task record; without Harness the project convention, such as a progress file, carries the context. NeKode sends only this text and does not claim that a handoff was saved.'

const CONTINUE_PURPOSE =
  'Asks the running agent to continue the current conversation. It does not choose a task or a context file and starts no discovery.'

const RESUME_PURPOSE =
  "Starts from the context selected by the project's Resume template. Edit the wording in Resume templates; it is not editable here."

const PLACEHOLDER_NOTE =
  'No placeholders. The text is sent exactly as written, including line breaks, whitespace, braces and dollar signs.'

type SavedAction = 'handoff' | 'continue'

export function InstructionSettings({
  app,
  handoffInstruction,
  continueInstruction,
  handoffInstructionError,
  continueInstructionError,
  autoSend,
  onSaveHandoff,
  onResetHandoff,
  onSaveContinue,
  onResetContinue,
  onManageTemplates,
}: InstructionSettingsProps): React.JSX.Element {
  const [handoffDraft, setHandoffDraft] = useState(handoffInstruction)
  const [continueDraft, setContinueDraft] = useState(continueInstruction)
  const [handoffValidation, setHandoffValidation] = useState<string | null>(null)
  const [continueValidation, setContinueValidation] = useState<string | null>(null)
  const [status, setStatus] = useState<{ action: SavedAction; kind: 'saved' | 'reset' } | null>(
    null,
  )
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [library, setLibrary] = useState<ResumeSourceLibrary | null>(null)
  const [boundTemplateId, setBoundTemplateId] = useState<string | null>(null)
  const [resumeError, setResumeError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void app.projects
      .list()
      .then((registered) => {
        if (!alive) return
        setProjects(registered)
        setSelectedProjectId((previous) => previous || (registered[0]?.id ?? ''))
      })
      .catch((cause: unknown) => {
        if (alive) setProjectsError(errorMessage(cause))
      })
    return () => {
      alive = false
    }
  }, [app])

  useEffect(() => {
    let alive = true
    if (selectedProjectId === '') {
      setLibrary(null)
      setBoundTemplateId(null)
      setResumeError(null)
      return
    }
    setLibrary(null)
    setBoundTemplateId(null)
    setResumeError(null)
    void Promise.all([app.resumeSources.list(), app.resumeSources.binding(selectedProjectId)])
      .then(([nextLibrary, binding]) => {
        if (!alive) return
        setLibrary(nextLibrary)
        setBoundTemplateId(binding.templateId)
      })
      .catch((cause: unknown) => {
        if (alive) setResumeError(errorMessage(cause))
      })
    return () => {
      alive = false
    }
  }, [app, selectedProjectId])

  // A rejected draft is not what delivery would use, so the preview falls back
  // to the saved effective text until the draft becomes valid again.
  const handoffPreviewDirty = handoffDraft !== handoffInstruction && handoffValidation === null
  const continuePreviewDirty = continueDraft !== continueInstruction && continueValidation === null
  const template: ResumeSourceTemplate | null =
    library?.templates.find((row) => row.id === boundTemplateId) ?? null
  const selectedProject = projects?.find((project) => project.id === selectedProjectId) ?? null
  const affectedProjects =
    projects === null
      ? null
      : projects.length === 0
        ? 'No projects registered.'
        : `Applies to all projects (${projects.length}): ${projects.map((project) => project.name).join(', ')}`

  function saveHandoff(): void {
    const validation = onSaveHandoff(handoffDraft)
    setHandoffValidation(validation)
    if (validation === null) setStatus({ action: 'handoff', kind: 'saved' })
  }

  function saveContinue(): void {
    const validation = onSaveContinue(continueDraft)
    setContinueValidation(validation)
    if (validation === null) setStatus({ action: 'continue', kind: 'saved' })
  }

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <PageIntro
        title="Instructions"
        description="What the action bar sends to the agent. Handoff and Continue are shared by every project; Resume comes from the project's Resume template."
      />
      {projectsError !== null ? (
        <p role="alert" className="text-sm text-danger">
          {projectsError}
        </p>
      ) : null}
      {affectedProjects !== null ? (
        <p
          data-testid={TEST_ID.instructionsAffectedProjects}
          className="text-xs text-ink-secondary"
        >
          {affectedProjects}
        </p>
      ) : null}

      <SettingsGroup label="Handoff">
        <SectionLabel title="Handoff" />
        <GroupBox>
          <div className="flex flex-col gap-2 px-4 py-3">
            <label htmlFor="instruction-handoff" className="text-[13px] font-medium text-ink">
              Handoff instruction
            </label>
            <p className="text-xs text-ink-muted">{HANDOFF_PURPOSE}</p>
            <textarea
              id="instruction-handoff"
              data-testid={TEST_ID.instructionHandoffEditor}
              className={`${textClass} h-28 py-2`}
              value={handoffDraft}
              maxLength={INSTRUCTION_MAX_LENGTH}
              onChange={(event) => {
                setHandoffDraft(event.target.value)
                setHandoffValidation(null)
                setStatus((previous) => (previous?.action === 'handoff' ? null : previous))
              }}
            />
            <p className="text-xs text-ink-muted">{PLACEHOLDER_NOTE}</p>
            <div className="flex flex-col gap-2 rounded-[8px] border border-edge bg-field p-3">
              <p className="text-xs text-ink-muted">
                {handoffPreviewDirty ? 'Preview (not saved)' : 'Sends'}:{' '}
                {autoSend
                  ? 'the text is sent straight to the active chat.'
                  : 'the text is pasted into the active chat console and you press Enter.'}
              </p>
              <p
                data-testid={TEST_ID.instructionHandoffPreview}
                className="whitespace-pre-wrap break-words font-mono text-xs text-ink"
              >
                {handoffPreviewDirty ? handoffDraft : handoffInstruction}
              </p>
            </div>
            {handoffValidation !== null || handoffInstructionError !== null ? (
              <p
                role="alert"
                data-testid={TEST_ID.instructionHandoffError}
                className="text-xs text-danger"
              >
                {handoffValidation ?? handoffInstructionError}
              </p>
            ) : null}
          </div>
          <GroupFooter
            status={
              status?.action === 'handoff' ? (
                <span className="text-success">
                  {status.kind === 'saved' ? 'Saved' : 'Default restored'}
                </span>
              ) : null
            }
          >
            <button
              type="button"
              className={quietClass}
              onClick={() => {
                onResetHandoff()
                setHandoffDraft(DEFAULT_HANDOFF_INSTRUCTION)
                setHandoffValidation(null)
                setStatus({ action: 'handoff', kind: 'reset' })
              }}
              data-testid={TEST_ID.instructionHandoffReset}
            >
              Reset to default
            </button>
            <button
              type="button"
              className={primaryClass}
              onClick={saveHandoff}
              data-testid={TEST_ID.instructionHandoffSave}
            >
              Save instruction
            </button>
          </GroupFooter>
        </GroupBox>
      </SettingsGroup>

      <SettingsGroup label="Continue">
        <SectionLabel title="Continue" />
        <GroupBox>
          <div className="flex flex-col gap-2 px-4 py-3">
            <label htmlFor="instruction-continue" className="text-[13px] font-medium text-ink">
              Continue instruction
            </label>
            <p className="text-xs text-ink-muted">{CONTINUE_PURPOSE}</p>
            <textarea
              id="instruction-continue"
              data-testid={TEST_ID.instructionContinueEditor}
              className={`${textClass} h-28 py-2`}
              value={continueDraft}
              maxLength={INSTRUCTION_MAX_LENGTH}
              onChange={(event) => {
                setContinueDraft(event.target.value)
                setContinueValidation(null)
                setStatus((previous) => (previous?.action === 'continue' ? null : previous))
              }}
            />
            <p className="text-xs text-ink-muted">{PLACEHOLDER_NOTE}</p>
            <div className="flex flex-col gap-2 rounded-[8px] border border-edge bg-field p-3">
              <p className="text-xs text-ink-muted">
                {continuePreviewDirty ? 'Preview (not saved)' : 'Sends'}: the text is written to the
                active chat and submitted with Enter, independently of auto-send.
              </p>
              <p
                data-testid={TEST_ID.instructionContinuePreview}
                className="whitespace-pre-wrap break-words font-mono text-xs text-ink"
              >
                {continuePreviewDirty ? continueDraft : continueInstruction}
              </p>
            </div>
            {continueValidation !== null || continueInstructionError !== null ? (
              <p
                role="alert"
                data-testid={TEST_ID.instructionContinueError}
                className="text-xs text-danger"
              >
                {continueValidation ?? continueInstructionError}
              </p>
            ) : null}
          </div>
          <GroupFooter
            status={
              status?.action === 'continue' ? (
                <span className="text-success">
                  {status.kind === 'saved' ? 'Saved' : 'Default restored'}
                </span>
              ) : null
            }
          >
            <button
              type="button"
              className={quietClass}
              onClick={() => {
                onResetContinue()
                setContinueDraft(DEFAULT_CONTINUE_INSTRUCTION)
                setContinueValidation(null)
                setStatus({ action: 'continue', kind: 'reset' })
              }}
              data-testid={TEST_ID.instructionContinueReset}
            >
              Reset to default
            </button>
            <button
              type="button"
              className={primaryClass}
              onClick={saveContinue}
              data-testid={TEST_ID.instructionContinueSave}
            >
              Save instruction
            </button>
          </GroupFooter>
        </GroupBox>
      </SettingsGroup>

      <SettingsGroup label="Resume">
        <SectionLabel
          title="Resume"
          action={
            <button
              type="button"
              className={quietClass}
              onClick={onManageTemplates}
              data-testid={TEST_ID.instructionManageTemplates}
            >
              Manage Resume templates
            </button>
          }
        />
        <GroupBox>
          <div className="flex flex-col gap-2 px-4 py-3">
            <p className="text-xs text-ink-muted">{RESUME_PURPOSE}</p>
            {projects !== null && projects.length > 0 ? (
              <label htmlFor="instruction-resume-project" className="flex flex-col gap-1 text-sm">
                Project
                <SettingsSelect
                  id="instruction-resume-project"
                  testId={TEST_ID.instructionResumeProject}
                  value={selectedProjectId}
                  onChange={setSelectedProjectId}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </SettingsSelect>
              </label>
            ) : null}
            {selectedProject !== null && template !== null ? (
              <div className="flex flex-col gap-1">
                <p className="text-[13px] font-medium text-ink">Template: {template.name}</p>
                <p className="text-xs text-ink-muted">{summarizeResumeSource(template.source)}</p>
                <p
                  data-testid={TEST_ID.instructionResumePrompt}
                  className="whitespace-pre-wrap break-words rounded-[8px] border border-edge bg-field p-3 font-mono text-xs text-ink"
                >
                  {template.prompt}
                </p>
              </div>
            ) : null}
            {selectedProject !== null && library !== null && template === null ? (
              <p
                data-testid={TEST_ID.instructionResumeUnconfigured}
                className="text-[13px] text-ink-muted"
              >
                No Resume template selected for {selectedProject.name}. Configure it in Project
                Settings.
              </p>
            ) : null}
            {selectedProject === null && projects !== null && projects.length === 0 ? (
              <p className="text-[13px] text-ink-muted">
                Add a project before selecting a Resume template.
              </p>
            ) : null}
            {resumeError !== null ? (
              <p
                role="alert"
                data-testid={TEST_ID.instructionResumeError}
                className="text-xs text-danger"
              >
                {resumeError}
              </p>
            ) : null}
            <p className="text-xs text-ink-muted">
              {'{taskPath}'} is replaced with the selected context path. {'{handoffPath}'} is a
              deprecated alias. The template must contain one of them.
            </p>
          </div>
        </GroupBox>
      </SettingsGroup>

      <SettingsGroup label="Stop">
        <SectionLabel title="Stop" />
        <GroupBox>
          <p
            data-testid={TEST_ID.instructionStopNote}
            className="px-4 py-3 text-[13px] text-ink-muted"
          >
            Stop sends Ctrl+C to the active chat. It is not configurable, creates no task record or
            handoff and does not close a card.
          </p>
        </GroupBox>
      </SettingsGroup>

      <p className="text-xs text-ink-muted">
        A saved change applies only to the action you saved. Editing a Resume template changes it
        for every project that uses that template; the template editor lists those projects.
      </p>
    </div>
  )
}
