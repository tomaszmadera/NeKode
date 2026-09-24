import { describe, expect, it } from 'vitest'
import {
  APP_ERROR_MARKER,
  AppError,
  parseAppErrorPayload,
  serializeAppError,
  toTransportError,
} from './ipc-error'

describe('typed error transport', () => {
  it('round-trips AppError through the serialized message form', () => {
    const original = new AppError('conflict', 'Already exists.', 'projects:add')
    const parsed = parseAppErrorPayload(new Error(serializeAppError(original)))
    expect(parsed).toEqual({
      nekodeAppError: true,
      code: 'conflict',
      message: 'Already exists.',
      channel: 'projects:add',
    })
  })

  it('attaches the channel on AppError without one and keeps typed codes', () => {
    const transport = toTransportError(new AppError('not_found', 'Missing.'), 'tasks:list')
    const parsed = parseAppErrorPayload(transport)
    expect(parsed?.code).toBe('not_found')
    expect(parsed?.channel).toBe('tasks:list')
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
    expect(parsed?.message).toBe('Unexpected error.')
    expect(transport.message).not.toContain('secret')
  })

  it('parses raw transport strings and rejects foreign errors', () => {
    expect(parseAppErrorPayload(`${APP_ERROR_MARKER}{"nekodeAppError":true`)).toBeNull()
    expect(parseAppErrorPayload('plain error')).toBeNull()
    expect(parseAppErrorPayload(42)).toBeNull()
  })
})
