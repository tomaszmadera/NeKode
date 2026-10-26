/**
 * The one argv element a profile reserves for the launch prompt. The saved
 * prompt replaces this whole element later; it is never concatenated into
 * another argument. Stage 2 only stores the literal.
 */
export const AGENT_PROMPT_PLACEHOLDER = '{prompt}'

/** One global agent launch definition. `id` is minted in main. */
export interface AgentProfile {
  id: string
  name: string
  executable: string
  args: string[]
  /** Complete argv for New Chat; absent keeps legacy prompt removal, [] means no arguments. */
  interactiveArgs?: string[]
  originProjectName?: string
}

export interface AgentProfilesLibrary {
  version: 1
  profiles: AgentProfile[]
}

export interface AgentProfileTemplate {
  id: string
  name: string
  command: string
}

export interface AgentProjectSelectionInput {
  selectedIds: string[]
  defaultId: string | null
}

export interface AgentProjectSelection extends AgentProjectSelectionInput {
  version: 1
}

/** Effective project profiles returned for launching, never stored as definitions. */
export interface AgentProfilesDocument {
  defaultId: string | null
  profiles: AgentProfile[]
}

/**
 * `agentProfiles:put` body. `id: null` creates a global profile. A string
 * edits the same definition for future launches in every selected project.
 */
export interface AgentProfilePut {
  id: string | null
  name: string
  command: string
  interactiveArgs?: string[]
}

export const AGENT_PROFILES_LIBRARY_KEY = 'agents.library'

export function projectAgentSelectionKey(projectId: string): string {
  return `project.agentSelection:${projectId}`
}

/** Per-project agent profiles document (kanban task launch amendment). */
export function projectAgentProfilesKey(projectId: string): string {
  return `project.agentProfiles:${projectId}`
}

/** Optional complete interactive argv; null means the value may be saved. */
export function agentInteractiveArgsError(value: unknown): string | null {
  if (value === undefined) return null
  if (!Array.isArray(value) || [...value].some((arg) => typeof arg !== 'string')) {
    return 'Interactive arguments must be a list of strings.'
  }
  if (value.some((arg: string) => arg.includes('\u0000'))) {
    return 'Interactive arguments must not contain NUL characters.'
  }
  if (value.some((arg: string) => arg.includes(AGENT_PROMPT_PLACEHOLDER))) {
    return 'Interactive arguments must not include {prompt}.'
  }
  return null
}

/**
 * Shared profile field rules. Null means the fields may be saved. Empty name,
 * empty executable, or any `{prompt}` count other than one is a validation
 * error. The placeholder must be its own argv element, not a substring.
 */
export function agentProfileFieldError(input: {
  name: string
  executable: string
  args: readonly string[]
  interactiveArgs?: readonly string[]
}): string | null {
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    return 'Name is required.'
  }
  if (typeof input.executable !== 'string' || input.executable.trim().length === 0) {
    return 'Executable is required.'
  }
  if (!Array.isArray(input.args) || input.args.some((arg) => typeof arg !== 'string')) {
    return 'Arguments must be a list of strings.'
  }
  if ([input.name, input.executable, ...input.args].some((value) => value.includes('\u0000'))) {
    return 'Profile fields must not contain NUL characters.'
  }
  const placeholders = input.args.filter((arg) => arg === AGENT_PROMPT_PLACEHOLDER).length
  const hasSubstring = input.args.some(
    (arg) => arg !== AGENT_PROMPT_PLACEHOLDER && arg.includes(AGENT_PROMPT_PLACEHOLDER),
  )
  if (placeholders !== 1 || hasSubstring) {
    return 'Arguments must include {prompt} exactly once.'
  }
  return agentInteractiveArgsError(input.interactiveArgs)
}
