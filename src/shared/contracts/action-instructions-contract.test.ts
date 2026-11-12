import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTINUE_INSTRUCTION,
  DEFAULT_HANDOFF_INSTRUCTION,
  INSTRUCTION_MAX_LENGTH,
  isValidStoredInstruction,
  resolveInstruction,
  validateInstruction,
} from './action-instructions-contract'

describe('action instructions', () => {
  it('keeps the current defaults', () => {
    expect(DEFAULT_HANDOFF_INSTRUCTION).toBe('Write a handoff')
    expect(DEFAULT_CONTINUE_INSTRUCTION).toBe('Continue')
  })

  it('resolves a missing or blank stored value to the default', () => {
    expect(resolveInstruction(null, DEFAULT_HANDOFF_INSTRUCTION)).toBe('Write a handoff')
    expect(resolveInstruction(undefined, DEFAULT_CONTINUE_INSTRUCTION)).toBe('Continue')
    expect(resolveInstruction('', DEFAULT_HANDOFF_INSTRUCTION)).toBe('Write a handoff')
    expect(resolveInstruction('   \n\t ', DEFAULT_CONTINUE_INSTRUCTION)).toBe('Continue')
  })

  it('returns stored text exactly, including multiline text and literal characters', () => {
    const instruction = 'Plan {scope}\nPrice $5 and keep braces {taskPath}\r\n  indented'
    expect(resolveInstruction(instruction, DEFAULT_HANDOFF_INSTRUCTION)).toBe(instruction)
    const validation = validateInstruction(instruction)
    expect(validation).toEqual({ ok: true, value: instruction })
  })

  it('rejects blank text instead of silently replacing it', () => {
    expect(validateInstruction('')).toEqual({
      ok: false,
      message: 'Instruction cannot be empty. Use Reset to default.',
    })
    expect(validateInstruction(' \n\t')).toEqual({
      ok: false,
      message: 'Instruction cannot be empty. Use Reset to default.',
    })
  })

  it('rejects NUL and oversize text', () => {
    expect(validateInstruction('a\u0000b')).toEqual({
      ok: false,
      message: 'Instruction cannot contain a null character.',
    })
    expect(validateInstruction('a'.repeat(INSTRUCTION_MAX_LENGTH + 1))).toEqual({
      ok: false,
      message: `Instruction must be at most ${INSTRUCTION_MAX_LENGTH.toLocaleString('en-US')} characters.`,
    })
  })

  it('treats invalid stored text as a fallback and reports it as invalid', () => {
    expect(isValidStoredInstruction('Send\ncontext')).toBe(true)
    expect(isValidStoredInstruction('')).toBe(false)
    expect(isValidStoredInstruction('a\u0000b')).toBe(false)
    expect(resolveInstruction('a\u0000b', DEFAULT_HANDOFF_INSTRUCTION)).toBe('Write a handoff')
  })
})
