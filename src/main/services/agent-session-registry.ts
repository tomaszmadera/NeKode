import { randomUUID } from 'node:crypto'
import { agentArgIndex } from './agent-identity'

/**
 * Launch records for agent chats (spec left-panel Behaviour, the context
 * meter). A chat's tile shows the context its OWN session has in use, so the
 * app has to know which transcript belongs to which chat.
 *
 * Claude Code takes `--session-id <uuid>` and writes
 * `<config>/projects/<cwd-slug>/<uuid>.jsonl`, which makes the mapping exact. A
 * fresh id per launch is required: Claude Code refuses an id whose transcript
 * already exists ("Session ID ... is already in use"), so reusing the chat id
 * would break a relaunch of the same chat.
 *
 * Codex CLI has no equivalent flag, so its record keeps the launch moment and
 * the project path, and the transcript is correlated by its `session_meta` cwd
 * and start time.
 */
export interface AgentLaunch {
  agentName: string
  /** Session id handed to the agent's argv; null when the agent chooses it. */
  sessionId: string | null
  /** Launch moment (epoch ms), the lower bound for transcript correlation. */
  startedAt: number
  /** Project root the agent runs in; transcripts record it as their cwd. */
  projectPath: string
}

export class AgentSessionRegistry {
  readonly #launches = new Map<string, AgentLaunch>()

  register(
    chatId: string,
    agentName: string | undefined,
    projectPath: string,
    now: number = Date.now(),
  ): AgentLaunch {
    const launch: AgentLaunch = {
      agentName: agentName ?? '',
      sessionId: agentName === 'Claude' ? randomUUID() : null,
      startedAt: now,
      projectPath,
    }
    this.#launches.set(chatId, launch)
    return launch
  }

  launch(chatId: string): AgentLaunch | null {
    return this.#launches.get(chatId) ?? null
  }

  /**
   * Points the chat at the session the profile named (resume), or clears the id
   * when the session cannot be named (`--continue` continues the latest
   * session, `--fork-session` creates a new one). Clearing keeps polls from
   * looking for a transcript that cannot exist under that id.
   */
  setSessionId(chatId: string, sessionId: string | null): void {
    const launch = this.#launches.get(chatId)
    if (launch !== undefined) launch.sessionId = sessionId
  }

  forget(chatId: string): void {
    this.#launches.delete(chatId)
  }
}

/** Flags whose presence means the profile decides the session itself. */
const SESSION_FLAGS = ['--session-id', '--resume', '-r', '--continue', '-c', '--fork-session']

/** True for `--resume`, `--resume=<id>`, `-r`, `--continue`, `-c`, `--fork-session`. */
function choosesSession(arg: string): boolean {
  const flag = arg.split('=')[0]
  return SESSION_FLAGS.includes(flag)
}

/** Flags that carry the session id as their value. */
const ID_FLAGS = ['--session-id', '--resume', '-r']

/**
 * Session id named by the profile itself, or null when it names none. Only the
 * arguments the agent owns are inspected, so a Node option before the script
 * never counts.
 */
export function profileSessionId(executable: string, args: readonly string[]): string | null {
  const agentArgs = args.slice(agentArgIndex(executable, args))
  for (let index = 0; index < agentArgs.length; index++) {
    const arg = agentArgs[index]
    const [flag, inline] = arg.split('=', 2)
    if (!ID_FLAGS.includes(flag)) continue
    if (inline !== undefined && inline.length > 0) return inline
    const next = agentArgs[index + 1]
    if (next !== undefined && !next.startsWith('-')) return next
  }
  return null
}

/**
 * Whether the AGENT's own arguments already choose the session. Only the
 * arguments the agent owns are inspected, so a Node option such as `-r` before
 * the script never counts.
 */
export function choosesOwnSession(executable: string, args: readonly string[]): boolean {
  return args.slice(agentArgIndex(executable, args)).some(choosesSession)
}

/**
 * Launch argv with the session id placed before the agent's positional prompt:
 * after the script for a Node launch, at the front for a direct CLI. A profile
 * that already chooses its own session keeps its argv untouched; its transcript
 * is then unknown and the tile stays without a meter.
 */
export function withSessionId(
  executable: string,
  args: readonly string[],
  sessionId: string | null,
): string[] {
  if (sessionId === null) return [...args]
  if (choosesOwnSession(executable, args)) return [...args]
  const at = agentArgIndex(executable, args)
  return [...args.slice(0, at), '--session-id', sessionId, ...args.slice(at)]
}
