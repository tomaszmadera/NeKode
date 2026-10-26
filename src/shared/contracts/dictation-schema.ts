import { z } from 'zod'

const nonEmptyTermSchema = z
  .string({ error: 'must be a non-empty string' })
  .refine((term) => term.trim().length > 0, { error: 'must be a non-empty string' })

const aliasesSchema = z.array(z.string({ error: 'must be a string' }), {
  error: 'must be an array of strings',
})

const descriptionSchema = z.string({ error: 'must be a string or null' }).nullable()

/** `dictation:dictionaryAdd` body; extra keys are accepted as today. */
export const createDictionaryEntryInputSchema = z
  .object(
    {
      /** Not validated by the channel today; the dictionary service owns it. */
      id: z.custom<string>().optional(),
      term: nonEmptyTermSchema,
      scope: z.enum(['global', 'project'], { error: "must be 'global' or 'project'" }),
      /** Scope-dependent: checked by the refinement below. */
      projectId: z.custom<string | null>().optional(),
      aliases: aliasesSchema.optional(),
      description: descriptionSchema.optional(),
      enabled: z.boolean({ error: 'must be a boolean' }).optional(),
    },
    { error: 'must be an object' },
  )
  .superRefine((input, ctx) => {
    if (input.scope === 'project') {
      if (typeof input.projectId !== 'string' || input.projectId.trim().length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['projectId'],
          message: 'must be a non-empty string for project scope',
        })
      }
    } else if (input.projectId !== undefined && input.projectId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'must not be set for global scope',
      })
    }
  })

export type CreateDictionaryEntryInput = z.output<typeof createDictionaryEntryInputSchema>

/** `dictation:dictionaryUpdate` body; extra keys are accepted as today. */
export const updateDictionaryEntryInputSchema = z.object(
  {
    term: nonEmptyTermSchema.optional(),
    aliases: aliasesSchema.optional(),
    description: descriptionSchema.optional(),
    enabled: z.boolean({ error: 'must be a boolean' }).optional(),
  },
  { error: 'must be an object' },
)

export type UpdateDictionaryEntryInput = z.output<typeof updateDictionaryEntryInputSchema>

/** A string restricted to `values`; the inferred type stays `string`. */
function stringOneOf(values: readonly string[], error: string) {
  return z.string({ error }).refine((value) => values.includes(value), { error })
}

/**
 * `dictation:postProcessingSetSettings` body. `mode` and `level` stay typed as
 * `string` (the service maps them); the schema restricts their values.
 */
export const setPostProcessingSettingsInputSchema = z.object(
  {
    mode: stringOneOf(
      ['disabled', 'provider_native', 'external_llm'],
      "must be 'disabled', 'provider_native', or 'external_llm'",
    ),
    level: stringOneOf(['light', 'medium', 'full'], "must be 'light', 'medium', or 'full'"),
    model: z.string({ error: 'must be a string' }).optional(),
    apiKey: z.string({ error: 'must be a string' }).optional(),
  },
  { error: 'must be an object' },
)

export type SetPostProcessingSettingsInput = z.output<typeof setPostProcessingSettingsInputSchema>

/** Provider config object (`dictation:providers*` config argument): any object. */
export const providerConfigSchema = z.looseObject({}, { error: 'must be an object' })
