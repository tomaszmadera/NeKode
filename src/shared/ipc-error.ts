// Typed error transport across the IPC bridge (spec Errors: validation
// failures reject with a typed error, no silent fallback).
//
// Electron serializes rejected invoke errors to a plain message string, and
// contextBridge clones plain objects but not custom Error subclasses. Main
// therefore serializes typed errors into the message
// (`APP_ERROR_MARKER + JSON payload`), and the preload bridge converts the
// rejection back into a plain, structured AppErrorPayload object.

export type AppErrorCode =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'sqlite'
  | 'timeout'
  | 'protocol'
  | 'adapter'
  // Adapter-reported failure codes (spec kanban-adapter-interface Errors):
  // surfaced verbatim through toAppError so the renderer sees the adapter's
  // own typed code, not a collapsed generic 'adapter'.
  | 'auth'
  | 'network'
  | 'notFound'
  | 'config'
  | 'internal'
  | 'unknown'

const APP_ERROR_CODES: readonly AppErrorCode[] = [
  'validation',
  'not_found',
  'conflict',
  'sqlite',
  'timeout',
  'protocol',
  'adapter',
  'auth',
  'network',
  'notFound',
  'config',
  'internal',
  'unknown',
]

export interface AppErrorPayload {
  nekodeAppError: true
  code: AppErrorCode
  message: string
  channel?: string
}

export const APP_ERROR_MARKER = '__nekode_app_error__'

/** Thrown in the main process; transported as a serialized payload string. */
export class AppError extends Error {
  readonly code: AppErrorCode
  readonly channel: string | undefined

  constructor(code: AppErrorCode, message: string, channel?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.channel = channel
  }

  toPayload(): AppErrorPayload {
    return { nekodeAppError: true, code: this.code, message: this.message, channel: this.channel }
  }
}

export function serializeAppError(error: AppError): string {
  return `${APP_ERROR_MARKER}${JSON.stringify(error.toPayload())}`
}

/**
 * Recognizes an app error from either form it can take on the renderer side:
 * a plain AppErrorPayload object (produced by the preload bridge) or an
 * Error/string whose message embeds the serialized payload (raw transport).
 * Returns null for anything else.
 */
export function parseAppErrorPayload(source: unknown): AppErrorPayload | null {
  if (typeof source === 'object' && source !== null && 'nekodeAppError' in source) {
    const candidate = source as Partial<AppErrorPayload>
    if (
      candidate.nekodeAppError === true &&
      isAppErrorCode(candidate.code) &&
      typeof candidate.message === 'string'
    ) {
      return {
        nekodeAppError: true,
        code: candidate.code,
        message: candidate.message,
        channel: candidate.channel,
      }
    }
    return null
  }

  const message =
    source instanceof Error ? source.message : typeof source === 'string' ? source : null
  if (message === null) {
    return null
  }
  const markerIndex = message.indexOf(APP_ERROR_MARKER)
  if (markerIndex === -1) {
    return null
  }
  try {
    const parsed = JSON.parse(
      message.slice(markerIndex + APP_ERROR_MARKER.length),
    ) as Partial<AppErrorPayload> | null
    if (parsed !== null && isAppErrorCode(parsed.code) && typeof parsed.message === 'string') {
      return {
        nekodeAppError: true,
        code: parsed.code,
        message: parsed.message,
        channel: parsed.channel,
      }
    }
  } catch {
    // Marker present but payload malformed: treat as a non-app error.
  }
  return null
}

export function isAppErrorPayload(source: unknown): source is AppErrorPayload {
  return parseAppErrorPayload(source) !== null
}

/**
 * Maps main-process errors to the serialized transport form. Unknown errors
 * are sanitized to a generic message (raw OS/library errors can leak paths or
 * internals); callers log the original error on the main side.
 */
export function toTransportError(error: unknown, channel: string): Error {
  if (error instanceof AppError) {
    const withChannel =
      error.channel === undefined ? new AppError(error.code, error.message, channel) : error
    return new Error(serializeAppError(withChannel))
  }
  return new Error(serializeAppError(new AppError('unknown', 'Unexpected error.', channel)))
}

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && (APP_ERROR_CODES as readonly string[]).includes(value)
}
