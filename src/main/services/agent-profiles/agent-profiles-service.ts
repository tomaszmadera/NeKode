import { randomUUID } from 'node:crypto'
import type { AgentProfilePut, AgentProfilesDocument } from '../../../shared/ipc-contract'
import { agentProfileFieldError, projectAgentProfilesKey } from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'

// Per-project agent profiles (kanban task launch amendment). One JSON document
// in the existing app_state store, key `project.agentProfiles:<projectId>`:
// `{ defaultId, profiles }`. No new table. Field checks run before the write.
// `projects:remove` deletes the row first, then calls cleanupProject, so
// cleanup must not require the project row to still exist.

const CHANNEL = {
  get: 'agentProfiles:get',
  put: 'agentProfiles:put',
  delete: 'agentProfiles:delete',
} as const

export interface AgentProfilesProjectLookup {
  get(projectId: string): { path: string } | null
}

export interface AgentProfilesStateStore {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

export interface AgentProfilesServiceDeps {
  projects: AgentProfilesProjectLookup
  state: AgentProfilesStateStore
}

function emptyDocument(): AgentProfilesDocument {
  return { defaultId: null, profiles: [] }
}

function parseProfile(value: unknown): AgentProfilesDocument['profiles'][number] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.length === 0) return null
  if (typeof record.name !== 'string' || typeof record.executable !== 'string') return null
  if (!Array.isArray(record.args) || record.args.some((arg) => typeof arg !== 'string')) {
    return null
  }
  return {
    id: record.id,
    name: record.name,
    executable: record.executable,
    args: record.args,
  }
}

/** A document this service did not write reads as empty. Read does not repair it. */
function parseDocument(raw: string | null): AgentProfilesDocument {
  if (raw === null || raw.length === 0) return emptyDocument()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyDocument()
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return emptyDocument()
  }
  const record = parsed as Record<string, unknown>
  if (!Array.isArray(record.profiles)) return emptyDocument()
  const profiles = []
  for (const entry of record.profiles) {
    const profile = parseProfile(entry)
    if (profile === null) return emptyDocument()
    profiles.push(profile)
  }
  const defaultId = typeof record.defaultId === 'string' ? record.defaultId : null
  return {
    defaultId:
      defaultId !== null && profiles.some((profile) => profile.id === defaultId) ? defaultId : null,
    profiles,
  }
}

export class AgentProfilesService {
  readonly #projects: AgentProfilesProjectLookup
  readonly #state: AgentProfilesStateStore

  constructor(deps: AgentProfilesServiceDeps) {
    this.#projects = deps.projects
    this.#state = deps.state
  }

  get(projectId: string): AgentProfilesDocument {
    this.requireProject(projectId, CHANNEL.get)
    return parseDocument(this.#state.get(projectAgentProfilesKey(projectId)))
  }

  put(projectId: string, input: AgentProfilePut): AgentProfilesDocument {
    this.requireProject(projectId, CHANNEL.put)
    this.assertPut(input)
    const current = parseDocument(this.#state.get(projectAgentProfilesKey(projectId)))
    const name = input.name.trim()
    const executable = input.executable.trim()
    const args = [...input.args]
    if (input.id === null) {
      const id = randomUUID()
      return this.write(projectId, {
        defaultId: input.isDefault ? id : current.defaultId,
        profiles: [...current.profiles, { id, name, executable, args }],
      })
    }
    const index = current.profiles.findIndex((profile) => profile.id === input.id)
    if (index < 0) {
      throw new AppError('not_found', `Agent profile "${input.id}" not found.`, CHANNEL.put)
    }
    const profiles = current.profiles.map((profile) => ({ ...profile, args: [...profile.args] }))
    profiles[index] = { id: input.id, name, executable, args }
    const defaultId = input.isDefault
      ? input.id
      : current.defaultId === input.id
        ? null
        : current.defaultId
    return this.write(projectId, { defaultId, profiles })
  }

  delete(projectId: string, profileId: string): AgentProfilesDocument {
    this.requireProject(projectId, CHANNEL.delete)
    const current = parseDocument(this.#state.get(projectAgentProfilesKey(projectId)))
    if (!current.profiles.some((profile) => profile.id === profileId)) {
      throw new AppError('not_found', `Agent profile "${profileId}" not found.`, CHANNEL.delete)
    }
    return this.write(projectId, {
      defaultId: current.defaultId === profileId ? null : current.defaultId,
      profiles: current.profiles.filter((profile) => profile.id !== profileId),
    })
  }

  /** Deletes the document key. Safe after the project row is already gone. */
  cleanupProject(projectId: string): void {
    this.#state.delete(projectAgentProfilesKey(projectId))
  }

  private requireProject(projectId: string, channel: string): void {
    if (this.#projects.get(projectId) === null) {
      throw new AppError('not_found', `Project "${projectId}" not found.`, channel)
    }
  }

  private assertPut(input: AgentProfilePut): void {
    if (input.id !== null && (typeof input.id !== 'string' || input.id.length === 0)) {
      throw new AppError(
        'validation',
        'Profile id must be a non-empty string or null.',
        CHANNEL.put,
      )
    }
    if (typeof input.isDefault !== 'boolean') {
      throw new AppError('validation', 'isDefault must be a boolean.', CHANNEL.put)
    }
    const message = agentProfileFieldError(input)
    if (message !== null) {
      throw new AppError('validation', message, CHANNEL.put)
    }
  }

  private write(projectId: string, document: AgentProfilesDocument): AgentProfilesDocument {
    const stored: AgentProfilesDocument = {
      defaultId: document.defaultId,
      profiles: document.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        executable: profile.executable,
        args: [...profile.args],
      })),
    }
    this.#state.set(projectAgentProfilesKey(projectId), JSON.stringify(stored))
    return stored
  }
}
