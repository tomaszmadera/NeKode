import type { AppApi, ResumeSourceLibrary, ResumeSourceTemplate } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useEffect, useState } from 'react'
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

const errorMessage = (cause: unknown) =>
  parseAppErrorPayload(cause)?.message ?? 'Failed to update Resume template selection.'

export function ProjectResumeSettings({
  app,
  projectId,
  onManageTemplates,
}: ProjectResumeSettingsProps): React.JSX.Element | null {
  const [templates, setTemplates] = useState<ResumeSourceTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (projectId === null || !app.resumeSources) {
      setTemplates([])
      setSelectedTemplateId('')
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

  async function handleSave(): Promise<void> {
    if (projectId === null || !app.resumeSources) return
    setSaving(true)
    setError(null)
    try {
      await app.resumeSources.bind(projectId, selectedTemplateId ? selectedTemplateId : null)
      setSaved(true)
    } catch (cause) {
      setError(errorMessage(cause))
      setSaved(false)
    } finally {
      setSaving(false)
    }
  }

  if (projectId === null) {
    return null
  }

  return (
    <SettingsGroup label="Resume template">
      <SectionLabel title="Resume template" />
      <GroupBox>
        <div data-testid="project-resume-settings">
          <FieldRow
            label="Resume template"
            htmlFor="project-resume-template"
            description="Configures how Resume finds continuation context and formats instructions."
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
                  Manage templates
                </button>
              ) : null}
            </div>
          </FieldRow>
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
  )
}
