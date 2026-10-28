import type { ChatInfo } from './chats-contract'
import type { HandoffRejection } from './handoffs-contract'

// Validated payload types are inferred from their schemas (one source of truth).
export type {
  KanbanCreateInput,
  KanbanDraftLaunchInput,
  KanbanHandoffAvailabilityInput,
  KanbanHandoffCandidatesInput,
  KanbanLaunchTaskBase,
  KanbanLaunchTaskInput,
  KanbanResumeLaunchInput,
  KanbanSetConfigInput,
  KanbanStartLaunchInput,
  KanbanUpdatePatch,
} from './kanban-schema'

// ---------------------------------------------------------------------------
// Kanban adapter integration (spec kanban-adapter-interface). Adapter plugins
// are external user-installed processes; the shapes below are the app-side
// normalized contract only — no backend knowledge lives in the renderer.
// ---------------------------------------------------------------------------

/** Plane-compatible state groups; every adapter maps its backend onto these. */
export type KanbanStateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled'

export const KANBAN_STATE_GROUPS: readonly KanbanStateGroup[] = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled',
]

export interface KanbanState {
  id: string
  name: string
  group: KanbanStateGroup
  /** Adapter-provided sort key; the board orders columns by it. */
  order: number
}

export type KanbanPriority = 'urgent' | 'high' | 'medium' | 'low'

export const KANBAN_PRIORITIES: readonly KanbanPriority[] = ['urgent', 'high', 'medium', 'low']

export interface WorkItem {
  /** Stable human-readable reference, e.g. `NEKODE-16`. */
  ref: string
  /** Backend-native id, opaque to the UI. */
  id: string
  title: string
  description: string | null
  stateId: string
  stateName: string
  stateGroup: KanbanStateGroup
  priority: KanbanPriority | null
  assignee: string | null
  url: string | null
  updatedAt: string | null
}

export interface KanbanComment {
  /** Backend-native comment id. */
  id: string
  /** Author display name or identifier, or null when unknown. */
  author: string | null
  /** Plain text content of the comment. */
  text: string
  /** ISO 8601 UTC timestamp or null. */
  createdAt: string | null
}

export interface KanbanBoard {
  states: KanbanState[]
  items: WorkItem[]
  /**
   * Document revision of the built-in `local-file` source (project-home spec
   * Data / API). The next create or update must echo it. Process adapters
   * omit it.
   */
  revision?: number
}

/**
 * Result of `kanban:createItem` and `kanban:updateItem`: the written item plus,
 * for `local-file` only, the new document revision.
 */
export type KanbanItemWriteResult = WorkItem & { revision?: number }

/**
 * Built-in task source (project-home spec Behaviour 7-10): a JSON document at
 * a fixed path under the project root, read and written by main. It is not
 * a discovered process adapter and has no config fields.
 */
export const LOCAL_FILE_ADAPTER_ID = 'local-file'
export const LOCAL_FILE_ADAPTER_NAME = 'Local file'
/** Project-relative path of the `local-file` task document. */
export const LOCAL_TASK_FILE_PATH = '.nekode/tasks.json'
/**
 * `detail` of the `not_found` error for a missing task file while bound
 * (project-home spec Edge cases). Only this case offers `Use a local task
 * list`; an unknown project or a missing project folder does not.
 */
export const LOCAL_TASK_FILE_MISSING = 'local_task_file_missing'

/**
 * Project-relative path of the one skill file `Teach agents` writes
 * (project-home spec Behaviour 11-12). No per-agent destinations.
 */
export const AGENT_SKILL_FILE_PATH = '.agents/skills/nekode-tasks/SKILL.md'

/** Result of `kanban:skillStatus`: whether the skill file already exists. */
export interface KanbanSkillStatus {
  exists: boolean
}

export type KanbanConfigFieldType = 'string' | 'secret' | 'select' | 'boolean'

export interface KanbanConfigField {
  key: string
  label: string
  type: KanbanConfigFieldType
  required: boolean
  /** `select` fields only: the allowed values (at least one). */
  options?: string[]
  default?: string | boolean
}

export interface KanbanAdapterInfo {
  id: string
  name: string
  configSchema: KanbanConfigField[]
}

/** kanban:getConfig result: secret values never leave main (spec Business rules). */
export interface KanbanProjectConfig {
  adapterId: string | null
  /** Stored non-secret values; secret fields read as null. */
  values: Record<string, string | null>
  /** Secret keys that hold a stored value (the UI shows "stored", never the value). */
  secretKeys: string[]
  /**
   * True when the OS keyring (Electron safeStorage) is unavailable, e.g. Linux
   * without libsecret/gnome-keyring: secrets are then kept in memory for this
   * session only and are never written to disk in plain text.
   */
  sessionOnlySecrets?: boolean
}

/** Chat created for one confirmation. `delivered` is false when spawn failed. */
export interface KanbanLaunchResult {
  chat: ChatInfo
  delivered: boolean
  /** The Start prompt for console paste; only for `mode: 'draft'` when delivered. */
  draftPrompt?: string
}

/** One loaded item's availability in a batch handoff scan. */
export interface KanbanHandoffAvailabilityItem {
  itemId: string
  ref: string
  /** True when at least one readable file name carries the item's full ref. */
  available: boolean
}

/**
 * One batch handoff check for the loaded items. `not-configured` is an
 * unconfigured directory; `error` is a directory read failure and is never
 * shown as an empty set. Both are distinct from a `ready` scan whose items are
 * all unavailable. The result carries no file bodies and no adapter config.
 */
export type KanbanHandoffAvailabilityResult =
  | { state: 'not-configured' }
  | { state: 'error'; message: string }
  | {
      state: 'ready'
      items: KanbanHandoffAvailabilityItem[]
      /** File-level scan warnings (size, encoding, read); never hides an item. */
      rejections: HandoffRejection[]
    }
