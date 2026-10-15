import { describe, expect, it } from 'vitest'
import {
  APP_ERROR_MARKER,
  AppError,
  formatError,
  formatErrorMessage,
  isAppErrorCode,
  isAppErrorKind,
  parseAppErrorPayload,
  serializeAppError,
  toNekodeAppError,
  toTransportError,
} from './ipc-error'

describe('typed error transport', () => {
  it('round-trips AppError through the serialized message form with code and kind', () => {
    const original = new AppError('conflict', 'Already exists.', 'projects:add')
    const parsed = parseAppErrorPayload(new Error(serializeAppError(original)))
    expect(parsed).toEqual({
      nekodeAppError: true,
      code: 'conflict',
      kind: 'conflict',
      message: 'Already exists.',
      channel: 'projects:add',
    })
  })

  it('attaches the channel on AppError without one and keeps typed codes and kinds', () => {
    const transport = toTransportError(new AppError('not_found', 'Missing.'), 'chats:list')
    const parsed = parseAppErrorPayload(transport)
    expect(parsed?.code).toBe('not_found')
    expect(parsed?.kind).toBe('not_found')
    expect(parsed?.channel).toBe('chats:list')
  })

  it('keeps the original channel when already set', () => {
    const transport = toTransportError(new AppError('sqlite', 'Database error.', 'state:get'), 'x')
    expect(parseAppErrorPayload(transport)?.channel).toBe('state:get')
  })

  it('sanitizes unknown errors instead of leaking raw messages', () => {
    const raw = new Error('SQLITE_CANTOPEN: unable to open database file C:\\Users\\secret\\x.db')
    const transport = toTransportError(raw, 'state:set')
    const parsed = parseAppErrorPayload(transport)
    expect(parsed?.code).toBe('unknown')
    expect(parsed?.kind).toBe('unknown')
    expect(parsed?.message).toBe('Unexpected error.')
    expect(transport.message).not.toContain('secret')
  })

  it('parses raw transport strings and rejects foreign errors', () => {
    expect(parseAppErrorPayload(`${APP_ERROR_MARKER}{"nekodeAppError":true`)).toBeNull()
    expect(parseAppErrorPayload('plain error')).toBeNull()
    expect(parseAppErrorPayload(42)).toBeNull()
  })

  it('keeps the adapter-reported failure codes typed through transport', () => {
    // Finding: toAppError must surface the adapter's own code verbatim.
    for (const code of ['auth', 'network', 'notFound', 'config', 'internal'] as const) {
      const transport = toTransportError(new AppError(code, 'adapter said so'), 'kanban:test')
      const parsed = parseAppErrorPayload(transport)
      expect(parsed?.code).toBe(code)
      expect(parsed?.kind).toBe(code)
    }
  })

  it('parses backwards-compatible payloads with only code or only kind', () => {
    const codeOnly = parseAppErrorPayload({
      nekodeAppError: true,
      code: 'validation',
      message: 'Invalid input.',
    })
    expect(codeOnly).toEqual({
      nekodeAppError: true,
      code: 'validation',
      kind: 'validation',
      message: 'Invalid input.',
      channel: undefined,
    })

    const kindOnly = parseAppErrorPayload({
      nekodeAppError: true,
      kind: 'timeout',
      message: 'Timed out.',
    })
    expect(kindOnly).toEqual({
      nekodeAppError: true,
      code: 'timeout',
      kind: 'timeout',
      message: 'Timed out.',
      channel: undefined,
    })
  })

  it('normalizes various error sources via toNekodeAppError', () => {
    const appErr = new AppError('conflict', 'Exists.', 'proj:create')
    expect(toNekodeAppError(appErr)).toEqual({
      nekodeAppError: true,
      code: 'conflict',
      kind: 'conflict',
      message: 'Exists.',
      channel: 'proj:create',
    })

    const stdErr = new Error('Standard error message')
    expect(toNekodeAppError(stdErr, 'Fallback message', 'sys:test')).toEqual({
      nekodeAppError: true,
      code: 'unknown',
      kind: 'unknown',
      message: 'Standard error message',
      channel: 'sys:test',
    })

    expect(toNekodeAppError('string error', 'Fallback')).toEqual({
      nekodeAppError: true,
      code: 'unknown',
      kind: 'unknown',
      message: 'string error',
      channel: undefined,
    })

    expect(toNekodeAppError(null, 'Custom fallback')).toEqual({
      nekodeAppError: true,
      code: 'unknown',
      kind: 'unknown',
      message: 'Custom fallback',
      channel: undefined,
    })
  })

  it('formats errors with machine-readable code/kind and message string', () => {
    const typed = new AppError('validation', 'Name is required.', 'users:add')
    const formatted = formatError(typed)
    expect(formatted.code).toBe('validation')
    expect(formatted.kind).toBe('validation')
    expect(formatted.message).toBe('Name is required.')
    expect(formatted.channel).toBe('users:add')
    expect(String(formatted)).toBe('Name is required.')
    expect(formatErrorMessage(typed)).toBe('Name is required.')

    const raw = new Error('Network failure')
    const formattedRaw = formatError(raw, 'Default failure')
    expect(formattedRaw.code).toBe('unknown')
    expect(formattedRaw.kind).toBe('unknown')
    expect(formattedRaw.message).toBe('Network failure')
    expect(String(formattedRaw)).toBe('Network failure')
  })

  it('validates error codes and kinds with type guards', () => {
    expect(isAppErrorCode('validation')).toBe(true)
    expect(isAppErrorCode('not-a-code')).toBe(false)
    expect(isAppErrorKind('timeout')).toBe(true)
    expect(isAppErrorKind(123)).toBe(false)
  })
})
