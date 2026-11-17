'use strict'

const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const SCRIPT = '.agents/scripts/task-status'
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
class AdapterFailure extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}
const object = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const nonblank = (value) => typeof value === 'string' && value.trim().length > 0
function malformed(detail) {
  throw new AdapterFailure('protocol', `Invalid task-status output: ${detail}`)
}
function text(value, field, noneIsNull = true) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') malformed(`${field} must be a string or null`)
  return value === '' || (noneIsNull && value === 'none') ? null : value
}
function choice(value, choices, field) {
  if (!choices.includes(value)) malformed(`${field} must be ${choices.join('|')}`)
  return value
}
function relativePath(value) {
  if (
    !nonblank(value) ||
    value.includes('\0') ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[A-Za-z]:/.test(value) ||
    value.split(/[\\/]/).includes('..')
  )
    malformed('task path must be relative and stay inside the project')
  return value.replace(/\\/g, '/')
}
function containedFile(root, relative, code) {
  try {
    const absolute = path.join(root, relative)
    const real = fs.realpathSync(absolute)
    const rel = path.relative(fs.realpathSync(root), real)
    if (path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) {
      throw new AdapterFailure(code, `${relative} resolves outside the project`)
    }
    const stat = fs.statSync(real)
    if (!stat.isFile()) throw new AdapterFailure(code, `${relative} is not a file`)
    return stat
  } catch (error) {
    if (error instanceof AdapterFailure) throw error
    const missing = ['ENOENT', 'ENOTDIR', 'EBUSY'].includes(error.code)
    throw new AdapterFailure(
      code === 'runtime' ? code : missing ? 'transient' : 'config',
      `Cannot read ${relative}: ${error.message}${code === 'runtime' ? '; install or restore Agent Harness in this project' : ''}`,
    )
  }
}

function mapSnapshot(source, root) {
  if (!object(source)) malformed('expected one JSON object')
  if (source.schema_version !== 2) {
    throw new AdapterFailure(
      'unsupported_source',
      'Unsupported task-status schema_version; expected 2',
    )
  }
  if (!Array.isArray(source.tasks)) malformed('tasks must be an array')
  const ids = new Set()
  const tasks = source.tasks.map((task) => {
    if (!object(task)) malformed('task must be an object')
    if (!nonblank(task.id) || task.id.length > 120) malformed('task id must have 1-120 characters')
    if (ids.has(task.id)) malformed(`duplicate task id: ${task.id}`)
    ids.add(task.id)
    const state = choice(task.status, ['active', 'blocked', 'completed'], `${task.id}.status`)
    const recordState = choice(
      task.record_state,
      ['valid', 'invalid', 'unsupported'],
      `${task.id}.record_state`,
    )
    if (!Array.isArray(task.errors) || task.errors.some((error) => typeof error !== 'string')) {
      malformed(`${task.id}.errors must be an array of strings`)
    }
    if (!Array.isArray(task.phases)) malformed(`${task.id}.phases must be an array`)
    const steps = new Map()
    const phases = task.phases.map((phase) => {
      if (
        !object(phase) ||
        !Number.isInteger(phase.number) ||
        phase.number < 0 ||
        typeof phase.name !== 'string' ||
        !Array.isArray(phase.steps)
      ) {
        malformed(`${task.id} has a malformed phase`)
      }
      return {
        number: phase.number,
        name: phase.name,
        steps: phase.steps.map((step) => {
          if (
            !object(step) ||
            !nonblank(step.id) ||
            typeof step.label !== 'string' ||
            typeof step.checked !== 'boolean'
          ) {
            malformed(`${task.id} has a malformed step`)
          }
          if (steps.has(step.id)) malformed(`${task.id} repeats step id ${step.id}`)
          steps.set(step.id, step.label)
          return { id: step.id, label: step.label, done: step.checked }
        }),
      }
    })
    // task-status reports empty optional metadata for identity-only unsupported records.
    const currentStepId = text(task.current_step, `${task.id}.current_step`)
    if (currentStepId !== null && !steps.has(currentStepId))
      malformed(`${task.id}.current_step names no step`)
    if (!object(task.timing) || !Array.isArray(task.timing.checkpoints))
      malformed(`${task.id}.timing.checkpoints must be an array`)
    const checkpoints = task.timing.checkpoints.map((checkpoint) => {
      if (
        !object(checkpoint) ||
        !nonblank(checkpoint.step) ||
        typeof checkpoint.completed !== 'string' ||
        !ISO_UTC.test(checkpoint.completed) ||
        Number.isNaN(Date.parse(checkpoint.completed))
      ) {
        malformed(`${task.id} has a malformed checkpoint`)
      }
      return { stepId: checkpoint.step, completedAt: checkpoint.completed }
    })
    const relative = relativePath(task.path)
    const stat = containedFile(root, relative, 'protocol')
    return {
      id: task.id,
      ref: task.id,
      title: text(task.title, `${task.id}.title`, false),
      state,
      location: relative.includes('.agents/tasks/archive/') ? 'archived' : 'live',
      recordState,
      errors: task.errors,
      activity:
        task.activity === undefined || task.activity === null
          ? null
          : choice(task.activity, ['working', 'waiting', 'idle'], `${task.id}.activity`),
      phases,
      currentStepId,
      currentLabel: steps.get(currentStepId)?.slice(0, 40) ?? null,
      nextAction: text(task.next_action, `${task.id}.next_action`),
      blockers: text(task.blockers, `${task.id}.blockers`),
      updatedAt: stat.mtime.toISOString(),
      createdAt: null,
      completedAt: null,
      corrections: 0,
      reviews: 0,
      checkpoints,
      path: relative,
    }
  })
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tasks,
    watch: [{ path: '.agents/tasks', recursive: true }],
  }
}

function handle(request) {
  if (!object(request) || request.protocolVersion !== 1)
    throw new AdapterFailure('internal', 'Unsupported protocolVersion')
  if (!object(request.project) || !nonblank(request.project.root))
    throw new AdapterFailure('config', 'Request has no project.root')
  if (request.project.environment !== 'local')
    throw new AdapterFailure('config', 'Only local projects are supported')
  if (!['test', 'snapshot'].includes(request.action))
    throw new AdapterFailure('internal', 'Unknown action')
  const root = request.project.root
  try {
    if (!fs.statSync(root).isDirectory()) throw new Error('not a directory')
  } catch (error) {
    throw new AdapterFailure('config', `Cannot read project directory: ${error.message}`)
  }
  containedFile(root, SCRIPT, 'runtime')
  const result = childProcess.spawnSync('python', [SCRIPT, '--json'], {
    cwd: root,
    shell: false,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 10_000,
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.stderr?.length) process.stderr.write(result.stderr)
  if (result.error) {
    throw new AdapterFailure(
      'runtime',
      `Cannot run python ${SCRIPT} --json: ${result.error.message}. Install Python 3.11 or newer from python.org and ensure the python command is on PATH`,
    )
  }
  if (result.status !== 0)
    throw new AdapterFailure(
      'runtime',
      `python ${SCRIPT} --json failed with exit code ${result.status}; check Python and the project's Agent Harness installation`,
    )
  let source
  try {
    source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.stdout))
  } catch {
    malformed('command did not return exactly one UTF-8 JSON object')
  }
  const snapshot = mapSnapshot(source, root)
  if (request.action === 'test')
    return {
      summary: `${snapshot.tasks.length} task records, ${snapshot.tasks.filter((task) => task.state === 'completed').length} completed`,
    }
  return snapshot
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
module.exports = { handle, mapSnapshot }
