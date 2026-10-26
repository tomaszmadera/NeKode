import { z } from 'zod'
import { parseAgentCommand } from '../agent-command'
import { agentInteractiveArgsError, agentProfileFieldError } from './agent-profiles-contract'
import { BARE_MESSAGE, exactObject } from './schema-rules'

/** Agent and project ids: a non-empty string without NUL characters. */
export const agentIdSchema = z
  .string({ error: 'must be a string' })
  .refine((id) => id.length > 0 && !id.includes('\u0000'), {
    error: 'must be non-empty without NUL characters',
  })

/**
 * `agentProfiles:put` body. `id: null` creates a global profile. A string
 * edits the same definition for future launches in every selected project.
 * Field rules shared with the editor form (`parseAgentCommand`,
 * `agentProfileFieldError`) report their own sentences without the label.
 */
export const agentProfilePutSchema = exactObject({
  id: agentIdSchema.nullable(),
  name: z.string({ error: 'must be a string' }),
  command: z.string({ error: 'must be a string' }),
  interactiveArgs: z
    .custom<string[]>((value) => agentInteractiveArgsError(value) === null, {
      error: (issue) => agentInteractiveArgsError(issue.input) ?? undefined,
      params: BARE_MESSAGE,
    })
    .optional(),
}).superRefine((input, ctx) => {
  let parsed: ReturnType<typeof parseAgentCommand>
  try {
    parsed = parseAgentCommand(input.command)
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: (error as Error).message, params: BARE_MESSAGE })
    return
  }
  const message = agentProfileFieldError({
    name: input.name,
    ...parsed,
    interactiveArgs: input.interactiveArgs,
  })
  if (message !== null) ctx.addIssue({ code: 'custom', message, params: BARE_MESSAGE })
})

export type AgentProfilePut = z.output<typeof agentProfilePutSchema>

/** `agentProfiles:selectionSet` body; exact key set. */
export const agentProjectSelectionInputSchema = exactObject({
  selectedIds: z.array(agentIdSchema, { error: 'must be an array' }),
  defaultId: agentIdSchema.nullable(),
})
  .refine((input) => new Set(input.selectedIds).size === input.selectedIds.length, {
    error: 'selected ids must be unique',
    abort: true,
  })
  .refine((input) => input.defaultId === null || input.selectedIds.includes(input.defaultId), {
    error: 'default agent must be selected',
  })

export type AgentProjectSelectionInput = z.output<typeof agentProjectSelectionInputSchema>
