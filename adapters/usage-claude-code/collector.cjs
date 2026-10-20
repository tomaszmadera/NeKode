// NeKode usage collector for the Claude Code status line.
//
// Claude Code runs the status-line command with session JSON on stdin. This collector maps only
// the documented subscription `rate_limits` windows to a normalized usage document (schema 1)
// and atomically replaces the configured output file, which NeKode reads with the built-in
// "Normalized JSON file" adapter. It never reads context-window fields as quota, never prints
// or logs the payload, and never contacts a server.
//
// Quota observation time is not part of the payload, so every metric has `observedAt: null`
// (Age unknown) and `collectedAt` records when this collector first received that value. An
// unchanged payload does not rewrite the file. With `--pass-through` the raw input is copied to
// stdout so a previous status-line command piped after this one keeps working.
//
// Usage: node collector.cjs --output <absolute json> --connection-id <id>
//          [--provider-id claude] [--pass-through]
// Docs: docs/features/usage-quota/claude-code.md
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const MAX_INPUT_BYTES = 1024 * 1024
const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const WINDOWS = [
  { key: 'five_hour', label: '5h', seconds: 5 * 3600, always: true },
  { key: 'seven_day', label: '7d', seconds: 7 * 86400, always: true },
  // Spend limits have a daily, weekly or monthly period; the length is not derived here.
  { key: 'spend_limit', label: 'Spend limit', seconds: null, always: false },
]

function parseArgs(argv) {
  const options = { providerId: 'claude', passThrough: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--nekode-usage') continue // setup marker identifying the installed command
    if (arg === '--pass-through') options.passThrough = true
    else if (arg === '--output') options.output = argv[++i]
    else if (arg === '--connection-id') options.connectionId = argv[++i]
    else if (arg === '--provider-id') options.providerId = argv[++i]
    else throw new Error('unknown argument')
  }
  if (typeof options.output !== 'string' || !path.isAbsolute(options.output))
    throw new Error('--output must be an absolute path')
  if (!ID_PATTERN.test(options.connectionId ?? '') || !ID_PATTERN.test(options.providerId))
    throw new Error('--connection-id and --provider-id must be 1-128 letters, digits, . _ -')
  return options
}

function windowMetric(spec, raw, collectedAt) {
  const base = { id: spec.key, label: spec.label, kind: 'window', observedAt: null }
  if (raw === undefined || raw === null)
    return { ...base, state: 'unavailable', reason: 'not_reported' }
  const percent = raw.used_percentage
  const reset = raw.resets_at
  if (
    typeof percent !== 'number' ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    (reset != null && (typeof reset !== 'number' || !Number.isFinite(reset) || reset <= 0))
  )
    return { ...base, state: 'unavailable', reason: 'invalid_value' }
  const resetsAt = reset == null ? null : new Date(Math.round(reset) * 1000).toISOString()
  return {
    ...base,
    state: 'available',
    collectedAt,
    usedPercent: percent,
    resetsAt,
    windowDurationSeconds: spec.seconds,
    periodStart:
      resetsAt && spec.seconds
        ? new Date(Date.parse(resetsAt) - spec.seconds * 1000).toISOString()
        : null,
  }
}

/**
 * Map a status-line payload. Returns null when the payload carries no `rate_limits` object at
 * all: Claude Code omits it before the session's first API response, so it says nothing new.
 */
function mapStatusLine(payload, { connectionId, providerId }, now = new Date()) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('status-line input is not a JSON object')
  const limits = payload.rate_limits
  if (limits === undefined || limits === null) return null
  if (typeof limits !== 'object' || Array.isArray(limits)) throw new Error('invalid rate_limits')
  const collectedAt = now.toISOString()
  const metrics = WINDOWS.filter((spec) => spec.always || limits[spec.key] != null).map((spec) =>
    windowMetric(spec, limits[spec.key], collectedAt),
  )
  return {
    schemaVersion: 1,
    subscriptions: [
      {
        id: connectionId,
        providerId,
        label: 'Claude Code',
        sourceKind: 'cli',
        status: metrics.some((m) => m.state === 'available') ? 'available' : 'unavailable',
        collectedAt,
        metrics,
      },
    ],
  }
}

/** Placeholder written when nothing has been reported yet, so absence is explicit. */
function notReported({ connectionId, providerId }, now = new Date()) {
  return mapStatusLine({ rate_limits: {} }, { connectionId, providerId }, now)
}

function withoutCollection(document) {
  return JSON.stringify(document, (key, value) => (key === 'collectedAt' ? undefined : value))
}

function readExisting(file) {
  try {
    if (fs.statSync(file).size > MAX_INPUT_BYTES) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function atomicWrite(file, document) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' })
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(temporary, file)
        return
      } catch (error) {
        // A reader can briefly hold the target open on Windows; retry a few times.
        if (attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
      }
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

/** Write the mapped document unless it is unchanged or carries no rate-limit information. */
function collect(payload, options, now = new Date()) {
  const existing = readExisting(options.output)
  let document = mapStatusLine(payload, options, now)
  if (!document) {
    if (existing) return 'unchanged'
    document = notReported(options, now)
  }
  if (existing && withoutCollection(existing) === withoutCollection(document)) return 'unchanged'
  atomicWrite(options.output, document)
  return 'written'
}

function main() {
  const chunks = []
  let size = 0
  process.stdin.on('data', (chunk) => {
    size += chunk.length
    if (size <= MAX_INPUT_BYTES) chunks.push(chunk)
  })
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks)
    let options = null
    try {
      options = parseArgs(process.argv.slice(2))
    } catch (error) {
      process.stderr.write(`NeKode usage collector: ${error.message}\n`)
      process.exitCode = 1
    }
    // Keep the previous status line working even when collection fails.
    if (options?.passThrough || process.argv.includes('--pass-through')) process.stdout.write(raw)
    if (!options) return
    try {
      if (size > MAX_INPUT_BYTES) throw new Error('status-line input exceeds 1 MiB')
      collect(JSON.parse(raw.toString('utf8')), options)
    } catch (error) {
      // Never echo payload content; only the failure category.
      const reason = error instanceof SyntaxError ? 'status-line input is not JSON' : error.message
      process.stderr.write(`NeKode usage collector: ${reason}\n`)
      process.exitCode = 1
    }
  })
}

if (require.main === module) main()

module.exports = { collect, mapStatusLine, notReported, parseArgs }
