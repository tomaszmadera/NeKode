import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatInfo } from '@shared/contracts/chats-contract'
import type { ProjectInfo } from '@shared/contracts/projects-contract'
import { parseSshTarget } from '@shared/ssh-target'
import { parseWslPath } from '@shared/wsl-path'
import type { AgentLaunch } from '../agent-session-registry'

/**
 * Context used by one agent chat, read from the agent CLI's own transcript
 * (spec left-panel Behaviour: the context meter).
 *
 * Two sources are understood, both reporting the prompt size of the session's
 * latest turn, which is the number that decides how close the session is to its
 * limit:
 *
 * - Claude Code: `<config>/projects/<cwd-slug>/<session-id>.jsonl`; the last
 *   assistant entry's `message.usage` (input plus prompt-cache read and write).
 *   The launch hands Claude its own `--session-id` or reuses the id the profile
 *   names (resume), so the file is exact.
 * - Codex CLI: `<config>/sessions/<Y>/<M>/<D>/rollout-*.jsonl`; the last
 *   `token_count` event's `last_token_usage.input_tokens`. Codex has no
 *   session-id flag, so rollouts are correlated by their `session_meta` cwd and
 *   start time, under three rules: a rollout that started more than
 *   `MAX_START_AFTER_MS` after the launch is not this chat's, a rollout belongs
 *   to one chat, and when two chats compete for one rollout the closer start
 *   wins.
 *
 * Numbers come from the transcript, never from a guess: a chat whose
 * transcript cannot be read is absent from the result and its tile renders no
 * meter.
 */

/** Tail window read first; a usage line older than this grows the window. */
const TAIL_BYTES = 256 * 1024
/** Hard ceiling for the growing tail read (whole file when smaller). */
const MAX_BYTES = 16 * 1024 * 1024
/** Codex session_meta is the first line; this is more than enough for it. */
const META_BYTES = 64 * 1024
/** Clock tolerance before the launch moment when matching a rollout. */
const START_TOLERANCE_MS = 2_000
/**
 * A rollout that started later than this after the launch belongs to another
 * session: a Codex session writes its session_meta within a second or two of
 * starting. Without this bound an unmatched chat could adopt any later
 * session's rollout and keep it.
 */
const MAX_START_AFTER_MS = 30_000
/** A rollout written within this window may be a resumed, still-live session. */
const RESUME_WINDOW_MS = 60_000
/** How long a failed one-level transcript scan is trusted before retrying. */
const SCAN_TTL_MS = 30_000

interface CachedTokens {
  mtimeMs: number
  size: number
  tokens: number
}

interface CodexProposal {
  chatId: string
  file: string
  /** Distance from the launch; resumed rollouts are ranked last. */
  distance: number
}

export interface CodexSessionMeta {
  cwd: string
  startedAt: number
}

export interface ContextUsageDeps {
  projects: { list(): ProjectInfo[] }
  chats: { list(projectId: string): ChatInfo[] }
  /** Launch record of a chat: agent, Claude session id, start moment, cwd. */
  launch: (chatId: string) => AgentLaunch | null
  /** Claude Code config directory (CLAUDE_CONFIG_DIR, else ~/.claude). */
  claudeConfigDir: () => string
  /** Codex CLI config directory (CODEX_HOME, else ~/.codex). */
  codexConfigDir: () => string
}

function usageTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const record = usage as Record<string, unknown>
  const input = record.input_tokens
  if (typeof input !== 'number' || !Number.isFinite(input)) return null
  const cached =
    typeof record.cache_read_input_tokens === 'number' ? record.cache_read_input_tokens : 0
  const created =
    typeof record.cache_creation_input_tokens === 'number' ? record.cache_creation_input_tokens : 0
  return input + cached + created
}

/** Claude Code: prompt tokens of the last assistant message. */
function claudePick(doc: Record<string, unknown>): number | null {
  const message = doc.message
  if (typeof message !== 'object' || message === null) return null
  return usageTokens((message as { usage?: unknown }).usage)
}

/** Codex CLI: prompt tokens of the session's last turn. */
function codexPick(doc: Record<string, unknown>): number | null {
  const payload = doc.payload
  if (typeof payload !== 'object' || payload === null) return null
  const event = payload as Record<string, unknown>
  if (event.type !== 'token_count') return null
  const info = event.info
  if (typeof info !== 'object' || info === null) return null
  const last = (info as Record<string, unknown>).last_token_usage
  if (typeof last !== 'object' || last === null) return null
  const input = (last as Record<string, unknown>).input_tokens
  return typeof input === 'number' && Number.isFinite(input) ? input : null
}

/**
 * Newest match found by walking the file backwards. Works from the end because
 * a long session can be many megabytes and only the newest usage matters.
 */
function scanTail(
  file: string,
  pick: (doc: Record<string, unknown>) => number | null,
): number | null {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    return null
  }
  if (size === 0) return null
  let window = Math.min(size, TAIL_BYTES)
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    while (true) {
      const buffer = Buffer.alloc(window)
      const read = readSync(fd, buffer, 0, window, size - window)
      const text = buffer.subarray(0, read).toString('utf8')
      const lines = text.split('\n')
      // The oldest line of a window that does not start at 0 may be cut in half.
      const first = window === size ? 0 : 1
      for (let index = lines.length - 1; index >= first; index--) {
        const line = lines[index].trim()
        if (!line.startsWith('{')) continue
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        if (typeof parsed !== 'object' || parsed === null) continue
        const tokens = pick(parsed as Record<string, unknown>)
        if (tokens !== null) return tokens
      }
      if (window >= size || window >= MAX_BYTES) return null
      window = Math.min(size, window * 2, MAX_BYTES)
    }
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** Claude Code context in use: the last assistant message's prompt tokens. */
export function readContextTokens(file: string): number | null {
  return scanTail(file, claudePick)
}

/** Codex CLI context in use: the last turn's prompt tokens. */
export function readCodexContextTokens(file: string): number | null {
  return scanTail(file, codexPick)
}

/**
 * Codex rollout identity: the cwd it ran in and the moment it started. A torn
 * read (the agent is still appending the line) returns null, and callers retry
 * rather than remember that null.
 */
export function readCodexSessionMeta(file: string): CodexSessionMeta | null {
  let fd: number | null = null
  try {
    const size = statSync(file).size
    const window = Math.min(size, META_BYTES)
    fd = openSync(file, 'r')
    const buffer = Buffer.alloc(window)
    const read = readSync(fd, buffer, 0, window, 0)
    for (const line of buffer.subarray(0, read).toString('utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{')) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (typeof parsed !== 'object' || parsed === null) continue
      const doc = parsed as Record<string, unknown>
      if (doc.type !== 'session_meta') continue
      const payload = doc.payload
      if (typeof payload !== 'object' || payload === null) continue
      const meta = payload as Record<string, unknown>
      const cwd = meta.cwd
      const timestamp = meta.timestamp
      if (typeof cwd !== 'string' || typeof timestamp !== 'string') return null
      const startedAt = Date.parse(timestamp)
      if (!Number.isFinite(startedAt)) return null
      return { cwd, startedAt }
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** Claude Code's directory name for a working directory: every non-alphanumeric byte becomes `-`. */
export function transcriptDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** A rollout this fresh belongs to a session that is still writing. */
function isRecentlyWritten(file: string): boolean {
  try {
    return Date.now() - statSync(file).mtimeMs <= RESUME_WINDOW_MS
  } catch {
    return false
  }
}

export class ContextUsageService {
  readonly #deps: ContextUsageDeps
  /** Tokens by transcript path; re-read only when the file changed. */
  readonly #cache = new Map<string, CachedTokens>()
  /** Claude transcript found by the fallback scan, per session id. */
  readonly #claudeFiles = new Map<string, string>()
  /** Codex rollout per chat; dropped when it disappears or goes quiet. */
  readonly #codexFiles = new Map<string, string>()
  /** A rollout belongs to one chat only. */
  readonly #codexClaims = new Map<string, string>()
  /** Codex session_meta per rollout; immutable, so read once it parses. */
  readonly #codexMeta = new Map<string, CodexSessionMeta>()
  /** Last failed one-level Claude scan per session id, so a poll stays cheap. */
  readonly #claudeMisses = new Map<string, number>()
  /** Rollout list for the current usage() pass, so chats do not repeat the walk. */
  #rollouts: string[] | null = null

  constructor(deps: ContextUsageDeps) {
    this.#deps = deps
  }

  /**
   * Tokens in use per chat. Local projects only: an SSH project's transcript
   * lives on the remote host and a WSL project's under the Linux home, so both
   * stay silent instead of reading a same-named local file.
   */
  usage(): Record<string, number> {
    const result: Record<string, number> = {}
    const claudeDir = this.#deps.claudeConfigDir()
    const codexDir = this.#deps.codexConfigDir()
    const seen = new Set<string>()
    const pending: Array<{ chatId: string; launch: AgentLaunch }> = []
    this.#rollouts = null
    try {
      for (const project of this.#deps.projects.list()) {
        if (parseSshTarget(project.path) !== null || parseWslPath(project.path) !== null) continue
        let chats: ChatInfo[]
        try {
          chats = this.#deps.chats.list(project.id)
        } catch {
          continue
        }
        for (const chat of chats) {
          const launch = this.#deps.launch(chat.id)
          if (launch === null) continue
          seen.add(chat.id)
          if (launch.agentName === 'Claude') {
            const file = this.#claudeTranscript(claudeDir, launch)
            if (file === null) continue
            const tokens = this.#tokens(file)
            if (tokens !== null) result[chat.id] = tokens
            continue
          }
          if (launch.agentName !== 'Codex') continue
          const known = this.#codexCached(chat.id)
          if (known !== null) {
            const tokens = this.#tokens(known)
            if (tokens !== null) result[chat.id] = tokens
            continue
          }
          pending.push({ chatId: chat.id, launch })
        }
      }
      this.#assignCodex(codexDir, pending, result)
    } finally {
      this.#rollouts = null
    }
    // A removed chat leaves no claim behind: a later chat that resumes the same
    // rollout must be able to claim it.
    for (const chatId of [...this.#codexFiles.keys()]) {
      if (seen.has(chatId)) continue
      const file = this.#codexFiles.get(chatId)
      this.#codexFiles.delete(chatId)
      if (file !== undefined && this.#codexClaims.get(file) === chatId) {
        this.#codexClaims.delete(file)
      }
    }
    return result
  }

  /**
   * `<config>/projects/<cwd-slug>/<session-id>.jsonl`, falling back to a
   * one-level scan for the id when the slug rule drifts. Both the direct hit and
   * a scanned hit are remembered, so the walk happens once; an ambiguous or
   * missing transcript yields no number.
   */
  #claudeTranscript(configDir: string, launch: AgentLaunch): string | null {
    if (launch.sessionId === null) return null
    const sessionId = launch.sessionId
    const remembered = this.#claudeFiles.get(sessionId)
    if (remembered !== undefined) {
      if (existsSync(remembered)) return remembered
      this.#claudeFiles.delete(sessionId)
    }
    const projectsDir = join(configDir, 'projects')
    const direct = join(projectsDir, transcriptDirName(launch.projectPath), `${sessionId}.jsonl`)
    if (existsSync(direct)) {
      this.#claudeFiles.set(sessionId, direct)
      this.#claudeMisses.delete(sessionId)
      return direct
    }
    // A failed scan only happens while the session has no transcript yet, so
    // remember it instead of walking the whole config tree on every poll.
    const missedAt = this.#claudeMisses.get(sessionId)
    if (missedAt !== undefined && Date.now() - missedAt < SCAN_TTL_MS) return null
    let entries: string[]
    try {
      entries = readdirSync(projectsDir)
    } catch {
      return null
    }
    const matches: string[] = []
    for (const entry of entries) {
      const candidate = join(projectsDir, entry, `${sessionId}.jsonl`)
      if (existsSync(candidate)) matches.push(candidate)
      if (matches.length > 1) return null
    }
    const found = matches[0] ?? null
    if (found === null) {
      this.#claudeMisses.set(sessionId, Date.now())
      return null
    }
    this.#claudeFiles.set(sessionId, found)
    this.#claudeMisses.delete(sessionId)
    return found
  }

  /** The chat's rollout from an earlier pass, while the file still looks live. */
  #codexCached(chatId: string): string | null {
    const known = this.#codexFiles.get(chatId)
    if (known === undefined) return null
    if (existsSync(known) && isRecentlyWritten(known)) return known
    this.#codexFiles.delete(chatId)
    if (this.#codexClaims.get(known) === chatId) this.#codexClaims.delete(known)
    return null
  }

  /**
   * Assigns rollouts to the chats that have none yet. Every chat proposes its
   * closest bounded candidate; proposals are accepted from the closest start
   * outwards, so when two chats compete for one rollout the one whose start
   * matches best wins and the other stays without a number. A rollout already
   * claimed, or a chat already served, is skipped.
   */
  #assignCodex(
    configDir: string,
    pending: ReadonlyArray<{ chatId: string; launch: AgentLaunch }>,
    result: Record<string, number>,
  ): void {
    if (pending.length === 0) return
    const proposals: CodexProposal[] = []
    for (const { chatId, launch } of pending) {
      const wanted = normalizePath(launch.projectPath)
      let best: { file: string; distance: number } | null = null
      let resumable: { file: string; mtimeMs: number } | null = null
      for (const file of this.#codexRollouts(configDir)) {
        const meta = this.#codexMetaFor(file)
        if (meta === null || normalizePath(meta.cwd) !== wanted) continue
        let mtimeMs: number
        try {
          mtimeMs = statSync(file).mtimeMs
        } catch {
          continue
        }
        // A session resumed by `codex resume` appends to a rollout that started
        // BEFORE this launch; a file that started later and merely happens to be
        // written now belongs to another session and is never adopted.
        if (
          meta.startedAt < launch.startedAt - START_TOLERANCE_MS &&
          mtimeMs >= launch.startedAt - RESUME_WINDOW_MS
        ) {
          if (resumable === null || mtimeMs > resumable.mtimeMs) resumable = { file, mtimeMs }
        }
        if (meta.startedAt < launch.startedAt - START_TOLERANCE_MS) continue
        if (meta.startedAt > launch.startedAt + MAX_START_AFTER_MS) continue
        const distance = Math.abs(meta.startedAt - launch.startedAt)
        if (best === null || distance < best.distance) best = { file, distance }
      }
      if (best !== null) {
        proposals.push({ chatId, file: best.file, distance: best.distance })
      } else if (resumable !== null) {
        proposals.push({ chatId, file: resumable.file, distance: Number.MAX_SAFE_INTEGER })
      }
    }
    proposals.sort((left, right) => left.distance - right.distance)
    const taken = new Set(this.#codexClaims.keys())
    const served = new Set<string>()
    for (const proposal of proposals) {
      if (served.has(proposal.chatId) || taken.has(proposal.file)) continue
      served.add(proposal.chatId)
      taken.add(proposal.file)
      this.#codexFiles.set(proposal.chatId, proposal.file)
      this.#codexClaims.set(proposal.file, proposal.chatId)
      const tokens = this.#tokens(proposal.file)
      if (tokens !== null) result[proposal.chatId] = tokens
    }
  }

  /** Null is never cached: a torn read must be retried on the next poll. */
  #codexMetaFor(file: string): CodexSessionMeta | null {
    const cached = this.#codexMeta.get(file)
    if (cached !== undefined) return cached
    const meta = readCodexSessionMeta(file)
    if (meta !== null) this.#codexMeta.set(file, meta)
    return meta
  }

  /** Every rollout file under `<config>/sessions`, walked once per usage() pass. */
  #codexRollouts(configDir: string): string[] {
    if (this.#rollouts !== null) return this.#rollouts
    const root = join(configDir, 'sessions')
    let entries: string[]
    try {
      entries = readdirSync(root, { recursive: true, encoding: 'utf8' })
    } catch {
      this.#rollouts = []
      return this.#rollouts
    }
    this.#rollouts = entries
      .filter((entry) => /(?:^|[\\/])rollout-[^\\/]*\.jsonl$/.test(entry))
      .map((entry) => join(root, entry))
    return this.#rollouts
  }

  #tokens(file: string): number | null {
    let stat: { mtimeMs: number; size: number }
    try {
      const info = statSync(file)
      stat = { mtimeMs: info.mtimeMs, size: info.size }
    } catch {
      return null
    }
    const cached = this.#cache.get(file)
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.tokens
    }
    // Both sources are JSONL but carry usage in different events; a transcript
    // only ever contains its own, so trying both keeps one cache keyed by path.
    const tokens = readContextTokens(file) ?? readCodexContextTokens(file)
    if (tokens === null) {
      this.#cache.delete(file)
      return null
    }
    this.#cache.set(file, { ...stat, tokens })
    return tokens
  }
}
