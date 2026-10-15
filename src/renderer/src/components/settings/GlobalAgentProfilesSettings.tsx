import type React from 'react'
import { useEffect, useState } from 'react'
import {
  AGENT_COMMAND_HELP,
  parseAgentCommand,
  serializeAgentCommand,
} from '../../../../shared/agent-command'
import type {
  AgentProfile,
  AgentProfilePut,
  AgentProfilesLibrary,
  AgentProfileTemplate,
  AppApi,
} from '../../../../shared/ipc-contract'
import { agentProfileFieldError } from '../../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../../shared/ipc-error'
import { useMutationGuard } from '../../hooks/useMutationGuard'

export function GlobalAgentProfilesSettings({ app }: { app: AppApi }): React.JSX.Element {
  const [library, setLibrary] = useState<AgentProfilesLibrary | null>(null)
  const [templates, setTemplates] = useState<AgentProfileTemplate[]>([])
  const [form, setForm] = useState<AgentProfilePut | null>(null)
  const [templateId, setTemplateId] = useState('custom')
  const [error, setError] = useState<string | null>(null)
  const guard = useMutationGuard()

  useEffect(() => {
    let alive = true
    Promise.all([app.agentProfiles.libraryGet(), app.agentProfiles.templatesGet()])
      .then(([next, presets]) => {
        if (!alive) return
        setLibrary(next)
        setTemplates(presets)
      })
      .catch((cause: unknown) => {
        if (alive)
          setError(parseAppErrorPayload(cause)?.message ?? 'Failed to load the agent library.')
      })
    return () => {
      alive = false
    }
  }, [app])

  function edit(profile: AgentProfile, copy: boolean): void {
    setTemplateId('custom')
    setForm({
      id: copy ? null : profile.id,
      name: profile.name,
      command: serializeAgentCommand(profile),
    })
    setError(null)
  }

  async function save(): Promise<void> {
    if (form === null || guard.inFlight()) return
    try {
      const fields = parseAgentCommand(form.command)
      const message = agentProfileFieldError({ ...fields, name: form.name })
      if (message !== null) throw new Error(message)
    } catch (cause) {
      setError((cause as Error).message)
      return
    }
    await guard.run(async () => {
      setError(null)
      try {
        const next = await app.agentProfiles.put(form)
        setLibrary(next)
        setForm(null)
      } catch (cause) {
        setError(parseAppErrorPayload(cause)?.message ?? 'Failed to save the agent profile.')
      }
    })
  }

  async function remove(id: string): Promise<void> {
    await guard.run(async () => {
      setError(null)
      try {
        setLibrary(await app.agentProfiles.delete(id))
      } catch (cause) {
        setError(parseAppErrorPayload(cause)?.message ?? 'Failed to delete the agent profile.')
      }
    })
  }

  return (
    <div>
      <h3 className="border-b border-edge pb-2 text-sm font-semibold">Agents</h3>
      <p className="mt-3 text-xs text-ink-secondary">
        Configure agents once, then select them in each project's Agents settings. Editing an agent
        affects future launches in every project that selects it.
      </p>
      {error !== null ? (
        <p role="alert" className="mt-3 text-xs text-error">
          {error}
        </p>
      ) : null}
      {library === null ? (
        error === null ? (
          <p className="mt-3 text-xs">Loading agent library...</p>
        ) : null
      ) : (
        <>
          {form === null ? (
            <button
              type="button"
              className="mt-3 h-control rounded-md bg-button px-4 text-sm hover:bg-button-hover"
              onClick={() => {
                setTemplateId('custom')
                setForm({ id: null, name: '', command: '' })
                setError(null)
              }}
            >
              Add agent
            </button>
          ) : (
            <div className="mt-3 space-y-3 text-xs">
              {form.id === null ? (
                <label className="block">
                  Template
                  <select
                    className="mt-1 block w-full rounded-sm bg-highlight p-2"
                    value={templateId}
                    disabled={guard.busy}
                    onChange={(event) => {
                      setTemplateId(event.target.value)
                      const preset = templates.find((entry) => entry.id === event.target.value)
                      setForm(
                        preset
                          ? { id: null, name: preset.name, command: preset.command }
                          : { id: null, name: '', command: '' },
                      )
                      setError(null)
                    }}
                  >
                    <option value="custom">Custom</option>
                    {templates.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block">
                Name
                <input
                  className="mt-1 block w-full rounded-sm bg-highlight p-2"
                  value={form.name}
                  disabled={guard.busy}
                  onChange={(event) => {
                    setForm({ ...form, name: event.target.value })
                    setError(null)
                  }}
                />
              </label>
              <label className="block">
                Command
                <input
                  aria-describedby="agent-command-help"
                  className="mt-1 block w-full rounded-sm bg-highlight p-2 font-mono"
                  value={form.command}
                  disabled={guard.busy}
                  onChange={(event) => {
                    setForm({ ...form, command: event.target.value })
                    setError(null)
                  }}
                />
              </label>
              <p id="agent-command-help" className="text-ink-secondary">
                {AGENT_COMMAND_HELP}
              </p>
              <p className="text-ink-muted">
                Use your CLI's parameters or configuration for a provider or model. Keep API keys in
                your CLI's login or configuration. On Windows, use a native executable or node.exe
                with the CLI script, rather than a .cmd or .ps1 launcher.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={guard.busy}
                  className="h-control rounded-md bg-button px-4 text-sm"
                  onClick={() => void save()}
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={guard.busy}
                  className="h-control rounded-md border border-edge px-4 text-sm"
                  onClick={() => {
                    setForm(null)
                    setError(null)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {library.profiles.length === 0 ? (
            <p className="mt-3 text-xs text-ink-secondary">
              No global agents. Add an agent from a template or a custom command.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {library.profiles.map((profile) => (
                <li key={profile.id} className="rounded-md border border-edge p-3 text-xs">
                  <p className="font-semibold">{profile.name}</p>
                  <code className="mt-1 block break-all text-ink-secondary">
                    {serializeAgentCommand(profile)}
                  </code>
                  {profile.originProjectName ? (
                    <p className="mt-1 text-ink-muted">From {profile.originProjectName}</p>
                  ) : null}
                  <div className="mt-2 flex gap-3">
                    <button
                      type="button"
                      aria-label={`Edit ${profile.name}`}
                      disabled={guard.busy}
                      onClick={() => edit(profile, false)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Copy ${profile.name}`}
                      disabled={guard.busy}
                      onClick={() => edit(profile, true)}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${profile.name}`}
                      disabled={guard.busy || form !== null}
                      onClick={() => void remove(profile.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
