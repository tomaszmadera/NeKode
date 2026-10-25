import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { serializeAgentCommand } from '../../../../shared/agent-command'
import type {
  AgentProfilesLibrary,
  AgentProjectSelectionInput,
  AppApi,
} from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { useMutationGuard } from '../../hooks/useMutationGuard'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'
import {
  FieldRow,
  GroupBox,
  GroupFooter,
  PageIntro,
  primaryClass,
  SectionLabel,
  SettingsGroup,
  SettingsSelect,
  secondaryClass,
} from './settings-ui'

interface AgentProfilesSettingsProps {
  app: AppApi
  projectId: string | null
  onManageAgents?: () => void
  libraryRefreshKey?: number
}

const EMPTY_LIBRARY: AgentProfilesLibrary = { version: 1, profiles: [] }
const EMPTY_SELECTION: AgentProjectSelectionInput = { selectedIds: [], defaultId: null }

export function AgentProfilesSettings({
  app,
  projectId,
  onManageAgents,
  libraryRefreshKey = 0,
}: AgentProfilesSettingsProps): React.JSX.Element {
  const [library, setLibrary] = useState(EMPTY_LIBRARY)
  const [selection, setSelection] = useState<AgentProjectSelectionInput>(EMPTY_SELECTION)
  const [saved, setSaved] = useState<AgentProjectSelectionInput>(EMPTY_SELECTION)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const guard = useMutationGuard()
  const projectRef = useRef(projectId)
  projectRef.current = projectId

  useEffect(() => {
    let alive = true
    guard.reset()
    setError(null)
    setLoading(true)
    setLoadedFor(null)
    if (projectId === null) {
      setLoading(false)
      return
    }
    Promise.all([app.agentProfiles.libraryGet(), app.agentProfiles.selectionGet(projectId)])
      .then(([nextLibrary, nextSelection]) => {
        if (!alive) return
        setLibrary(nextLibrary)
        const draft = { selectedIds: nextSelection.selectedIds, defaultId: nextSelection.defaultId }
        setSelection(draft)
        setSaved(draft)
        setLoadedFor(projectId)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (!alive) return
        setError(parseAppErrorPayload(cause)?.message ?? 'Failed to load agent profiles.')
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [app, projectId, guard.reset])

  useEffect(() => {
    if (libraryRefreshKey === 0) return
    let alive = true
    app.agentProfiles
      .libraryGet()
      .then((next) => {
        if (alive) setLibrary(next)
      })
      .catch((cause: unknown) => {
        if (alive)
          setError(parseAppErrorPayload(cause)?.message ?? 'Failed to refresh the agent library.')
      })
    return () => {
      alive = false
    }
  }, [app, libraryRefreshKey])

  async function save(): Promise<void> {
    if (projectId === null || loadedFor !== projectId) return
    const savedFor = projectId
    await guard.run(
      async () => {
        setError(null)
        try {
          const next = await app.agentProfiles.selectionSet(savedFor, selection)
          if (projectRef.current !== savedFor) return
          const draft = { selectedIds: next.selectedIds, defaultId: next.defaultId }
          setSelection(draft)
          setSaved(draft)
        } catch (cause) {
          if (projectRef.current === savedFor)
            setError(parseAppErrorPayload(cause)?.message ?? 'Failed to save agent selection.')
        }
      },
      () => projectRef.current === savedFor,
    )
  }

  const selectedCount = selection.selectedIds.length
  const totalCount = library.profiles.length

  return (
    <div data-testid={TEST_ID.settingsAgentsPanel} className="flex max-w-[660px] flex-col gap-7">
      <PageIntro
        title="Agents"
        description="Global agents available in this project. None are selected automatically."
      />
      {error !== null ? (
        <p role="alert" data-testid={TEST_ID.settingsAgentsError} className="text-xs text-error">
          {error}
        </p>
      ) : null}
      {projectId === null ? (
        <p className="text-[13px] text-ink-secondary">Select a project to choose agents.</p>
      ) : loading ? (
        <p className="text-[13px] text-ink-secondary">Loading agent profiles...</p>
      ) : loadedFor === projectId ? (
        <SettingsGroup label="Available agents">
          <SectionLabel
            title={`Available · ${selectedCount} of ${totalCount}`}
            action={
              <button
                type="button"
                className={cn(secondaryClass, 'h-8 gap-1.5')}
                onClick={onManageAgents}
              >
                Manage agents
                <Icon.external size={13} aria-hidden />
              </button>
            }
          />
          <GroupBox>
            {library.profiles.length === 0 ? (
              <p
                data-testid={TEST_ID.settingsAgentsEmpty}
                className="px-4 py-3 text-[13px] text-ink-secondary"
              >
                No global agents. Use Manage agents to add one.
              </p>
            ) : (
              library.profiles.map((profile) => {
                const command = serializeAgentCommand(profile)
                const enabled = selection.selectedIds.includes(profile.id)
                return (
                  <label
                    key={profile.id}
                    className="flex cursor-pointer items-center gap-3 border-t border-edge px-4 py-3 first:border-t-0"
                  >
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      aria-label={`Enable ${profile.name}: ${command}`}
                      checked={enabled}
                      disabled={guard.busy}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setSelection((current) => ({
                          selectedIds: checked
                            ? [...current.selectedIds, profile.id]
                            : current.selectedIds.filter((id) => id !== profile.id),
                          defaultId:
                            !checked && current.defaultId === profile.id ? null : current.defaultId,
                        }))
                      }}
                    />
                    <span
                      aria-hidden
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-edge bg-field peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                    >
                      {enabled ? <Icon.checkSmall size={12} className="text-on-accent" /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px] font-semibold text-project-title">
                        {profile.name}
                      </span>
                      <code title={command} className="truncate font-mono text-xs text-ink-muted">
                        {command}
                      </code>
                      {profile.originProjectName ? (
                        <span className="text-xs text-ink-muted">
                          From {profile.originProjectName}
                        </span>
                      ) : null}
                    </span>
                    {selection.defaultId === profile.id ? (
                      <span className="shrink-0 rounded-full bg-highlight px-2 py-px text-[11px] font-medium text-accent">
                        Default
                      </span>
                    ) : null}
                  </label>
                )
              })
            )}
            {library.profiles.length > 0 && selection.selectedIds.length === 0 ? (
              <p
                data-testid={TEST_ID.settingsAgentsEmpty}
                className="border-t border-edge px-4 py-3 text-[13px] text-ink-secondary"
              >
                No agents selected for this project. Select an agent to use it in New Chat or Tasks.
              </p>
            ) : null}
            <FieldRow
              label="Default agent"
              htmlFor="settings-agents-default"
              description="Used for New Chat and Tasks."
              divided
            >
              <SettingsSelect
                id="settings-agents-default"
                value={selection.defaultId ?? ''}
                disabled={guard.busy}
                testId={TEST_ID.settingsAgentsDefault}
                onChange={(value) => setSelection({ ...selection, defaultId: value || null })}
              >
                <option value="">None (choose at launch)</option>
                {library.profiles
                  .filter((profile) => selection.selectedIds.includes(profile.id))
                  .map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
              </SettingsSelect>
            </FieldRow>
            <GroupFooter>
              <button
                type="button"
                disabled={guard.busy}
                onClick={() => {
                  setSelection(saved)
                  setError(null)
                }}
                className={secondaryClass}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={guard.busy}
                onClick={() => void save()}
                className={primaryClass}
              >
                Save
              </button>
            </GroupFooter>
          </GroupBox>
        </SettingsGroup>
      ) : null}
    </div>
  )
}
