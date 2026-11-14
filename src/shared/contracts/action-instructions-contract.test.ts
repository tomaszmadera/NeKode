import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTINUE_INSTRUCTION,
  DEFAULT_HANDOFF_INSTRUCTION,
  DEFAULT_RESUME_INSTRUCTION,
  DEFAULT_START_INSTRUCTION,
  formatStartInstruction,
  INSTRUCTION_MAX_LENGTH,
  isValidStoredInstruction,
  parseResumeMigrationNotice,
  resolveInstruction,
  type StartInstructionValues,
  validateInstruction,
} from './action-instructions-contract'

/** The fixed Start text before NEKODE-187, kept to prove the default reproduces it. */
function previousStartPrompt(item: StartInstructionValues): string {
  const description = item.description?.trim() ?? ''
  const url = item.url?.trim() ?? ''
  return [
    `Work on task ${item.ref}: ${item.title}.`,
    description.length > 0 ? description : 'This task has no description.',
    ...(url.length > 0 ? [url] : []),
    "Follow the project's instructions. Do not assume approval for actions that require it.",
    "Keep the full ref in the name of the local task record, following the project's instructions.",
  ].join('\n\n')
}

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

  describe('Start instruction (NEKODE-187)', () => {
    const item = (overrides: Partial<StartInstructionValues> = {}): StartInstructionValues => ({
      ref: 'DEMO-1',
      title: 'Ship it',
      description: 'line one\n\nline {url} {ref} $& two',
      url: 'https://example.test/DEMO-1',
      ...overrides,
    })

    it.each([
      ['description and URL', item()],
      ['no description', item({ description: '  \n ' })],
      ['no URL', item({ url: ' ' })],
      ['neither', item({ description: null, url: undefined })],
    ])('the default reproduces the previous fixed text with %s', (_label, values) => {
      expect(formatStartInstruction(DEFAULT_START_INSTRUCTION, values)).toBe(
        previousStartPrompt(values),
      )
    })

    it('substitutes all placeholders in one pass and keeps other text literal', () => {
      const template = 'Ref {ref}\nTitle {title} {unknown} $1\n\n{description}\n\nLink: {url}'
      expect(formatStartInstruction(template, item())).toBe(
        'Ref DEMO-1\nTitle Ship it {unknown} $1\n\nline one\n\nline {url} {ref} $& two\n\nLink: https://example.test/DEMO-1',
      )
    })

    it('removes a paragraph left blank by a placeholder with one separator only', () => {
      expect(formatStartInstruction('A {ref}\n\n{url}\n\nB', item({ url: null }))).toBe(
        'A DEMO-1\n\nB',
      )
      expect(formatStartInstruction('{url}\n\nA {ref}', item({ url: '' }))).toBe('A DEMO-1')
      expect(formatStartInstruction('A {ref}\n\n{url}', item({ url: '' }))).toBe('A DEMO-1')
      expect(formatStartInstruction('A {ref}\n\nLink: {url}', item({ url: '' }))).toBe(
        'A DEMO-1\n\nLink: ',
      )
      expect(formatStartInstruction('A {ref}\n\n\n\nB', item())).toBe('A DEMO-1\n\n\n\nB')
    })

    it('requires {ref} and the shared limits', () => {
      expect(validateInstruction('Work on {title}', 'start')).toEqual({
        ok: false,
        message: 'Start instruction must contain {ref}.',
      })
      expect(validateInstruction('Work on {ref}', 'start')).toEqual({
        ok: true,
        value: 'Work on {ref}',
      })
      expect(validateInstruction(' ', 'start').ok).toBe(false)
      expect(validateInstruction('{ref}\u0000', 'start').ok).toBe(false)
      expect(validateInstruction(`{ref}${'a'.repeat(INSTRUCTION_MAX_LENGTH)}`, 'start').ok).toBe(
        false,
      )
    })
  })

  describe('Resume instruction (NEKODE-187)', () => {
    it('defaults to Resume task {taskPath}', () => {
      expect(DEFAULT_RESUME_INSTRUCTION).toBe('Resume task {taskPath}')
    })

    it('requires {taskPath} or its deprecated alias', () => {
      expect(validateInstruction('Resume something', 'resume')).toEqual({
        ok: false,
        message: 'Resume instruction must contain {taskPath}.',
      })
      expect(validateInstruction('Resume {taskPath}', 'resume').ok).toBe(true)
      expect(validateInstruction('Resume {handoffPath}', 'resume').ok).toBe(true)
    })

    it('falls back to the default for a missing, blank or invalid stored value', () => {
      expect(resolveInstruction(null, DEFAULT_RESUME_INSTRUCTION, 'resume')).toBe(
        DEFAULT_RESUME_INSTRUCTION,
      )
      expect(resolveInstruction(' ', DEFAULT_RESUME_INSTRUCTION, 'resume')).toBe(
        DEFAULT_RESUME_INSTRUCTION,
      )
      expect(resolveInstruction('No path', DEFAULT_RESUME_INSTRUCTION, 'resume')).toBe(
        DEFAULT_RESUME_INSTRUCTION,
      )
      expect(resolveInstruction('No ref', DEFAULT_START_INSTRUCTION, 'start')).toBe(
        DEFAULT_START_INSTRUCTION,
      )
      expect(resolveInstruction('Mine {taskPath}', DEFAULT_RESUME_INSTRUCTION, 'resume')).toBe(
        'Mine {taskPath}',
      )
    })

    it('parses the migration notice and treats empty or malformed values as none', () => {
      const notice = { prompts: [{ prompt: 'A {taskPath}', templates: ['A'] }] }
      expect(parseResumeMigrationNotice(JSON.stringify(notice))).toEqual(notice)
      expect(parseResumeMigrationNotice('')).toBeNull()
      expect(parseResumeMigrationNotice(null)).toBeNull()
      expect(parseResumeMigrationNotice('{broken')).toBeNull()
      expect(parseResumeMigrationNotice('{"prompts":[]}')).toBeNull()
    })
  })
})
