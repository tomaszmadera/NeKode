import type {
  AgentSkillPreview,
  AppApi,
  ResumeSourceLibrary,
  ResumeSourceTemplate,
  WorkRecordSkillPreview,
} from '@shared/ipc-contract'
import { WORK_RECORD_SKILL_FILE_PATH } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { summarizeResumeSource } from '../../lib/resume-source-summary'
import { TEST_ID } from '../../lib/test-ids'
import { AgentSkillTeachDialog, type AgentSkillTeachTestIds } from './AgentSkillTeachDialog'
import {
  FieldRow,
  GroupBox,
  GroupFooter,
  primaryClass,
  SectionLabel,
  SettingsGroup,
  SettingsSelect,
  secondaryClass,
} from './settings-ui'

export interface ProjectResumeSettingsProps {
  app: AppApi
  projectId: string | null
  onManageTemplates?: () => void
}

/** Open `Teach agents` dialog: the preview, the selected profile names, and a reload notice. */
interface TeachDialogState {
  /** Null after a failed reload: nothing is shown as writable and Confirm is off. */
  preview: WorkRecordSkillPreview | null
  profiles: { id: string; name: string }[]
  notice: string | null
}

const TEACH_STALE_NOTICE = 'The skill file or its source changed. Review the new preview.'

function workRecordOriginLabel(preview: AgentSkillPreview): string {
  switch (preview.origin) {
    case 'local-file':
      return 'Local file instructions'
    case 'adapter':
      return `Instructions from the ${preview.sourceName} adapter`
    case 'default':
      return `NeKode default instructions for ${preview.sourceName}`
    case 'local-progress':
      return 'Local work record instructions'
    case 'agent-harness':
      return 'Agent Harness instructions'
    case 'file-source':
      return `Instructions for the ${preview.sourceName} file source`
    case 'command-source':
      return `Instructions for the ${preview.sourceName} command source`
  }
}

const WORK_RECORD_TEACH_TEST_IDS: AgentSkillTeachTestIds = {
  file: TEST_ID.settingsWorkRecordTeachFile,
  replace: TEST_ID.settingsWorkRecordTeachReplace,
  new: TEST_ID.settingsWorkRecordTeachNew,
  origin: TEST_ID.settingsWorkRecordTeachOrigin,
  text: TEST_ID.settingsWorkRecordTeachText,
  diff: TEST_ID.settingsWorkRecordTeachDiff,
  noChanges: TEST_ID.settingsWorkRecordTeachNoChanges,
  currentHidden: TEST_ID.settingsWorkRecordTeachCurrentHidden,
  notice: TEST_ID.settingsWorkRecordTeachNotice,
  boundary: TEST_ID.settingsWorkRecordTeachBoundary,
  profiles: TEST_ID.settingsWorkRecordTeachProfiles,
  noProfiles: TEST_ID.settingsWorkRecordTeachNoProfiles,
  error: TEST_ID.settingsWorkRecordTeachError,
}

const errorMessage = (cause: unknown) =>
  parseAppErrorPayload(cause)?.message ?? 'Failed to update work record source selection.'

export function ProjectResumeSettings({
  app,
  projectId,
  onManageTemplates,
}: ProjectResumeSettingsProps): React.JSX.Element | null {
  const [templates, setTemplates] = useState<ResumeSourceTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  /** The saved binding, not the draft select value: `Teach agents` follows it. */
  const [boundTemplateId, setBoundTemplateId] = useState<string>('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teachDialog, setTeachDialog] = useState<TeachDialogState | null>(null)
  const [teachError, setTeachError] = useState<string | null>(null)
  const [teachWriting, setTeachWriting] = useState(false)
  const [teachDone, setTeachDone] = useState(false)
  const teachOpen = useRef(false)
  teachOpen.current = teachDialog !== null
  // The opener is disabled while the binding loads, so the dialog cannot rely
  // on the element focused at its mount; focus returns here on close.
  const teachButtonRef = useRef<HTMLButtonElement>(null)
  const teachWasOpen = useRef(false)

  useEffect(() => {
    if (teachDialog !== null) {
      teachWasOpen.current = true
      return
    }
    if (!teachWasOpen.current) return
    teachWasOpen.current = false
    // Runs after the dialog's unmount cleanup, so this focus wins.
    teachButtonRef.current?.focus()
  }, [teachDialog])

  useEffect(() => {
    let alive = true
    if (projectId === null || !app.resumeSources) {
      setTemplates([])
      setSelectedTemplateId('')
      setBoundTemplateId('')
      setSaved(false)
      return
    }

    async function load(): Promise<void> {
      try {
        const [library, binding] = await Promise.all([
          app.resumeSources.list(),
          app.resumeSources.binding(projectId as string),
        ])
        if (!alive) return
        setTemplates(library.templates)
        setSelectedTemplateId(binding.templateId ?? '')
        setBoundTemplateId(binding.templateId ?? '')
        setSaved(false)
      } catch (cause) {
        if (!alive) return
        setError(errorMessage(cause))
      }
    }

    void load()

    const unsubscribe = app.resumeSources.onChanged?.(() => {
      void app.resumeSources
        .list()
        .then((next: ResumeSourceLibrary) => {
          if (alive) setTemplates(next.templates)
        })
        .catch(() => undefined)
    })

    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [app, projectId])

  const reloadTeachPreview = useCallback(
    async (notice: string | null): Promise<void> => {
      if (projectId === null) return
      try {
        const preview = await app.resumeSources.skillPreview(projectId)
        setTeachError(null)
        setTeachDialog((current) => (current === null ? null : { ...current, preview, notice }))
      } catch (cause) {
        // The shown preview is stale and no new one exists: drop it so the
        // dialog shows only the error and Confirm cannot run.
        setTeachDialog((current) =>
          current === null ? null : { ...current, preview: null, notice },
        )
        setTeachError(
          parseAppErrorPayload(cause)?.message ?? 'Could not prepare the agent skill file.',
        )
      }
    },
    [app, projectId],
  )

  // Saving another source or clearing the binding while the dialog is open
  // reloads the preview, or closes the dialog when no source remains.
  const lastTeachBinding = useRef(boundTemplateId)
  useEffect(() => {
    if (lastTeachBinding.current === boundTemplateId) return
    lastTeachBinding.current = boundTemplateId
    if (!teachOpen.current) return
    if (boundTemplateId === '') {
      setTeachDialog(null)
      setTeachError(null)
      return
    }
    void reloadTeachPreview(TEACH_STALE_NOTICE)
  }, [boundTemplateId, reloadTeachPreview])

  async function handleSave(): Promise<void> {
    if (projectId === null || !app.resumeSources) return
    setSaving(true)
    setError(null)
    try {
      await app.resumeSources.bind(projectId, selectedTemplateId ? selectedTemplateId : null)
      setBoundTemplateId(selectedTemplateId)
      setSaved(true)
      setTeachDone(false)
    } catch (cause) {
      setError(errorMessage(cause))
      setSaved(false)
    } finally {
      setSaving(false)
    }
  }

  /**
   * `Teach agents` (separation spec): loads the preview and the project's
   * selected profiles, then opens the confirm dialog. Nothing is written until
   * Confirm.
   */
  async function openTeachAgents(): Promise<void> {
    if (projectId === null || boundTemplateId === '') return
    setTeachError(null)
    setTeachDone(false)
    setError(null)
    try {
      const [preview, document] = await Promise.all([
        app.resumeSources.skillPreview(projectId),
        app.agentProfiles.get(projectId),
      ])
      setTeachDialog({
        preview,
        profiles: document.profiles.map((profile) => ({ id: profile.id, name: profile.name })),
        notice: null,
      })
    } catch (cause) {
      setTeachDialog(null)
      setError(parseAppErrorPayload(cause)?.message ?? 'Could not prepare the agent skill file.')
    }
  }

  /**
   * Confirm: one write of the previewed text. A stale preview (`conflict`)
   * writes nothing and loads a new preview that needs its own confirm.
   */
  async function confirmTeachAgents(): Promise<void> {
    if (projectId === null || teachDialog?.preview == null || teachWriting) return
    const { path, token } = teachDialog.preview
    setTeachWriting(true)
    setTeachError(null)
    try {
      await app.resumeSources.writeSkill(projectId, token)
      setTeachDialog(null)
      setTeachDone(true)
    } catch (cause) {
      const appError = parseAppErrorPayload(cause)
      if (appError?.code === 'conflict') {
        await reloadTeachPreview(TEACH_STALE_NOTICE)
      } else {
        setTeachError(appError?.message ?? `Could not write ${path}.`)
      }
    } finally {
      setTeachWriting(false)
    }
  }

  if (projectId === null) {
    return null
  }

  const selected = templates.find((template) => template.id === selectedTemplateId)

  return (
    <>
      <SettingsGroup label="Work record">
        <SectionLabel title="Work record" />
        <GroupBox>
          <div data-testid="project-resume-settings">
            <FieldRow
              label="Work record source"
              htmlFor="project-resume-template"
              description="Configures where Resume finds the record of work on a work item. The Resume instruction is set in Application settings, Instructions."
            >
              <div className="flex items-center gap-2">
                <SettingsSelect
                  id="project-resume-template"
                  value={selectedTemplateId}
                  onChange={(value) => {
                    setSelectedTemplateId(value)
                    setSaved(false)
                  }}
                >
                  <option value="">None (Unconfigured)</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </SettingsSelect>
                {onManageTemplates ? (
                  <button type="button" className={secondaryClass} onClick={onManageTemplates}>
                    Manage sources
                  </button>
                ) : null}
              </div>
            </FieldRow>
            {selected ? (
              <div
                className="border-t border-edge px-4 py-2 text-xs text-ink-secondary"
                data-testid="project-resume-source-summary"
              >
                <p className="font-mono">{summarizeResumeSource(selected.source)}</p>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="border-t border-edge px-4 py-2 text-xs text-error">
                {error}
              </p>
            ) : null}
            <GroupFooter
              status={
                saved ? (
                  <span className="text-success" data-testid="project-resume-saved">
                    Saved
                  </span>
                ) : null
              }
            >
              <button
                type="button"
                disabled={saving}
                className={primaryClass}
                onClick={() => void handleSave()}
              >
                Save
              </button>
            </GroupFooter>
          </div>
        </GroupBox>
      </SettingsGroup>
      {boundTemplateId !== '' ? (
        <SettingsGroup label="Agents">
          <SectionLabel title="Agents" />
          <GroupBox>
            <div className="flex items-center gap-6 px-4 py-3">
              <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">
                Teach agents how to keep this project's work record
              </span>
              <button
                ref={teachButtonRef}
                type="button"
                disabled={teachWriting}
                className={secondaryClass}
                data-testid={TEST_ID.settingsWorkRecordTeachAgents}
                onClick={() => {
                  void openTeachAgents()
                }}
              >
                Teach agents
              </button>
            </div>
            {teachDone ? (
              <p
                className="border-t border-edge px-4 py-2 text-xs text-success"
                data-testid={TEST_ID.settingsWorkRecordTeachDone}
              >
                Wrote {WORK_RECORD_SKILL_FILE_PATH}.
              </p>
            ) : null}
          </GroupBox>
        </SettingsGroup>
      ) : null}
      <AgentSkillTeachDialog
        open={teachDialog !== null}
        body="NeKode writes one agent skill file that tells agents how to keep this project's work record. It contains no work items, existing records, or source settings."
        preview={teachDialog?.preview ?? null}
        profiles={teachDialog?.profiles ?? []}
        notice={teachDialog?.notice ?? null}
        error={teachError}
        writing={teachWriting}
        originLabel={workRecordOriginLabel}
        testIds={WORK_RECORD_TEACH_TEST_IDS}
        onConfirm={() => {
          void confirmTeachAgents()
        }}
        onCancel={() => {
          setTeachDialog(null)
          setTeachError(null)
        }}
      />
    </>
  )
}
