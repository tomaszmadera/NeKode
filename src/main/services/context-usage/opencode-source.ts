import { statSync } from 'node:fs'
import Database from 'better-sqlite3'

/**
 * OpenCode session context, read from OpenCode's own SQLite database
 * (spec left-panel Data / API, NEKODE-167).
 *
 * `<data>/opencode/opencode.db` keeps every session in `session` and every
 * turn in `message`, whose `data` column is the message JSON. The count is the
 * prompt size of the latest completed assistant turn: `tokens.input` plus
 * `tokens.cache.read` and `tokens.cache.write`. A turn still in progress is
 * stored with zero tokens and no `time.completed`, so it never replaces the
 * previous completed turn.
 *
 * The connection is read-only and must find an existing file; only SELECT
 * statements run and nothing checkpoints, so `opencode.db` and its `-wal` file
 * stay unchanged. The `-shm` file receives the reader marks every SQLite reader
 * writes (user decision of 2026-11-19).
 */

export interface OpenCodeSession {
  id: string
  directory: string
  createdAt: number
}

export interface OpenCodeSnapshot {
  /** Top-level sessions created at or after the requested moment, oldest first. */
  sessions: OpenCodeSession[]
  /** Prompt size of each listed session's latest completed turn, when it has one. */
  tokens: Map<string, number>
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Prompt tokens of one completed assistant message, or null for any other row. */
export function openCodeMessageTokens(data: string): number | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const message = parsed as Record<string, unknown>
  if (message.role !== 'assistant') return null
  const time = message.time
  if (typeof time !== 'object' || time === null) return null
  if (finite((time as Record<string, unknown>).completed) === null) return null
  const tokens = message.tokens
  if (typeof tokens !== 'object' || tokens === null) return null
  const record = tokens as Record<string, unknown>
  const input = finite(record.input)
  if (input === null) return null
  const cache = record.cache
  const cacheRecord =
    typeof cache === 'object' && cache !== null ? (cache as Record<string, unknown>) : {}
  const prompt = input + (finite(cacheRecord.read) ?? 0) + (finite(cacheRecord.write) ?? 0)
  // An aborted turn can complete without usage; zero is not a context size.
  return prompt > 0 ? prompt : null
}

/**
 * Sessions created at or after `since` and their latest completed turn. Any
 * failure (missing file, locked or foreign database, missing table or column)
 * yields null, so the caller shows no number rather than a guess.
 */
export function readOpenCodeSnapshot(file: string, since: number): OpenCodeSnapshot | null {
  let db: Database.Database | null = null
  try {
    db = new Database(file, { readonly: true, fileMustExist: true })
    const rows = db
      .prepare(
        `SELECT id, directory, time_created FROM session
         WHERE parent_id IS NULL AND time_created >= ?
         ORDER BY time_created ASC, id ASC`,
      )
      .all(since) as Array<{ id: unknown; directory: unknown; time_created: unknown }>
    const sessions: OpenCodeSession[] = []
    for (const row of rows) {
      const createdAt = finite(row.time_created)
      if (typeof row.id !== 'string' || typeof row.directory !== 'string' || createdAt === null) {
        continue
      }
      sessions.push({ id: row.id, directory: row.directory, createdAt })
    }
    const messages = db.prepare(
      `SELECT data FROM message WHERE session_id = ?
       ORDER BY time_created DESC, id DESC`,
    )
    const tokens = new Map<string, number>()
    for (const session of sessions) {
      // Newest first; stop at the first completed turn so a long session reads
      // only its tail. Unparsable rows are skipped like torn transcript lines.
      for (const row of messages.iterate(session.id) as Iterable<{ data: unknown }>) {
        if (typeof row.data !== 'string') continue
        const count = openCodeMessageTokens(row.data)
        if (count === null) continue
        tokens.set(session.id, count)
        break
      }
    }
    return { sessions, tokens }
  } catch {
    return null
  } finally {
    db?.close()
  }
}

/** Size and modification time of the database and its WAL; null when the database is absent. */
export function openCodeSignature(file: string): string | null {
  const part = (path: string): string | null => {
    try {
      const info = statSync(path)
      return `${info.size}:${info.mtimeMs}`
    } catch {
      return null
    }
  }
  const main = part(file)
  if (main === null) return null
  return `${main}|${part(`${file}-wal`) ?? '-'}`
}
