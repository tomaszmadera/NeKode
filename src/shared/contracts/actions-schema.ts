import { z } from 'zod'
import { exactObject, nonBlankSchema, safePathSchema } from './schema-rules'

/** `actions:create` / `actions:update` body; exact key set. */
export const actionInputSchema = exactObject(
  {
    scope: z.enum(['global', 'project'], { error: 'is invalid' }),
    projectId: z.string({ error: 'must be a string' }).nullable(),
    title: nonBlankSchema,
    icon: z.string({ error: 'must be a string' }).nullable(),
    /**
     * Group name for the action row (action-groups spec Behaviour 1-3); `null`
     * keeps the action as its own button. Trimmed by the service, and an empty
     * result is stored as `null`.
     */
    group: z
      .string({ error: 'must be a string' })
      .refine((value) => value.trim().length <= 60, { error: 'must be at most 60 characters' })
      .nullable(),
    command: nonBlankSchema,
    cwd: safePathSchema.nullable(),
    runMode: z.enum(['background', 'new-terminal', 'bottom-terminal', 'current-terminal'], {
      error: 'is invalid',
    }),
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
