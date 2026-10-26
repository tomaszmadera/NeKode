import { z } from 'zod'
import { KANBAN_PRIORITIES } from './kanban-contract'
import {
  exactKeys,
  exactObject,
  nonBlankSchema,
  nonEmptyIdSchema,
  objectInput,
  stringValuesSchema,
  UNEXPECTED_OR_MISSING_FIELDS,
} from './schema-rules'

const PRIORITY_LIST = KANBAN_PRIORITIES.join('|')

/** `kanban:setConfig` body; extra keys are accepted as today. */
export const kanbanSetConfigInputSchema = z.object(
  {
    adapterId: z.string({ error: 'must be a string or null' }).nullable(),
    values: stringValuesSchema,
  },
  { error: 'must be an object' },
)

export type KanbanSetConfigInput = z.output<typeof kanbanSetConfigInputSchema>

/** `kanban:createItem` body; extra keys are accepted as today. */
export const kanbanCreateInputSchema = z.object(
  {
    title: nonBlankSchema,
    description: z.string({ error: 'must be a string' }).optional(),
    /** State name or group alias; resolved by the adapter, never by main. */
    stateRef: nonBlankSchema.optional(),
    priority: z.enum(KANBAN_PRIORITIES, { error: `must be one of ${PRIORITY_LIST}` }).optional(),
  },
  { error: 'must be an object' },
)

export type KanbanCreateInput = z.output<typeof kanbanCreateInputSchema>

const kanbanUpdatePatchShape = {
  title: nonBlankSchema.optional(),
  description: z.string({ error: 'must be a string' }).optional(),
  stateRef: nonBlankSchema.optional(),
  /**
   * Named priority, or null to clear it. Omit the field to leave priority
   * unchanged. Create still uses `KanbanPriority` only and does not clear.
   */
  priority: z
    .enum(KANBAN_PRIORITIES, { error: `must be one of ${PRIORITY_LIST} or null` })
    .nullable()
    .optional(),
}

const PATCHABLE_FIELDS = Object.keys(kanbanUpdatePatchShape)

/** `kanban:updateItem` patch: at least one field, every field patchable. */
export const kanbanUpdatePatchSchema = objectInput()
  .refine((input) => Object.keys(input).length > 0, {
    error: 'must change at least one field',
    abort: true,
  })
  .superRefine((input, ctx) => {
    const key = Object.keys(input).find((field) => !PATCHABLE_FIELDS.includes(field))
    if (key !== undefined) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'is not a patchable field' })
    }
  })
  .pipe(z.object(kanbanUpdatePatchShape))

export type KanbanUpdatePatch = z.output<typeof kanbanUpdatePatchSchema>

/**
 * Shared fields of `kanban:launchTask`. Main refetches the item with `getItem`
 * `{ ref }` and checks `itemId`. The renderer does not send a chat name,
 * description, or prompt.
 */
const launchTaskBaseShape = {
  projectId: nonEmptyIdSchema,
  itemId: nonEmptyIdSchema,
  ref: nonEmptyIdSchema,
  profileId: nonEmptyIdSchema,
  attemptId: nonEmptyIdSchema,
}

export const kanbanLaunchTaskBaseSchema = z.object(launchTaskBaseShape)

export type KanbanLaunchTaskBase = z.output<typeof kanbanLaunchTaskBaseSchema>

/** `kanban:launchTask` body for `mode: 'start'` (the Start prompt). */
export const kanbanStartLaunchInputSchema = z.strictObject({
  ...launchTaskBaseShape,
  mode: z.literal('start'),
})

export type KanbanStartLaunchInput = z.output<typeof kanbanStartLaunchInputSchema>

/**
 * `kanban:launchTask` body for `mode: 'resume'`. `fileName` and `stamp` come
 * from a scan result main just produced. Main rechecks the file and the stamp
 * immediately before creating the chat; a missing, unreadable, replaced, or
 * changed file refreshes the choice and creates no chat.
 */
export const kanbanResumeLaunchInputSchema = z.strictObject({
  ...launchTaskBaseShape,
  mode: z.literal('resume'),
  /**
   * File name from the scan result main just produced, never a free path: a
   * separator or a dot segment is rejected.
   */
  fileName: nonEmptyIdSchema.refine(
    (fileName) => !/[\\/]/.test(fileName) && fileName !== '.' && fileName !== '..',
    { error: 'must be a file name, not a path' },
  ),
  /** `modifiedAt` ISO stamp from that scan; main rechecks it before the chat. */
  stamp: nonEmptyIdSchema,
})

export type KanbanResumeLaunchInput = z.output<typeof kanbanResumeLaunchInputSchema>

/**
 * `kanban:launchTask` body for `mode: 'draft'` (Start without sending,
 * NEKODE-99). Main starts the profile with its interactive argv and returns the
 * Start prompt as `draftPrompt` instead of passing it to the process.
 */
export const kanbanDraftLaunchInputSchema = z.strictObject({
  ...launchTaskBaseShape,
  mode: z.literal('draft'),
})

export type KanbanDraftLaunchInput = z.output<typeof kanbanDraftLaunchInputSchema>

const launchKeysByMode: Record<string, (input: Record<string, unknown>) => boolean> = {
  start: exactKeys(kanbanStartLaunchInputSchema.shape),
  resume: exactKeys(kanbanResumeLaunchInputSchema.shape),
  draft: exactKeys(kanbanDraftLaunchInputSchema.shape),
}

/** Mode first, then that mode's exact key set, then the fields (today's order). */
export const kanbanLaunchTaskInputSchema = objectInput()
  .refine(
    (input) => typeof input.mode === 'string' && Object.hasOwn(launchKeysByMode, input.mode),
    {
      error: 'must be "start", "resume" or "draft"',
      path: ['mode'],
      abort: true,
    },
  )
  .refine((input) => launchKeysByMode[input.mode as string](input), {
    error: UNEXPECTED_OR_MISSING_FIELDS,
    abort: true,
  })
  .pipe(
    z.discriminatedUnion('mode', [
      kanbanStartLaunchInputSchema,
      kanbanResumeLaunchInputSchema,
      kanbanDraftLaunchInputSchema,
    ]),
  )

export type KanbanLaunchTaskInput = z.output<typeof kanbanLaunchTaskInputSchema>

/** `kanban:handoffCandidates` body. Item identity comes from the board. */
export const kanbanHandoffCandidatesInputSchema = exactObject({
  projectId: nonEmptyIdSchema,
  itemId: nonEmptyIdSchema,
  ref: nonEmptyIdSchema,
})

export type KanbanHandoffCandidatesInput = z.output<typeof kanbanHandoffCandidatesInputSchema>

/**
 * `kanban:handoffAvailability` body. The renderer sends the loaded items'
 * identities only, never a disk path; main resolves the configured directory
 * from its own state.
 */
export const kanbanHandoffAvailabilityInputSchema = exactObject({
  projectId: nonEmptyIdSchema,
  items: z.array(exactObject({ itemId: nonEmptyIdSchema, ref: nonEmptyIdSchema }), {
    error: 'must be an array',
  }),
})

export type KanbanHandoffAvailabilityInput = z.output<typeof kanbanHandoffAvailabilityInputSchema>
