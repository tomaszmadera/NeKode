import { isAbsolute } from 'node:path'
import { z } from 'zod'

// Reusable rules for the IPC payload schemas (agent-friendly-architecture spec
// Business rules). Main-process validation imports the `*-schema.ts` modules;
// the renderer imports only their inferred types through the domain
// contracts, so Zod and `node:path` stay out of the renderer bundle.
//
// Messages are rule fragments: main prefixes them with the channel label and
// the issue path (for example `actions:create input.cwd must be an absolute
// path`). An issue carrying `BARE_MESSAGE` params is a complete user-facing
// sentence and is reported without the label.

export const BARE_MESSAGE = { bare: true } as const

export const UNEXPECTED_OR_MISSING_FIELDS = 'has unexpected or missing fields'

const NUL = '\u0000'

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Any non-null, non-array object; the first stage of every object payload. */
export function objectInput(error = 'must be an object') {
  return z.custom<Record<string, unknown>>(isObjectRecord, { error, abort: true })
}

/**
 * Key-set rule of `shape`: the returned predicate is true when an object has
 * every key whose schema rejects `undefined` and no key outside `shape`.
 */
export function exactKeys(shape: z.core.$ZodShape): (value: Record<string, unknown>) => boolean {
  const allowed = Object.keys(shape)
  const required = allowed.filter((key) => !z.safeParse(shape[key], undefined).success)
  return (value) => {
    const present = Object.keys(value)
    return (
      present.every((key) => allowed.includes(key)) &&
      required.every((key) => present.includes(key))
    )
  }
}

/**
 * Object with an exact key set, checked before any field rule (today's order):
 * a missing required key or an extra key is `has unexpected or missing fields`.
 */
export function exactObject<S extends z.core.$ZodShape>(shape: S, error = 'must be an object') {
  return objectInput(error)
    .refine(exactKeys(shape), { error: UNEXPECTED_OR_MISSING_FIELDS, abort: true })
    .pipe(z.strictObject(shape))
}

/**
 * Map of string values (adapter config values); any object, every value a
 * string. Iterates `Object.entries` so an own `__proto__` key (kept by
 * structured clone) is checked too; `z.object().catchall()` skips it.
 */
export const stringValuesSchema = z
  .custom<Record<string, string>>(isObjectRecord, { error: 'must be an object', abort: true })
  .superRefine((value, ctx) => {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry !== 'string') {
        ctx.addIssue({ code: 'custom', path: [key], message: 'must be a string' })
      }
    }
  })

/** Non-blank string without NUL characters (ids and refs sent by the renderer). */
export const nonEmptyIdSchema = z
  .string({ error: 'must be a non-empty string' })
  .refine((value) => value.trim().length > 0, { error: 'must be a non-empty string' })
  .refine((value) => !value.includes(NUL), { error: 'must not contain NUL characters' })

/** Non-blank string (titles, commands). */
export const nonBlankSchema = z
  .string({ error: 'must be non-empty' })
  .refine((value) => value.trim().length > 0, { error: 'must be non-empty' })

/**
 * Path-shaped arguments (project roots, terminal cwd) are renderer-supplied
 * strings that become OS operations. Reject ambiguous input up front: NUL
 * bytes, relative paths and '..' segments (traversal).
 */
export const safePathSchema = z
  .string({ error: 'must be a string' })
  .refine((path) => !path.includes(NUL), { error: 'must not contain NUL characters' })
  .refine((path) => isAbsolute(path), { error: 'must be an absolute path' })
  .refine((path) => !path.split(/[\\/]+/).includes('..'), {
    error: 'must not contain ".." segments',
  })
