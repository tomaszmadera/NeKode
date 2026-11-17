'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MAX_RECORD_BYTES = 1024 * 1024
const MAX_BLOCK_BYTES = 64 * 1024
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
class AdapterFailure extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}
const object = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const nonblank = (value) => typeof value === 'string' && value.trim().length > 0
const invalid = (message, recordState = 'invalid') => ({
  recordState,
  errors: [message],
  state: 'active',
  title: null,
  phases: [],
  currentStepId: null,
  currentLabel: null,
  nextAction: null,
  blockers: null,
})

/** The prose stays opaque. Fences inside other fenced examples are not state blocks. */
function parseRecord(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_RECORD_BYTES)
    return invalid('work record exceeds 1 MiB')
  const blocks = []
  let fence = null
  let content = []
  for (const line of text.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)\r?$/.exec(line)
    if (fence) {
      if (
        match &&
        match[1][0] === fence.marker &&
        match[1].length >= fence.length &&
        match[2].trim() === ''
      ) {
        if (fence.state) blocks.push(content.join('\n'))
        fence = null
        content = []
      } else if (fence.state) content.push(line)
    } else if (match) {
      fence = {
        marker: match[1][0],
        length: match[1].length,
        state: line.replace(/\r$/, '') === '```nekode-state',
      }
    }
  }
  if (fence?.state) return invalid('nekode-state block has no closing fence')
  if (blocks.length === 0) return invalid('missing nekode-state block')
  if (blocks.length !== 1) return invalid('expected exactly one nekode-state block')
  if (Buffer.byteLength(blocks[0], 'utf8') > MAX_BLOCK_BYTES)
    return invalid('nekode-state block exceeds 64 KiB')
  let raw
  try {
    raw = JSON.parse(blocks[0])
  } catch {
    return invalid('nekode-state block has invalid JSON')
  }
  if (!object(raw)) return invalid('nekode-state must be an object')
  if (raw.schemaVersion !== 1)
    return invalid('unsupported nekode-state schemaVersion', 'unsupported')
  if (!['active', 'blocked', 'completed'].includes(raw.status))
    return invalid('status must be active, blocked, or completed')
  if (!Array.isArray(raw.phases)) return invalid('phases must be an array')
  const phases = []
  const steps = new Map()
  for (const phase of raw.phases) {
    if (!object(phase) || !nonblank(phase.name)) return invalid('phase name must be nonblank')
    if (!Array.isArray(phase.steps)) return invalid('phase steps must be an array')
    const normalized = { name: phase.name, steps: [] }
    for (const step of phase.steps) {
      if (!object(step) || !nonblank(step.id)) return invalid('step id must be nonblank')
      if (!nonblank(step.label)) return invalid('step label must be nonblank')
      if (typeof step.done !== 'boolean') return invalid('step done must be a boolean')
      if (steps.has(step.id)) return invalid(`duplicate step id: ${step.id}`)
      const item = { id: step.id, label: step.label, done: step.done }
      steps.set(step.id, item)
      normalized.steps.push(item)
    }
    phases.push(normalized)
  }
  for (const field of ['currentStepId', 'nextAction', 'blockers']) {
    if (raw[field] !== undefined && raw[field] !== null && typeof raw[field] !== 'string')
      return invalid(`${field} must be a string or null`)
  }
  if (raw.title !== undefined && typeof raw.title !== 'string')
    return invalid('title must be a string')
  if (
    raw.updatedAt !== undefined &&
    (typeof raw.updatedAt !== 'string' ||
      !ISO_UTC.test(raw.updatedAt) ||
      Number.isNaN(Date.parse(raw.updatedAt)))
  )
    return invalid('updatedAt must be an ISO 8601 UTC timestamp')
  const currentStepId = raw.currentStepId ?? null
  if (currentStepId !== null && !steps.has(currentStepId))
    return invalid('currentStepId names no step')
  return {
    recordState: 'valid',
    errors: [],
    state: raw.status,
    title: raw.title ?? null,
    phases,
    currentStepId,
    currentLabel: steps.get(currentStepId)?.label.slice(0, 40) ?? null,
    nextAction: raw.nextAction ?? null,
    blockers: raw.blockers ?? null,
    ...(raw.updatedAt === undefined ? {} : { updatedAt: raw.updatedAt }),
  }
}

function readFailure(error, relative) {
  // A disappearing file or directory can be retried by the existing scheduler.
  const code = ['ENOENT', 'ENOTDIR', 'EBUSY'].includes(error.code) ? 'transient' : 'config'
  return new AdapterFailure(code, `Cannot read ${relative}: ${error.message}`)
}
function statIfPresent(absolute, relative) {
  try {
    return fs.lstatSync(absolute)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw readFailure(error, relative)
  }
}

function scan(root) {
  let realRoot
  try {
    if (!fs.statSync(root).isDirectory()) throw new Error('not a directory')
    realRoot = fs.realpathSync(root)
  } catch (error) {
    throw new AdapterFailure('config', `Cannot read project directory: ${error.message}`)
  }
  const tasks = new Map()
  const watch = []
  let duplicates = 0
  function walk(directory, location) {
    let entries
    try {
      entries = fs.readdirSync(path.join(root, directory), { withFileTypes: true })
    } catch (error) {
      throw readFailure(error, directory)
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const relative = `${directory}/${entry.name}`
      const absolute = path.join(root, relative)
      const stat = statIfPresent(absolute, relative)
      if (!stat || stat.isSymbolicLink()) continue
      // Check the physical path too, including a parent replaced during the scan.
      let real
      try {
        real = fs.realpathSync(absolute)
      } catch (error) {
        throw readFailure(error, relative)
      }
      const contained = path.relative(realRoot, real)
      if (path.isAbsolute(contained) || contained === '..' || contained.startsWith(`..${path.sep}`))
        continue
      if (stat.isDirectory()) {
        walk(relative, location)
        continue
      }
      if (!stat.isFile() || entry.name !== 'progress.md') continue
      const id = path.basename(path.dirname(absolute))
      if (tasks.has(id)) {
        duplicates++
        continue
      }
      let parsed
      if (stat.size > MAX_RECORD_BYTES) parsed = invalid('work record exceeds 1 MiB')
      else {
        try {
          parsed = parseRecord(fs.readFileSync(absolute, 'utf8'))
        } catch (error) {
          throw readFailure(error, relative)
        }
      }
      tasks.set(id, {
        id,
        ref: id,
        location,
        ...parsed,
        activity: null,
        corrections: 0,
        reviews: 0,
        createdAt: null,
        updatedAt: parsed.updatedAt ?? stat.mtime.toISOString(),
        completedAt: null,
        checkpoints: [],
        path: relative,
      })
    }
  }
  for (const [directory, location] of [
    ['work', 'live'],
    ['work-completed', 'archived'],
  ]) {
    const stat = statIfPresent(path.join(root, directory), directory)
    if (!stat || stat.isSymbolicLink()) continue
    if (!stat.isDirectory()) throw new AdapterFailure('config', `${directory} is not a directory`)
    watch.push({ path: directory, recursive: true })
    walk(directory, location)
  }
  return { tasks: [...tasks.values()], watch, duplicates }
}

function handle(request) {
  if (request.protocolVersion !== 1)
    throw new AdapterFailure('internal', 'Unsupported protocolVersion')
  if (!object(request.project) || !nonblank(request.project.root))
    throw new AdapterFailure('config', 'Request has no project.root')
  if (request.project.environment !== 'local')
    throw new AdapterFailure('config', 'Only local projects are supported')
  if (!['test', 'snapshot'].includes(request.action))
    throw new AdapterFailure('internal', 'Unknown action')
  const { tasks, watch, duplicates } = scan(request.project.root)
  if (request.action === 'test') {
    const invalid = tasks.filter((task) => task.recordState === 'invalid').length
    const unsupported = tasks.filter((task) => task.recordState === 'unsupported').length
    return {
      summary: `${tasks.length} work records, ${invalid} invalid, ${unsupported} unsupported, ${duplicates} duplicate${duplicates === 1 ? '' : 's'} ignored`,
    }
  }
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), tasks, watch }
}

if (require.main === module) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    raw += chunk
  })
  process.stdin.on('end', () => {
    let response
    try {
      response = { ok: true, data: handle(JSON.parse(raw)) }
    } catch (error) {
      if (!(error instanceof AdapterFailure)) console.error(error.stack ?? String(error))
      response = {
        ok: false,
        error: {
          code: error instanceof AdapterFailure ? error.code : 'internal',
          message: error.message ?? String(error),
        },
      }
    }
    process.stdout.write(JSON.stringify(response))
    process.exitCode = response.ok ? 0 : 1
  })
}
module.exports = { parseRecord, handle }
