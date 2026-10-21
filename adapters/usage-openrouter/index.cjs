// NeKode usage adapter for the OpenRouter account balance (protocol version 1).
//
// One read sends exactly one documented metadata request, `GET /api/v1/credits` with
// `Authorization: Bearer <Management key>`
// (https://openrouter.ai/docs/api-reference/get-credits), and maps
// `total_credits - total_usage` to one account-wide USD `balance` metric. An ordinary API key is
// refused by OpenRouter with 403; that is reported as a configuration failure and never replaced
// by a per-key limit or another endpoint. The key arrives over stdin only; it is never written to
// stdout, stderr, errors or argv. Docs: docs/features/usage-quota/openrouter.md.

const PROVIDER_ID = 'openrouter'
const BASE_URL = 'https://openrouter.ai'
const PATH = '/api/v1/credits'
/** One deadline for the request and body; it ends well before NeKode's 30-second limit. */
const TOTAL_DEADLINE_MS = 20_000
const MAX_RESPONSE_BYTES = 1024 * 1024
const DEFAULT_RETRY_SECONDS = 60
const MAX_RETRY_SECONDS = 86_400

class Failure extends Error {
  constructor(code, message, retryAfterSeconds) {
    super(message)
    this.code = code
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds
  }
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

/** Test seam: only a loopback HTTP origin may replace the documented base URL. */
function baseUrl(env) {
  const override = env?.NEKODE_USAGE_TEST_BASE_URL
  return typeof override === 'string' && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(override)
    ? override
    : BASE_URL
}

function apiKey(config) {
  const key = config?.apiKey
  if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\0\r\n]/.test(key))
    throw new Failure('config', 'Set an OpenRouter Management key in Usage settings.')
  return key.trim()
}

function statusFailure(status, headers, now) {
  if (status === 429)
    return new Failure(
      'rate_limited',
      'OpenRouter rate limit reached. Retry later.',
      retryAfter(headers.get('retry-after'), now),
    )
  if (status === 401)
    return new Failure('auth', 'OpenRouter rejected the key. It may be expired or revoked.')
  // Documented: "Only management keys can perform this operation". No per-key substitute.
  if (status === 403)
    return new Failure(
      'config',
      'OpenRouter account balance needs a Management key; an ordinary API key cannot read it.',
    )
  if (status === 404)
    return new Failure('unsupported', 'OpenRouter credits endpoint is unavailable.')
  if (status >= 500) return new Failure('network', 'OpenRouter is unavailable. Retry later.')
  return new Failure('protocol', `OpenRouter returned HTTP ${status}.`)
}

/** One bounded GET; provider bodies and transport errors are never echoed. */
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
        headers: { Accept: 'application/json', ...headers },
        redirect: 'error',
        signal: controller.signal,
      })
    } catch {
      throw timedOut
        ? new Failure('timeout', 'OpenRouter did not answer in time. Retry later.')
        : new Failure('network', 'Cannot reach OpenRouter. Check the network and retry.')
    }
    if (!response.ok) throw statusFailure(response.status, response.headers, now())
    let bytes
    try {
      const length = Number(response.headers.get('content-length'))
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('size')
      bytes = Buffer.from(await response.arrayBuffer())
    } catch {
      throw timedOut
        ? new Failure('timeout', 'OpenRouter did not answer in time. Retry later.')
        : new Failure('protocol', 'OpenRouter returned an unreadable response.')
    }
    if (bytes.length > MAX_RESPONSE_BYTES)
      throw new Failure('protocol', 'OpenRouter response exceeds 1 MiB.')
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      throw new Failure('protocol', 'OpenRouter returned invalid JSON.')
    }
  } finally {
    clearTimeout(timer)
  }
}

const amount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Account balance in USD; a negative balance is shown as returned. */
function mapCredits(body, observedAt) {
  const data = body && typeof body === 'object' && !Array.isArray(body) ? body.data : null
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Failure('protocol', 'OpenRouter returned invalid credits.')
  if (!amount(data.total_credits) || !amount(data.total_usage))
    throw new Failure('protocol', 'OpenRouter returned invalid credit totals.')
  // Round away binary floating-point noise (0.3 - 0.1); `|| 0` turns -0 into 0.
  const balance = Math.round((data.total_credits - data.total_usage) * 1e6) / 1e6 || 0
  return {
    id: 'balance',
    label: 'Account balance',
    kind: 'balance',
    observedAt,
    collectedAt: observedAt,
    state: 'available',
    amount: balance,
    currency: 'USD',
  }
}

/**
 * Run one read. `fetch`, `env`, `now` and `timeoutMs` exist for fixtures; production uses the
 * global fetch, the process environment and the 20-second deadline.
 */
async function collect({
  connectionId,
  config = {},
  fetch = globalThis.fetch,
  env = process.env,
  now = () => new Date(),
  timeoutMs = TOTAL_DEADLINE_MS,
}) {
  if (typeof connectionId !== 'string' || !connectionId.trim() || connectionId.length > 256)
    throw new Failure('protocol', 'Missing usage connection id.')
  const key = apiKey(config)
  const body = await getJson(
    `${baseUrl(env)}${PATH}`,
    { Authorization: `Bearer ${key}` },
    { fetch, timeoutMs, now },
  )
  // The endpoint returns current account totals, so the completed GET time is the observation
  // time (spec rule 14).
  const metric = mapCredits(body, now().toISOString())
  return {
    schemaVersion: 1,
    subscriptions: [
      {
        id: connectionId,
        providerId: PROVIDER_ID,
        label: 'OpenRouter',
        sourceKind: 'api',
        status: 'available',
        metrics: [metric],
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
      if (request.protocolVersion !== 1 || request.action !== 'read')
        throw new Failure('protocol', 'Unsupported usage adapter request.')
      const data = await collect({
        connectionId: request.params?.connectionId,
        config: request.config,
      })
      respond({ protocolVersion: 1, ok: true, data }, 0)
    } catch (error) {
      const known = error instanceof Failure
      respond(
        {
          protocolVersion: 1,
          ok: false,
          error: {
            code: known ? error.code : 'protocol',
            message: known ? error.message : 'OpenRouter usage adapter failed.',
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

module.exports = { TOTAL_DEADLINE_MS, Failure, collect, mapCredits, retryAfter }
