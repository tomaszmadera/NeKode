import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '../../../shared/ipc-error'
import type { UsageAdapter, UsageDocument, UsageMetric } from '../../../shared/usage-contract'

export const CLAUDE_SNAPSHOT_ADAPTER: UsageAdapter = {
  id: 'claude-code-snapshots',
  name: 'Claude Code session snapshots',
  protocolVersion: 1,
  invocation: { command: 'Built-in Claude snapshot reader', args: [] },
  sourceKind: 'file',
  capabilities: ['window'],
  minimumRefreshSeconds: 5,
  configSchema: [
    { key: 'directory', label: 'Claude snapshot directory', type: 'directory', required: true },
  ],
}

/** Spec rule 16 bounds. */
export const CLAUDE_SNAPSHOT_MAX_FILES = 256
export const CLAUDE_SNAPSHOT_MAX_BYTES = 256 * 1024

const WINDOWS = [
  { key: 'five_hour', label: '5h', seconds: 5 * 3600, always: true },
  { key: 'seven_day', label: '7d', seconds: 7 * 86400, always: true },
  // Spend limits have a daily, weekly or monthly period; the length is not derived here.
  { key: 'spend_limit', label: 'Spend limit', seconds: null, always: false },
] as const

export interface Candidate {
  usedPercent: number
  resetsAt: number | null
}

function candidate(raw: unknown): Candidate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { used_percentage: percent, resets_at: reset } = raw as Record<string, unknown>
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0) return null
  if (reset == null) return { usedPercent: percent, resetsAt: null }
  if (typeof reset !== 'number' || !Number.isFinite(reset) || reset <= 0) return null
  const resetsAt = Math.round(reset)
  // Beyond the valid Date range the value cannot be a reset time.
  if (!Number.isFinite(new Date(resetsAt * 1000).getTime())) return null
  return { usedPercent: percent, resetsAt }
}

/**
 * Spec rule 16 order: a later reset wins, a numeric reset still in the future beats an unknown
 * one, an unknown reset beats a numeric reset that has passed at `now` (epoch milliseconds), and
 * for the same reset the higher value wins (usage in a window never drops). True when `a` is
 * strictly newer.
 */
export function newerWindow(a: Candidate, b: Candidate | undefined, now: number): boolean {
  if (!b) return true
  if (a.resetsAt !== b.resetsAt) {
    const expired = (reset: number) => reset * 1000 <= now
    if (a.resetsAt === null) return b.resetsAt !== null && expired(b.resetsAt)
    if (b.resetsAt === null) return !expired(a.resetsAt)
    return a.resetsAt > b.resetsAt
  }
  return a.usedPercent > b.usedPercent
}

function rateLimits(path: string): Record<string, unknown> | null {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size > CLAUDE_SNAPSHOT_MAX_BYTES) return null
    const bytes = readFileSync(path)
    if (bytes.length > CLAUDE_SNAPSHOT_MAX_BYTES) return null
    const document: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!document || typeof document !== 'object' || Array.isArray(document)) return null
    const limits = (document as Record<string, unknown>).rate_limits
    return limits && typeof limits === 'object' && !Array.isArray(limits)
      ? (limits as Record<string, unknown>)
      : null
  } catch {
    // Unreadable, partial, oversized or foreign files are skipped (spec rule 16).
    return null
  }
}

/**
 * Read one account's Claude Code session snapshots (spec rule 16). Only `rate_limits` is read
 * from at most the 256 most recently modified regular `*.json` files of at most 256 KiB each.
 * Modification time only selects files; it never sets freshness, so `observedAt` stays null.
 * The directory is never written. The caller validates the directory path first.
 */
export function readClaudeSnapshots(
  directory: string,
  connection: { id: string; providerId: string; label: string },
  now: number,
): UsageDocument {
  let names: string[]
  try {
    names = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => entry.name)
  } catch {
    throw new AppError(
      'io',
      'Cannot read Claude snapshot directory. Collection retries automatically.',
    )
  }
  const files: { path: string; mtime: number }[] = []
  for (const name of names) {
    const path = join(directory, name)
    try {
      const stat = lstatSync(path)
      if (stat.isFile()) files.push({ path, mtime: stat.mtimeMs })
    } catch {
      /* Removed between listing and stat; skip it. */
    }
  }
  files.sort((a, b) => b.mtime - a.mtime || (a.path < b.path ? -1 : 1))
  const best = new Map<string, Candidate>()
  const present = new Set<string>()
  for (const file of files.slice(0, CLAUDE_SNAPSHOT_MAX_FILES)) {
    const limits = rateLimits(file.path)
    if (!limits) continue
    for (const spec of WINDOWS) {
      if (limits[spec.key] == null) continue
      present.add(spec.key)
      const value = candidate(limits[spec.key])
      if (value && newerWindow(value, best.get(spec.key), now)) best.set(spec.key, value)
    }
  }
  const collectedAt = new Date(now).toISOString()
  const metrics: UsageMetric[] = WINDOWS.filter((spec) => spec.always || present.has(spec.key)).map(
    (spec) => {
      const base = { id: spec.key, label: spec.label, kind: 'window' as const, observedAt: null }
      const value = best.get(spec.key)
      if (!value) return { ...base, state: 'unavailable', reason: 'not_reported' }
      const resetsAt =
        value.resetsAt === null ? null : new Date(value.resetsAt * 1000).toISOString()
      return {
        ...base,
        state: 'available',
        collectedAt,
        usedPercent: value.usedPercent,
        resetsAt,
        windowDurationSeconds: spec.seconds,
        periodStart:
          value.resetsAt !== null && spec.seconds
            ? new Date((value.resetsAt - spec.seconds) * 1000).toISOString()
            : null,
      }
    },
  )
  return {
    schemaVersion: 1,
    subscriptions: [
      {
        id: connection.id,
        providerId: connection.providerId,
        label: connection.label,
        sourceKind: 'file',
        status: metrics.some((m) => m.state === 'available') ? 'available' : 'unavailable',
        metrics,
      },
    ],
  }
}
