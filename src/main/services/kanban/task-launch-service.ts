import {
  DEFAULT_START_INSTRUCTION,
  formatStartInstruction,
} from '@shared/contracts/action-instructions-contract'
import type {
  AgentProfile,
  AgentProfilesDocument,
  ChatInfo,
  ChatLaunchIdentity,
  KanbanLaunchResult,
  KanbanLaunchTaskInput,
  WorkItem,
} from '@shared/ipc-contract'
import { AGENT_PROMPT_PLACEHOLDER } from '@shared/ipc-contract'
import { AppError } from '@shared/ipc-error'
import { agentArgs } from '../agent-chat-launch-service'
import { agentDisplayName } from '../agent-identity'
import {
  type AgentSessionRegistry,
  choosesOwnSession,
  profileSessionId,
  withSessionId,
} from '../agent-session-registry'
import type { ShellSpec } from '../terminal/terminal-service'
import { validateWslExecutableAsync } from '../terminal/wsl'

// Task launch (kanban task launch amendment, NEKODE-142). Main rechecks the project, the
// adapter binding (via getItem), the profile, and the live item, then inserts
// one chat named for the profile and spawns that profile. The prompt replaces
// the single `{prompt}` argv element. It is never passed through a shell.
// `handoffResume.autoSend` is the action-bar paste setting and is not read.
// Start and Resume share this path; Resume uses the prepared prompt composed by
// the project's reusable Resume template selection.
// Draft (Start without sending, NEKODE-99) shares the Start checks
// and prompt, starts the profile with its interactive argv like New Chat, and
// returns the prompt for the renderer to paste into the console without submitting.
// Resume without sending (user decision 2026-11-12) applies the same draft launch
// to the prepared Resume prompt.

const CHANNEL = 'kanban:launchTask'
const SPAWN_LOG = '[kanban-launch] failed to start the task process'

const LAUNCH_FIELDS = ['projectId', 'itemId', 'ref', 'profileId', 'attemptId', 'mode'] as const
const RESUME_FIELDS = [...LAUNCH_FIELDS, 'prompt'] as const

export interface TaskLaunchProjectLookup {
  get(projectId: string): { path: string } | null
}

export interface TaskLaunchProfiles {
  get(projectId: string): AgentProfilesDocument
}

export interface TaskLaunchKanban {
  getItem(projectId: string, ref: string): Promise<WorkItem>
}

export interface TaskLaunchDeps {
  projects: TaskLaunchProjectLookup
  profiles: TaskLaunchProfiles
  kanban: TaskLaunchKanban
  createChat: (projectId: string, name: string, identity: ChatLaunchIdentity) => ChatInfo
  /** Claude session ids for the context meter (spec left-panel Behaviour). */
  sessions: AgentSessionRegistry
  terminals: {
    create(chatId: string, cwd: string, shell?: ShellSpec): string | Promise<string>
  }
  /** Effective application-level Start instruction (NEKODE-187), read per preparation. */
  startInstruction?: () => string
}

interface Attempt {
  mode: KanbanLaunchTaskInput['mode']
  projectId: string
  itemId: string
  ref: string
  profileId: string
  prompt: string | null
  chat: ChatInfo | null
  delivered: boolean
  /** The Start prompt a delivered draft returns; null for Start and Resume. */
  draftPrompt: string | null
  dropped: boolean
  inflight: Promise<KanbanLaunchResult> | null
}

interface PreparedLaunch {
  taskRef: string
  projectPath: string
  profile: AgentProfile
  shell: ShellSpec
  draftPrompt: string | null
}

/**
 * Start prompt from the application Start instruction (NEKODE-187). The
 * default instruction reproduces the previous fixed text exactly.
 */
export function buildStartPrompt(
  item: WorkItem,
  instruction: string = DEFAULT_START_INSTRUCTION,
): string {
  return formatStartInstruction(instruction, {
    ref: item.ref,
    title: item.title,
    description: item.description,
    url: item.url,
  })
}

/**
 * Default Resume prompt (spec Resume.4). The only line names the handoff path: the
 * project-relative form when the file is inside the project, the absolute form
 * otherwise. The agent's resume workflow owns the instructions.
 * The path is prompt data, never shell code.
 */
export function buildResumePrompt(handoffPath: string): string {
  return `Resume from ${handoffPath}`
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

/** The result of a delivered attempt; a draft carries its prompt. */
function deliveredResult(chat: ChatInfo, draftPrompt: string | null): KanbanLaunchResult {
  return draftPrompt === null ? { chat, delivered: true } : { chat, delivered: true, draftPrompt }
}

function logSpawnFailure(): void {
  console.error(SPAWN_LOG)
}

/** The resume-only identity of a confirmation, or null for Start. */
function resumeFields(input: KanbanLaunchTaskInput): {
  prompt: string | null
} {
  return input.mode === 'resume' || input.mode === 'resume-draft'
    ? { prompt: input.prompt }
    : { prompt: null }
}

export class TaskLaunchService {
  readonly #projects: TaskLaunchProjectLookup
  readonly #profiles: TaskLaunchProfiles
  readonly #kanban: TaskLaunchKanban
  readonly #createChat: TaskLaunchDeps['createChat']
  readonly #sessions: AgentSessionRegistry
  readonly #terminals: TaskLaunchDeps['terminals']
  readonly #startInstruction: () => string
  readonly #attempts = new Map<string, Attempt>()
  readonly #droppedProjects = new Set<string>()

  constructor(deps: TaskLaunchDeps) {
    this.#projects = deps.projects
    this.#profiles = deps.profiles
    this.#kanban = deps.kanban
    this.#createChat = deps.createChat
    this.#sessions = deps.sessions
    this.#terminals = deps.terminals
    this.#startInstruction = deps.startInstruction ?? (() => DEFAULT_START_INSTRUCTION)
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
        return Promise.resolve(deliveredResult(existing.chat, existing.draftPrompt))
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
      draftPrompt: null,
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
      attempt.chat = this.#createChat(input.projectId, prepared.profile.name, {
        taskRef: prepared.taskRef,
        agentName: agentDisplayName(prepared.shell.file, prepared.shell.args),
      })
      return await this.#spawn(attempt, project.path, prepared)
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
        return deliveredResult(attempt.chat, attempt.draftPrompt)
      }
      if (attempt.dropped || this.#droppedProjects.has(input.projectId)) {
        throw new AppError('not_found', 'Project not found.', CHANNEL)
      }
      const prepared = await this.#prepare(input)
      if (attempt.delivered && attempt.chat !== null) {
        return deliveredResult(attempt.chat, attempt.draftPrompt)
      }
      if (attempt.dropped || this.#droppedProjects.has(input.projectId) || attempt.chat === null) {
        throw new AppError('not_found', 'Project not found.', CHANNEL)
      }
      const project = this.#projects.get(input.projectId)
      if (project === null) {
        throw new AppError('not_found', 'Project not found.', CHANNEL)
      }
      return await this.#spawn(attempt, project.path, prepared)
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
    let profile = this.#profiles
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
      input.mode === 'resume' || input.mode === 'resume-draft'
        ? input.prompt
        : buildStartPrompt(item, this.#startInstruction())
    // The project must still be present when adapter reads land.
    if (
      this.#droppedProjects.has(input.projectId) ||
      this.#projects.get(input.projectId) === null
    ) {
      throw new AppError('not_found', 'Project not found.', CHANNEL)
    }
    const draft = input.mode === 'draft' || input.mode === 'resume-draft'
    while (true) {
      // Recheck selection and the definition after every asynchronous probe.
      profile = this.#profiles
        .get(input.projectId)
        .profiles.find((candidate) => candidate.id === input.profileId)
      if (profile === undefined) {
        throw new AppError(
          'not_found',
          'The selected agent profile is no longer available.',
          CHANNEL,
        )
      }
      const shell = {
        file: profile.executable,
        args: draft
          ? agentArgs(profile.args, profile.interactiveArgs, CHANNEL)
          : substitutePrompt(profile.args, prompt),
      }
      // A missing Linux CLI must reject before a persisted chat exists.
      let probeFailure: { error: unknown } | undefined
      try {
        await validateWslExecutableAsync(current.path, shell)
      } catch (error) {
        probeFailure = { error }
      }
      const latest = this.#profiles
        .get(input.projectId)
        .profiles.find((candidate) => candidate.id === input.profileId)
      if (latest === undefined) {
        throw new AppError(
          'not_found',
          'The selected agent profile is no longer available.',
          CHANNEL,
        )
      }
      const latestArgs = draft
        ? agentArgs(latest.args, latest.interactiveArgs, CHANNEL)
        : substitutePrompt(latest.args, prompt)
      if (
        latest.executable !== shell.file ||
        latestArgs.length !== shell.args.length ||
        latestArgs.some((arg, index) => arg !== shell.args[index])
      ) {
        continue
      }
      if (probeFailure !== undefined) {
        throw probeFailure.error
      }
      return {
        taskRef: item.ref,
        projectPath: current.path,
        profile: latest,
        shell,
        draftPrompt: draft ? prompt : null,
      }
    }
  }

  async #spawn(
    attempt: Attempt,
    cwd: string,
    prepared: PreparedLaunch,
  ): Promise<KanbanLaunchResult> {
    if (attempt.chat === null) {
      throw new AppError('conflict', 'The task chat is missing.', CHANNEL)
    }
    if (attempt.delivered) {
      return deliveredResult(attempt.chat, attempt.draftPrompt)
    }
    if (attempt.dropped || this.#droppedProjects.has(attempt.projectId)) {
      throw new AppError('not_found', 'Project not found.', CHANNEL)
    }
    try {
      // A Claude chat launches with its own session id, so the context meter
      // reads exactly this chat's transcript (a retried attempt gets a new id).
      const executable = prepared.shell.file
      const launch = this.#sessions.register(
        attempt.chat.id,
        agentDisplayName(executable, prepared.shell.args),
        cwd,
      )
      if (choosesOwnSession(executable, prepared.shell.args)) {
        const named = profileSessionId(executable, prepared.shell.args)
        this.#sessions.setSessionId(
          attempt.chat.id,
          prepared.shell.args.includes('--fork-session') ? null : named,
        )
      }
      const shell: ShellSpec = {
        file: executable,
        args: withSessionId(executable, prepared.shell.args, launch.sessionId),
      }
      await this.#terminals.create(attempt.chat.id, cwd, shell)
    } catch {
      this.#sessions.forget(attempt.chat.id)
      if (attempt.dropped || this.#droppedProjects.has(attempt.projectId)) {
        throw new AppError('not_found', 'Project not found.', CHANNEL)
      }
      logSpawnFailure()
      return { chat: attempt.chat, delivered: false }
    }
    if (attempt.dropped || this.#droppedProjects.has(attempt.projectId)) {
      throw new AppError('not_found', 'Project not found.', CHANNEL)
    }
    attempt.delivered = true
    attempt.draftPrompt = prepared.draftPrompt
    return deliveredResult(attempt.chat, attempt.draftPrompt)
  }

  #assertSame(attempt: Attempt, input: KanbanLaunchTaskInput): void {
    const expected = resumeFields(input)
    if (
      attempt.mode !== input.mode ||
      attempt.projectId !== input.projectId ||
      attempt.itemId !== input.itemId ||
      attempt.ref !== input.ref ||
      attempt.profileId !== input.profileId ||
      attempt.prompt !== expected.prompt
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
    if (
      record.mode !== 'start' &&
      record.mode !== 'resume' &&
      record.mode !== 'resume-draft' &&
      record.mode !== 'draft'
    ) {
      throw new AppError('validation', 'kanban:launchTask mode is invalid.', CHANNEL)
    }
    const fields: readonly string[] =
      record.mode === 'resume' || record.mode === 'resume-draft' ? RESUME_FIELDS : LAUNCH_FIELDS
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
    if (record.mode === 'resume' || record.mode === 'resume-draft') {
      const value = record.prompt
      if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
        throw new AppError('validation', 'kanban:launchTask prompt is invalid.', CHANNEL)
      }
    }
  }
}
