// Configurable action-bar instructions (spec handoff-resume-flow, NEKODE-172).
// Handoff and Continue are application-level: every project inherits the same
// text. The Resume instruction is not here; it stays in the shared Resume
// template so there is exactly one editable source.

export const DEFAULT_HANDOFF_INSTRUCTION = 'Write a handoff'
export const DEFAULT_CONTINUE_INSTRUCTION = 'Continue'

/** Upper bound for one stored instruction, in characters. */
export const INSTRUCTION_MAX_LENGTH = 10000

export type InstructionValidation = { ok: true; value: string } | { ok: false; message: string }

/**
 * Validate an instruction before it is stored. Text is kept exactly as typed:
 * line breaks, whitespace and braces are the user's content. Blank text is
 * rejected instead of silently becoming the default; Reset owns that.
 */
export function validateInstruction(value: string): InstructionValidation {
  if (value.trim().length === 0)
    return { ok: false, message: 'Instruction cannot be empty. Use Reset to default.' }
  if (value.includes('\u0000'))
    return { ok: false, message: 'Instruction cannot contain a null character.' }
  if (value.length > INSTRUCTION_MAX_LENGTH)
    return {
      ok: false,
      message: `Instruction must be at most ${INSTRUCTION_MAX_LENGTH.toLocaleString('en-US')} characters.`,
    }
  return { ok: true, value }
}

/** True when a stored value may be sent as-is. */
export function isValidStoredInstruction(value: string): boolean {
  return validateInstruction(value).ok
}

/**
 * Effective instruction for delivery. A missing, blank or invalid stored value
 * falls back to the built-in default; the Instructions tab reports an invalid
 * stored value so the fallback is never silent.
 */
export function resolveInstruction(value: string | null | undefined, fallback: string): string {
  if (value === null || value === undefined) return fallback
  return isValidStoredInstruction(value) ? value : fallback
}
