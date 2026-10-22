// NeKode Claude Code status-line snapshot writer.
//
// Claude Code runs the status-line command with session JSON on stdin. This writer stores one
// file per session, `<dir>/<session_id>.json`, by atomic rename. The file holds only
// `session_id` and the raw `rate_limits` object; NeKode's built-in "Claude Code session
// snapshots" reader merges the files of one account (spec rule 16). Context-window, cost, path
// and model fields are never written, the payload is never printed or logged, and no server is
// contacted. A payload without `rate_limits` (before the session's first API response) and an
// unchanged payload write nothing. With `--pass-through` the raw input is copied to stdout so a
// previous status-line command piped after this one keeps working.
//
// `--dir` is required; there is no default directory (spec rule 24). NeKode proposes one
// directory per Claude account in its settings. Record each Claude account once per computer:
// if another tool already writes these snapshots, read its directory instead of adding this writer.
//
// Usage: node collector.cjs --dir <absolute directory> [--pass-through]
// Docs: docs/features/usage-quota/claude-code.md
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const MAX_INPUT_BYTES = 1024 * 1024
/** The reader skips larger files (spec rule 16). */
const MAX_SNAPSHOT_BYTES = 256 * 1024
const SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function parseArgs(argv) {
  const options = { passThrough: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--nekode-usage') continue // setup marker identifying the installed command
    if (arg === '--pass-through') options.passThrough = true
    else if (arg === '--dir') options.dir = argv[++i]
    else throw new Error('unknown argument')
  }
  if (typeof options.dir !== 'string' || !path.isAbsolute(options.dir))
    throw new Error('--dir is required and must be an absolute path')
  return options
}

function atomicWrite(file, text) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, text, { flag: 'wx' })
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

/** Write this session's snapshot unless it carries no rate limits or is unchanged. */
function collect(payload, options) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('status-line input is not a JSON object')
  const limits = payload.rate_limits
  if (limits === undefined || limits === null) return 'skipped'
  if (typeof limits !== 'object' || Array.isArray(limits)) throw new Error('invalid rate_limits')
  const sessionId = payload.session_id
  if (typeof sessionId !== 'string' || !SESSION_PATTERN.test(sessionId))
    throw new Error('invalid session_id')
  const text = `${JSON.stringify({ session_id: sessionId, rate_limits: limits }, null, 2)}\n`
  if (Buffer.byteLength(text) > MAX_SNAPSHOT_BYTES) throw new Error('rate_limits exceed 256 KiB')
  const file = path.join(options.dir, `${sessionId}.json`)
  try {
    if (fs.readFileSync(file, 'utf8') === text) return 'unchanged'
  } catch {
    /* No previous snapshot for this session. */
  }
  fs.mkdirSync(options.dir, { recursive: true })
  atomicWrite(file, text)
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

module.exports = { collect, parseArgs }
