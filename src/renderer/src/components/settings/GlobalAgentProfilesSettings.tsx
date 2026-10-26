import {
  AGENT_COMMAND_HELP,
  parseAgentArguments,
  parseAgentCommand,
  serializeAgentArguments,
  serializeAgentCommand,
} from '@shared/agent-command'
import type {
  AgentProfile,
  AgentProfilePut,
  AgentProfilesLibrary,
  AgentProfileTemplate,
  AppApi,
} from '@shared/ipc-contract'
import { agentProfileFieldError } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useMutationGuard } from '../../hooks/useMutationGuard'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
import {
  FieldRow,
  GroupBox,
  GroupFooter,
  monoClass,
  PageIntro,
  primaryClass,
  quietClass,
  SectionLabel,
  SettingsGroup,
  SettingsSelect,
  SettingsSwitch,
  StackedRow,
  secondaryClass,
  textClass,
} from './settings-ui'

type ProfileForm = Omit<AgentProfilePut, 'interactiveArgs'> & { interactiveArguments?: string }

export function GlobalAgentProfilesSettings({ app }: { app: AppApi }): React.JSX.Element {
  const [library, setLibrary] = useState<AgentProfilesLibrary | null>(null)
  const [templates, setTemplates] = useState<AgentProfileTemplate[]>([])
  const [form, setForm] = useState<ProfileForm | null>(null)
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
      ...(profile.interactiveArgs === undefined
        ? {}
        : { interactiveArguments: serializeAgentArguments(profile.interactiveArgs) }),
    })
    setError(null)
  }

  async function save(): Promise<void> {
    if (form === null || guard.inFlight()) return
    let input: AgentProfilePut
    try {
      input = {
        id: form.id,
        name: form.name,
        command: form.command,
        ...(form.interactiveArguments === undefined
          ? {}
          : { interactiveArgs: parseAgentArguments(form.interactiveArguments) }),
      }
      const fields = parseAgentCommand(form.command)
      const message = agentProfileFieldError({
        ...fields,
        name: form.name,
        interactiveArgs: input.interactiveArgs,
      })
      if (message !== null) throw new Error(message)
    } catch (cause) {
      setError((cause as Error).message)
      return
    }
    await guard.run(async () => {
      setError(null)
      try {
        const next = await app.agentProfiles.put(input)
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

  const overrideOn = form?.interactiveArguments !== undefined
  return (
    <div className="flex max-w-[660px] flex-col gap-7">
      <PageIntro
        title="Agents"
        description="Configure agents once, then pick them in each project's Agents settings. Editing an agent affects future launches in every project that uses it."
      />
      {error !== null ? (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      ) : null}
      {library === null ? (
        error === null ? (
          <p className="text-xs text-ink-muted">Loading agent library...</p>
        ) : null
      ) : form !== null ? (
        <SettingsGroup label={form.id === null ? 'New agent' : `Edit ${form.name}`}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Back to agents"
              className={quietClass}
              disabled={guard.busy}
              onClick={() => {
                setForm(null)
                setError(null)
              }}
            >
              <Icon.back size={14} aria-hidden />
              {form.id === null ? 'New agent' : `Edit ${form.name}`}
            </button>
          </div>
          <GroupBox>
            {form.id === null ? (
              <FieldRow label="Template" htmlFor="agent-template">
                <SettingsSelect
                  id="agent-template"
                  value={templateId}
                  disabled={guard.busy}
                  onChange={(value) => {
                    setTemplateId(value)
                    const preset = templates.find((entry) => entry.id === value)
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
                </SettingsSelect>
              </FieldRow>
            ) : null}
            <FieldRow label="Name" htmlFor="agent-name" divided={form.id === null}>
              <input
                id="agent-name"
                className={textClass}
                value={form.name}
                disabled={guard.busy}
                onChange={(event) => {
                  setForm({ ...form, name: event.target.value })
                  setError(null)
                }}
              />
            </FieldRow>
            <StackedRow label="Command" htmlFor="agent-command" divided>
              <input
                id="agent-command"
                aria-describedby="agent-command-help"
                className={monoClass}
                value={form.command}
                disabled={guard.busy}
                onChange={(event) => {
                  setForm({ ...form, command: event.target.value })
                  setError(null)
                }}
              />
              <ul className="list-disc pl-4 text-xs text-ink-muted">
                <li>Use single or double quotes to group arguments.</li>
                <li>Include {'{prompt}'} as one whole argument exactly once.</li>
                <li>Shell operators and multiple lines are not supported.</li>
              </ul>
              <span id="agent-command-help" className="sr-only">
                {AGENT_COMMAND_HELP}
              </span>
            </StackedRow>
            <SettingsSwitch
              id="agent-override"
              label="Override arguments for New Chat"
              description="New Chat only. Kanban keeps using Command."
              checked={overrideOn}
              disabled={guard.busy}
              divided
              onChange={(next) => {
                setForm({
                  ...form,
                  interactiveArguments: next ? '' : undefined,
                })
                setError(null)
              }}
            />
            {form.interactiveArguments !== undefined ? (
              <StackedRow label="New Chat arguments" htmlFor="agent-interactive" divided>
                <input
                  id="agent-interactive"
                  aria-describedby="agent-interactive-help"
                  className={monoClass}
                  value={form.interactiveArguments}
                  disabled={guard.busy}
                  onChange={(event) => {
                    setForm({ ...form, interactiveArguments: event.target.value })
                    setError(null)
                  }}
                />
                <p id="agent-interactive-help">
                  For New Chat only. Replaces all arguments using the same quoting rules as Command,
                  without {'{prompt}'}. Leave empty to pass no arguments. Uses the executable from
                  Command; include any required CLI script path here. Kanban keeps using Command.
                </p>
              </StackedRow>
            ) : null}
            <p className="border-t border-edge px-4 py-3 text-xs text-ink-muted">
              Use your CLI's parameters or configuration for a provider or model. Keep API keys in
              your CLI's login or configuration. On Windows, use a native executable or node.exe
              with the CLI script, rather than a .cmd or .ps1 launcher.
            </p>
            <GroupFooter>
              <button
                type="button"
                disabled={guard.busy}
                className={secondaryClass}
                onClick={() => {
                  setForm(null)
                  setError(null)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={guard.busy}
                className={primaryClass}
                onClick={() => void save()}
              >
                Save agent
              </button>
            </GroupFooter>
          </GroupBox>
        </SettingsGroup>
      ) : (
        <SettingsGroup label="Agents">
          <SectionLabel
            title={library.profiles.length === 1 ? '1 agent' : `${library.profiles.length} agents`}
            action={
              <button
                type="button"
                className={secondaryClass}
                onClick={() => {
                  setTemplateId('custom')
                  setForm({ id: null, name: '', command: '' })
                  setError(null)
                }}
              >
                <Icon.plus size={14} aria-hidden />
                Add agent
              </button>
            }
          />
          {library.profiles.length === 0 ? (
            <p className="text-xs text-ink-secondary">
              No global agents. Add an agent from a template or a custom command.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {library.profiles.map((profile) => (
                <li
                  key={profile.id}
                  className="overflow-hidden rounded-[10px] border border-edge bg-group text-xs"
                >
                  <div className="flex items-center gap-2 px-4 py-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                      {profile.name}
                    </p>
                    <button
                      type="button"
                      aria-label={`Edit ${profile.name}`}
                      disabled={guard.busy}
                      className={quietClass}
                      onClick={() => edit(profile, false)}
                    >
                      <Icon.edit size={13} aria-hidden />
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Copy ${profile.name}`}
                      disabled={guard.busy}
                      className={quietClass}
                      onClick={() => edit(profile, true)}
                    >
                      <Icon.copy size={13} aria-hidden />
                      Copy
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${profile.name}`}
                      disabled={guard.busy}
                      className={cn(quietClass, 'text-error')}
                      onClick={() => void remove(profile.id)}
                    >
                      <Icon.trash size={13} aria-hidden />
                      Delete
                    </button>
                  </div>
                  <div className="border-t border-edge px-4 py-3">
                    <code className="block break-all font-mono text-ink-secondary">
                      {serializeAgentCommand(profile)}
                    </code>
                    {profile.interactiveArgs !== undefined ? (
                      <p className="mt-1 break-all text-ink-secondary">
                        New Chat arguments:{' '}
                        {serializeAgentArguments(profile.interactiveArgs) || '(none)'}
                      </p>
                    ) : null}
                    {profile.originProjectName ? (
                      <p className="mt-1 text-ink-muted">From {profile.originProjectName}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SettingsGroup>
      )}
    </div>
  )
}
