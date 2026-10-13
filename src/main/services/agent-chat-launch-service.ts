import type { AgentProfilesDocument, ChatInfo } from '../../shared/ipc-contract'
import { AGENT_PROMPT_PLACEHOLDER, IPC_CHANNEL } from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'
import type { ShellSpec } from './terminal/terminal-service'

// Agent chat launch (spec new-chat-agent-menu): the profile menu of the left
// panel's New Chat button creates one chat named for the profile and starts
// that profile in the chat's terminal -- the same launch path
// `kanban:launchTask` uses (argv, never a shell, at the project root). A task
// launch carries a prompt; this launch does not, so the single `{prompt}` argv
// element is removed and the agent starts interactively. A failed spawn rolls
// the just-created chat back in this same flow, so the renderer never adopts a
// chat without its agent.

const CHANNEL = IPC_CHANNEL.chatsCreateWithAgent
const SPAWN_LOG = '[agent-chat] failed to start the agent process'

export interface AgentChatProjectLookup {
  get(projectId: string): { path: string } | null
}

export interface AgentChatProfiles {
  get(projectId: string): AgentProfilesDocument
}

export interface AgentChatLaunchDeps {
  projects: AgentChatProjectLookup
  profiles: AgentChatProfiles
  /** Creates the `[shell] <profile name>` chat row (ChatService.createNamed). */
  createChat: (projectId: string, name: string) => ChatInfo
  /** Removes the chat row again when the agent process cannot start. */
  removeChat: (chatId: string) => void
  terminals: {
    create(chatId: string, cwd: string, shell?: ShellSpec): string
  }
}

/**
 * The profile argv without its prompt slot (spec Behaviour 4: the `{prompt}`
 * element is removed, no other element changes). The profile contract
 * guarantees exactly one element; a document that violates it would silently
 * drop a real argument, so it is refused instead.
 */
function agentArgs(args: readonly string[]): string[] {
  const next = args.filter((arg) => arg !== AGENT_PROMPT_PLACEHOLDER)
  if (args.length - next.length !== 1) {
    throw new AppError('validation', 'The selected agent profile is invalid.', CHANNEL)
  }
  return next
}

/**
 * The typed launch error. An error main already classified (missing project
 * directory, application closing, PTY refusal) keeps its code and message so the
 * notice stays specific; anything else becomes the launch's own message.
 */
function spawnFailure(error: unknown): AppError {
  console.error(SPAWN_LOG)
  if (error instanceof AppError) {
    return error
  }
  return new AppError('unknown', 'Failed to start the agent chat.', CHANNEL)
}

export class AgentChatLaunchService {
  readonly #projects: AgentChatProjectLookup
  readonly #profiles: AgentChatProfiles
  readonly #createChat: AgentChatLaunchDeps['createChat']
  readonly #removeChat: AgentChatLaunchDeps['removeChat']
  readonly #terminals: AgentChatLaunchDeps['terminals']

  constructor(deps: AgentChatLaunchDeps) {
    this.#projects = deps.projects
    this.#profiles = deps.profiles
    this.#createChat = deps.createChat
    this.#removeChat = deps.removeChat
    this.#terminals = deps.terminals
  }

  /**
   * One chat with the chosen profile's agent running in its terminal. Main owns
   * the name and the process: the chat is created first (so the terminal has an
   * id to attach to), then the agent spawns. A spawn failure removes the chat
   * row again and surfaces the typed error; no half-chat survives and there is
   * no fallback to a plain shell chat.
   */
  createWithAgent(projectId: string, profileId: string): ChatInfo {
    const project = this.#projects.get(projectId)
    if (project === null) {
      throw new AppError('not_found', 'Project not found.', CHANNEL)
    }
    const profile = this.#profiles
      .get(projectId)
      .profiles.find((candidate) => candidate.id === profileId)
    if (profile === undefined) {
      throw new AppError('not_found', 'The selected agent profile is no longer available.', CHANNEL)
    }
    const shell: ShellSpec = { file: profile.executable, args: agentArgs(profile.args) }
    const chat = this.#createChat(projectId, profile.name)
    try {
      this.#terminals.create(chat.id, project.path, shell)
    } catch (error) {
      this.#removeChat(chat.id)
      throw spawnFailure(error)
    }
    return chat
  }
}
