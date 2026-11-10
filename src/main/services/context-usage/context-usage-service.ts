import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatInfo } from '@shared/contracts/chats-contract'
import type { ProjectInfo } from '@shared/contracts/projects-contract'
import { projectEnvironment, projectWslLocation } from '@shared/project-environment'
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
 *   start time: a rollout must have started no earlier than
 *   `START_TOLERANCE_MS` before the launch and no later than
 *   `MAX_START_AFTER_MS` after it, a rollout belongs to one chat, and the
 *   accepted pairing is the assignment with the smallest total distance over
 *   every remaining chat and rollout. Two guards withhold a guess: pending
 *   chats in one directory launched within the tolerance of each other, and,
 *   when the best assignment is not better than the next one by a full margin,
 *   the chats whose pairing flips between those two readings.
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
/**
 * Two candidate assignments whose total distance differs by less than this are
 * indistinguishable: the launch moment is recorded before the CLI starts and
 * session_meta is stamped when it writes, so both timestamps already carry up
 * to a second of noise. Below one margin the pairing is a guess, not a match.
 */
const AMBIGUITY_MARGIN_MS = 1_000
/** Cost of leaving a chat without a transcript; above any accepted distance. */
const UNMATCHED_PENALTY = START_TOLERANCE_MS + MAX_START_AFTER_MS + 1
/** Cost of a chat x rollout pair that is not a candidate at all. */
const FORBIDDEN_COST = 1e9
/** A rollout written within this window belongs to a session that still writes. */
const LIVE_WINDOW_MS = 60_000
/** How long a failed one-level transcript scan is trusted before retrying. */
const SCAN_TTL_MS = 30_000

interface CachedTokens {
  mtimeMs: number
  size: number
  tokens: number
}

interface CodexCandidate {
  file: string
  /** Distance between the rollout start and the launch. */
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
    return Date.now() - statSync(file).mtimeMs <= LIVE_WINDOW_MS
  } catch {
    return false
  }
}

/**
 * Minimum-cost assignment of every row to a distinct column (Hungarian method
 * over shortest augmenting paths). Rows must not outnumber columns, and every
 * row is assigned, so a chat that may stay unmatched needs its own column.
 */
function minCostAssignment(cost: ReadonlyArray<ReadonlyArray<number>>): number[] {
  const rows = cost.length
  const columns = cost[0].length
  const rowPotential = new Array<number>(rows + 1).fill(0)
  const columnPotential = new Array<number>(columns + 1).fill(0)
  /** matchedRow[column] is the 1-based row held by that column, 0 when free. */
  const matchedRow = new Array<number>(columns + 1).fill(0)
  const cameFrom = new Array<number>(columns + 1).fill(0)
  for (let row = 1; row <= rows; row++) {
    matchedRow[0] = row
    let column = 0
    const slack = new Array<number>(columns + 1).fill(Number.POSITIVE_INFINITY)
    const used = new Array<boolean>(columns + 1).fill(false)
    do {
      used[column] = true
      const current = matchedRow[column]
      let delta = Number.POSITIVE_INFINITY
      let next = 0
      for (let candidate = 1; candidate <= columns; candidate++) {
        if (used[candidate]) continue
        const reduced =
          cost[current - 1][candidate - 1] - rowPotential[current] - columnPotential[candidate]
        if (reduced < slack[candidate]) {
          slack[candidate] = reduced
          cameFrom[candidate] = column
        }
        if (slack[candidate] < delta) {
          delta = slack[candidate]
          next = candidate
        }
      }
      for (let candidate = 0; candidate <= columns; candidate++) {
        if (used[candidate]) {
          rowPotential[matchedRow[candidate]] += delta
          columnPotential[candidate] -= delta
        } else {
          slack[candidate] -= delta
        }
      }
      column = next
    } while (matchedRow[column] !== 0)
    do {
      const prior = cameFrom[column]
      matchedRow[column] = matchedRow[prior]
      column = prior
    } while (column !== 0)
  }
  const assignment = new Array<number>(rows).fill(-1)
  for (let column = 1; column <= columns; column++) {
    if (matchedRow[column] !== 0) assignment[matchedRow[column] - 1] = column - 1
  }
  return assignment
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
        // Remote projects have no local rollout directory. The WSL lookup keeps
        // the parser's error for a malformed stored path, as before.
        if (
          projectEnvironment(project.path).kind === 'ssh' ||
          projectWslLocation(project.path) !== null
        )
          continue
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
   * Assigns rollouts to the chats that have none yet.
   *
   * Every chat x rollout pair inside the identity bounds is a candidate, and the
   * accepted pairing is the one with the smallest total distance: a per-chat
   * nearest pick hands the closer chat a rollout that belongs to an earlier
   * launch and leaves its real owner without a number. Two guards keep a guess
   * off the tile: pending chats in one directory launched within the tolerance
   * of each other cannot be told apart, and when the next-best assignment is
   * less than one margin away only the chats whose pairing flips between the
   * two readings stay silent. A rollout already claimed is not a candidate.
   */
  #assignCodex(
    configDir: string,
    pending: ReadonlyArray<{ chatId: string; launch: AgentLaunch }>,
    result: Record<string, number>,
  ): void {
    if (pending.length === 0) return
    const ambiguous = this.#ambiguousLaunches(pending)
    const chats = pending.filter((entry) => !ambiguous.has(entry.chatId))
    if (chats.length === 0) return
    const claimed = new Set(this.#codexClaims.keys())
    const rollouts = this.#codexRollouts(configDir)
    const columns: string[] = []
    const candidates = chats.map(({ launch }) => {
      const wanted = normalizePath(launch.projectPath)
      const found: CodexCandidate[] = []
      for (const file of rollouts) {
        if (claimed.has(file)) continue
        const meta = this.#codexMetaFor(file)
        if (meta === null || normalizePath(meta.cwd) !== wanted) continue
        const distance = meta.startedAt - launch.startedAt
        if (distance < -START_TOLERANCE_MS || distance > MAX_START_AFTER_MS) continue
        found.push({ file, distance: Math.abs(distance) })
        if (!columns.includes(file)) columns.push(file)
      }
      return found
    })
    if (columns.length === 0) return
    const cost = candidates.map((found) => {
      const pairs = columns.map((file) => {
        const match = found.find((entry) => entry.file === file)
        return match === undefined ? FORBIDDEN_COST : match.distance
      })
      // One dummy column per chat keeps it unmatched at a cost above any
      // accepted distance, so a clear pairing still wins over no pairing.
      return [...pairs, ...Array.from({ length: chats.length }, () => UNMATCHED_PENALTY)]
    })
    const total = (matrix: ReadonlyArray<ReadonlyArray<number>>, rows: readonly number[]): number =>
      rows.reduce((sum, column, row) => sum + matrix[row][column], 0)
    const best = minCostAssignment(cost)
    const bestTotal = total(cost, best)
    // The next-best solution is the best one that changes at least one pairing,
    // which is the cheapest optimum found after forbidding one accepted pair.
    // Only the chats whose pairing changes between the two solutions are
    // ambiguous; every other chat keeps the number its own start supports.
    const withheld = new Set<number>()
    for (let row = 0; row < best.length; row++) {
      if (best[row] >= columns.length) continue
      const raised = cost.map((line) => [...line])
      raised[row][best[row]] = FORBIDDEN_COST
      const alternative = minCostAssignment(raised)
      if (total(raised, alternative) - bestTotal >= AMBIGUITY_MARGIN_MS) continue
      for (let other = 0; other < alternative.length; other++) {
        if (alternative[other] !== best[other]) withheld.add(other)
      }
    }
    for (let row = 0; row < best.length; row++) {
      if (withheld.has(row)) continue
      const column = best[row]
      if (column >= columns.length) continue
      const chatId = chats[row].chatId
      const file = columns[column]
      this.#codexFiles.set(chatId, file)
      this.#codexClaims.set(file, chatId)
      const tokens = this.#tokens(file)
      if (tokens !== null) result[chatId] = tokens
    }
  }

  /**
   * Pending chats in one directory launched closer to each other than the start
   * tolerance cannot be told apart by time, so the whole group stays silent.
   */
  #ambiguousLaunches(pending: ReadonlyArray<{ chatId: string; launch: AgentLaunch }>): Set<string> {
    const ambiguous = new Set<string>()
    for (let left = 0; left < pending.length; left++) {
      for (let right = left + 1; right < pending.length; right++) {
        const first = pending[left]
        const second = pending[right]
        if (normalizePath(first.launch.projectPath) !== normalizePath(second.launch.projectPath)) {
          continue
        }
        if (Math.abs(first.launch.startedAt - second.launch.startedAt) >= START_TOLERANCE_MS) {
          continue
        }
        ambiguous.add(first.chatId)
        ambiguous.add(second.chatId)
      }
    }
    return ambiguous
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
