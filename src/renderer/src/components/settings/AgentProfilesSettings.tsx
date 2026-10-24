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
import { TEST_ID } from '../../lib/test-ids'

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

  return (
    <div data-testid={TEST_ID.settingsAgentsPanel}>
      <h3 className="border-b border-edge pb-2 text-sm font-semibold">Agents</h3>
      <p className="mt-3 text-xs text-ink-secondary">
        Choose the global agents available in this project. No agents are selected automatically.
      </p>
      <button
        type="button"
        className="mt-3 h-control rounded-md bg-button px-4 text-sm hover:bg-button-hover"
        onClick={onManageAgents}
      >
        Manage agents
      </button>
      {error !== null ? (
        <p
          role="alert"
          data-testid={TEST_ID.settingsAgentsError}
          className="mt-3 text-xs text-error"
        >
          {error}
        </p>
      ) : null}
      {projectId === null ? (
        <p className="mt-3 text-xs text-ink-secondary">Select a project to choose agents.</p>
      ) : loading ? (
        <p className="mt-3 text-xs text-ink-secondary">Loading agent profiles...</p>
      ) : loadedFor === projectId ? (
        <>
          {library.profiles.length === 0 ? (
            <p
              data-testid={TEST_ID.settingsAgentsEmpty}
              className="mt-3 text-xs text-ink-secondary"
            >
              No global agents. Use Manage agents to add one.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {library.profiles.map((profile) => (
                <label key={profile.id} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    aria-label={`Enable ${profile.name}: ${serializeAgentCommand(profile)}`}
                    checked={selection.selectedIds.includes(profile.id)}
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
                  <span className="min-w-0">
                    <span className="font-semibold">{profile.name}</span>
                    <code className="mt-1 block break-all text-ink-secondary">
                      {serializeAgentCommand(profile)}
                    </code>
                    {profile.originProjectName ? (
                      <span className="text-ink-muted">From {profile.originProjectName}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          )}
          {library.profiles.length > 0 && selection.selectedIds.length === 0 ? (
            <p
              data-testid={TEST_ID.settingsAgentsEmpty}
              className="mt-3 text-xs text-ink-secondary"
            >
              No agents selected for this project. Select an agent to use it in New Chat or Tasks.
            </p>
          ) : null}
          <label className="mt-4 block text-xs">
            Default agent
            <select
              data-testid={TEST_ID.settingsAgentsDefault}
              className="mt-1 block w-full rounded-sm bg-highlight p-2"
              value={selection.defaultId ?? ''}
              disabled={guard.busy}
              onChange={(event) =>
                setSelection({ ...selection, defaultId: event.target.value || null })
              }
            >
              <option value="">None (choose at launch)</option>
              {library.profiles
                .filter((profile) => selection.selectedIds.includes(profile.id))
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} - {serializeAgentCommand(profile)}
                  </option>
                ))}
            </select>
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={guard.busy}
              onClick={() => void save()}
              className="h-control rounded-md bg-button px-4 text-sm hover:bg-button-hover"
            >
              Save
            </button>
            <button
              type="button"
              disabled={guard.busy}
              onClick={() => {
                setSelection(saved)
                setError(null)
              }}
              className="h-control rounded-md border border-edge px-4 text-sm"
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
