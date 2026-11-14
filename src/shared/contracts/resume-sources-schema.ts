import { z } from 'zod'

export const resumeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/)
export const resumeRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const resumeTokenSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !value.includes('\u0000'))
const text = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => !value.includes('\u0000'))
const sourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('files'),
    directory: text.refine((value) => {
      if (!value.trim()) return false
      if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return true
      if (/^[A-Za-z]:/.test(value)) return false
      let depth = 0
      for (const part of value.split(/[\\/]/)) {
        if (part === '..') {
          if (--depth < 0) return false
        } else if (part !== '' && part !== '.') depth++
      }
      return true
    }, 'A relative directory must stay within the project.'),
    pattern: text.refine((value) => !/[\\/]/.test(value)),
    recursive: z.boolean(),
    identity: z.enum(['stem', 'parent']),
  }),
  z
    .strictObject({
      kind: z.literal('command'),
      protocol: z.enum(['generic', 'agent-harness']),
      executable: text.refine((value) => value.trim().length > 0),
      args: z.array(
        z
          .string()
          .max(32768)
          .refine((value) => !value.includes('\u0000')),
      ),
    })
    .refine(
      (value) =>
        value.protocol !== 'agent-harness' ||
        (value.executable === 'python' &&
          JSON.stringify(value.args) ===
            JSON.stringify(['.agents/scripts/taskctl', 'list', '--json'])),
      'Agent Harness uses python .agents/scripts/taskctl list --json.',
    ),
])

const putFields = {
  id: resumeIdSchema.nullable(),
  revision: resumeRevisionSchema.nullable(),
  name: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value.trim().length > 0 && !value.includes('\u0000')),
  source: sourceSchema,
}

const sameIdentity = (value: { id: string | null; revision: number | null }) =>
  (value.id === null) === (value.revision === null)
const identityMessage = 'New sources use null id and revision; editing requires both.'

/** A save carries no prompt: the Resume instruction is application-level (NEKODE-187). */
export const resumeSourcePutSchema = z.strictObject(putFields).refine(sameIdentity, identityMessage)

/**
 * A stored row may still carry a pre-NEKODE-187 `prompt`. It is accepted on
 * read, ignored, and dropped on the next save of that row.
 */
export const storedResumeSourceSchema = z
  .strictObject({ ...putFields, prompt: z.string().optional() })
  .refine(sameIdentity, identityMessage)
