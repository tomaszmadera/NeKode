// NeKode usage adapter for Claude Code plan limits (protocol version 2, usage-quota spec L10-L14).
//
// One read, for both `read` and `refresh`: read `<configDirectory>/.credentials.json`, take
// `claudeAiOauth.accessToken` and `claudeAiOauth.expiresAt`, and send exactly one
// `GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <accessToken>` and
// `anthropic-beta: oauth-2025-04-20`. The endpoint is not publicly documented and can change.
// The adapter never reads or sends the refresh token, never writes the credentials file, and
// never writes the access token to stdout, stderr, errors or argv.
// Docs: docs/features/usage-quota/claude-code.md.

const { readFileSync, statSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROVIDER_ID = 'claude'
const BASE_URL = 'https://api.anthropic.com'
const PATH = '/api/oauth/usage'
const BETA = 'oauth-2025-04-20'
const TOTAL_DEADLINE_MS = 10_000
const MAX_CREDENTIALS_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024
const DEFAULT_RETRY_SECONDS = 300
const MAX_RETRY_SECONDS = 86_400
const WINDOWS = [
  { id: 'five_hour', label: '5-hour window', seconds: 18_000 },
  { id: 'seven_day', label: '7-day window', seconds: 604_800 },
]
const SIGN_IN = 'Claude Code is not signed in on this computer. Open Claude Code and sign in.'

class Failure extends Error {
  constructor(code, message, retryAfterSeconds) {
    super(message)
    this.code = code
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds
  }
}

/** Test seam: only a loopback HTTP origin may replace the provider origin. */
function baseUrl(env) {
  const override = env?.NEKODE_USAGE_TEST_BASE_URL
  return typeof override === 'string' && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(override)
    ? override
    : BASE_URL
}

/** L11: the configured absolute directory, else CLAUDE_CONFIG_DIR, else `~/.claude`. */
function configDirectory(config, env, homedir) {
  const configured = config?.configDirectory
  if (configured !== undefined && typeof configured !== 'string')
    throw new Failure('config', 'The Claude Code config directory must be a path.')
  const value = configured?.trim()
  if (value) {
    if (value.length > 4096 || value.includes('\0') || !path.isAbsolute(value))
      throw new Failure('config', 'The Claude Code config directory must be an absolute path.')
    return value
  }
  const fromEnv = env?.CLAUDE_CONFIG_DIR
  const envValue = typeof fromEnv === 'string' ? fromEnv.trim() : ''
  if (envValue) {
    // A relative value would resolve against the adapter's working directory.
    if (envValue.includes('\0') || !path.isAbsolute(envValue))
      throw new Failure('config', 'CLAUDE_CONFIG_DIR must be an absolute path.')
    return envValue
  }
  return path.join(homedir(), '.claude')
}

/** L12: the access token and its expiry; the refresh token is never read into a variable. */
function credentials(directory, now) {
  const file = path.join(directory, '.credentials.json')
  let raw
  try {
    if (statSync(file).size > MAX_CREDENTIALS_BYTES) throw new Error('size')
    raw = readFileSync(file)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw new Failure('auth', SIGN_IN)
    if (error?.message === 'size')
      throw new Failure('auth', 'The Claude Code credentials file exceeds 64 KiB.')
    throw new Failure('io', 'Cannot read the Claude Code credentials file.')
  }
  if (raw.length > MAX_CREDENTIALS_BYTES)
    throw new Failure('auth', 'The Claude Code credentials file exceeds 64 KiB.')
  let oauth
  try {
    oauth = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))?.claudeAiOauth
  } catch {
    throw new Failure('auth', 'The Claude Code credentials file is unreadable.')
  }
  const token = oauth && typeof oauth === 'object' ? oauth.accessToken : undefined
  // A header-safe token: visible ASCII only, so it cannot add another header line.
  if (typeof token !== 'string' || token.length > 8192 || !/^[!-~]+$/.test(token.trim()))
    throw new Failure('auth', SIGN_IN)
  const expiresAt = oauth.expiresAt
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt))
    throw new Failure('auth', 'The Claude Code sign-in has no expiry time.')
  if (expiresAt <= now.getTime()) throw new Failure('auth', 'The Claude Code sign-in has expired.')
  return token.trim()
}

/** Retry-After as delta seconds or an HTTP date, bounded to the host's accepted range. */
function retryAfter(value, now) {
  if (typeof value === 'string' && /^\d+$/.test(value.trim()))
    return Math.min(MAX_RETRY_SECONDS, Number(value.trim()))
  const date = typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (Number.isFinite(date))
    return Math.min(MAX_RETRY_SECONDS, Math.max(0, Math.ceil((date - now.getTime()) / 1000)))
  return DEFAULT_RETRY_SECONDS
}

/** L14: status mapping; provider bodies are never echoed. */
function statusFailure(status, headers, now) {
  if (status === 401 || status === 403)
    return new Failure('auth', 'Claude rejected the Claude Code sign-in.')
  if (status === 429)
    return new Failure(
      'rate_limited',
      'Claude usage rate limit reached. Retry later.',
      retryAfter(headers.get('retry-after'), now),
    )
  return new Failure('protocol', `Claude usage returned HTTP ${status}.`)
}

/** One bounded GET; transport errors are never echoed. */
async function getJson(url, headers, { fetch, timeoutMs, now }) {
  if (typeof fetch !== 'function')
    throw new Failure('unsupported', 'This Node.js has no fetch. Use Node.js 18 or later.')
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: controller.signal,
      })
    } catch {
      throw timedOut
        ? new Failure('timeout', 'Claude usage did not answer in time. Retry later.')
        : new Failure('network', 'Cannot reach Claude usage. Check the network and retry.')
    }
    if (!response.ok) throw statusFailure(response.status, response.headers, now())
    let bytes
    try {
      const length = Number(response.headers.get('content-length'))
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('size')
      bytes = Buffer.from(await response.arrayBuffer())
    } catch {
      throw timedOut
        ? new Failure('timeout', 'Claude usage did not answer in time. Retry later.')
        : new Failure('protocol', 'Claude usage returned an unreadable response.')
    }
    if (bytes.length > MAX_RESPONSE_BYTES)
      throw new Failure('protocol', 'Claude usage response exceeds 1 MiB.')
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      throw new Failure('protocol', 'Claude usage returned invalid JSON.')
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `resets_at` may carry microseconds and a numeric offset (`...59.943648+00:00`). Truncate the
 * fraction to milliseconds and return UTC ISO (L13).
 */
function resetTime(value) {
  const match =
    typeof value === 'string' &&
    /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value)
  const time = match
    ? Date.parse(`${match[1]}.${(match[2] ?? '').slice(0, 3).padEnd(3, '0')}${match[3]}`)
    : Number.NaN
  if (!Number.isFinite(time))
    throw new Failure('protocol', 'Claude usage returned an invalid reset time.')
  return time
}

const plainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function mapUsage(body, observedAt) {
  if (!plainObject(body))
    throw new Failure('protocol', 'Claude usage returned an unexpected shape.')
  return WINDOWS.map(({ id, label, seconds }) => {
    const window = body[id]
    const base = { id, label, kind: 'window', observedAt, collectedAt: observedAt }
    if (
      window === null ||
      window === undefined ||
      window.utilization === null ||
      window.utilization === undefined
    ) {
      if (window != null && !plainObject(window))
        throw new Failure('protocol', 'Claude usage returned an unexpected shape.')
      return { ...base, state: 'unavailable', reason: 'not_reported' }
    }
    if (
      !plainObject(window) ||
      typeof window.utilization !== 'number' ||
      !Number.isFinite(window.utilization) ||
      window.utilization < 0
    )
      throw new Failure('protocol', 'Claude usage returned an invalid window.')
    const reset = window.resets_at == null ? null : resetTime(window.resets_at)
    return {
      ...base,
      state: 'available',
      usedPercent: window.utilization,
      windowDurationSeconds: seconds,
      resetsAt: reset === null ? null : new Date(reset).toISOString(),
      periodStart: reset === null ? null : new Date(reset - seconds * 1000).toISOString(),
    }
  })
}

/**
 * Run one read. `fetch`, `env`, `homedir`, `now` and `timeoutMs` exist for fixtures; production
 * uses the global fetch, the process environment, the OS home directory and the 10-second deadline.
 */
async function collect({
  connectionId,
  config = {},
  fetch = globalThis.fetch,
  env = process.env,
  homedir = os.homedir,
  now = () => new Date(),
  timeoutMs = TOTAL_DEADLINE_MS,
}) {
  if (typeof connectionId !== 'string' || !connectionId.trim() || connectionId.length > 256)
    throw new Failure('protocol', 'Missing usage connection id.')
  const token = credentials(configDirectory(config, env, homedir), now())
  const body = await getJson(
    `${baseUrl(env)}${PATH}`,
    { Accept: 'application/json', Authorization: `Bearer ${token}`, 'anthropic-beta': BETA },
    { fetch, timeoutMs, now },
  )
  // L4: the response carries no observation time, so its arrival time is the observation time.
  const metrics = mapUsage(body, now().toISOString())
  return {
    schemaVersion: 1,
    subscriptions: [
      {
        id: connectionId,
        providerId: PROVIDER_ID,
        label: 'Claude Code',
        sourceKind: 'api',
        status: metrics.some((m) => m.state === 'available') ? 'available' : 'unavailable',
        metrics,
      },
    ],
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
      // Protocol 2 (L2): every read asks the provider during this request, so the scheduled
      // `read` and the manual live `refresh` share one path.
      if (request.protocolVersion !== 2 || !['read', 'refresh'].includes(request.action))
        throw new Failure('protocol', 'Unsupported usage adapter request.')
      const data = await collect({
        connectionId: request.params?.connectionId,
        config: request.config,
      })
      respond({ protocolVersion: 2, ok: true, data }, 0)
    } catch (error) {
      const known = error instanceof Failure
      respond(
        {
          protocolVersion: 2,
          ok: false,
          error: {
            code: known ? error.code : 'protocol',
            message: known ? error.message : 'Claude Code usage adapter failed.',
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

module.exports = { TOTAL_DEADLINE_MS, Failure, collect, mapUsage, resetTime, retryAfter }
