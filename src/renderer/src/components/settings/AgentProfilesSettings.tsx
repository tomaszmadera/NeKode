import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { AgentProfile, AgentProfilesDocument, AppApi } from '../../../../shared/ipc-contract'
import { AGENT_PROMPT_PLACEHOLDER, agentProfileFieldError } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { TEST_ID } from '../../lib/test-ids'

// Agents tab of Project Settings (kanban task launch amendment, Profile
// agentów). Profiles are per project. This tab does not spawn a process and
// does not create a chat. Empty name, empty executable, or a `{prompt}` count
// other than one is rejected here and again in main; neither path writes.

interface AgentProfilesSettingsProps {
  app: AppApi
  projectId: string | null
}

interface ArgRow {
  key: string
  value: string
}

interface ProfileForm {
  id: string | null
  name: string
  executable: string
  args: ArgRow[]
  isDefault: boolean
}

const EMPTY_DOCUMENT: AgentProfilesDocument = { defaultId: null, profiles: [] }

function argRows(values: readonly string[], nextKey: () => string): ArgRow[] {
  return values.map((value) => ({ key: nextKey(), value }))
}

export function AgentProfilesSettings({
  app,
  projectId,
}: AgentProfilesSettingsProps): React.JSX.Element {
  const [document, setDocument] = useState<AgentProfilesDocument>(EMPTY_DOCUMENT)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [loading, setLoading] = useState(projectId !== null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<ProfileForm | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const projectRef = useRef(projectId)
  const argKey = useRef(0)
  projectRef.current = projectId

  function nextArgKey(): string {
    argKey.current += 1
    return `arg-${argKey.current}`
  }

  useEffect(() => {
    let alive = true
    busyRef.current = false
    setForm(null)
    setFormError(null)
    setLoadError(null)
    setBusy(false)
    if (projectId === null) {
      setDocument(EMPTY_DOCUMENT)
      setLoadedFor(null)
      setLoading(false)
      return
    }
    setLoading(true)
    app.agentProfiles
      .get(projectId)
      .then((next) => {
        if (!alive) return
        setDocument(next)
        setLoadedFor(projectId)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (!alive) return
        setDocument(EMPTY_DOCUMENT)
        setLoadedFor(projectId)
        setLoading(false)
        setLoadError(parseAppErrorPayload(cause)?.message ?? 'Failed to load agent profiles.')
      })
    return () => {
      alive = false
    }
  }, [app, projectId])

  function releaseBusy(savedFor: string): void {
    if (savedFor !== projectRef.current) return
    busyRef.current = false
    setBusy(false)
  }

  async function save(): Promise<void> {
    if (projectId === null || form === null || busyRef.current) return
    const message = agentProfileFieldError({
      name: form.name,
      executable: form.executable,
      args: form.args.map((row) => row.value),
    })
    if (message !== null) {
      setFormError(message)
      return
    }
    const savedFor = projectId
    busyRef.current = true
    setBusy(true)
    setFormError(null)
    try {
      const next = await app.agentProfiles.put(projectId, {
        id: form.id,
        name: form.name.trim(),
        executable: form.executable.trim(),
        args: form.args.map((row) => row.value),
        isDefault: form.isDefault,
      })
      if (savedFor !== projectRef.current) return
      setDocument(next)
      setLoadedFor(savedFor)
      setForm(null)
    } catch (cause) {
      if (savedFor !== projectRef.current) return
      setFormError(parseAppErrorPayload(cause)?.message ?? 'Failed to save the agent profile.')
    } finally {
      releaseBusy(savedFor)
    }
  }

  async function remove(profileId: string): Promise<void> {
    if (projectId === null || busyRef.current) return
    const savedFor = projectId
    busyRef.current = true
    setBusy(true)
    setFormError(null)
    try {
      const next = await app.agentProfiles.delete(projectId, profileId)
      if (savedFor !== projectRef.current) return
      setDocument(next)
      setLoadedFor(savedFor)
      if (form?.id === profileId) setForm(null)
    } catch (cause) {
      if (savedFor !== projectRef.current) return
      setFormError(parseAppErrorPayload(cause)?.message ?? 'Failed to delete the agent profile.')
    } finally {
      releaseBusy(savedFor)
    }
  }

  function startAdd(): void {
    setForm({
      id: null,
      name: '',
      executable: '',
      args: argRows([AGENT_PROMPT_PLACEHOLDER], nextArgKey),
      isDefault: false,
    })
    setFormError(null)
  }

  function startEdit(profile: AgentProfile): void {
    setForm({
      id: profile.id,
      name: profile.name,
      executable: profile.executable,
      args: argRows(profile.args, nextArgKey),
      isDefault: document.defaultId === profile.id,
    })
    setFormError(null)
  }

  const showDocument = projectId !== null && !loading && loadedFor === projectId

  return (
    <div data-testid={TEST_ID.settingsAgentsPanel}>
      <h3 className="border-b border-edge pb-2 text-sm font-semibold">Agents</h3>
      {projectId === null ? (
        <p className="mt-3 text-xs text-ink-secondary">
          Select a project to configure agent profiles.
        </p>
      ) : !showDocument ? (
        <p className="mt-3 text-xs text-ink-secondary">Loading agent profiles…</p>
      ) : (
        <>
          {loadError ? (
            <p role="alert" className="mt-3 text-xs text-error">
              {loadError}
            </p>
          ) : null}
          {form === null ? (
            <button
              type="button"
              className="mt-3 h-control rounded-md bg-button px-4 text-sm text-ink hover:bg-button-hover"
              onClick={startAdd}
            >
              Add profile
            </button>
          ) : (
            <div className="mt-3 space-y-2 text-xs">
              <label className="block">
                Name
                <input
                  className="mt-1 w-full rounded-sm bg-highlight p-1"
                  value={form.name}
                  onChange={(event) => {
                    setForm({ ...form, name: event.target.value })
                    setFormError(null)
                  }}
                />
              </label>
              <label className="block">
                Executable
                <input
                  className="mt-1 w-full rounded-sm bg-highlight p-1"
                  value={form.executable}
                  onChange={(event) => {
                    setForm({ ...form, executable: event.target.value })
                    setFormError(null)
                  }}
                />
              </label>
              <div>
                <div className="text-ink-secondary">
                  Arguments. Exactly one argument must be the literal {AGENT_PROMPT_PLACEHOLDER}.
                </div>
                {form.args.map((row, index) => (
                  <div key={row.key} className="mt-1 flex gap-2">
                    <label className="min-w-0 flex-1">
                      {`Argument ${index + 1}`}
                      <input
                        className="mt-1 w-full rounded-sm bg-highlight p-1"
                        value={row.value}
                        onChange={(event) => {
                          setForm({
                            ...form,
                            args: form.args.map((candidate) =>
                              candidate.key === row.key
                                ? { ...candidate, value: event.target.value }
                                : candidate,
                            ),
                          })
                          setFormError(null)
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="mt-4 shrink-0 rounded-md px-2 py-1 text-ink-secondary hover:bg-highlight hover:text-ink"
                      aria-label={`Remove argument ${index + 1}`}
                      onClick={() => {
                        setForm({
                          ...form,
                          args: form.args.filter((candidate) => candidate.key !== row.key),
                        })
                        setFormError(null)
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="mt-2 rounded-md px-2 py-1 text-ink-secondary hover:bg-highlight hover:text-ink"
                  onClick={() => {
                    setForm({
                      ...form,
                      args: [...form.args, { key: nextArgKey(), value: '' }],
                    })
                    setFormError(null)
                  }}
                >
                  Add argument
                </button>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  data-testid={TEST_ID.settingsAgentsDefault}
                  onChange={(event) => {
                    setForm({ ...form, isDefault: event.target.checked })
                    setFormError(null)
                  }}
                />
                Default profile
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="h-control rounded-md bg-button px-4 text-ink hover:bg-button-hover disabled:opacity-50"
                  disabled={busy}
                  onClick={() => {
                    void save()
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="h-control rounded-md px-3 text-ink-secondary hover:bg-highlight hover:text-ink"
                  onClick={() => {
                    setForm(null)
                    setFormError(null)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {formError ? (
            <p
              role="alert"
              className="mt-2 text-xs text-error"
              data-testid={TEST_ID.settingsAgentsError}
            >
              {formError}
            </p>
          ) : null}
          {!loadError && document.profiles.length === 0 && form === null ? (
            <p
              className="mt-3 text-xs text-ink-secondary"
              data-testid={TEST_ID.settingsAgentsEmpty}
            >
              No agent profiles for this project.
            </p>
          ) : null}
          <ul className="mt-3 space-y-2">
            {document.profiles.map((profile) => (
              <li
                key={profile.id}
                className="flex items-center gap-2 rounded border border-edge px-2 py-1 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {profile.name}
                    {document.defaultId === profile.id ? (
                      <span
                        className="ml-2 text-ink-secondary"
                        data-testid={TEST_ID.settingsAgentsDefaultBadge}
                      >
                        Default
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-ink-secondary" title={profile.executable}>
                    {profile.executable}
                  </div>
                  <div className="truncate text-ink-muted" title={profile.args.join(' ')}>
                    {profile.args.join(' ')}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-ink-secondary hover:bg-highlight hover:text-ink"
                  aria-label={`Edit ${profile.name}`}
                  onClick={() => startEdit(profile)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-ink-secondary hover:bg-error/10 hover:text-error disabled:opacity-50"
                  aria-label={`Delete ${profile.name}`}
                  disabled={busy}
                  onClick={() => {
                    void remove(profile.id)
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
