import { describe, expect, it } from 'vitest'
import {
  APP_ERROR_MARKER,
  AppError,
  formatErrorMessage,
  isAppErrorCode,
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

  it('carries an optional detail through the transport and the plain payload form', () => {
    const original = new AppError('not_found', 'Missing file.', undefined, undefined, 'why')
    const parsed = parseAppErrorPayload(toTransportError(original, 'kanban:listBoard'))
    expect(parsed).toStrictEqual({
      nekodeAppError: true,
      code: 'not_found',
      kind: 'not_found',
      message: 'Missing file.',
      channel: 'kanban:listBoard',
      detail: 'why',
    })
    expect(parseAppErrorPayload(parsed)?.detail).toBe('why')
    const without = parseAppErrorPayload(
      toTransportError(new AppError('not_found', 'Missing.'), 'kanban:listBoard'),
    )
    expect(without !== null && 'detail' in without).toBe(false)
    expect(
      parseAppErrorPayload({ nekodeAppError: true, code: 'not_found', message: 'x', detail: 1 }),
    ).not.toHaveProperty('detail')
  })

  it('attaches a channel only when the AppError has none', async () => {
    const attached = parseAppErrorPayload(
      toTransportError(new AppError('not_found', 'Missing.'), 'chats:list'),
    )
    expect(attached?.code).toBe('not_found')
    expect(attached?.kind).toBe('not_found')
    expect(attached?.channel).toBe('chats:list')
    const kept = parseAppErrorPayload(
      toTransportError(new AppError('sqlite', 'Database error.', 'state:get'), 'x'),
    )
    expect(kept?.channel).toBe('state:get')
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
    for (const code of ['auth', 'network', 'config', 'internal'] as const) {
      const transport = toTransportError(new AppError(code, 'adapter said so'), 'kanban:test')
      const parsed = parseAppErrorPayload(transport)
      expect(parsed?.code).toBe(code)
      expect(parsed?.kind).toBe(code)
    }
  })

  it('normalizes validation_error to validation and notFound to not_found', () => {
    const validationError = parseAppErrorPayload({
      nekodeAppError: true,
      code: 'validation_error',
      message: 'Invalid task format.',
    })
    expect(validationError?.code).toBe('validation')
    expect(validationError?.kind).toBe('validation')

    const notFoundError = parseAppErrorPayload({
      nekodeAppError: true,
      code: 'notFound',
      message: 'Item not found.',
    })
    expect(notFoundError?.code).toBe('not_found')
    expect(notFoundError?.kind).toBe('not_found')

    const fromTransport = parseAppErrorPayload(
      toTransportError(new AppError('validation_error', 'Invalid task format.'), 'test:channel'),
    )
    expect(fromTransport?.code).toBe('validation')
    expect(fromTransport?.kind).toBe('validation')
  })

  it('transports git_error typed code through the IPC bridge', () => {
    const transport = toTransportError(
      new AppError('git_error', 'git pull failed: merge conflict'),
      'git:sync',
    )
    const parsed = parseAppErrorPayload(transport)
    expect(parsed?.code).toBe('git_error')
    expect(parsed?.kind).toBe('git_error')
    expect(parsed?.message).toBe('git pull failed: merge conflict')
    expect(parsed?.channel).toBe('git:sync')
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

  it('extracts the renderer message from a typed or unknown error', () => {
    expect(formatErrorMessage(new AppError('validation', 'Name is required.', 'users:add'))).toBe(
      'Name is required.',
    )
    expect(formatErrorMessage(new Error('Network failure'))).toBe('Network failure')
    expect(formatErrorMessage(null, 'Default failure')).toBe('Default failure')
  })

  it('validates error codes with the type guard', () => {
    expect(isAppErrorCode('validation')).toBe(true)
    expect(isAppErrorCode('not-a-code')).toBe(false)
    expect(isAppErrorCode(123)).toBe(false)
  })
})
