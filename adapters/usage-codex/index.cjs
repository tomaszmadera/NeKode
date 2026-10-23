// Experimental NeKode usage adapter for the Codex CLI app-server (protocol version 2).
//
// One read: check `codex --version`, start `codex app-server` over stdio JSONL, send
// `initialize`, `initialized`, `account/read` (refreshToken false) and
// `account/rateLimits/read`, map the documented rate-limit buckets, then terminate the
// app-server process tree. No thread, turn, login, logout, credit or config method is ever
// sent (see ALLOWED_METHODS). The user's Codex auth stays inside Codex; nothing from the
// account response except its type reaches the output. Docs:
// docs/features/usage-quota/codex.md.
const { spawn } = require('node:child_process')
const path = require('node:path')

const ADAPTER_VERSION = '1.0.0'
/** Oldest Codex CLI whose app-server protocol was verified against this mapping. */
const MINIMUM_CODEX_VERSION = [0, 163, 0]
const ALLOWED_METHODS = new Set([
  'initialize',
  'initialized',
  'account/read',
  'account/rateLimits/read',
])
const PROVIDER_ID = 'codex'
const MAX_LINE_BYTES = 1024 * 1024
const MAX_BUCKETS = 25
/**
 * One deadline for the whole read: version check, app-server session and cleanup. It ends well
 * before NeKode's 30-second plugin limit so this adapter reports its own typed timeout.
 */
const TOTAL_DEADLINE_MS = 25_000
/** Part of the deadline kept for terminating app-server after the session. */
const CLEANUP_RESERVE_MS = 3_000

class Failure extends Error {
  constructor(code, message, retryAfterSeconds) {
    super(message)
    this.code = code
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds
  }
}

function terminate(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.on('error', () => child.kill())
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

function waitForClose(child, ms) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    child.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * Environment for the Codex CLI. NeKode starts this shipped adapter with ELECTRON_RUN_AS_NODE
 * (usage-quota spec rule 19); it must not reach children, where it would put any Electron-based
 * executable into Node mode.
 */
function childEnv(env = process.env) {
  const copy = { ...env }
  delete copy.ELECTRON_RUN_AS_NODE
  return copy
}

/** Resolve the configured executable without a shell; script shims cannot run without one. */
function executable(config) {
  const value = config?.codexPath
  if (value === undefined || value === '') return 'codex'
  if (typeof value !== 'string' || value.includes('\0') || !path.isAbsolute(value))
    throw new Failure('config', 'Set the Codex executable to an absolute path, or leave it empty.')
  if (process.platform === 'win32' && path.extname(value).toLowerCase() !== '.exe')
    throw new Failure('config', 'Choose codex.exe. Script shims (.cmd, .bat, .ps1) need a shell.')
  return value
}

function startFailure(error) {
  return error?.code === 'ENOENT'
    ? new Failure('config', 'Codex CLI was not found. Install it or set its executable path.')
    : new Failure('config', 'Cannot start Codex CLI. Check its executable path.')
}

function parseVersion(text) {
  const match = /codex-cli\s+(\d+)\.(\d+)\.(\d+)/.exec(text)
  return match ? match.slice(1, 4).map(Number) : null
}
function versionAtLeast(version, minimum) {
  for (let i = 0; i < 3; i++) if (version[i] !== minimum[i]) return version[i] > minimum[i]
  return true
}

function checkVersion(command, prefixArgs, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, [...prefixArgs, '--version'], {
        shell: false,
        windowsHide: true,
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch (error) {
      reject(startFailure(error))
      return
    }
    let out = ''
    const timer = setTimeout(() => {
      terminate(child)
      reject(new Failure('timeout', 'Codex CLI did not report its version in time.'))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      if (out.length < 4096) out += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(startFailure(error))
    })
    child.once('close', () => {
      clearTimeout(timer)
      const version = parseVersion(out)
      if (!version)
        reject(new Failure('unsupported', 'Cannot determine the Codex CLI version. Update Codex.'))
      else if (!versionAtLeast(version, MINIMUM_CODEX_VERSION))
        reject(
          new Failure(
            'unsupported',
            `Unsupported Codex CLI ${version.join('.')}. Update to ${MINIMUM_CODEX_VERSION.join('.')} or later.`,
          ),
        )
      else resolve(version.join('.'))
    })
  })
}

function rpcFailure(method, error) {
  const code = typeof error?.code === 'number' ? error.code : null
  const message = typeof error?.message === 'string' ? error.message : ''
  if (code === -32601 || /method not found|unknown variant|unknown method/i.test(message))
    return new Failure('unsupported', `This Codex CLI does not support ${method}. Update Codex.`)
  if (code === -32001)
    return new Failure('rate_limited', 'Codex app-server is overloaded. Retry later.', 60)
  if (/unauthori|forbidden|\b401\b|\b403\b|log ?in|sign ?in|auth/i.test(message))
    return new Failure('auth', 'Sign in with the configured Codex CLI.')
  return new Failure('network', 'Codex could not read rate limits. Retry later.')
}

function text(value, max) {
  return typeof value === 'string' && value.trim() && value.length <= max && !value.includes('\0')
}
function integer(value) {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
function duration(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

/** Map `account/rateLimits/read` to normalized metrics; durations and buckets come from Codex. */
function mapRateLimits(result, observedAt) {
  if (!result || typeof result !== 'object' || !result.rateLimits)
    throw new Failure('protocol', 'Codex returned no rate limits. Update Codex or retry.')
  const byId = result.rateLimitsByLimitId
  const entries =
    byId && typeof byId === 'object' && !Array.isArray(byId) && Object.keys(byId).length
      ? Object.entries(byId)
      : [[result.rateLimits.limitId ?? 'codex', result.rateLimits]]
  if (entries.length > MAX_BUCKETS)
    throw new Failure('protocol', 'Codex returned too many rate-limit buckets.')
  const metrics = []
  for (const [key, snapshot] of entries) {
    if (!snapshot || typeof snapshot !== 'object')
      throw new Failure('protocol', 'Codex returned an invalid rate-limit bucket.')
    const limitId = snapshot.limitId ?? key
    if (!text(limitId, 64) || !/^[A-Za-z0-9._:-]+$/.test(limitId))
      throw new Failure('protocol', 'Codex returned an invalid rate-limit bucket id.')
    const name = text(snapshot.limitName, 100) ? snapshot.limitName.trim() : null
    const prefix = name ? `${name} ` : limitId === 'codex' ? '' : `${limitId} `
    for (const slot of ['primary', 'secondary']) {
      const window = snapshot[slot]
      const id = `${limitId}.${slot}`
      if (window === null || window === undefined) {
        metrics.push({
          id,
          label: `${prefix}${slot} window`,
          kind: 'window',
          observedAt,
          collectedAt: observedAt,
          state: 'unavailable',
          reason: 'window_not_reported',
          bucketId: limitId,
        })
        continue
      }
      const minutes = window.windowDurationMins
      if (
        typeof window.usedPercent !== 'number' ||
        !Number.isFinite(window.usedPercent) ||
        window.usedPercent < 0 ||
        (minutes != null && (!integer(minutes) || minutes <= 0)) ||
        (window.resetsAt != null && (!integer(window.resetsAt) || window.resetsAt <= 0))
      )
        throw new Failure('protocol', 'Codex returned an invalid rate-limit window.')
      const seconds = minutes == null ? null : minutes * 60
      const resetsAt =
        window.resetsAt == null ? null : new Date(window.resetsAt * 1000).toISOString()
      metrics.push({
        id,
        label: `${prefix}${seconds === null ? `${slot} window` : duration(minutes)}`,
        kind: 'window',
        observedAt,
        collectedAt: observedAt,
        state: 'available',
        usedPercent: window.usedPercent,
        bucketId: limitId,
        resetsAt,
        windowDurationSeconds: seconds,
        periodStart:
          resetsAt && seconds
            ? new Date(window.resetsAt * 1000 - seconds * 1000).toISOString()
            : null,
      })
    }
  }
  if (metrics.length > 50) throw new Failure('protocol', 'Codex returned too many rate limits.')
  return metrics
}

/**
 * Run one bounded app-server session. Options exist for fixtures: `prefixArgs` lets a test run a
 * fake server script through Node; production uses the configured executable only.
 */
async function collect({
  connectionId,
  config = {},
  command = executable(config),
  prefixArgs = [],
  env = childEnv(),
  timeoutMs = TOTAL_DEADLINE_MS,
  now = () => new Date(),
}) {
  if (!text(connectionId, 256)) throw new Failure('protocol', 'Missing usage connection id.')
  const deadlineAt = Date.now() + timeoutMs
  const reserve = Math.min(CLEANUP_RESERVE_MS, Math.floor(timeoutMs / 5))
  const remaining = () => Math.max(0, deadlineAt - reserve - Date.now())
  const version = await checkVersion(command, prefixArgs, env, remaining())
  let child
  try {
    child = spawn(command, [...prefixArgs, 'app-server'], {
      shell: false,
      windowsHide: true,
      env,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
  } catch (error) {
    throw startFailure(error)
  }
  const pending = new Map()
  let nextId = 0,
    buffer = Buffer.alloc(0),
    closed = null
  const failAll = (failure) => {
    closed ??= failure
    for (const { reject } of pending.values()) reject(failure)
    pending.clear()
  }
  const send = (method, params, expectResponse) => {
    if (!ALLOWED_METHODS.has(method)) throw new Error(`Forbidden Codex method ${method}`)
    if (closed) return Promise.reject(closed)
    const message = expectResponse ? { method, id: nextId++, params } : { method, params }
    child.stdin.write(`${JSON.stringify(message)}\n`)
    if (!expectResponse) return Promise.resolve()
    return new Promise((resolve, reject) => pending.set(message.id, { method, resolve, reject }))
  }
  const onLine = (line) => {
    if (!line.trim()) return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      failAll(new Failure('protocol', 'Codex app-server sent invalid JSONL.'))
      return
    }
    // Server notifications and server-initiated requests are ignored; no reply is sent.
    if (!message || typeof message !== 'object' || message.method !== undefined) return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(rpcFailure(entry.method, message.error))
    else entry.resolve(message.result)
  }
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    let index = buffer.indexOf(10)
    while (index !== -1) {
      onLine(buffer.subarray(0, index).toString('utf8'))
      buffer = buffer.subarray(index + 1)
      index = buffer.indexOf(10)
    }
    if (buffer.length > MAX_LINE_BYTES) {
      failAll(new Failure('protocol', 'Codex app-server message exceeds 1 MiB.'))
      terminate(child)
    }
  })
  child.stdin.on('error', () =>
    failAll(new Failure('protocol', 'Codex app-server closed its input early.')),
  )
  child.once('error', (error) => failAll(startFailure(error)))
  child.once('close', () =>
    failAll(new Failure('protocol', 'Codex app-server exited before answering. Update Codex.')),
  )
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Failure('timeout', 'Codex app-server timed out. Retry later.')),
      remaining(),
    )
  })
  try {
    const session = (async () => {
      await send(
        'initialize',
        { clientInfo: { name: 'nekode_usage', title: 'NeKode usage', version: ADAPTER_VERSION } },
        true,
      )
      await send('initialized', {}, false)
      const account = await send('account/read', { refreshToken: false }, true)
      if (!account?.account)
        throw new Failure('auth', 'Sign in with the configured Codex CLI using ChatGPT.')
      if (account.account.type !== 'chatgpt')
        throw new Failure('auth', 'Usage data is available only for a ChatGPT sign-in.')
      const limits = await send('account/rateLimits/read', undefined, true)
      return mapRateLimits(limits, now().toISOString())
    })()
    // The race reports the first failure; a later rejection after a timeout is expected.
    session.catch(() => {})
    const metrics = await Promise.race([session, deadline])
    return {
      version,
      document: {
        schemaVersion: 1,
        subscriptions: [
          {
            id: connectionId,
            providerId: PROVIDER_ID,
            label: 'Codex',
            sourceKind: 'cli',
            status: metrics.some((m) => m.state === 'available') ? 'available' : 'unavailable',
            metrics,
          },
        ],
      },
    }
  } finally {
    clearTimeout(timer)
    failAll(new Failure('protocol', 'Codex session closed.'))
    child.stdin.end()
    terminate(child)
    await waitForClose(child, Math.max(0, deadlineAt - Date.now()))
  }
}

function respond(response, exitCode) {
  process.stdout.write(JSON.stringify(response))
  process.exitCode = exitCode
}

function main() {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    input += chunk
    if (Buffer.byteLength(input) > 64 * 1024) process.exit(1)
  })
  process.stdin.on('end', async () => {
    try {
      let request
      try {
        request = JSON.parse(input)
      } catch {
        throw new Failure('protocol', 'Invalid usage adapter request.')
      }
      // Protocol 2 (usage-quota spec L2): every read already asks the provider during this
      // request, so the scheduled `read` and the manual live `refresh` share one path.
      if (request.protocolVersion !== 2 || !['read', 'refresh'].includes(request.action))
        throw new Failure('protocol', 'Unsupported usage adapter request.')
      const { document } = await collect({
        connectionId: request.params?.connectionId,
        config: request.config,
      })
      respond({ protocolVersion: 2, ok: true, data: document }, 0)
    } catch (error) {
      const known = error instanceof Failure
      respond(
        {
          protocolVersion: 2,
          ok: false,
          error: {
            code: known ? error.code : 'protocol',
            message: known ? error.message : 'Codex usage adapter failed.',
            ...(known && error.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: error.retryAfterSeconds }
              : {}),
          },
        },
        1,
      )
    }
  })
}

if (require.main === module) main()

module.exports = {
  ALLOWED_METHODS,
  MINIMUM_CODEX_VERSION,
  TOTAL_DEADLINE_MS,
  Failure,
  childEnv,
  collect,
  executable,
  mapRateLimits,
  parseVersion,
}
