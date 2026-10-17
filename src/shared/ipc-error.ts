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
  | 'git_error'
  | 'unknown'

export type AppErrorKind = AppErrorCode

export const APP_ERROR_CODES: readonly AppErrorCode[] = [
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
  'git_error',
  'unknown',
]

export interface AppErrorPayload {
  nekodeAppError: true
  code: AppErrorCode
  kind?: AppErrorKind
  message: string
  channel?: string
}

export type NekodeAppError = AppErrorPayload

export const APP_ERROR_MARKER = '__nekode_app_error__'

/** Thrown in the main process; transported as a serialized payload string. */
export class AppError extends Error {
  readonly nekodeAppError = true as const
  readonly code: AppErrorCode
  readonly kind: AppErrorKind
  readonly channel: string | undefined

  constructor(code: AppErrorCode, message: string, channel?: string, kind?: AppErrorKind) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.kind = kind ?? code
    this.channel = channel
  }

  toPayload(): AppErrorPayload {
    return {
      nekodeAppError: true,
      code: this.code,
      kind: this.kind,
      message: this.message,
      channel: this.channel,
    }
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
    const candidate = source as Partial<AppErrorPayload> & { kind?: unknown }
    const resolvedCode = isAppErrorCode(candidate.code)
      ? candidate.code
      : isAppErrorCode(candidate.kind)
        ? candidate.kind
        : null
    if (
      candidate.nekodeAppError === true &&
      resolvedCode !== null &&
      typeof candidate.message === 'string'
    ) {
      const resolvedKind = isAppErrorCode(candidate.kind) ? candidate.kind : resolvedCode
      return {
        nekodeAppError: true,
        code: resolvedCode,
        kind: resolvedKind,
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
    const parsed = JSON.parse(message.slice(markerIndex + APP_ERROR_MARKER.length)) as
      | (Partial<AppErrorPayload> & { kind?: unknown })
      | null
    if (parsed !== null && typeof parsed.message === 'string') {
      const resolvedCode = isAppErrorCode(parsed.code)
        ? parsed.code
        : isAppErrorCode(parsed.kind)
          ? parsed.kind
          : null
      if (resolvedCode !== null) {
        const resolvedKind = isAppErrorCode(parsed.kind) ? parsed.kind : resolvedCode
        return {
          nekodeAppError: true,
          code: resolvedCode,
          kind: resolvedKind,
          message: parsed.message,
          channel: parsed.channel,
        }
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
 * Normalizes any error, rejection, or raw message into a typed NekodeAppError / AppErrorPayload.
 * Preserves existing codes and kinds, or defaults to 'unknown'.
 */
export function toNekodeAppError(
  source: unknown,
  fallbackMessage = 'Unexpected error.',
  channel?: string,
): NekodeAppError {
  const parsed = parseAppErrorPayload(source)
  if (parsed !== null) {
    return channel && !parsed.channel ? { ...parsed, channel } : parsed
  }
  if (source instanceof AppError) {
    const payload = source.toPayload()
    return channel && !payload.channel ? { ...payload, channel } : payload
  }
  const message =
    source instanceof Error && source.message
      ? source.message
      : typeof source === 'string' && source.length > 0
        ? source
        : fallbackMessage
  return {
    nekodeAppError: true,
    code: 'unknown',
    kind: 'unknown',
    message,
    channel,
  }
}

export interface FormattedError {
  message: string
  code: AppErrorCode
  kind: AppErrorKind
  channel?: string
}

/**
 * Extracts human-readable message and machine-readable code/kind from any error source.
 */
export function formatError(
  source: unknown,
  fallback = 'Unexpected error.',
): FormattedError & { toString(): string } {
  const appError = toNekodeAppError(source, fallback)
  const message = appError.message
  return {
    message,
    code: appError.code,
    kind: appError.kind ?? appError.code,
    channel: appError.channel,
    toString: () => message,
  }
}

export function formatErrorMessage(source: unknown, fallback = 'Unexpected error.'): string {
  return toNekodeAppError(source, fallback).message
}

/**
 * Maps main-process errors to the serialized transport form. Unknown errors
 * are sanitized to a generic message (raw OS/library errors can leak paths or
 * internals); callers log the original error on the main side.
 */
export function toTransportError(error: unknown, channel: string): Error {
  if (error instanceof AppError) {
    const withChannel =
      error.channel === undefined
        ? new AppError(error.code, error.message, channel, error.kind)
        : error
    return new Error(serializeAppError(withChannel))
  }
  return new Error(serializeAppError(new AppError('unknown', 'Unexpected error.', channel)))
}

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && (APP_ERROR_CODES as readonly string[]).includes(value)
}

export const isAppErrorKind = isAppErrorCode
