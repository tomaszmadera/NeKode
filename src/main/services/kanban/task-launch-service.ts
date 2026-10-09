import type {
  AgentProfile,
  AgentProfilesDocument,
  ChatInfo,
  HandoffCandidatesResult,
  KanbanHandoffCandidatesInput,
  KanbanLaunchResult,
  KanbanLaunchTaskInput,
  KanbanResumeLaunchInput,
  WorkItem,
} from '../../../shared/ipc-contract'
import { AGENT_PROMPT_PLACEHOLDER } from '../../../shared/ipc-contract'
import { AppError } from '../../../shared/ipc-error'
import type { ShellSpec } from '../terminal/terminal-service'

// Task launch (kanban task launch amendment). Main rechecks the project, the
// adapter binding (via getItem), the profile, and the live item, then inserts
// one chat named for the profile and spawns that profile. The prompt replaces
// the single `{prompt}` argv element. It is never passed through a shell.
// `handoffResume.autoSend` is the action-bar paste setting and is not read.
// Start and Resume share this path; Resume additionally rechecks the handoff
// file and its stamp immediately before the chat is created (spec Resume.3)
// and uses the Resume prompt. A detected file is never treated as plan
// approval.

const CHANNEL = 'kanban:launchTask'
const SPAWN_LOG = '[kanban-launch] failed to start the task process'
const RESUME_REFRESH =
  'The handoff file changed or is no longer available. Refresh the handoff list and resume again.'

const LAUNCH_FIELDS = ['projectId', 'itemId', 'ref', 'profileId', 'attemptId', 'mode'] as const
const RESUME_FIELDS = [...LAUNCH_FIELDS, 'fileName', 'stamp'] as const

export interface TaskLaunchProjectLookup {
  get(projectId: string): { path: string } | null
}

export interface TaskLaunchProfiles {
  get(projectId: string): AgentProfilesDocument
}

export interface TaskLaunchKanban {
  getItem(projectId: string, ref: string): Promise<WorkItem>
}

/** The stage 4 matcher, used only to recheck a Resume choice before the chat. */
export interface TaskLaunchHandoffs {
  candidates(input: KanbanHandoffCandidatesInput): Promise<HandoffCandidatesResult>
}

export interface TaskLaunchDeps {
  projects: TaskLaunchProjectLookup
  profiles: TaskLaunchProfiles
  kanban: TaskLaunchKanban
  handoffs: TaskLaunchHandoffs
  /** Stored handoff directory, or null when unset. Does not read the directory. */
  handoffDir: (projectId: string) => string | null
  createChat: (projectId: string, name: string) => ChatInfo
  terminals: {
    create(chatId: string, cwd: string, shell?: ShellSpec): string
  }
}

interface Attempt {
  mode: KanbanLaunchTaskInput['mode']
  projectId: string
  itemId: string
  ref: string
  profileId: string
  fileName: string | null
  stamp: string | null
  chat: ChatInfo | null
  delivered: boolean
  dropped: boolean
  inflight: Promise<KanbanLaunchResult> | null
}

interface PreparedLaunch {
  projectPath: string
  profile: AgentProfile
  shell: ShellSpec
}

/** The description, URL, project instructions and handoff directory. */
function promptTail(item: WorkItem, handoffDir: string | null): string[] {
  const parts: string[] = []
  const description = item.description?.trim() ?? ''
  parts.push(description.length > 0 ? description : 'This task has no description.')
  const url = item.url?.trim() ?? ''
  if (url.length > 0) {
    parts.push(url)
  }
  parts.push(
    "Follow the project's instructions. Do not assume approval for actions that require it.",
  )
  parts.push(
    "Keep the full ref in the name of the future local record and handoff, following the project's instructions.",
  )
  const directory = handoffDir?.trim() ?? ''
  if (directory.length > 0) {
    parts.push(`The project's handoff directory is ${directory}.`)
  }
  return parts
}

/** Start prompt. The first line is the spec sentence; the rest is separated by blank lines. */
export function buildStartPrompt(item: WorkItem, handoffDir: string | null): string {
  return [`Work on task ${item.ref}: ${item.title}.`, ...promptTail(item, handoffDir)].join('\n\n')
}

/**
 * Resume prompt (spec Resume.4). The first line names the handoff path: the
 * project-relative form when the file is inside the project, the absolute form
 * otherwise. The rest continues the Start prompt content. The path is prompt
 * data, never shell code.
 */
export function buildResumePrompt(
  item: WorkItem,
  handoffPath: string,
  handoffDir: string | null,
): string {
  return [
    `Resume task ${item.ref}: ${item.title} from handoff ${handoffPath}. Read the handoff first and reconcile it with the current repository state before continuing.`,
    ...promptTail(item, handoffDir),
  ].join('\n\n')
}

function substitutePrompt(args: readonly string[], prompt: string): string[] {
  let count = 0
  const next = args.map((arg) => {
    if (arg === AGENT_PROMPT_PLACEHOLDER) {
      count += 1
      return prompt
    }
    return arg
  })
  if (count !== 1) {
    throw new AppError('validation', 'The selected agent profile is invalid.', CHANNEL)
  }
  return next
}

function logSpawnFailure(): void {
  console.error(SPAWN_LOG)
}

/** The resume-only identity of a confirmation, or nulls for Start. */
function resumeFields(input: KanbanLaunchTaskInput): {
  fileName: string | null
  stamp: string | null
} {
  return input.mode === 'resume'
    ? { fileName: input.fileName, stamp: input.stamp }
    : { fileName: null, stamp: null }
}

export class TaskLaunchService {
  readonly #projects: TaskLaunchProjectLookup
  readonly #profiles: TaskLaunchProfiles
  readonly #kanban: TaskLaunchKanban
  readonly #handoffs: TaskLaunchHandoffs
  readonly #handoffDir: (projectId: string) => string | null
  readonly #createChat: (projectId: string, name: string) => ChatInfo
  readonly #terminals: TaskLaunchDeps['terminals']
  readonly #attempts = new Map<string, Attempt>()
  readonly #droppedProjects = new Set<string>()

  constructor(deps: TaskLaunchDeps) {
    this.#projects = deps.projects
    this.#profiles = deps.profiles
    this.#kanban = deps.kanban
    this.#handoffs = deps.handoffs
    this.#handoffDir = deps.handoffDir
    this.#createChat = deps.createChat
    this.#terminals = deps.terminals
  }

  /**
   * One confirmation. The same attempt id returns the same chat and does not
   * spawn again after argv was delivered. A failed spawn retries on that chat.
   */
  launch(input: KanbanLaunchTaskInput): Promise<KanbanLaunchResult> {
    this.#validate(input)
    const existing = this.#attempts.get(input.attemptId)
    if (existing !== undefined) {
      this.#assertSame(existing, input)
      if (existing.dropped || this.#droppedProjects.has(existing.projectId)) {
        return Promise.reject(new AppError('not_found', 'Project not found.', CHANNEL))
      }
      if (existing.delivered && existing.chat !== null) {
        return Promise.resolve({ chat: existing.chat, delivered: true })
      }
      if (existing.inflight !== null) {
        return existing.inflight
      }
      if (existing.chat !== null) {
        const retry = this.#retry(existing, input)
        existing.inflight = retry
        return retry
      }
    }
    const attempt: Attempt = {
      mode: input.mode,
      projectId: input.projectId,
      itemId: input.itemId,
      ref: input.ref,
      profileId: input.profileId,
      ...resumeFields(input),
      chat: null,
      delivered: false,
      dropped: this.#droppedProjects.has(input.projectId),
      inflight: null,
    }
    this.#attempts.set(input.attemptId, attempt)
    const promise = this.#start(attempt, input)
    attempt.inflight = promise
    return promise
  }

  /** In-flight Start for this project must not spawn after the project is removed. */
  dropProject(projectId: string): void {
    this.#droppedProjects.add(projectId)
    for (const attempt of this.#attempts.values()) {
      if (attempt.projectId === projectId) {
        attempt.dropped = true
      }
    }
  }

  /** Renderer `terminals:create` must not start the project shell for a failed launch. */
  blocksProjectShell(chatId: string): boolean {
    for (const attempt of this.#attempts.values()) {
      if (attempt.chat?.id === chatId && !attempt.delivered) {
        return true
      }
    }
    return false
  }

  async #start(attempt: Attempt, input: KanbanLaunchTaskInput): Promise<KanbanLaunchResult> {
    try {
      if (attempt.dropped || this.#droppedProjects.has(input.projectId)) {
        throw new AppError('not_found', 'Project not found.', CHANNEL)
      }
      const prepared = await this.#prepare(input)
      if (attempt.dropped || this.#droppedProjects.has(input.projectId)) {
        throw new AppError('not_found', 'Project not found.', CHANNEL)
      }
      const project = this.#projects.get(input.projectId)
      if (project === null) {
        throw new AppError('not_found', 'Project not found.', CHANNEL)
      }
      attempt.chat = this.#createChat(input.projectId, prepared.profile.name)
      return this.#spawn(attempt, project.path, prepared)
    } finally {
      attempt.inflight = null
      if (attempt.chat === null) {
        this.#attempts.delete(input.attemptId)
      }
    }
  }

  async #retry(attempt: Attempt, input: KanbanLaunchTaskInput): Promise<KanbanLaunchResult> {
    try {
      if (attempt.delivered && attempt.chat !== null) {
        return { chat: attempt.chat, delivered: true }
      }
      if (attempt.dropped || this.#droppedProjects.has(input.projectId)) {
        throw new AppError('not_found', 'Project not found.', CHANNEL)
      }
      const prepared = await this.#prepare(input)
      if (attempt.delivered && attempt.chat !== null) {
        return { chat: attempt.chat, delivered: true }
      }
      if (attempt.dropped || this.#droppedProjects.has(input.projectId) || attempt.chat === null) {
        throw new AppError('not_found', 'Project not found.', CHANNEL)
      }
      const project = this.#projects.get(input.projectId)
      if (project === null) {
        throw new AppError('not_found', 'Project not found.', CHANNEL)
      }
      return this.#spawn(attempt, project.path, prepared)
    } finally {
      attempt.inflight = null
    }
  }

  async #prepare(input: KanbanLaunchTaskInput): Promise<PreparedLaunch> {
    if (this.#droppedProjects.has(input.projectId)) {
      throw new AppError('not_found', 'Project not found.', CHANNEL)
    }
    const project = this.#projects.get(input.projectId)
    if (project === null) {
      throw new AppError('not_found', 'Project not found.', CHANNEL)
    }
    const profile = this.#profiles
      .get(input.projectId)
      .profiles.find((candidate) => candidate.id === input.profileId)
    if (profile === undefined) {
      throw new AppError('not_found', 'The selected agent profile is no longer available.', CHANNEL)
    }
    const item = await this.#kanban.getItem(input.projectId, input.ref)
    if (this.#droppedProjects.has(input.projectId)) {
      throw new AppError('not_found', 'Project not found.', CHANNEL)
    }
    const current = this.#projects.get(input.projectId)
    if (current === null) {
      throw new AppError('not_found', 'Project not found.', CHANNEL)
    }
    if (item.id !== input.itemId || item.ref !== input.ref) {
      throw new AppError(
        'conflict',
        'The task changed. Refresh the board and start again.',
        CHANNEL,
      )
    }
    const prompt =
      input.mode === 'resume'
        ? await this.#resumePrompt(item, input)
        : buildStartPrompt(item, this.#handoffDir(input.projectId))
    // The resume scan awaits; the project must still be present when it lands.
    if (
      this.#droppedProjects.has(input.projectId) ||
      this.#projects.get(input.projectId) === null
    ) {
      throw new AppError('not_found', 'Project not found.', CHANNEL)
    }
    return {
      projectPath: current.path,
      profile,
      shell: {
        file: profile.executable,
        args: substitutePrompt(profile.args, prompt),
      },
    }
  }

  /**
   * Rechecks the chosen file and the current configuration through the stage 4
   * matcher, then builds the Resume prompt. A file that is now missing,
   * unreadable, no longer a filename candidate, or whose stamp changed
   * refreshes the choice and launches nothing. The path in the prompt is the
   * matcher display path: project-relative inside the project, absolute
   * otherwise.
   */
  async #resumePrompt(item: WorkItem, input: KanbanResumeLaunchInput): Promise<string> {
    const scan = await this.#handoffs.candidates({
      projectId: input.projectId,
      itemId: input.itemId,
      ref: input.ref,
    })
    if (scan.state !== 'ready') {
      throw new AppError('conflict', RESUME_REFRESH, CHANNEL)
    }
    const candidate = scan.files.find(
      (file) => file.name === input.fileName && file.matchKind === 'filename',
    )
    if (candidate === undefined || candidate.modifiedAt !== input.stamp) {
      throw new AppError('conflict', RESUME_REFRESH, CHANNEL)
    }
    return buildResumePrompt(item, candidate.path, this.#handoffDir(input.projectId))
  }

  #spawn(attempt: Attempt, cwd: string, prepared: PreparedLaunch): KanbanLaunchResult {
    if (attempt.chat === null) {
      throw new AppError('conflict', 'The task chat is missing.', CHANNEL)
    }
    if (attempt.delivered) {
      return { chat: attempt.chat, delivered: true }
    }
    if (attempt.dropped || this.#droppedProjects.has(attempt.projectId)) {
      throw new AppError('not_found', 'Project not found.', CHANNEL)
    }
    try {
      this.#terminals.create(attempt.chat.id, cwd, prepared.shell)
    } catch {
      logSpawnFailure()
      return { chat: attempt.chat, delivered: false }
    }
    attempt.delivered = true
    return { chat: attempt.chat, delivered: true }
  }

  #assertSame(attempt: Attempt, input: KanbanLaunchTaskInput): void {
    const expected = resumeFields(input)
    if (
      attempt.mode !== input.mode ||
      attempt.projectId !== input.projectId ||
      attempt.itemId !== input.itemId ||
      attempt.ref !== input.ref ||
      attempt.profileId !== input.profileId ||
      attempt.fileName !== expected.fileName ||
      attempt.stamp !== expected.stamp
    ) {
      throw new AppError(
        'conflict',
        'This start attempt does not match the original confirmation.',
        CHANNEL,
      )
    }
  }

  #validate(input: KanbanLaunchTaskInput): void {
    if (typeof input !== 'object' || input === null) {
      throw new AppError('validation', 'kanban:launchTask requires an object.', CHANNEL)
    }
    const record = input as unknown as Record<string, unknown>
    if (record.mode !== 'start' && record.mode !== 'resume') {
      throw new AppError('validation', 'kanban:launchTask mode is invalid.', CHANNEL)
    }
    const fields: readonly string[] = record.mode === 'resume' ? RESUME_FIELDS : LAUNCH_FIELDS
    const keys = Object.keys(record)
    if (keys.length !== fields.length || fields.some((field) => !keys.includes(field))) {
      throw new AppError(
        'validation',
        'kanban:launchTask has unexpected or missing fields.',
        CHANNEL,
      )
    }
    for (const field of ['projectId', 'itemId', 'ref', 'profileId', 'attemptId'] as const) {
      const value = record[field]
      if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
        throw new AppError('validation', `kanban:launchTask ${field} is invalid.`, CHANNEL)
      }
    }
    if (record.mode === 'resume') {
      for (const field of ['fileName', 'stamp'] as const) {
        const value = record[field]
        if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
          throw new AppError('validation', `kanban:launchTask ${field} is invalid.`, CHANNEL)
        }
      }
      const fileName = record.fileName as string
      if (/[\\/]/.test(fileName) || fileName === '.' || fileName === '..') {
        throw new AppError(
          'validation',
          'kanban:launchTask fileName must be a file name, not a path.',
          CHANNEL,
        )
      }
    }
  }
}
