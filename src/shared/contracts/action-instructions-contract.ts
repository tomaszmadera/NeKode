// Configurable action instructions (spec handoff-resume-flow, NEKODE-172 and
// NEKODE-187). Start, Resume, Handoff and Continue are application-level:
// every project inherits the same text. A Resume source owns discovery only.

export const DEFAULT_HANDOFF_INSTRUCTION = 'Write a handoff'
export const DEFAULT_CONTINUE_INSTRUCTION = 'Continue'
export const DEFAULT_RESUME_INSTRUCTION = 'Resume task {taskPath}'
export const DEFAULT_START_INSTRUCTION = [
  'Work on task {ref}: {title}.',
  '{description}',
  '{url}',
  "Follow the project's instructions. Do not assume approval for actions that require it.",
  "Keep the full ref in the name of the local task record, following the project's instructions.",
].join('\n\n')

/** Substituted for a blank `{description}` in the Start instruction. */
export const START_NO_DESCRIPTION = 'This task has no description.'

/** Upper bound for one stored instruction, in characters. */
export const INSTRUCTION_MAX_LENGTH = 10000

export type InstructionKind = 'handoff' | 'continue' | 'start' | 'resume'

export type InstructionValidation = { ok: true; value: string } | { ok: false; message: string }

const RESUME_PLACEHOLDER = /\{(?:taskPath|handoffPath)\}/
const START_PLACEHOLDER = /\{(ref|title|description|url)\}/g

/**
 * Validate an instruction before it is stored. Text is kept exactly as typed:
 * line breaks, whitespace and braces are the user's content. Blank text is
 * rejected instead of silently becoming the default; Reset owns that.
 * Start requires `{ref}`; Resume requires `{taskPath}` (or its alias).
 */
export function validateInstruction(
  value: string,
  kind: InstructionKind = 'handoff',
): InstructionValidation {
  if (value.trim().length === 0)
    return { ok: false, message: 'Instruction cannot be empty. Use Reset to default.' }
  if (value.includes('\u0000'))
    return { ok: false, message: 'Instruction cannot contain a null character.' }
  if (value.length > INSTRUCTION_MAX_LENGTH)
    return {
      ok: false,
      message: `Instruction must be at most ${INSTRUCTION_MAX_LENGTH.toLocaleString('en-US')} characters.`,
    }
  if (kind === 'start' && !value.includes('{ref}'))
    return { ok: false, message: 'Start instruction must contain {ref}.' }
  if (kind === 'resume' && !RESUME_PLACEHOLDER.test(value))
    return { ok: false, message: 'Resume instruction must contain {taskPath}.' }
  return { ok: true, value }
}

/** True when a stored value may be sent as-is. */
export function isValidStoredInstruction(
  value: string,
  kind: InstructionKind = 'handoff',
): boolean {
  return validateInstruction(value, kind).ok
}

/**
 * Effective instruction for delivery. A missing, blank or invalid stored value
 * falls back to the built-in default; the Instructions tab reports an invalid
 * stored value so the fallback is never silent.
 */
export function resolveInstruction(
  value: string | null | undefined,
  fallback: string,
  kind: InstructionKind = 'handoff',
): string {
  if (value === null || value === undefined) return fallback
  return isValidStoredInstruction(value, kind) ? value : fallback
}

export interface StartInstructionValues {
  ref: string
  title: string
  description: string | null | undefined
  url: string | null | undefined
}

/**
 * Format the Start instruction (NEKODE-187). One pass: inserted values are
 * never scanned for placeholders. A template paragraph (split at blank lines)
 * that holds a placeholder and is blank after substitution is removed with
 * one adjoining separator; all other text stays literal.
 */
export function formatStartInstruction(template: string, values: StartInstructionValues): string {
  const description = values.description?.trim() ?? ''
  const replacements: Record<string, string> = {
    ref: values.ref,
    title: values.title,
    description: description.length > 0 ? description : START_NO_DESCRIPTION,
    url: values.url?.trim() ?? '',
  }
  const parts = template.split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/)
  const kept: Array<{ index: number; separator: string; text: string }> = []
  for (let index = 0; index < parts.length; index += 2) {
    const paragraph = parts[index]
    const hasPlaceholder = new RegExp(START_PLACEHOLDER.source).test(paragraph)
    const text = paragraph.replace(START_PLACEHOLDER, (_match, key: string) => replacements[key])
    if (hasPlaceholder && text.trim().length === 0) continue
    kept.push({ index, separator: index > 0 ? parts[index - 1] : '', text })
  }
  return kept
    .map((row, position) => (position === 0 ? row.text : row.separator + row.text))
    .join('')
}

/**
 * Previous Resume template prompts kept by the NEKODE-187 migration when they
 * differed. Stored as JSON under `instructions.resumeMigration`; empty means dismissed.
 */
export interface ResumeMigrationNotice {
  prompts: Array<{ prompt: string; templates: string[] }>
}

export function parseResumeMigrationNotice(
  raw: string | null | undefined,
): ResumeMigrationNotice | null {
  if (raw === null || raw === undefined || raw.trim().length === 0) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (
      typeof value !== 'object' ||
      value === null ||
      !Array.isArray((value as ResumeMigrationNotice).prompts)
    )
      return null
    const prompts = (value as ResumeMigrationNotice).prompts.filter(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        typeof row.prompt === 'string' &&
        Array.isArray(row.templates) &&
        row.templates.every((name) => typeof name === 'string'),
    )
    return prompts.length > 0 ? { prompts } : null
  } catch {
    return null
  }
}
