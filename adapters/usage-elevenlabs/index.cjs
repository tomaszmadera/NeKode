// NeKode usage adapter for the ElevenLabs subscription (protocol version 2).
//
// One read sends exactly one documented metadata request,
// `GET /v1/user/subscription` with the `xi-api-key` header
// (https://elevenlabs.io/docs/api-reference/user/subscription/get,
// https://elevenlabs.io/docs/api-reference/authentication), and maps `character_count`,
// `character_limit` and `next_character_count_reset_unix` to one `credits` metric. The API key
// arrives over stdin only; it is never written to stdout, stderr, errors or argv.
// Docs: docs/features/usage-quota/elevenlabs.md.

const PROVIDER_ID = 'elevenlabs'
const PATH = '/v1/user/subscription'
/** Documented base URLs (default and data residency). */
const REGIONS = {
  default: 'https://api.elevenlabs.io',
  us: 'https://api.us.elevenlabs.io',
  eu: 'https://api.eu.residency.elevenlabs.io',
  in: 'https://api.in.residency.elevenlabs.io',
  sg: 'https://api.sg.residency.elevenlabs.io',
}
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
function baseUrl(config, env) {
  const override = env?.NEKODE_USAGE_TEST_BASE_URL
  if (typeof override === 'string' && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(override))
    return override
  const region = config?.region
  if (region === undefined || region === '') return REGIONS.default
  if (typeof region !== 'string' || !Object.hasOwn(REGIONS, region))
    throw new Failure('config', 'Choose a documented ElevenLabs API region.')
  return REGIONS[region]
}

function apiKey(config) {
  const key = config?.apiKey
  if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\0\r\n]/.test(key))
    throw new Failure('config', 'Set the ElevenLabs API key in Usage settings.')
  return key.trim()
}

function statusFailure(status, headers, now) {
  if (status === 429)
    return new Failure(
      'rate_limited',
      'ElevenLabs rate limit reached. Retry later.',
      retryAfter(headers.get('retry-after'), now),
    )
  if (status === 401 || status === 403)
    return new Failure('auth', 'ElevenLabs rejected the API key. Check its access and retry.')
  if (status === 404)
    return new Failure('unsupported', 'ElevenLabs subscription endpoint is unavailable.')
  if (status >= 500) return new Failure('network', 'ElevenLabs is unavailable. Retry later.')
  return new Failure('protocol', `ElevenLabs returned HTTP ${status}.`)
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
        ? new Failure('timeout', 'ElevenLabs did not answer in time. Retry later.')
        : new Failure('network', 'Cannot reach ElevenLabs. Check the network and retry.')
    }
    if (!response.ok) throw statusFailure(response.status, response.headers, now())
    let bytes
    try {
      const length = Number(response.headers.get('content-length'))
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('size')
      bytes = Buffer.from(await response.arrayBuffer())
    } catch {
      throw timedOut
        ? new Failure('timeout', 'ElevenLabs did not answer in time. Retry later.')
        : new Failure('protocol', 'ElevenLabs returned an unreadable response.')
    }
    if (bytes.length > MAX_RESPONSE_BYTES)
      throw new Failure('protocol', 'ElevenLabs response exceeds 1 MiB.')
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      throw new Failure('protocol', 'ElevenLabs returned invalid JSON.')
    }
  } finally {
    clearTimeout(timer)
  }
}

const count = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Map the documented subscription fields; tier, status, invoices and currency are dropped. */
function mapSubscription(body, observedAt) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Failure('protocol', 'ElevenLabs returned an invalid subscription.')
  const used = body.character_count
  const limit = body.character_limit
  const reset = body.next_character_count_reset_unix
  if (
    !count(used) ||
    (limit != null && !count(limit)) ||
    (reset != null && (!count(reset) || reset === 0))
  )
    throw new Failure('protocol', 'ElevenLabs returned an invalid character count.')
  const base = { id: 'characters', label: 'Characters', kind: 'credits', observedAt }
  // A missing limit is unavailability, never zero; a zero limit stays without a percentage.
  if (limit == null) return { ...base, state: 'unavailable', reason: 'limit_not_reported' }
  return {
    ...base,
    collectedAt: observedAt,
    state: 'available',
    used,
    limit,
    unit: 'characters',
    // The billing period is a label, not a start time, so the cycle start stays unknown.
    periodStart: null,
    resetsAt: reset == null ? null : new Date(reset * 1000).toISOString(),
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
  const url = `${baseUrl(config, env)}${PATH}`
  const body = await getJson(url, { 'xi-api-key': key }, { fetch, timeoutMs, now })
  // The endpoint returns the current subscription state, so the completed GET time is the
  // observation time (spec rule 14).
  const metric = mapSubscription(body, now().toISOString())
  return {
    schemaVersion: 1,
    subscriptions: [
      {
        id: connectionId,
        providerId: PROVIDER_ID,
        label: 'ElevenLabs',
        sourceKind: 'api',
        status: metric.state === 'available' ? 'available' : 'unavailable',
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
      // Protocol 2 (usage-quota spec L2): every read already asks the provider during this
      // request, so the scheduled `read` and the manual live `refresh` share one path.
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
            message: known ? error.message : 'ElevenLabs usage adapter failed.',
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

module.exports = { TOTAL_DEADLINE_MS, REGIONS, Failure, collect, mapSubscription, retryAfter }
