import { randomUUID } from 'node:crypto'
import { parseAgentCommand } from '@shared/agent-command'
import type {
  AgentProfile,
  AgentProfilePut,
  AgentProfilesDocument,
  AgentProfilesLibrary,
  AgentProjectSelection,
  AgentProjectSelectionInput,
} from '@shared/ipc-contract'
import {
  AGENT_PROFILES_LIBRARY_KEY,
  agentProfileFieldError,
  projectAgentProfilesKey,
  projectAgentSelectionKey,
} from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { agentProfileTemplates } from './agent-profile-templates'

export interface AgentProfilesProjectLookup {
  get(projectId: string): { path: string; name?: string } | null
}

export interface AgentProfilesStateStore {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
  listPrefix(prefix: string): Array<{ key: string; value: string }>
  transaction<T>(operation: () => T): T
}

export interface AgentProfilesServiceDeps {
  projects: AgentProfilesProjectLookup
  state: AgentProfilesStateStore
}

const LEGACY_PREFIX = 'project.agentProfiles:'
const SELECTION_PREFIX = 'project.agentSelection:'
const EMPTY_SELECTION: AgentProjectSelection = { version: 1, selectedIds: [], defaultId: null }

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected an object.')
  return value as Record<string, unknown>
}

function profile(value: unknown): AgentProfile {
  const input = record(value)
  if (typeof input.id !== 'string' || input.id.length === 0 || input.id.includes('\u0000'))
    throw new Error('Invalid profile id.')
  const error = agentProfileFieldError(input as unknown as AgentProfile)
  if (error !== null) throw new Error(error)
  if (input.originProjectName !== undefined && typeof input.originProjectName !== 'string')
    throw new Error('Invalid profile origin.')
  // Preserve additional launch fields if a format amendment has introduced them.
  return {
    ...input,
    args: [...(input.args as string[])],
    ...(input.interactiveArgs === undefined
      ? {}
      : { interactiveArgs: [...(input.interactiveArgs as string[])] }),
  } as unknown as AgentProfile
}

function profiles(value: unknown): AgentProfile[] {
  if (!Array.isArray(value)) throw new Error('Expected a profile list.')
  const result = value.map(profile)
  if (new Set(result.map((entry) => entry.id)).size !== result.length)
    throw new Error('Duplicate profile ids.')
  return result
}

function selection(
  value: unknown,
  library: AgentProfilesLibrary,
  versioned = true,
): AgentProjectSelection {
  const input = record(value)
  if (versioned && input.version !== 1) throw new Error('Unsupported selection format.')
  if (
    !Array.isArray(input.selectedIds) ||
    input.selectedIds.some((id) => typeof id !== 'string' || id.length === 0)
  )
    throw new Error('Selected ids must be non-empty strings.')
  const selectedIds = input.selectedIds as string[]
  if (new Set(selectedIds).size !== selectedIds.length)
    throw new Error('Selected ids must be unique.')
  if (selectedIds.some((id) => !library.profiles.some((entry) => entry.id === id)))
    throw new Error('A selected profile no longer exists.')
  if (
    input.defaultId !== null &&
    (typeof input.defaultId !== 'string' || !selectedIds.includes(input.defaultId))
  )
    throw new Error('Default agent must be selected for this project.')
  return { version: 1, selectedIds: [...selectedIds], defaultId: input.defaultId as string | null }
}

export class AgentProfilesService {
  readonly #projects: AgentProfilesProjectLookup
  readonly #state: AgentProfilesStateStore

  constructor(deps: AgentProfilesServiceDeps) {
    this.#projects = deps.projects
    this.#state = deps.state
  }

  templatesGet(): ReturnType<typeof agentProfileTemplates> {
    return agentProfileTemplates()
  }

  libraryGet(): AgentProfilesLibrary {
    return this.persistence('agentProfiles:libraryGet', () => {
      this.migrate()
      return this.readLibrary()
    })
  }

  get(projectId: string): AgentProfilesDocument {
    this.requireProject(projectId, 'agentProfiles:get')
    const library = this.libraryGet()
    const selected = this.selectionGet(projectId)
    return {
      defaultId: selected.defaultId,
      profiles: library.profiles.filter((entry) => selected.selectedIds.includes(entry.id)),
    }
  }

  selectionGet(projectId: string): AgentProjectSelection {
    this.requireProject(projectId, 'agentProfiles:selectionGet')
    const library = this.libraryGet()
    return this.readSelection(projectId, library)
  }

  selectionSet(projectId: string, input: AgentProjectSelectionInput): AgentProjectSelection {
    const channel = 'agentProfiles:selectionSet'
    this.requireProject(projectId, channel)
    const library = this.libraryGet()
    let next: AgentProjectSelection
    try {
      next = selection(input, library, false)
    } catch (error) {
      throw new AppError('validation', (error as Error).message, channel)
    }
    return this.persistence(channel, () =>
      this.#state.transaction(() => {
        this.#state.set(projectAgentSelectionKey(projectId), JSON.stringify(next))
        return next
      }),
    )
  }

  put(input: AgentProfilePut): AgentProfilesLibrary {
    const channel = 'agentProfiles:put'
    let parsed: ReturnType<typeof parseAgentCommand>
    try {
      const fields = record(input)
      if (fields.id !== null && (typeof fields.id !== 'string' || fields.id.length === 0))
        throw new Error('Profile id must be a non-empty string or null.')
      parsed = parseAgentCommand(fields.command as string)
      const error = agentProfileFieldError({
        ...parsed,
        name: fields.name as string,
        interactiveArgs: fields.interactiveArgs as string[] | undefined,
      })
      if (error !== null) throw new Error(error)
    } catch (error) {
      throw new AppError('validation', (error as Error).message, channel)
    }
    const library = this.libraryGet()
    const index =
      input.id === null ? -1 : library.profiles.findIndex((entry) => entry.id === input.id)
    if (input.id !== null && index < 0)
      throw new AppError('not_found', 'Agent profile not found.', channel)
    const nextProfile: AgentProfile = {
      ...(index < 0 ? {} : library.profiles[index]),
      id: input.id ?? randomUUID(),
      name: input.name.trim(),
      ...parsed,
    }
    if (input.interactiveArgs === undefined) delete nextProfile.interactiveArgs
    else nextProfile.interactiveArgs = [...input.interactiveArgs]
    const next: AgentProfilesLibrary = { version: 1, profiles: [...library.profiles] }
    if (index < 0) next.profiles.push(nextProfile)
    else next.profiles[index] = nextProfile
    return this.writeLibrary(next, channel)
  }

  delete(profileId: string): AgentProfilesLibrary {
    const channel = 'agentProfiles:delete'
    const library = this.libraryGet()
    if (!library.profiles.some((entry) => entry.id === profileId))
      throw new AppError('not_found', 'Agent profile not found.', channel)
    return this.persistence(channel, () =>
      this.#state.transaction(() => {
        const users: string[] = []
        for (const { key } of this.#state.listPrefix(SELECTION_PREFIX)) {
          const projectId = key.slice(SELECTION_PREFIX.length)
          const project = this.#projects.get(projectId)
          if (
            project !== null &&
            this.readSelection(projectId, library).selectedIds.includes(profileId)
          )
            users.push(project.name ?? projectId)
        }
        if (users.length > 0)
          throw new AppError(
            'conflict',
            `Deselect this agent in these projects before deleting it: ${users.join(', ')}.`,
            channel,
          )
        const next: AgentProfilesLibrary = {
          version: 1,
          profiles: library.profiles.filter((entry) => entry.id !== profileId),
        }
        this.#state.set(AGENT_PROFILES_LIBRARY_KEY, JSON.stringify(next))
        return next
      }),
    )
  }

  /** Selection cleanup never removes a global definition or requires a project row. */
  cleanupProject(projectId: string): void {
    this.persistence('projects:remove', () =>
      this.#state.transaction(() => {
        this.migrate()
        this.#state.delete(projectAgentSelectionKey(projectId))
        this.#state.delete(projectAgentProfilesKey(projectId))
      }),
    )
  }

  private migrate(): void {
    if (this.#state.get(AGENT_PROFILES_LIBRARY_KEY) !== null) return
    this.#state.transaction(() => {
      const library: AgentProfilesLibrary = { version: 1, profiles: [] }
      const migrated: Array<{ key: string; projectId: string; selection: AgentProjectSelection }> =
        []
      const ids = new Set<string>()
      // Validate every source and construct all mappings before the first write.
      for (const { key, value } of this.#state.listPrefix(LEGACY_PREFIX)) {
        const projectId = key.slice(LEGACY_PREFIX.length)
        try {
          const source = record(JSON.parse(value))
          const entries = profiles(source.profiles)
          if (
            source.defaultId !== null &&
            (typeof source.defaultId !== 'string' ||
              !entries.some((entry) => entry.id === source.defaultId))
          )
            throw new Error('Invalid default profile.')
          const mapping = new Map<string, string>()
          for (const entry of entries) {
            let id = entry.id
            while (ids.has(id)) id = randomUUID()
            ids.add(id)
            mapping.set(entry.id, id)
            const originProjectName = this.#projects.get(projectId)?.name ?? projectId
            library.profiles.push({ ...entry, id, originProjectName })
          }
          migrated.push({
            key,
            projectId,
            selection: {
              version: 1,
              selectedIds: entries.map((entry) => mapping.get(entry.id) as string),
              defaultId:
                source.defaultId === null
                  ? null
                  : (mapping.get(source.defaultId as string) as string),
            },
          })
        } catch {
          throw new AppError(
            'validation',
            `Cannot migrate agent profiles for project "${projectId}": invalid stored configuration. Original data has been preserved.`,
            'agentProfiles:libraryGet',
          )
        }
      }
      this.#state.set(AGENT_PROFILES_LIBRARY_KEY, JSON.stringify(library))
      for (const entry of migrated) {
        this.#state.set(projectAgentSelectionKey(entry.projectId), JSON.stringify(entry.selection))
        this.#state.delete(entry.key)
      }
    })
  }

  private readLibrary(): AgentProfilesLibrary {
    const raw = this.#state.get(AGENT_PROFILES_LIBRARY_KEY)
    try {
      const input = record(JSON.parse(raw as string))
      if (input.version !== 1) throw new Error('Unsupported format.')
      return { version: 1, profiles: profiles(input.profiles) }
    } catch {
      throw new AppError(
        'validation',
        'The stored agent library is invalid. Original data has been preserved.',
        'agentProfiles:libraryGet',
      )
    }
  }

  private readSelection(projectId: string, library: AgentProfilesLibrary): AgentProjectSelection {
    return this.persistence('agentProfiles:selectionGet', () => {
      const raw = this.#state.get(projectAgentSelectionKey(projectId))
      if (raw === null) return { ...EMPTY_SELECTION, selectedIds: [] }
      try {
        return selection(JSON.parse(raw), library)
      } catch {
        throw new AppError(
          'validation',
          `The stored agent selection for project "${projectId}" is invalid.`,
          'agentProfiles:selectionGet',
        )
      }
    })
  }

  private writeLibrary(library: AgentProfilesLibrary, channel: string): AgentProfilesLibrary {
    return this.persistence(channel, () =>
      this.#state.transaction(() => {
        this.#state.set(AGENT_PROFILES_LIBRARY_KEY, JSON.stringify(library))
        return library
      }),
    )
  }

  private persistence<T>(channel: string, operation: () => T): T {
    try {
      return operation()
    } catch (error) {
      if (error instanceof AppError) throw error
      // Do not log stored commands or SQLite values.
      throw new AppError('sqlite', 'Failed to read or save agent configuration.', channel)
    }
  }

  private requireProject(projectId: string, channel: string): void {
    if (this.#projects.get(projectId) === null)
      throw new AppError('not_found', 'Project not found.', channel)
  }
}
