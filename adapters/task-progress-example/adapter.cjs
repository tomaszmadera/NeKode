'use strict'

// NeKode task progress adapter, protocol v1 example. It reads one JSON file
// in the snapshot format (see README.md) from the project and returns it.
// One process per request: one JSON request on stdin, one JSON response on
// stdout, exit 0 for ok:true and 1 for ok:false. Diagnostics go to stderr.

const { readFileSync } = require('node:fs')
const path = require('node:path')

class AdapterFailure extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function respond(response) {
  process.stdout.write(JSON.stringify(response))
  process.exitCode = response.ok ? 0 : 1
}

/** Resolves config.path inside project.root; anything escaping it is a config error. */
function snapshotPath(request) {
  const relative = request.config?.path
  if (typeof relative !== 'string' || relative.trim() === '') {
    throw new AdapterFailure('config', 'Field "path" is required.')
  }
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
    throw new AdapterFailure('config', `Field "path" must stay inside the project: ${relative}`)
  }
  const root = request.project?.root
  if (typeof root !== 'string' || root === '') {
    throw new AdapterFailure('internal', 'Request has no project.root.')
  }
  return { relative, absolute: path.resolve(root, relative) }
}

function readSnapshot(file) {
  let text
  try {
    text = readFileSync(file.absolute, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new AdapterFailure('config', `Snapshot file not found: ${file.relative}`)
    }
    // A file moved or rewritten mid-read can fail briefly; NeKode retries.
    throw new AdapterFailure('transient', `Cannot read ${file.relative}: ${error.message}`)
  }
  let snapshot
  try {
    snapshot = JSON.parse(text)
  } catch {
    throw new AdapterFailure('unsupported_source', `${file.relative} is not valid JSON.`)
  }
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    snapshot.schemaVersion !== 1 ||
    !Array.isArray(snapshot.tasks)
  ) {
    throw new AdapterFailure(
      'unsupported_source',
      `${file.relative} is not a schemaVersion 1 snapshot with a tasks array.`,
    )
  }
  return snapshot
}

function handle(request) {
  if (request.protocolVersion !== 1) {
    throw new AdapterFailure('internal', `Unsupported protocolVersion ${request.protocolVersion}.`)
  }
  const file = snapshotPath(request)
  const snapshot = readSnapshot(file)
  if (request.action === 'test') {
    const count = snapshot.tasks.length
    return { summary: `Found ${count} task${count === 1 ? '' : 's'} in ${file.relative}.` }
  }
  if (request.action === 'snapshot') {
    // Without an explicit watch list, watch the directory holding the file.
    const directory = path.dirname(file.relative).split(path.sep).join('/')
    return {
      ...snapshot,
      watch: Array.isArray(snapshot.watch)
        ? snapshot.watch
        : [{ path: directory, recursive: false }],
    }
  }
  throw new AdapterFailure('internal', `Unknown action "${request.action}".`)
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  raw += chunk
})
process.stdin.on('end', () => {
  try {
    respond({ ok: true, data: handle(JSON.parse(raw)) })
  } catch (error) {
    if (error instanceof AdapterFailure) {
      respond({ ok: false, error: { code: error.code, message: error.message } })
      return
    }
    console.error(error?.stack ?? String(error))
    respond({ ok: false, error: { code: 'internal', message: String(error?.message ?? error) } })
  }
})
