import { z } from 'zod'
import { exactObject, nonBlankSchema, safePathSchema } from './schema-rules'

/** `actions:create` / `actions:update` body; exact key set. */
export const actionInputSchema = exactObject(
  {
    scope: z.enum(['global', 'project'], { error: 'is invalid' }),
    projectId: z.string({ error: 'must be a string' }).nullable(),
    title: nonBlankSchema,
    icon: z.string({ error: 'must be a string' }).nullable(),
    command: nonBlankSchema,
    cwd: safePathSchema.nullable(),
    runMode: z.enum(['background', 'new-terminal', 'bottom-terminal'], { error: 'is invalid' }),
    confirm: z.boolean({ error: 'must be a boolean' }),
    sortOrder: z
      .number({ error: 'must be an integer' })
      .refine(Number.isSafeInteger, { error: 'must be an integer' }),
  },
  'must be an action object',
).refine((input) => (input.scope === 'project') === (input.projectId !== null), {
  error: 'has inconsistent scope and projectId',
})

export type ActionInput = z.output<typeof actionInputSchema>
