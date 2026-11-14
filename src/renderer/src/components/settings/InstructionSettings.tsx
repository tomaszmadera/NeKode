import {
  DEFAULT_CONTINUE_INSTRUCTION,
  DEFAULT_HANDOFF_INSTRUCTION,
  DEFAULT_RESUME_INSTRUCTION,
  DEFAULT_START_INSTRUCTION,
  INSTRUCTION_MAX_LENGTH,
  type ResumeMigrationNotice,
} from '@shared/contracts/action-instructions-contract'
import type { AppApi, ProjectInfo } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import { type ReactNode, useEffect, useState } from 'react'
import { TEST_ID } from '../../lib/test-ids'
import {
  GroupBox,
  GroupFooter,
  PageIntro,
  primaryClass,
  quietClass,
  SectionLabel,
  SettingsGroup,
  secondaryClass,
  textClass,
} from './settings-ui'

export interface InstructionSettingsProps {
  app: AppApi
  handoffInstruction: string
  continueInstruction: string
  startInstruction: string
  resumeInstruction: string
  handoffInstructionError: string | null
  continueInstructionError: string | null
  startInstructionError: string | null
  resumeInstructionError: string | null
  resumeMigrationNotice: ResumeMigrationNotice | null
  autoSend: boolean
  onSaveHandoff: (value: string) => string | null
  onResetHandoff: () => void
  onSaveContinue: (value: string) => string | null
  onResetContinue: () => void
  onSaveStart: (value: string) => string | null
  onResetStart: () => void
  onSaveResume: (value: string) => string | null
  onResetResume: () => void
  onDismissResumeMigration: () => void
  onManageTemplates: () => void
}

const errorMessage = (cause: unknown) =>
  parseAppErrorPayload(cause)?.message ?? 'Instructions could not be loaded. Retry the operation.'

const START_PURPOSE =
  "Sent when you start a card from a Kanban board. It is passed to the agent when its process starts; the project's instructions decide what starting a task means."

const RESUME_PURPOSE =
  "Sent when you resume from the context that the project's Resume source finds, from the action bar or a Kanban card."

const HANDOFF_PURPOSE =
  'Asks the running agent to record transfer context and stop. In an Agent Harness project the agent updates the task record; without Harness the project convention, such as a progress file, carries the context. NeKode sends only this text and does not claim that a handoff was saved.'

const CONTINUE_PURPOSE =
  'Asks the running agent to continue the current conversation. It does not choose a task or a context file and starts no discovery.'

const PLACEHOLDER_NOTE =
  'No placeholders. The text is sent exactly as written, including line breaks, whitespace, braces and dollar signs.'

const START_PLACEHOLDER_NOTE =
  '{ref} (required) is the full card ref, {title} the title, {description} the description or "This task has no description.", {url} the card URL or nothing. A paragraph left empty by a placeholder is removed. Other text is sent exactly as written.'

const RESUME_PLACEHOLDER_NOTE =
  '{taskPath} (required) is replaced with the selected context path; {handoffPath} is a deprecated alias. Other text is sent exactly as written.'

type ActionId = 'start' | 'resume' | 'handoff' | 'continue'

interface InstructionTestIds {
  editor: string
  save: string
  reset: string
  preview: string
  error: string
}

interface InstructionEditorProps {
  action: ActionId
  title: string
  purpose: string
  value: string
  defaultValue: string
  storedError: string | null
  placeholderNote: string
  sendNote: string
  testIds: InstructionTestIds
  onSave: (value: string) => string | null
  onReset: () => void
  /** Text that replaces the draft from outside, for example a legacy import. */
  externalDraft?: { value: string; nonce: number } | null
  headerAction?: ReactNode
  children?: ReactNode
}

function InstructionEditor({
  action,
  title,
  purpose,
  value,
  defaultValue,
  storedError,
  placeholderNote,
  sendNote,
  testIds,
  onSave,
  onReset,
  externalDraft,
  headerAction,
  children,
}: InstructionEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [validation, setValidation] = useState<string | null>(null)
  const [status, setStatus] = useState<'saved' | 'reset' | null>(null)
  const editorId = `instruction-${action}`

  useEffect(() => {
    if (externalDraft == null) return
    setDraft(externalDraft.value)
    setValidation(null)
    setStatus(null)
  }, [externalDraft])

  // A rejected draft is not what delivery would use, so the preview falls back
  // to the saved effective text until the draft becomes valid again.
  const previewDirty = draft !== value && validation === null

  return (
    <SettingsGroup label={title}>
      <SectionLabel title={title} action={headerAction} />
      <GroupBox>
        <div className="flex flex-col gap-2 px-4 py-3">
          <label htmlFor={editorId} className="text-[13px] font-medium text-ink">
            {title} instruction
          </label>
          <p className="text-xs text-ink-muted">{purpose}</p>
          <textarea
            id={editorId}
            data-testid={testIds.editor}
            className={`${textClass} h-28 py-2`}
            value={draft}
            maxLength={INSTRUCTION_MAX_LENGTH}
            onChange={(event) => {
              setDraft(event.target.value)
              setValidation(null)
              setStatus(null)
            }}
          />
          <p className="text-xs text-ink-muted">{placeholderNote}</p>
          <div className="flex flex-col gap-2 rounded-[8px] border border-edge bg-field p-3">
            <p className="text-xs text-ink-muted">
              {previewDirty ? 'Preview (not saved)' : 'Sends'}: {sendNote}
            </p>
            <p
              data-testid={testIds.preview}
              className="whitespace-pre-wrap break-words font-mono text-xs text-ink"
            >
              {previewDirty ? draft : value}
            </p>
          </div>
          {validation !== null || storedError !== null ? (
            <p role="alert" data-testid={testIds.error} className="text-xs text-danger">
              {validation ?? storedError}
            </p>
          ) : null}
          {children}
        </div>
        <GroupFooter
          status={
            status !== null ? (
              <span className="text-success">
                {status === 'saved' ? 'Saved' : 'Default restored'}
              </span>
            ) : null
          }
        >
          <button
            type="button"
            className={quietClass}
            onClick={() => {
              onReset()
              setDraft(defaultValue)
              setValidation(null)
              setStatus('reset')
            }}
            data-testid={testIds.reset}
          >
            Reset to default
          </button>
          <button
            type="button"
            className={primaryClass}
            onClick={() => {
              const result = onSave(draft)
              setValidation(result)
              setStatus(result === null ? 'saved' : null)
            }}
            data-testid={testIds.save}
          >
            Save instruction
          </button>
        </GroupFooter>
      </GroupBox>
    </SettingsGroup>
  )
}

export function InstructionSettings({
  app,
  handoffInstruction,
  continueInstruction,
  startInstruction,
  resumeInstruction,
  handoffInstructionError,
  continueInstructionError,
  startInstructionError,
  resumeInstructionError,
  resumeMigrationNotice,
  autoSend,
  onSaveHandoff,
  onResetHandoff,
  onSaveContinue,
  onResetContinue,
  onSaveStart,
  onResetStart,
  onSaveResume,
  onResetResume,
  onDismissResumeMigration,
  onManageTemplates,
}: InstructionSettingsProps): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [kanbanUsed, setKanbanUsed] = useState<boolean | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [imported, setImported] = useState<{ value: string; nonce: number } | null>(null)

  useEffect(() => {
    let alive = true
    void app.projects
      .list()
      .then((registered) => {
        if (!alive) return
        setProjects(registered)
        // The Kanban note is advisory: an unreadable binding leaves it hidden
        // and Project Settings reports that binding's error.
        void Promise.all(registered.map((project) => app.kanban.getConfig(project.id)))
          .then((configs) => {
            if (alive) setKanbanUsed(configs.some((config) => config.adapterId !== null))
          })
          .catch(() => undefined)
      })
      .catch((cause: unknown) => {
        if (alive) setProjectsError(errorMessage(cause))
      })
    return () => {
      alive = false
    }
  }, [app])

  const affectedProjects =
    projects === null
      ? null
      : projects.length === 0
        ? 'No projects registered.'
        : `Applies to all projects (${projects.length}): ${projects.map((project) => project.name).join(', ')}`

  const pasteNote = autoSend
    ? 'the text is sent straight to the active chat.'
    : 'the text is pasted into the active chat console and you press Enter.'

  async function importLegacy(): Promise<void> {
    setImportError(null)
    try {
      const value = await app.resumeSources.importLegacy()
      if (value === null) {
        setImportError('No legacy Resume template was found in settings.json.')
        return
      }
      setImported((previous) => ({ value, nonce: (previous?.nonce ?? 0) + 1 }))
    } catch (cause) {
      setImportError(errorMessage(cause))
    }
  }

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <PageIntro
        title="Instructions"
        description="What NeKode sends to the agent. Every instruction is shared by all projects; a project only selects where Resume finds its context."
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

      <InstructionEditor
        action="start"
        title="Start"
        purpose={START_PURPOSE}
        value={startInstruction}
        defaultValue={DEFAULT_START_INSTRUCTION}
        storedError={startInstructionError}
        placeholderNote={START_PLACEHOLDER_NOTE}
        sendNote="the formatted text starts the chosen agent, independently of auto-send."
        testIds={{
          editor: TEST_ID.instructionStartEditor,
          save: TEST_ID.instructionStartSave,
          reset: TEST_ID.instructionStartReset,
          preview: TEST_ID.instructionStartPreview,
          error: TEST_ID.instructionStartError,
        }}
        onSave={onSaveStart}
        onReset={onResetStart}
      >
        {kanbanUsed === false ? (
          <p data-testid={TEST_ID.instructionStartKanbanNote} className="text-xs text-ink-muted">
            No project uses a Kanban board yet.
          </p>
        ) : null}
      </InstructionEditor>

      <InstructionEditor
        action="resume"
        title="Resume"
        purpose={RESUME_PURPOSE}
        value={resumeInstruction}
        defaultValue={DEFAULT_RESUME_INSTRUCTION}
        storedError={resumeInstructionError}
        placeholderNote={RESUME_PLACEHOLDER_NOTE}
        sendNote={pasteNote}
        testIds={{
          editor: TEST_ID.instructionResumeEditor,
          save: TEST_ID.instructionResumeSave,
          reset: TEST_ID.instructionResumeReset,
          preview: TEST_ID.instructionResumePreview,
          error: TEST_ID.instructionResumeError,
        }}
        onSave={onSaveResume}
        onReset={onResetResume}
        externalDraft={imported}
        headerAction={
          <button
            type="button"
            className={quietClass}
            onClick={onManageTemplates}
            data-testid={TEST_ID.instructionManageTemplates}
          >
            Manage Resume sources
          </button>
        }
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`${secondaryClass} h-auto px-2.5 py-1 text-xs`}
            onClick={() => void importLegacy()}
            data-testid={TEST_ID.instructionResumeImport}
          >
            Import legacy template
          </button>
          <span className="text-xs text-ink-muted">
            Fills the editor from settings.json; Save stores it.
          </span>
        </div>
        {importError !== null ? (
          <p role="alert" className="text-xs text-danger">
            {importError}
          </p>
        ) : null}
        {resumeMigrationNotice !== null ? (
          <div
            data-testid={TEST_ID.instructionResumeMigration}
            className="flex flex-col gap-2 rounded-[8px] border border-edge p-3"
          >
            <p className="text-xs text-ink">
              Your Resume templates used different instructions, so the default is used now. Copy
              the one you want into the editor above and save it.
            </p>
            {resumeMigrationNotice.prompts.map((row) => (
              <div key={row.prompt} className="flex flex-col gap-1">
                <p className="text-xs text-ink-muted">{row.templates.join(', ')}</p>
                <p className="whitespace-pre-wrap break-words rounded-[8px] bg-field p-2 font-mono text-xs text-ink">
                  {row.prompt}
                </p>
                <button
                  type="button"
                  className={`${quietClass} self-start`}
                  onClick={() => void navigator.clipboard?.writeText(row.prompt)}
                >
                  Copy
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={secondaryClass}
                onClick={onDismissResumeMigration}
                data-testid={TEST_ID.instructionResumeMigrationDismiss}
              >
                Dismiss
              </button>
              <span className="text-xs text-ink-muted">
                Dismiss removes this list for good; copy what you need first.
              </span>
            </div>
          </div>
        ) : null}
      </InstructionEditor>

      <InstructionEditor
        action="handoff"
        title="Handoff"
        purpose={HANDOFF_PURPOSE}
        value={handoffInstruction}
        defaultValue={DEFAULT_HANDOFF_INSTRUCTION}
        storedError={handoffInstructionError}
        placeholderNote={PLACEHOLDER_NOTE}
        sendNote={pasteNote}
        testIds={{
          editor: TEST_ID.instructionHandoffEditor,
          save: TEST_ID.instructionHandoffSave,
          reset: TEST_ID.instructionHandoffReset,
          preview: TEST_ID.instructionHandoffPreview,
          error: TEST_ID.instructionHandoffError,
        }}
        onSave={onSaveHandoff}
        onReset={onResetHandoff}
      />

      <InstructionEditor
        action="continue"
        title="Continue"
        purpose={CONTINUE_PURPOSE}
        value={continueInstruction}
        defaultValue={DEFAULT_CONTINUE_INSTRUCTION}
        storedError={continueInstructionError}
        placeholderNote={PLACEHOLDER_NOTE}
        sendNote="the text is written to the active chat and submitted with Enter, independently of auto-send."
        testIds={{
          editor: TEST_ID.instructionContinueEditor,
          save: TEST_ID.instructionContinueSave,
          reset: TEST_ID.instructionContinueReset,
          preview: TEST_ID.instructionContinuePreview,
          error: TEST_ID.instructionContinueError,
        }}
        onSave={onSaveContinue}
        onReset={onResetContinue}
      />

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
        A saved change applies only to the action you saved, in every project.
      </p>
    </div>
  )
}
